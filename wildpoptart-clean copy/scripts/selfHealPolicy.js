/**
 * selfHealPolicy.js
 * v2.0.0 — question-aware self-healing memory for survey automation
 *
 * Purpose:
 * - Detects recurring DOM or LLM extraction issues.
 * - Learns working fallbacks per question pattern (Level 2: Question-aware).
 * - Persists them per-platform AND per-question-signature so future surveys auto-adapt.
 *
 * Integration: Chrome Extension Manifest V3 compatible
 * Uses chrome.storage.local instead of localStorage for better extension performance
 */

const HEAL_KEY = "selfHealPolicies_v2";
const MAX_HEALS_PER_PATTERN = 10;
const MAX_PATTERNS_PER_PLATFORM = 50;

// Internal caches
let platformCache = {};
let globalDelays = {};
let isLoaded = false;

/**
 * Simple hash function for generating pattern signatures.
 * @param {string} str - Input string
 * @returns {string} Hash string
 */
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h; // Convert to 32-bit integer
  }
  return Math.abs(h).toString(36);
}

/**
 * Detect question type from a question element.
 * @param {Element} questionEl - Question DOM element
 * @returns {string} Question type (text, radio, checkbox, select, slider, matrix, textarea, unknown)
 */
function detectQuestionType(questionEl) {
  if (!questionEl) return 'unknown';

  // Check for specific input types
  const inputs = questionEl.querySelectorAll('input, select, textarea');

  // Radio buttons
  if (questionEl.querySelector('input[type="radio"]')) return 'radio';

  // Checkboxes
  if (questionEl.querySelector('input[type="checkbox"]')) return 'checkbox';

  // Dropdown/Select
  if (questionEl.querySelector('select')) return 'select';

  // Slider (range input or custom slider elements)
  if (questionEl.querySelector('input[type="range"], .slider, [role="slider"]')) return 'slider';

  // Text area
  if (questionEl.querySelector('textarea')) return 'textarea';

  // Text input
  if (questionEl.querySelector('input[type="text"], input[type="number"], input[type="email"]')) return 'text';

  // Matrix (multiple rows with similar structure)
  const rows = questionEl.querySelectorAll('tr, .matrix-row, [class*="row"]');
  if (rows.length > 2 && inputs.length > rows.length) return 'matrix';

  // Default to text if inputs exist but type unclear
  return inputs.length > 0 ? 'text' : 'unknown';
}

/**
 * Compute a unique pattern signature for a question element.
 * This creates a fingerprint based on question structure, type, and content.
 * @param {Element} questionEl - Question DOM element
 * @returns {string} Pattern signature
 */
function computePatternSignature(questionEl) {
  if (!questionEl) return 'unknown_0_0';

  // Extract text content and normalize
  const text = questionEl.innerText?.toLowerCase().replace(/\s+/g, ' ').trim() || '';
  const textHash = hash(text.substring(0, 200)); // Use first 200 chars to avoid huge text

  // Detect question type
  const type = detectQuestionType(questionEl);

  // Count options/inputs
  const optionCount = questionEl.querySelectorAll('input, option, textarea, select').length;

  // Generate signature: type_optionCount_textHash
  return `${type}_${optionCount}_${textHash}`;
}

/**
 * Load all stored healings from chrome.storage.local.
 * @returns {Promise<object>} Platform cache
 */
async function loadHealDB() {
  if (isLoaded) return platformCache;

  try {
    const result = await chrome.storage.local.get(HEAL_KEY);
    let data = result[HEAL_KEY] || {};

    // Migrate old v1 format to v2 if needed
    // Old: { platform: [array of heals] }
    // New: { platform: { patternSignature: [array of heal entries] } }
    Object.keys(data).forEach(platform => {
      if (Array.isArray(data[platform])) {
        console.log(`[HEAL] Migrating v1 data for ${platform} to v2 format`);
        data[platform] = { 'legacy_pattern': data[platform] };
      }
    });

    platformCache = data;
    isLoaded = true;

    let totalPatterns = 0;
    Object.keys(platformCache).forEach(platform => {
      totalPatterns += Object.keys(platformCache[platform] || {}).length;
    });

    console.log(`[HEAL] Loaded ${Object.keys(platformCache).length} platforms with ${totalPatterns} total patterns`);
  } catch (error) {
    console.error('[HEAL] Failed to load heal database:', error);
    platformCache = {};
  }

  // Load delays into memory (from any pattern)
  Object.keys(platformCache).forEach(platform => {
    const patterns = platformCache[platform] || {};
    Object.keys(patterns).forEach(patternSig => {
      const heals = patterns[patternSig] || [];
      heals.forEach(heal => {
        if (heal.delay && !globalDelays[platform]) {
          globalDelays[platform] = heal.delay;
        }
      });
    });
  });

  return platformCache;
}

/**
 * Save to chrome.storage.local (debounced to avoid thrash).
 */
let saveTimeout;
async function saveHealDB() {
  clearTimeout(saveTimeout);
  return new Promise(resolve => {
    saveTimeout = setTimeout(async () => {
      try {
        await chrome.storage.local.set({ [HEAL_KEY]: platformCache });
        console.log(`[HEAL] Saved policies for ${Object.keys(platformCache).length} platforms`);
        resolve();
      } catch (error) {
        console.error('[HEAL] Failed to save heal database:', error);
        resolve();
      }
    }, 300);
  });
}

/**
 * Record a new healing fix (Level 2: Question-aware).
 * @param {string} platform - e.g., "ipsos", "qualtrics", "typeform"
 * @param {string} patternSignature - Unique question pattern signature
 * @param {object} healData - Healing data object
 * @param {string} healData.questionType - Question type (radio, checkbox, etc.)
 * @param {Array<string>} healData.selectors - Working selectors
 * @param {number} [healData.delay] - Delay in milliseconds
 * @param {boolean} [healData.success=true] - Whether the healing was successful
 * @returns {Promise<void>}
 */
async function recordHealing(platform, patternSignature, healData) {
  await loadHealDB();

  if (!platformCache[platform]) platformCache[platform] = {};
  if (!platformCache[platform][patternSignature]) platformCache[platform][patternSignature] = [];

  const patterns = platformCache[platform][patternSignature];
  const success = healData.success !== false; // Default to true

  // Find existing entry with same selectors
  let existingEntry = patterns.find(entry =>
    JSON.stringify(entry.selectors) === JSON.stringify(healData.selectors)
  );

  if (existingEntry) {
    // Update success/failure counts
    if (success) {
      existingEntry.successCount = (existingEntry.successCount || 0) + 1;
    } else {
      existingEntry.failureCount = (existingEntry.failureCount || 0) + 1;
    }
    existingEntry.lastUsed = Date.now();

    // Update delay if provided (running average)
    if (healData.delay) {
      const oldDelay = existingEntry.delay || healData.delay;
      existingEntry.delay = Math.round(oldDelay * 0.7 + healData.delay * 0.3);
    }

    console.log(`[HEAL] Updated ${platform}/${patternSignature}: success=${existingEntry.successCount}, failure=${existingEntry.failureCount}`);
  } else {
    // Create new entry
    const newEntry = {
      patternSignature,
      questionType: healData.questionType,
      selectors: healData.selectors || [],
      delay: healData.delay || 0,
      successCount: success ? 1 : 0,
      failureCount: success ? 0 : 1,
      timestamp: Date.now(),
      lastUsed: Date.now(),
      url: window.location.hostname
    };

    platformCache[platform][patternSignature].push(newEntry);
    console.log(`[HEAL] ✓ Learned new pattern for ${platform}/${patternSignature}:`, newEntry);
  }

  // Limit patterns per platform
  const patternCount = Object.keys(platformCache[platform]).length;
  if (patternCount > MAX_PATTERNS_PER_PLATFORM) {
    // Remove oldest pattern
    const patterns = Object.keys(platformCache[platform]);
    const oldestPattern = patterns.reduce((oldest, current) => {
      const oldestTime = platformCache[platform][oldest][0]?.lastUsed || 0;
      const currentTime = platformCache[platform][current][0]?.lastUsed || 0;
      return currentTime < oldestTime ? current : oldest;
    });
    delete platformCache[platform][oldestPattern];
    console.log(`[HEAL] Removed oldest pattern: ${oldestPattern}`);
  }

  // Limit heals per pattern
  if (platformCache[platform][patternSignature].length > MAX_HEALS_PER_PATTERN) {
    platformCache[platform][patternSignature].shift();
  }

  await saveHealDB();
}

/**
 * Return all heals for a platform and optional pattern.
 * @param {string} platform
 * @param {string} [patternSignature] - Optional pattern signature
 * @returns {Promise<Array|Object>}
 */
async function getHealsFor(platform, patternSignature = null) {
  await loadHealDB();

  if (!platformCache[platform]) return patternSignature ? [] : {};

  if (patternSignature) {
    // Return heals for specific pattern
    return platformCache[platform][patternSignature] || [];
  }

  // Return all patterns for platform
  return platformCache[platform];
}

/**
 * Apply known heals to current detection environment (Level 2: Pattern-aware).
 * Injects selectors, timing adjustments based on matching question patterns.
 * @param {string} platform
 * @param {string} [patternSignature] - Question pattern signature for targeted healing
 * @param {object} env - Current detection environment
 * @returns {Promise<object>} Updated environment with learned fixes
 */
async function applyHeals(platform, patternSignature = null, env = {}) {
  const allPatterns = await getHealsFor(platform);
  let addedSelectors = [];
  let appliedDelay = null;

  // If pattern signature provided, prioritize matching pattern
  if (patternSignature && allPatterns[patternSignature]) {
    const patternHeals = allPatterns[patternSignature];

    // Sort by success rate (successCount / (successCount + failureCount))
    const sortedHeals = patternHeals.sort((a, b) => {
      const aRate = a.successCount / Math.max(1, a.successCount + a.failureCount);
      const bRate = b.successCount / Math.max(1, b.successCount + b.failureCount);
      return bRate - aRate; // Higher success rate first
    });

    // Apply best performing heals
    sortedHeals.forEach(heal => {
      if (heal.selectors && heal.selectors.length > 0) {
        env.candidateSelectors = [
          ...(env.candidateSelectors || []),
          ...heal.selectors
        ];
        addedSelectors.push(...heal.selectors);
      }

      if (heal.delay && !appliedDelay) {
        appliedDelay = heal.delay;
        env.delay = heal.delay;
      }
    });

    if (addedSelectors.length) {
      console.log(`[HEAL] Applied ${addedSelectors.length} selectors for ${platform}/${patternSignature}:`, addedSelectors);
    }
    if (appliedDelay) {
      console.log(`[HEAL] Applied learned delay for ${platform}/${patternSignature}: ${appliedDelay}ms`);
    }
  } else {
    // No specific pattern - apply general platform heals (fallback mode)
    Object.keys(allPatterns).forEach(pattern => {
      const heals = allPatterns[pattern];
      heals.forEach(heal => {
        if (heal.selectors && heal.selectors.length > 0 && addedSelectors.length < 10) {
          // Limit to 10 fallback selectors
          const newSelectors = heal.selectors.filter(s => !addedSelectors.includes(s));
          env.candidateSelectors = [
            ...(env.candidateSelectors || []),
            ...newSelectors
          ];
          addedSelectors.push(...newSelectors);
        }

        if (heal.delay && !appliedDelay) {
          appliedDelay = heal.delay;
          env.delay = heal.delay;
        }
      });
    });

    if (addedSelectors.length) {
      console.log(`[HEAL] Applied ${addedSelectors.length} fallback selectors for ${platform}`);
    }
  }

  return env;
}

/**
 * Learn an average delay for DOM stabilization.
 * @param {string} platform
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>}
 */
async function learnDelay(platform, ms) {
  const current = globalDelays[platform];
  let newDelay;

  if (!current) {
    newDelay = ms;
  } else {
    // Smooth average (70% old, 30% new)
    newDelay = Math.round(current * 0.7 + ms * 0.3);
  }

  globalDelays[platform] = newDelay;
  await recordHealing(platform, "renderDelay", { type: "delay", ms: newDelay });
}

/**
 * Retrieve learned delay if any.
 * @param {string} platform
 * @returns {number} Delay in milliseconds
 */
function getDelay(platform) {
  return globalDelays[platform] || 0;
}

/**
 * Identify platform from current URL and DOM.
 * @returns {string} Platform identifier
 */
function detectPlatform() {
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  // Check URL patterns
  if (hostname.includes('ipsos')) return 'ipsos';
  if (hostname.includes('qualtrics')) return 'qualtrics';
  if (hostname.includes('surveymonkey')) return 'surveymonkey';
  if (hostname.includes('typeform')) return 'typeform';
  if (hostname.includes('google.com/forms')) return 'google-forms';
  if (hostname.includes('confirmit')) return 'confirmit';
  if (hostname.includes('decipher')) return 'decipher';

  // Check DOM signatures
  if (document.querySelector('.MuiDialog-root, .MuiFormControl-root')) return 'material-ui';
  if (document.querySelector('[ng-app], [ng-controller]')) return 'angular';
  if (document.querySelector('.cm-sliders-container')) return 'confirmit';
  if (document.querySelector('form[data-quest-mindshare]')) return 'quest-mindshare';

  // Fallback to hostname
  return hostname.split('.')[0] || 'unknown';
}

/**
 * Export statistics for debugging (Level 2: Pattern-aware).
 * @returns {Promise<Array>} Array of pattern statistics
 */
async function getHealStats() {
  await loadHealDB();

  const statsList = [];

  Object.keys(platformCache).forEach(platform => {
    const patterns = platformCache[platform];

    Object.keys(patterns).forEach(patternSig => {
      const heals = patterns[patternSig];

      heals.forEach(heal => {
        const totalAttempts = (heal.successCount || 0) + (heal.failureCount || 0);
        const successRate = totalAttempts > 0
          ? ((heal.successCount || 0) / totalAttempts * 100).toFixed(1) + '%'
          : 'N/A';

        statsList.push({
          platform,
          patternSignature: patternSig.substring(0, 30) + (patternSig.length > 30 ? '...' : ''),
          questionType: heal.questionType || 'unknown',
          selectors: heal.selectors?.slice(0, 2).join(', ') || 'none',
          delay: heal.delay || 0,
          successCount: heal.successCount || 0,
          failureCount: heal.failureCount || 0,
          successRate,
          lastUsed: heal.lastUsed ? new Date(heal.lastUsed).toISOString().substring(0, 10) : 'N/A'
        });
      });
    });
  });

  // Sort by success count descending
  statsList.sort((a, b) => b.successCount - a.successCount);

  return statsList;
}

/**
 * Clear all healing policies (for debugging).
 * @returns {Promise<void>}
 */
async function clearHealDB() {
  platformCache = {};
  globalDelays = {};
  isLoaded = false;
  await chrome.storage.local.remove(HEAL_KEY);
  console.log('[HEAL] All healing policies cleared');
}

// Make functions available globally for content.js
window.selfHeal = {
  // Core functions
  recordHealing,
  getHealsFor,
  applyHeals,
  learnDelay,
  getDelay,
  detectPlatform,
  getHealStats,
  clearHealDB,
  // Level 2 helpers
  computePatternSignature,
  detectQuestionType,
  hash
};
