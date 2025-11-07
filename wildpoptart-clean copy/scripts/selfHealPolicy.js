/**
 * selfHealPolicy.js
 * v3.0.0 — Level 3: Context-Aware Self-Healing
 *
 * Purpose:
 * - Detects recurring DOM or LLM extraction issues.
 * - Learns working fallbacks with context features.
 * - Predicts similar patterns based on DOM structure.
 * - Adapts timing based on page complexity.
 * - Persists them per-platform so future surveys auto-adapt.
 *
 * Level 3 Features:
 * - extractContextFeatures(): Records DOM depth, parent classes, siblings, UI indicators
 * - findSimilarPatterns(): Matches current context to stored patterns with similarity scoring
 * - predictDelay(): Adjusts timing based on DOM complexity
 * - Context-aware applyHeals() with predictive selector merging
 *
 * Integration: Chrome Extension Manifest V3 compatible
 * Uses chrome.storage.local instead of localStorage for better extension performance
 */

const HEAL_KEY = "selfHealPolicies_v1";
const MAX_HEALS_PER_PLATFORM = 25;

// Internal caches
let platformCache = {};
let globalDelays = {};
let isLoaded = false;

/**
 * Load all stored healings from chrome.storage.local.
 * @returns {Promise<object>} Platform cache
 */
async function loadHealDB() {
  if (isLoaded) return platformCache;

  try {
    const result = await chrome.storage.local.get(HEAL_KEY);
    platformCache = result[HEAL_KEY] || {};
    isLoaded = true;
    console.log(`[HEAL] Loaded ${Object.keys(platformCache).length} platform policies from storage`);
  } catch (error) {
    console.error('[HEAL] Failed to load heal database:', error);
    platformCache = {};
  }

  // Load delays into memory
  Object.keys(platformCache).forEach(platform => {
    const delayHeal = platformCache[platform]?.find(h => h.issue === 'renderDelay');
    if (delayHeal?.fix?.ms) {
      globalDelays[platform] = delayHeal.fix.ms;
    }
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
 * Record a new healing fix.
 * Level 3: Now stores context features
 * @param {string} platform - e.g., "ipsos", "qualtrics", "typeform"
 * @param {string} issue - e.g., "noElementsFound", "zeroWidthSpace", "dialogSearch"
 * @param {object} fix - description of what worked (e.g., selector, delay)
 * @param {HTMLElement} element - Optional element to extract context from
 * @returns {Promise<void>}
 */
async function recordHealing(platform, issue, fix, element = null) {
  await loadHealDB();

  if (!platformCache[platform]) platformCache[platform] = [];

  // Extract context features if element provided
  const contextFeatures = element ? extractContextFeatures(element) : null;

  // Check if this exact fix already exists
  const exists = platformCache[platform].some(h =>
    h.issue === issue && JSON.stringify(h.fix) === JSON.stringify(fix)
  );

  if (exists) {
    console.log(`[HEAL] Fix already known for ${platform}: ${issue}`);
    return;
  }

  platformCache[platform].push({
    issue,
    fix,
    contextFeatures,
    timestamp: Date.now(),
    url: window.location.hostname
  });

  // Limit per-platform memory
  if (platformCache[platform].length > MAX_HEALS_PER_PLATFORM) {
    platformCache[platform].shift();
  }

  await saveHealDB();
  console.log(`[HEAL] ✓ Learned new fix for ${platform}: ${issue} →`, fix);
  if (contextFeatures) {
    console.log(`[HEAL] Context: depth=${contextFeatures.depth}, siblings=${contextFeatures.siblingCount}`, contextFeatures);
  }
}

/**
 * Return all heals for a platform.
 * @param {string} platform
 * @returns {Promise<Array>}
 */
async function getHealsFor(platform) {
  await loadHealDB();
  return platformCache[platform] || [];
}

/**
 * Apply known heals to current detection environment.
 * Level 3: Context-aware pattern matching with predictions
 * @param {string} platform
 * @param {object} env - Current detection environment
 * @param {object} context - Current context features (optional)
 * @returns {Promise<object>} Updated environment
 */
async function applyHeals(platform, env = {}, context = null) {
  const heals = await getHealsFor(platform);
  let addedSelectors = [];
  let exactMatch = false;

  // Try exact pattern matching first
  heals.forEach(({ issue, fix }) => {
    if (fix.type === "selector" && Array.isArray(fix.selectors)) {
      env.candidateSelectors = [
        ...(env.candidateSelectors || []),
        ...fix.selectors
      ];
      addedSelectors.push(...fix.selectors);
      exactMatch = true;
    }
    if (fix.type === "delay" && fix.ms) {
      globalDelays[platform] = fix.ms;
      env.delay = fix.ms;
    }
  });

  // Level 3: If no exact match and context provided, try similar patterns
  if (!exactMatch && context && heals.length > 0) {
    const similarPatterns = findSimilarPatterns(context, heals);

    if (similarPatterns.length > 0) {
      console.log(`[HEAL-PREDICT] Found ${similarPatterns.length} similar patterns for context matching`);

      // Merge selectors from top similar patterns
      const mergedSelectors = [];
      similarPatterns.forEach(({ heal, score }) => {
        if (heal.fix.type === "selector" && Array.isArray(heal.fix.selectors)) {
          mergedSelectors.push(...heal.fix.selectors);
          console.log(`[HEAL-PREDICT] Pattern match (score: ${score.toFixed(1)}): ${heal.issue}`, heal.fix.selectors);
        }
      });

      if (mergedSelectors.length > 0) {
        env.candidateSelectors = [
          ...(env.candidateSelectors || []),
          ...mergedSelectors
        ];
        addedSelectors.push(...mergedSelectors);
        console.log(`[HEAL-MERGED] Applied ${mergedSelectors.length} selectors from similar patterns`);
      }
    }
  }

  // Level 3: Predict adaptive delay based on context
  if (context) {
    const predictedDelay = predictDelay(context, globalDelays[platform] || 500);
    if (predictedDelay !== (globalDelays[platform] || 500)) {
      env.delay = predictedDelay;
      console.log(`[HEAL-PREDICT] Adaptive delay: ${predictedDelay}ms (depth=${context.depth}, components: slider=${context.hasSlider}, dropdown=${context.hasDropdown})`);
    }
  }

  if (addedSelectors.length) {
    console.log(`[HEAL] Applied ${addedSelectors.length} extra selectors for ${platform}:`, [...new Set(addedSelectors)]);
  }
  if (env.delay) {
    console.log(`[HEAL] Applied delay override for ${platform}: ${env.delay}ms`);
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
 * Extract context features from a DOM element.
 * Level 3: Context-Aware Detection
 * @param {HTMLElement} element - Target element
 * @returns {object} Context features
 */
function extractContextFeatures(element) {
  if (!element) return null;

  // Calculate DOM depth
  let depth = 0;
  let current = element;
  while (current.parentElement) {
    depth++;
    current = current.parentElement;
  }

  // Get parent class names (up to 3 levels)
  const parentClasses = [];
  current = element.parentElement;
  for (let i = 0; i < 3 && current; i++) {
    if (current.className && typeof current.className === 'string') {
      parentClasses.push(...current.className.split(' ').filter(c => c.trim()));
    }
    current = current.parentElement;
  }

  // Count siblings
  const siblingCount = element.parentElement ? element.parentElement.children.length : 0;

  // Detect UI component indicators
  const ancestorHTML = element.closest('body')?.innerHTML || '';
  const hasSlider = !!(element.closest('[class*="slider"]') ||
                       element.querySelector('[class*="slider"]') ||
                       /slider|range|thumb/i.test(ancestorHTML.substring(0, 5000)));

  const hasDropdown = !!(element.closest('select, [class*="dropdown"], [class*="select"]') ||
                         element.querySelector('select, [class*="dropdown"], [class*="select"]'));

  const hasCheckbox = !!(element.closest('[type="checkbox"], [class*="checkbox"]') ||
                         element.querySelector('[type="checkbox"], [class*="checkbox"]'));

  return {
    depth,
    parentClasses: [...new Set(parentClasses)].slice(0, 10), // Top 10 unique classes
    siblingCount,
    hasSlider,
    hasDropdown,
    hasCheckbox
  };
}

/**
 * Find similar patterns based on context features.
 * Level 3: Pattern Matching
 * @param {object} currentContext - Current context features
 * @param {Array} heals - Array of heal records
 * @returns {Array} Similar patterns with scores
 */
function findSimilarPatterns(currentContext, heals) {
  if (!currentContext || !heals || heals.length === 0) return [];

  const scored = heals
    .filter(h => h.contextFeatures)
    .map(heal => {
      const ctx = heal.contextFeatures;
      let score = 0;

      // Depth similarity (normalized)
      const depthDiff = Math.abs(ctx.depth - currentContext.depth);
      score += Math.max(0, 1 - depthDiff / 20) * 20;

      // Parent class overlap
      const contextClasses = new Set(currentContext.parentClasses || []);
      const healClasses = new Set(ctx.parentClasses || []);
      const intersection = [...contextClasses].filter(c => healClasses.has(c));
      score += (intersection.length / Math.max(contextClasses.size, 1)) * 30;

      // Sibling count similarity
      const siblingDiff = Math.abs(ctx.siblingCount - currentContext.siblingCount);
      score += Math.max(0, 1 - siblingDiff / 10) * 15;

      // UI component matches
      if (ctx.hasSlider === currentContext.hasSlider) score += 10;
      if (ctx.hasDropdown === currentContext.hasDropdown) score += 10;
      if (ctx.hasCheckbox === currentContext.hasCheckbox) score += 15;

      return { heal, score };
    })
    .filter(item => item.score > 30) // Minimum threshold
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 5); // Top 5 matches
}

/**
 * Predict appropriate delay based on context complexity.
 * Level 3: Adaptive Timing
 * @param {object} contextFeatures - Context features
 * @param {number} baseDelay - Base delay in ms
 * @returns {number} Predicted delay in ms
 */
function predictDelay(contextFeatures, baseDelay = 500) {
  if (!contextFeatures) return baseDelay;

  let delay = baseDelay;

  // Increase for deep DOM trees (more complex rendering)
  if (contextFeatures.depth > 15) delay += 200;
  else if (contextFeatures.depth > 10) delay += 100;

  // Increase for interactive components
  if (contextFeatures.hasSlider) delay += 150;
  if (contextFeatures.hasDropdown) delay += 100;
  if (contextFeatures.hasCheckbox) delay += 50;

  // Cap maximum delay
  return Math.min(delay, 2000);
}

/**
 * Export statistics for debugging.
 * @returns {Promise<object>}
 */
async function getHealStats() {
  await loadHealDB();

  const stats = {};
  Object.keys(platformCache).forEach(platform => {
    const heals = platformCache[platform];
    stats[platform] = {
      totalHeals: heals.length,
      issues: {},
      delay: globalDelays[platform] || 0
    };

    heals.forEach(({ issue }) => {
      stats[platform].issues[issue] = (stats[platform].issues[issue] || 0) + 1;
    });
  });

  return stats;
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
  recordHealing,
  getHealsFor,
  applyHeals,
  learnDelay,
  getDelay,
  detectPlatform,
  getHealStats,
  clearHealDB,
  // Level 3 functions
  extractContextFeatures,
  findSimilarPatterns,
  predictDelay
};
