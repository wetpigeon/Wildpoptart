/**
 * selfHealPolicy.js
 * v1.0.0 — adaptive self-healing memory for survey automation
 *
 * Purpose:
 * - Detects recurring DOM or LLM extraction issues.
 * - Learns working fallbacks.
 * - Persists them per-platform so future surveys auto-adapt.
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
 * @param {string} platform - e.g., "ipsos", "qualtrics", "typeform"
 * @param {string} issue - e.g., "noElementsFound", "zeroWidthSpace", "dialogSearch"
 * @param {object} fix - description of what worked (e.g., selector, delay)
 * @returns {Promise<void>}
 */
async function recordHealing(platform, issue, fix) {
  await loadHealDB();

  if (!platformCache[platform]) platformCache[platform] = [];

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
    timestamp: Date.now(),
    url: window.location.hostname
  });

  // Limit per-platform memory
  if (platformCache[platform].length > MAX_HEALS_PER_PLATFORM) {
    platformCache[platform].shift();
  }

  await saveHealDB();
  console.log(`[HEAL] ✓ Learned new fix for ${platform}: ${issue} →`, fix);
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
 * Injects selectors, timing adjustments, etc.
 * @param {string} platform
 * @param {object} env - Current detection environment
 * @returns {Promise<object>} Updated environment
 */
async function applyHeals(platform, env = {}) {
  const heals = await getHealsFor(platform);
  let addedSelectors = [];

  heals.forEach(({ issue, fix }) => {
    if (fix.type === "selector" && Array.isArray(fix.selectors)) {
      env.candidateSelectors = [
        ...(env.candidateSelectors || []),
        ...fix.selectors
      ];
      addedSelectors.push(...fix.selectors);
    }
    if (fix.type === "delay" && fix.ms) {
      globalDelays[platform] = fix.ms;
      env.delay = fix.ms;
    }
  });

  if (addedSelectors.length) {
    console.log(`[HEAL] Applied ${addedSelectors.length} extra selectors for ${platform}:`, addedSelectors);
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
  clearHealDB
};
