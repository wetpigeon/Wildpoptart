/**
 * selfHealPolicy.js
 * v2.0.0 — Level 3: Context-Aware Self-Healing with Question Awareness
 *
 * Purpose:
 * - Detects recurring DOM or LLM extraction issues.
 * - Learns working fallbacks with full context awareness.
 * - Adapts based on platform, DOM structure, question type, and survey phase.
 * - Tracks success/failure rates for adaptive learning.
 *
 * Upgrade from v1.0.0 (Platform-Aware) to v2.0.0 (Context-Aware):
 * - Level 2.5: Question type awareness
 * - Level 3: Full context matching (platform + DOM fingerprint + question type + phase)
 * - Adaptive learning with success/failure tracking
 * - Real-time heuristic optimization
 *
 * Integration: Chrome Extension Manifest V3 compatible
 */

const HEAL_KEY = "selfHealPolicies_v2";
const MAX_HEALS_PER_PLATFORM = 50; // Increased for context-aware storage
const CONTEXT_MATCH_THRESHOLD = 0.6; // Minimum similarity score (0-1)

// Matching weights for context similarity
const MATCH_WEIGHTS = {
  platform: 0.25,      // Platform match importance
  domHash: 0.30,       // DOM structure similarity
  questionType: 0.25,  // Question type match
  phase: 0.20          // Survey phase match
};

// Internal caches
let platformCache = {};
let globalDelays = {};
let isLoaded = false;
let sessionStats = {}; // Track in-session heal performance

/**
 * Load all stored healings from chrome.storage.local.
 * @returns {Promise<object>} Platform cache
 */
async function loadHealDB() {
  if (isLoaded) return platformCache;

  try {
    const result = await chrome.storage.local.get(HEAL_KEY);
    platformCache = result[HEAL_KEY] || {};

    // Backward compatibility: try loading v1 data if v2 is empty
    if (Object.keys(platformCache).length === 0) {
      const v1Result = await chrome.storage.local.get("selfHealPolicies_v1");
      if (v1Result["selfHealPolicies_v1"]) {
        console.log('[HEAL] Migrating v1 data to v2 format...');
        platformCache = migrateV1ToV2(v1Result["selfHealPolicies_v1"]);
        await saveHealDB();
      }
    }

    isLoaded = true;
    console.log(`[HEAL v2.0] Loaded ${Object.keys(platformCache).length} platform policies from storage`);
  } catch (error) {
    console.error('[HEAL] Failed to load heal database:', error);
    platformCache = {};
  }

  // Load delays into memory
  Object.keys(platformCache).forEach(platform => {
    const delayHeals = platformCache[platform]?.filter(h => h.issue === 'renderDelay') || [];
    if (delayHeals.length > 0) {
      // Use the most recently used delay heal
      const latestDelay = delayHeals.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))[0];
      if (latestDelay?.fix?.ms) {
        globalDelays[platform] = latestDelay.fix.ms;
      }
    }
  });

  return platformCache;
}

/**
 * Migrate v1 heal data to v2 format with context fields.
 * @param {object} v1Data - Old format heal data
 * @returns {object} v2 format with context
 */
function migrateV1ToV2(v1Data) {
  const v2Data = {};

  Object.keys(v1Data).forEach(platform => {
    v2Data[platform] = v1Data[platform].map(oldHeal => ({
      issue: oldHeal.issue,
      fix: oldHeal.fix,
      timestamp: oldHeal.timestamp || Date.now(),
      url: oldHeal.url || window.location.hostname,
      // New v2 fields with defaults
      context: {
        platform: platform,
        domHash: 'unknown',
        questionType: 'unknown',
        phase: 'detection',
        dialogCount: 0
      },
      lastUsed: oldHeal.timestamp || Date.now(),
      successCount: 1,
      failureCount: 0
    }));
  });

  console.log(`[HEAL] Migrated ${Object.keys(v2Data).length} platforms to v2 format`);
  return v2Data;
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
 * Compute a lightweight DOM fingerprint for context matching.
 * Captures key structural elements without full DOM serialization.
 * @returns {string} Hash representing DOM structure
 */
function computeDOMFingerprint() {
  const features = [];

  // Count key element types
  features.push(`dialogs:${document.querySelectorAll('[role="dialog"], .MuiDialog-root, .modal').length}`);
  features.push(`forms:${document.querySelectorAll('form').length}`);
  features.push(`inputs:${document.querySelectorAll('input[type="text"], textarea').length}`);
  features.push(`radios:${document.querySelectorAll('input[type="radio"]').length}`);
  features.push(`checkboxes:${document.querySelectorAll('input[type="checkbox"]').length}`);
  features.push(`selects:${document.querySelectorAll('select').length}`);
  features.push(`sliders:${document.querySelectorAll('input[type="range"], .slider, [role="slider"]').length}`);
  features.push(`buttons:${document.querySelectorAll('button, [role="button"]').length}`);

  // Detect common frameworks
  if (document.querySelector('.MuiDialog-root, .MuiFormControl-root')) features.push('mui');
  if (document.querySelector('[ng-app], [ng-controller]')) features.push('angular');
  if (document.querySelector('[data-reactroot], [data-reactid]')) features.push('react');
  if (document.querySelector('.cm-sliders-container')) features.push('confirmit');

  const fingerprint = features.join('|');

  // Create simple hash (djb2 algorithm)
  let hash = 5381;
  for (let i = 0; i < fingerprint.length; i++) {
    hash = ((hash << 5) + hash) + fingerprint.charCodeAt(i);
  }

  return (hash >>> 0).toString(36); // Convert to base36 string
}

/**
 * Detect question type from DOM inspection.
 * Called from content.js with element context.
 * @param {Element} element - Question element to inspect
 * @returns {string} Question type identifier
 */
function detectQuestionType(element) {
  if (!element) return 'unknown';

  // Look in element and its container
  const container = element.closest('form, [role="dialog"], .question, .MuiFormControl-root') || element;

  // Count input types
  const radios = container.querySelectorAll('input[type="radio"]').length;
  const checkboxes = container.querySelectorAll('input[type="checkbox"]').length;
  const textInputs = container.querySelectorAll('input[type="text"], textarea').length;
  const selects = container.querySelectorAll('select').length;
  const sliders = container.querySelectorAll('input[type="range"], .slider, [role="slider"], .ui-slider').length;

  // Matrix detection: multiple rows of radios/checkboxes
  const rows = container.querySelectorAll('tr, .matrix-row, [class*="row"]').length;
  if (rows > 1 && (radios > rows || checkboxes > rows)) {
    return checkboxes > radios ? 'matrix-checkbox' : 'matrix-radio';
  }

  // Single question type detection
  if (sliders > 0) return 'slider';
  if (radios > checkboxes && radios > 0) return 'radio';
  if (checkboxes > 0) return 'checkbox';
  if (selects > 0) return 'select';
  if (textInputs > 0) return 'text';

  // Fallback: check for role-based buttons (custom surveys)
  if (container.querySelectorAll('[role="button"]').length > 2) return 'custom-button';

  return 'unknown';
}

/**
 * Capture full context for context-aware healing.
 * @param {string} platform - Platform identifier
 * @param {string} questionType - Question type (from detectQuestionType)
 * @param {string} phase - Survey phase: 'detection', 'filling', 'submitting'
 * @param {Element} element - Optional element for DOM fingerprinting
 * @returns {object} Context object
 */
function captureContext(platform, questionType, phase, element = null) {
  const context = {
    platform: platform || detectPlatform(),
    domHash: computeDOMFingerprint(),
    questionType: questionType || 'unknown',
    phase: phase || 'detection',
    dialogCount: document.querySelectorAll('[role="dialog"], .MuiDialog-root, .modal').length,
    timestamp: Date.now()
  };

  console.log(`[HEAL-CTX] Captured: ${context.platform} | ${context.questionType} | ${context.phase} | DOM:${context.domHash} | Dialogs:${context.dialogCount}`);

  return context;
}

/**
 * Calculate similarity score between two contexts (0-1 scale).
 * Higher score = better match for applying heal.
 * @param {object} currentCtx - Current context
 * @param {object} healCtx - Stored heal context
 * @returns {number} Similarity score (0-1)
 */
function matchContext(currentCtx, healCtx) {
  if (!currentCtx || !healCtx) return 0;

  let score = 0;

  // Platform match (exact)
  if (currentCtx.platform === healCtx.platform) {
    score += MATCH_WEIGHTS.platform;
  }

  // DOM hash match (exact or similar)
  if (currentCtx.domHash === healCtx.domHash) {
    score += MATCH_WEIGHTS.domHash;
  } else if (currentCtx.domHash && healCtx.domHash && currentCtx.domHash !== 'unknown') {
    // Partial credit for similar DOM structure (first 4 chars match)
    if (currentCtx.domHash.substring(0, 4) === healCtx.domHash.substring(0, 4)) {
      score += MATCH_WEIGHTS.domHash * 0.5;
    }
  }

  // Question type match
  if (currentCtx.questionType === healCtx.questionType) {
    score += MATCH_WEIGHTS.questionType;
  } else if (currentCtx.questionType !== 'unknown' && healCtx.questionType !== 'unknown') {
    // Partial credit for related types (e.g., radio vs checkbox)
    const related = [
      ['radio', 'checkbox'],
      ['matrix-radio', 'matrix-checkbox'],
      ['text', 'select']
    ];
    const isRelated = related.some(pair =>
      (pair.includes(currentCtx.questionType) && pair.includes(healCtx.questionType))
    );
    if (isRelated) {
      score += MATCH_WEIGHTS.questionType * 0.3;
    }
  }

  // Phase match
  if (currentCtx.phase === healCtx.phase) {
    score += MATCH_WEIGHTS.phase;
  }

  return score;
}

/**
 * Record a new healing fix with full context.
 * @param {string} platform - e.g., "ipsos", "qualtrics", "typeform"
 * @param {string} issue - e.g., "noElementsFound", "zeroWidthSpace", "dialogSearch"
 * @param {object} fix - description of what worked (e.g., selector, delay)
 * @param {object} context - Full context object from captureContext()
 * @returns {Promise<void>}
 */
async function recordHealing(platform, issue, fix, context = null) {
  await loadHealDB();

  if (!platformCache[platform]) platformCache[platform] = [];

  // Create context if not provided (backward compatibility)
  if (!context) {
    context = captureContext(platform, 'unknown', 'detection');
  }

  // Check if similar heal exists (match by issue, fix, and context)
  const existingIndex = platformCache[platform].findIndex(h =>
    h.issue === issue &&
    JSON.stringify(h.fix) === JSON.stringify(fix) &&
    matchContext(context, h.context) > 0.8
  );

  if (existingIndex !== -1) {
    // Update existing heal with new usage data
    const existing = platformCache[platform][existingIndex];
    existing.lastUsed = Date.now();
    existing.successCount = (existing.successCount || 0) + 1;
    existing.context = context; // Update context with latest
    console.log(`[HEAL] Updated existing fix for ${platform}: ${issue} (success: ${existing.successCount})`);
  } else {
    // Add new heal entry
    platformCache[platform].push({
      issue,
      fix,
      timestamp: Date.now(),
      url: window.location.hostname,
      context,
      lastUsed: Date.now(),
      successCount: 1,
      failureCount: 0
    });
    console.log(`[HEAL] ✓ Learned new fix for ${platform}: ${issue} →`, fix);
  }

  // Limit per-platform memory (keep most successful)
  if (platformCache[platform].length > MAX_HEALS_PER_PLATFORM) {
    // Sort by success rate and recency
    platformCache[platform].sort((a, b) => {
      const aRate = (a.successCount || 1) / ((a.successCount || 1) + (a.failureCount || 0));
      const bRate = (b.successCount || 1) / ((b.successCount || 1) + (b.failureCount || 0));
      const rateScore = bRate - aRate;
      const recencyScore = (b.lastUsed || 0) - (a.lastUsed || 0);
      return rateScore * 0.7 + recencyScore * 0.3;
    });
    platformCache[platform] = platformCache[platform].slice(0, MAX_HEALS_PER_PLATFORM);
  }

  await saveHealDB();
}

/**
 * Record successful heal application (adaptive learning).
 * @param {string} platform - Platform identifier
 * @param {string} issue - Issue type
 * @param {object} context - Context when heal was applied
 * @returns {Promise<void>}
 */
async function recordHealSuccess(platform, issue, context) {
  await loadHealDB();

  if (!platformCache[platform]) return;

  // Find matching heal and increment success count
  const heal = platformCache[platform].find(h =>
    h.issue === issue && matchContext(context, h.context) > CONTEXT_MATCH_THRESHOLD
  );

  if (heal) {
    heal.successCount = (heal.successCount || 0) + 1;
    heal.lastUsed = Date.now();
    console.log(`[HEAL] ✓ Success recorded for ${platform}:${issue} (${heal.successCount} total)`);

    // Track in-session stats
    const key = `${platform}:${issue}`;
    if (!sessionStats[key]) sessionStats[key] = { success: 0, failure: 0 };
    sessionStats[key].success++;

    await saveHealDB();
  }
}

/**
 * Record failed heal application (adaptive learning).
 * @param {string} platform - Platform identifier
 * @param {string} issue - Issue type
 * @param {object} context - Context when heal failed
 * @returns {Promise<void>}
 */
async function recordHealFailure(platform, issue, context) {
  await loadHealDB();

  if (!platformCache[platform]) return;

  // Find matching heal and increment failure count
  const heal = platformCache[platform].find(h =>
    h.issue === issue && matchContext(context, h.context) > CONTEXT_MATCH_THRESHOLD
  );

  if (heal) {
    heal.failureCount = (heal.failureCount || 0) + 1;
    console.log(`[HEAL] ✗ Failure recorded for ${platform}:${issue} (${heal.failureCount} failures)`);

    // Track in-session stats
    const key = `${platform}:${issue}`;
    if (!sessionStats[key]) sessionStats[key] = { success: 0, failure: 0 };
    sessionStats[key].failure++;

    await saveHealDB();
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
 * Apply known heals to current detection environment with context-aware matching.
 * Selects best matching heals based on context similarity.
 * @param {string} platform
 * @param {object} env - Current detection environment
 * @param {object} context - Current context from captureContext()
 * @returns {Promise<object>} Updated environment with matched heals
 */
async function applyHeals(platform, env = {}, context = null) {
  const heals = await getHealsFor(platform);
  let addedSelectors = [];
  let appliedHeals = [];

  // If no context provided, create a basic one
  if (!context) {
    context = captureContext(platform, 'unknown', 'detection');
  }

  // Score and sort heals by context match
  const scoredHeals = heals.map(heal => ({
    heal,
    score: matchContext(context, heal.context || {}),
    successRate: (heal.successCount || 1) / ((heal.successCount || 1) + (heal.failureCount || 0))
  }))
  .filter(item => item.score >= CONTEXT_MATCH_THRESHOLD)
  .sort((a, b) => {
    // Prioritize: context match (60%) + success rate (40%)
    return (b.score * 0.6 + b.successRate * 0.4) - (a.score * 0.6 + a.successRate * 0.4);
  });

  console.log(`[HEAL] Found ${scoredHeals.length}/${heals.length} context-matching heals for ${platform}`);

  // Apply top matching heals
  scoredHeals.forEach(({ heal, score, successRate }) => {
    const { issue, fix } = heal;

    if (fix.type === "selector" && Array.isArray(fix.selectors)) {
      env.candidateSelectors = [
        ...(env.candidateSelectors || []),
        ...fix.selectors
      ];
      addedSelectors.push(...fix.selectors);
      appliedHeals.push({ issue, score: score.toFixed(2), successRate: (successRate * 100).toFixed(0) + '%' });
    }

    if (fix.type === "delay" && fix.ms) {
      // Use the highest-scoring delay
      if (!env.delay || score > (env.delayScore || 0)) {
        globalDelays[platform] = fix.ms;
        env.delay = fix.ms;
        env.delayScore = score;
      }
    }
  });

  if (addedSelectors.length) {
    console.log(`[HEAL] Applied ${addedSelectors.length} selectors from ${appliedHeals.length} heals:`, appliedHeals);
  }
  if (env.delay) {
    console.log(`[HEAL] Applied delay override: ${env.delay}ms (match score: ${env.delayScore?.toFixed(2)})`);
  }

  // Store applied heals for success/failure tracking
  env.appliedHeals = appliedHeals.map(h => h.issue);

  return env;
}

/**
 * Learn an average delay for DOM stabilization.
 * @param {string} platform
 * @param {number} ms - Delay in milliseconds
 * @param {object} context - Context when delay was learned
 * @returns {Promise<void>}
 */
async function learnDelay(platform, ms, context = null) {
  const current = globalDelays[platform];
  let newDelay;

  if (!current) {
    newDelay = ms;
  } else {
    // Smooth average (70% old, 30% new)
    newDelay = Math.round(current * 0.7 + ms * 0.3);
  }

  globalDelays[platform] = newDelay;

  if (!context) {
    context = captureContext(platform, 'unknown', 'detection');
  }

  await recordHealing(platform, "renderDelay", { type: "delay", ms: newDelay }, context);
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
 * Export statistics for debugging with context details.
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
      questionTypes: {},
      delay: globalDelays[platform] || 0,
      avgSuccessRate: 0,
      topHeals: []
    };

    let totalSuccess = 0;
    let totalAttempts = 0;

    heals.forEach(heal => {
      const { issue, context, successCount = 0, failureCount = 0 } = heal;

      // Count by issue
      if (!stats[platform].issues[issue]) {
        stats[platform].issues[issue] = 0;
      }
      stats[platform].issues[issue]++;

      // Count by question type
      const qType = context?.questionType || 'unknown';
      if (!stats[platform].questionTypes[qType]) {
        stats[platform].questionTypes[qType] = 0;
      }
      stats[platform].questionTypes[qType]++;

      // Calculate success rate
      const attempts = successCount + failureCount;
      totalSuccess += successCount;
      totalAttempts += attempts;

      if (attempts > 0) {
        const rate = (successCount / attempts * 100).toFixed(0);
        stats[platform].topHeals.push({
          issue,
          questionType: qType,
          successRate: rate + '%',
          uses: attempts
        });
      }
    });

    // Sort top heals by success rate
    stats[platform].topHeals.sort((a, b) => {
      const aRate = parseInt(a.successRate);
      const bRate = parseInt(b.successRate);
      return bRate - aRate;
    });
    stats[platform].topHeals = stats[platform].topHeals.slice(0, 5);

    // Overall success rate
    stats[platform].avgSuccessRate = totalAttempts > 0
      ? (totalSuccess / totalAttempts * 100).toFixed(0) + '%'
      : 'N/A';
  });

  return stats;
}

/**
 * Get in-session performance stats.
 * @returns {object} Session statistics
 */
function getSessionStats() {
  return sessionStats;
}

/**
 * Clear all healing policies (for debugging).
 * @returns {Promise<void>}
 */
async function clearHealDB() {
  platformCache = {};
  globalDelays = {};
  sessionStats = {};
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

  // New Level 3 functions
  captureContext,
  detectQuestionType,
  computeDOMFingerprint,
  matchContext,
  recordHealSuccess,
  recordHealFailure,

  // Debugging
  getHealStats,
  getSessionStats,
  clearHealDB
};

console.log('[HEAL v2.0] Context-Aware Self-Healing System Loaded (Level 3)');
