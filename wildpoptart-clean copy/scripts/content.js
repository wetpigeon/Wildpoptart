// Wildpoptart Content Script - Page Observer and Question Detector

console.log('===== VERSION 5.0.0 - LEVEL 5: META-LEARNING ENGINE =====');
console.log('📊 To export question database, type: exportDB()');
console.log('🧬 To view self-healing stats, type: viewHealings()');
console.log('🧠 To export learned heuristics, type: exportHeuristics()');
console.log('📥 To import learned heuristics, type: importHeuristics(json)');
console.log('📈 To view learning stats, type: viewLearningStats()');
console.log('🤖 AUTO-FILL MODE: The bot will automatically progress through surveys without button clicks');
console.log('[v5.0.0] LEVEL 5 META-LEARNING: Persistent cross-session learning from mistakes');
console.log('[v5.0.0] Dynamic confidence adjustment and auto-tuning based on success rates');
console.log('[v5.1.2] Material UI checkbox fallback layer with self-healing selector learning');
console.log('[LEVEL 4] Fuzzy token-based similarity matching (threshold: 0.8)');

// State management
let isActive = false;
let autoFillEnabled = false; // Auto-fill mode - automatically process surveys without button clicks
let currentPersona = null;
let detectedQuestions = [];
let answeredQuestionIds = new Set(); // Track question IDs we've already answered in this session
let isDetecting = false; // Prevent multiple simultaneous detections
let isFillingQuestions = false; // Track if we're currently filling questions
let skippedPreFilledCount = 0; // Track questions skipped due to pre-filled values (v1.9.15)

// V5.1.0: Self-correcting architecture state
let costCounters = {
  llm_hint_calls: 0,
  llm_repair_calls: 0
};
let failureLog = []; // Track fill failures for debugging

// Question database tracking
let currentSurveySession = {
  survey_id: null,
  url: window.location.href,
  start_time: Date.now(),
  questions: []
};

// ============================================================================
// LEVEL 5: META-LEARNING ENGINE
// ============================================================================
// Persistent learning system that records successful repairs and failures,
// applies learned rules automatically, and self-tunes parameters based on
// success rates across sessions.
// ============================================================================

const HEURISTICS_STORAGE_KEY = 'wildpoptart_heuristics_v5';
const LEARNING_STATS_KEY = 'wildpoptart_learning_stats_v5';
const HEURISTICS_DECAY_DAYS = 7; // Rules older than 7 days are decayed
const MIN_CONFIDENCE_THRESHOLD = 0.7; // Below this, auto-tune parameters
const RULE_SIMILARITY_THRESHOLD = 0.85; // For consolidating similar rules

// In-memory heuristics database (loaded from localStorage)
let heuristicsDB = {
  version: '5.0.0',
  heuristics: {},
  platformStats: {},
  lastUpdated: new Date().toISOString()
};

// Platform/question type statistics for auto-tuning
let learningStats = {
  platforms: {},
  globalStats: {
    totalAttempts: 0,
    totalSuccesses: 0,
    totalFailures: 0
  }
};

/**
 * Load heuristics from localStorage
 */
function loadHeuristics() {
  try {
    const stored = localStorage.getItem(HEURISTICS_STORAGE_KEY);
    if (stored) {
      heuristicsDB = JSON.parse(stored);
      console.log(`[META-LEARNING] Loaded ${Object.keys(heuristicsDB.heuristics || {}).length} learned rules from storage`);
    } else {
      console.log('[META-LEARNING] No existing heuristics found, starting fresh');
    }

    const storedStats = localStorage.getItem(LEARNING_STATS_KEY);
    if (storedStats) {
      learningStats = JSON.parse(storedStats);
      console.log(`[META-LEARNING] Loaded learning stats for ${Object.keys(learningStats.platforms || {}).length} platforms`);
    }

    // Clean up old rules (decay)
    cleanupOldHeuristics();
  } catch (e) {
    console.error('[META-LEARNING] Error loading heuristics:', e);
    heuristicsDB = { version: '5.0.0', heuristics: {}, platformStats: {}, lastUpdated: new Date().toISOString() };
  }
}

/**
 * Save heuristics to localStorage
 */
function saveHeuristics() {
  try {
    heuristicsDB.lastUpdated = new Date().toISOString();
    localStorage.setItem(HEURISTICS_STORAGE_KEY, JSON.stringify(heuristicsDB));
    localStorage.setItem(LEARNING_STATS_KEY, JSON.stringify(learningStats));
    console.log(`[META-LEARNING] Saved ${Object.keys(heuristicsDB.heuristics).length} rules to storage`);
  } catch (e) {
    console.error('[META-LEARNING] Error saving heuristics:', e);
  }
}

/**
 * Cleanup old heuristics (decay rules older than threshold)
 */
function cleanupOldHeuristics() {
  const now = new Date();
  const decayThreshold = HEURISTICS_DECAY_DAYS * 24 * 60 * 60 * 1000;
  let removedCount = 0;

  for (const [key, rule] of Object.entries(heuristicsDB.heuristics)) {
    const lastUsed = new Date(rule.lastUsed);
    const age = now - lastUsed;

    if (age > decayThreshold && rule.confidence < 0.5) {
      delete heuristicsDB.heuristics[key];
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`[META-LEARNING] Decayed ${removedCount} old/low-confidence rules`);
    saveHeuristics();
  }
}

/**
 * Generate a unique key for a heuristic rule
 */
function generateHeuristicKey(platform, questionType, ruleType, rulePattern) {
  return `${platform}.${questionType}.${ruleType}.${rulePattern}`;
}

/**
 * Record a new heuristic rule or update an existing one
 */
function recordHeuristic(platform, questionType, ruleType, rule, success = true) {
  const rulePattern = typeof rule === 'object' ? JSON.stringify(rule) : String(rule);
  const key = generateHeuristicKey(platform, questionType, ruleType, rulePattern);

  if (!heuristicsDB.heuristics[key]) {
    heuristicsDB.heuristics[key] = {
      platform,
      questionType,
      ruleType,
      rule,
      successCount: 0,
      failureCount: 0,
      created: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      confidence: 0
    };
    console.log(`[LEARNED_RULE_ADDED] ${platform}.${questionType}.${ruleType}: ${typeof rule === 'object' ? JSON.stringify(rule) : rule}`);
  }

  const heuristic = heuristicsDB.heuristics[key];

  if (success) {
    heuristic.successCount++;
  } else {
    heuristic.failureCount++;
  }

  heuristic.lastUsed = new Date().toISOString();
  heuristic.confidence = heuristic.successCount / (heuristic.successCount + heuristic.failureCount);

  saveHeuristics();
}

/**
 * Find matching heuristic rules for a given platform/question type
 */
function findMatchingHeuristics(platform, questionType, ruleType) {
  const matches = [];

  for (const [key, rule] of Object.entries(heuristicsDB.heuristics)) {
    if (rule.platform === platform &&
        rule.questionType === questionType &&
        rule.ruleType === ruleType &&
        rule.confidence >= 0.5) {
      matches.push({ key, ...rule });
    }
  }

  // Sort by confidence (highest first)
  matches.sort((a, b) => b.confidence - a.confidence);

  return matches;
}

/**
 * Track fill attempt outcome for platform/question type
 */
function trackFillAttempt(platform, questionType, success) {
  // Update global stats
  learningStats.globalStats.totalAttempts++;
  if (success) {
    learningStats.globalStats.totalSuccesses++;
  } else {
    learningStats.globalStats.totalFailures++;
  }

  // Update platform stats
  if (!learningStats.platforms[platform]) {
    learningStats.platforms[platform] = {};
  }

  if (!learningStats.platforms[platform][questionType]) {
    learningStats.platforms[platform][questionType] = {
      attempts: 0,
      successes: 0,
      failures: 0,
      avgWaitTime: 300,
      fuzzyThreshold: 0.8,
      lastTuned: new Date().toISOString()
    };
  }

  const stats = learningStats.platforms[platform][questionType];
  stats.attempts++;
  if (success) {
    stats.successes++;
  } else {
    stats.failures++;
  }

  // Calculate success rate
  const successRate = stats.successes / stats.attempts;

  // Auto-tune if success rate is below threshold
  if (successRate < MIN_CONFIDENCE_THRESHOLD && stats.attempts >= 5) {
    autoTuneParameters(platform, questionType, successRate);
  }

  saveHeuristics();
}

/**
 * Auto-tune parameters based on success rate
 */
function autoTuneParameters(platform, questionType, successRate) {
  const stats = learningStats.platforms[platform][questionType];
  const oldWaitTime = stats.avgWaitTime;
  const oldThreshold = stats.fuzzyThreshold;

  // Increase wait time by 20% if success rate is low
  if (successRate < 0.6) {
    stats.avgWaitTime = Math.min(stats.avgWaitTime * 1.2, 1500);
  }

  // Broaden fuzzy threshold if success rate is low
  if (successRate < 0.65) {
    stats.fuzzyThreshold = Math.max(stats.fuzzyThreshold - 0.05, 0.6);
  }

  stats.lastTuned = new Date().toISOString();

  console.log(`[SELF-TUNED] ${platform}.${questionType}: Success rate ${(successRate * 100).toFixed(1)}% < ${(MIN_CONFIDENCE_THRESHOLD * 100)}%`);
  console.log(`[SELF-TUNED]   Wait time: ${oldWaitTime}ms → ${stats.avgWaitTime}ms`);
  console.log(`[SELF-TUNED]   Fuzzy threshold: ${oldThreshold.toFixed(2)} → ${stats.fuzzyThreshold.toFixed(2)}`);

  saveHeuristics();
}

/**
 * Get auto-tuned parameters for a platform/question type
 */
function getAutoTunedParams(platform, questionType) {
  const stats = learningStats.platforms?.[platform]?.[questionType];

  if (stats) {
    return {
      waitTime: stats.avgWaitTime,
      fuzzyThreshold: stats.fuzzyThreshold
    };
  }

  // Default values
  return {
    waitTime: 300,
    fuzzyThreshold: 0.8
  };
}

/**
 * Consolidate similar heuristics to generalize patterns
 */
function consolidateHeuristics() {
  const rules = Object.entries(heuristicsDB.heuristics);
  let mergedCount = 0;

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const [keyA, ruleA] = rules[i];
      const [keyB, ruleB] = rules[j];

      // Only consolidate rules for same platform/type
      if (ruleA.platform !== ruleB.platform ||
          ruleA.questionType !== ruleB.questionType ||
          ruleA.ruleType !== ruleB.ruleType) {
        continue;
      }

      // Check similarity of rule patterns
      const patternA = JSON.stringify(ruleA.rule);
      const patternB = JSON.stringify(ruleB.rule);
      const sim = similarity(patternA, patternB);

      if (sim >= RULE_SIMILARITY_THRESHOLD) {
        // Merge B into A (keep higher confidence one)
        if (ruleB.confidence > ruleA.confidence) {
          ruleA.rule = ruleB.rule;
        }
        ruleA.successCount += ruleB.successCount;
        ruleA.failureCount += ruleB.failureCount;
        ruleA.confidence = ruleA.successCount / (ruleA.successCount + ruleA.failureCount);

        delete heuristicsDB.heuristics[keyB];
        mergedCount++;

        console.log(`[META-LEARNING] Consolidated similar rules: ${keyA} ← ${keyB} (sim=${sim.toFixed(2)})`);
      }
    }
  }

  if (mergedCount > 0) {
    console.log(`[META-LEARNING] Consolidated ${mergedCount} similar rules`);
    saveHeuristics();
  }
}

/**
 * Export heuristics for federated learning
 */
function exportHeuristics() {
  const exportData = {
    version: heuristicsDB.version,
    exportDate: new Date().toISOString(),
    heuristics: heuristicsDB.heuristics,
    platformStats: learningStats.platforms,
    globalStats: learningStats.globalStats,
    // Privacy: No user answers or survey content included
    metadata: {
      totalRules: Object.keys(heuristicsDB.heuristics).length,
      platforms: Object.keys(learningStats.platforms),
      totalAttempts: learningStats.globalStats.totalAttempts,
      globalSuccessRate: (learningStats.globalStats.totalSuccesses / learningStats.globalStats.totalAttempts * 100).toFixed(1) + '%'
    }
  };

  console.log('[META-LEARNING] Exporting heuristics...');
  console.log(JSON.stringify(exportData, null, 2));

  // Download as JSON file
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wildpoptart_heuristics_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);

  return exportData;
}

/**
 * Import heuristics from federated learning
 */
function importHeuristics(jsonData) {
  try {
    const imported = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

    console.log(`[META-LEARNING] Importing ${Object.keys(imported.heuristics || {}).length} rules...`);

    // Merge imported heuristics with existing ones
    let addedCount = 0;
    let updatedCount = 0;

    for (const [key, rule] of Object.entries(imported.heuristics || {})) {
      if (heuristicsDB.heuristics[key]) {
        // Merge with existing rule
        const existing = heuristicsDB.heuristics[key];
        existing.successCount += rule.successCount;
        existing.failureCount += rule.failureCount;
        existing.confidence = existing.successCount / (existing.successCount + existing.failureCount);
        updatedCount++;
      } else {
        // Add new rule
        heuristicsDB.heuristics[key] = rule;
        addedCount++;
      }
    }

    // Merge platform stats
    for (const [platform, types] of Object.entries(imported.platformStats || {})) {
      if (!learningStats.platforms[platform]) {
        learningStats.platforms[platform] = {};
      }

      for (const [type, stats] of Object.entries(types)) {
        if (!learningStats.platforms[platform][type]) {
          learningStats.platforms[platform][type] = stats;
        } else {
          const existing = learningStats.platforms[platform][type];
          existing.attempts += stats.attempts;
          existing.successes += stats.successes;
          existing.failures += stats.failures;
        }
      }
    }

    saveHeuristics();

    console.log(`[META-LEARNING] Import complete: ${addedCount} new rules, ${updatedCount} updated rules`);

    return { success: true, addedCount, updatedCount };
  } catch (e) {
    console.error('[META-LEARNING] Error importing heuristics:', e);
    return { success: false, error: e.message };
  }
}

/**
 * View learning statistics
 */
function viewLearningStats() {
  const stats = {
    globalStats: learningStats.globalStats,
    platforms: {},
    topRules: []
  };

  // Platform breakdown
  for (const [platform, types] of Object.entries(learningStats.platforms)) {
    stats.platforms[platform] = {};
    for (const [type, data] of Object.entries(types)) {
      stats.platforms[platform][type] = {
        attempts: data.attempts,
        successRate: ((data.successes / data.attempts) * 100).toFixed(1) + '%',
        currentWaitTime: data.avgWaitTime + 'ms',
        currentFuzzyThreshold: data.fuzzyThreshold.toFixed(2)
      };
    }
  }

  // Top 10 rules by confidence
  stats.topRules = Object.entries(heuristicsDB.heuristics)
    .map(([key, rule]) => ({
      key,
      platform: rule.platform,
      questionType: rule.questionType,
      ruleType: rule.ruleType,
      confidence: (rule.confidence * 100).toFixed(1) + '%',
      uses: rule.successCount + rule.failureCount
    }))
    .sort((a, b) => parseFloat(b.confidence) - parseFloat(a.confidence))
    .slice(0, 10);

  console.log('=== META-LEARNING STATISTICS ===');
  console.log(JSON.stringify(stats, null, 2));

  return stats;
}

// Initialize heuristics on load
loadHeuristics();

// Periodic cleanup and consolidation (every 5 minutes)
setInterval(() => {
  cleanupOldHeuristics();
  consolidateHeuristics();
}, 5 * 60 * 1000);

// Make functions globally available
window.exportHeuristics = exportHeuristics;
window.importHeuristics = importHeuristics;
window.viewLearningStats = viewLearningStats;

// Debug log collection
let debugLogs = [];
const MAX_LOGS = 1000; // Keep last 1000 log entries
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Override console methods to capture logs
console.log = function(...args) {
  debugLogs.push({ type: 'log', timestamp: Date.now(), message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
  if (debugLogs.length > MAX_LOGS) debugLogs.shift();
  originalConsoleLog.apply(console, args);
};

console.warn = function(...args) {
  debugLogs.push({ type: 'warn', timestamp: Date.now(), message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
  if (debugLogs.length > MAX_LOGS) debugLogs.shift();
  originalConsoleWarn.apply(console, args);
};

console.error = function(...args) {
  debugLogs.push({ type: 'error', timestamp: Date.now(), message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
  if (debugLogs.length > MAX_LOGS) debugLogs.shift();
  originalConsoleError.apply(console, args);
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle') {
    isActive = request.enabled;
    if (isActive) {
      startSurveyDetection();
    } else {
      stopSurveyDetection();
    }
    sendResponse({ success: true });
  } else if (request.action === 'fillSurvey') {
    // Call processSurvey in this frame
    processSurvey();

    // IMPORTANT: Forward message to all child frames (for frameset pages)
    // This ensures that if the popup sends to the main frame, child frames also receive it
    if (window.frames && window.frames.length > 0) {
      console.log(`[FRAMES] Forwarding fillSurvey to ${window.frames.length} child frames`);
      for (let i = 0; i < window.frames.length; i++) {
        try {
          window.frames[i].postMessage({ action: 'fillSurvey', source: 'wildpoptart' }, '*');
        } catch (e) {
          console.log(`[FRAMES] Could not forward to frame ${i}:`, e.message);
        }
      }
    }

    sendResponse({ success: true });
  } else if (request.action === 'rateLimitNotification') {
    // Show rate limit notification to user
    const { waitTime, retryCount, maxRetries } = request;
    showNotification(
      `⏳ RATE LIMIT EXCEEDED!\n\nClaude API rate limit hit. Waiting ${waitTime} seconds before retry ${retryCount}/${maxRetries}.\n\nTip: Slow down survey submissions to avoid this.`,
      'warning'
    );
    sendResponse({ success: true });
  } else if (request.action === 'exportDatabase') {
    exportQuestionDatabase();
    sendResponse({ success: true });
  } else if (request.action === 'captureDebugSnapshot') {
    captureDebugSnapshot()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('[DEBUG SNAPSHOT] Error in captureDebugSnapshot:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  } else if (request.action === 'updateAutoFill') {
    autoFillEnabled = request.enabled;
    console.log('[AUTO-FILL] Updated via popup:', autoFillEnabled ? '✅ ENABLED' : '❌ DISABLED');
    sendResponse({ success: true });
  } else if (request.action === 'getStatus') {
    sendResponse({
      isActive,
      questionsDetected: detectedQuestions.length
    });
  }
  return true;
});

// Listen for postMessage from parent frame (for frameset pages)
window.addEventListener('message', (event) => {
  // Only accept messages from our extension
  if (event.data && event.data.source === 'wildpoptart' && event.data.action === 'fillSurvey') {
    console.log('[FRAMES] Received fillSurvey message from parent frame');
    processSurvey();
  }
});

// ============================================
// 🔧 V5.1.0: SELF-CORRECTING LLM ARCHITECTURE
// Semantic Hints → Runtime Facts → Type Reconciliation → Adaptive Cache
// ============================================

// Semantic Hint (Discovery) Prompt - V5.1.0
const STRUCTURE_DISCOVERY_PROMPT = `You analyze survey HTML and return JSON hints only (no explanations, no markdown).

For each question return:
- parent_text: visible question text
- intended_type: one of ["text","textarea","radio","checkbox","slider","matrix","unknown"]
- anchor: { "selector": "<stable container selector or null>", "confidence": 0..1 }
- qid_hint: id/name if present

Rules:
- Do NOT generate per-option selectors.
- If unsure, set intended_type:"unknown".
- If input is incomplete/ambiguous, return {"platform_fingerprint":"unknown","questions":[]} — JSON only.

HTML:
__HTML_PLACEHOLDER__

Required output format:
{
  "platform_fingerprint": "confirmit|qualtrics|surveymonkey|ipsos|unknown",
  "questions": [
    {
      "question_index": 0,
      "parent_text": "Which of the following do you identify with?",
      "intended_type": "radio",
      "anchor": {
        "selector": "h3.question-text",
        "confidence": 0.9
      },
      "qid_hint": "_r_4_"
    }
  ]
}

Return ONLY valid JSON.`;

// Get minimal HTML for LLM analysis (remove noise, reduce token usage)
function getMinimalFormHTML() {
  console.log('[LLM-HTML] Creating minimal HTML for structure discovery...');

  const form = document.querySelector('form') || document.body;
  const clone = form.cloneNode(true);

  // Remove noise (90% size reduction)
  clone.querySelectorAll(
    'script, style, noscript, iframe, svg, img, video, audio, ' +
    '.ad, .advertisement, [class*="track"], [class*="analytics"], ' +
    '[id*="google"], [id*="facebook"], [class*="social"]'
  ).forEach(el => el.remove());

  // Remove inline styles and handlers
  clone.querySelectorAll('*').forEach(el => {
    el.removeAttribute('style');
    el.removeAttribute('onclick');
    el.removeAttribute('onchange');
  });

  // Clear existing values (privacy)
  clone.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type !== 'radio' && el.type !== 'checkbox') {
      el.removeAttribute('value');
    }
  });

  let minimalHTML = clone.innerHTML
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/<!--.*?-->/g, '') // Remove comments
    .trim();

  const originalSize = form.innerHTML.length;
  const minimalSize = minimalHTML.length;
  const reduction = ((1 - minimalSize / originalSize) * 100).toFixed(1);

  console.log(`[LLM-HTML] Reduced from ${originalSize} to ${minimalSize} chars (${reduction}% reduction)`);

  return minimalHTML;
}

// Generate platform fingerprint for caching
function getPlatformFingerprint() {
  const form = document.querySelector('form');
  const firstInput = document.querySelector('input');

  const fingerprintString =
    location.hostname +
    '|' + (form?.className || '') +
    '|' + (firstInput?.id || '') +
    '|' + (firstInput?.name || '');

  return hashCode(fingerprintString);
}

// Simple hash function
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Discover structure using LLM (one-time per platform)
async function discoverStructureWithLLM(minimalHTML) {
  console.log('[LLM-DISCOVER] Sending HTML to Claude for structure discovery...');

  // V5.1.0: Track cost
  costCounters.llm_hint_calls++;

  const prompt = STRUCTURE_DISCOVERY_PROMPT.replace('__HTML_PLACEHOLDER__', minimalHTML);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'callClaude',
      data: {
        model: 'claude-3-5-haiku-20241022', // Cheapest model for structure extraction
        messages: [{
          role: 'user',
          content: prompt
        }],
        max_tokens: 4096,
        temperature: 0 // Deterministic output
      }
    });

    console.log('[LLM-DISCOVER] Received response from background');

    // Check for errors
    if (response.error) {
      throw new Error(`Claude API error: ${response.error}`);
    }

    if (!response.success || !response.data) {
      throw new Error('Invalid response format from background script');
    }

    // V5.1.0: Use parseClaudeJSON for robust parsing
    const structure = parseClaudeJSON(response.data);

    if (!structure || !structure.questions) {
      console.warn('[LLM-DISCOVER] Invalid structure returned, using empty');
      return { platform_fingerprint: 'unknown', questions: [] };
    }

    console.log(`[LLM-DISCOVER] Parsed structure with ${structure.questions.length} questions`);

    // V5.1.0: Simplified validation (just check anchors exist, no input validation)
    const validated = {
      platform_fingerprint: structure.platform_fingerprint || 'unknown',
      questions: structure.questions.filter(q => {
        // Question must have parent_text or anchor
        if (!q.parent_text && !q.anchor?.selector) {
          console.warn(`[LLM-VALIDATE] ⚠️ Question has no parent_text or anchor, skipping`);
          return false;
        }
        return true;
      })
    };

    console.log(`[LLM-VALIDATE] Validated ${validated.questions.length}/${structure.questions.length} questions`);

    return validated;

  } catch (error) {
    console.error('[LLM-DISCOVER] Failed:', error);
    throw error;
  }
}

/**
 * Extract question text from element context (parents/siblings)
 * Strips invisible characters like zero-width spaces
 */
function extractQuestionTextFromContext(el) {
  if (!el) return '(no visible question text)';

  // Get visible text from this element and its immediate children
  let text = el.innerText?.trim() || '';

  // Strip invisible characters (zero-width spaces, etc.)
  const cleanText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

  // If the text is only invisible characters or too short
  if (!cleanText || cleanText.length < 3) {
    // Try visible siblings or parents that might hold the question (Material UI patterns)
    const parent = el.parentElement;
    if (parent) {
      const visibleText = parent.querySelector(
        '.question-text, .MuiTypography-root, label, h1, h2, h3, h4, h5, h6, [role="heading"], legend'
      )?.innerText?.trim();

      if (visibleText) {
        const cleanSiblingText = visibleText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
        if (cleanSiblingText && cleanSiblingText.length > 0) {
          text = cleanSiblingText;
        }
      }

      // Still empty? Search in entire dialog container
      if (!text || text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().length < 3) {
        const dialog = document.querySelector('[role="dialog"], .MuiDialog-root, .dialog-question, .modal');
        if (dialog) {
          const dialogHeading = dialog.querySelector('.MuiTypography-root, h1, h2, h3, h4, h5, h6, [role="heading"]');
          if (dialogHeading) {
            const dialogText = dialogHeading.innerText?.trim() || '';
            const cleanDialogText = dialogText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
            if (cleanDialogText && cleanDialogText.length > 0) {
              text = cleanDialogText;
            }
          }
        }
      }

      // Last resort: Try getting all text from parent container
      if (!text || text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().length < 3) {
        const parentText = parent.innerText?.trim() || '';
        const cleanParentText = parentText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
        if (cleanParentText && cleanParentText.length > 0) {
          text = cleanParentText;
          // Limit length to first line/sentence
          if (text.length > 200) {
            text = text.substring(0, 200) + '...';
          }
        }
      }
    }
  } else {
    text = cleanText;
  }

  // Final cleanup: strip zero-width spaces & return
  const finalText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  return finalText || '(no visible question text)';
}

// Apply structure map to extract actual questions from page
function applyStructureMap(structure) {
  console.log('[LLM-APPLY] Applying structure map to extract questions...');

  const questions = [];

  (structure.questions || []).forEach((qHint, idx) => {
    try {
      // V5.1.0: New Semantic Hint format
      let parentText = qHint.parent_text || '';
      const intendedType = qHint.intended_type || 'unknown';
      const anchorSelector = qHint.anchor?.selector || null;
      const confidence = qHint.anchor?.confidence || 0;
      const qidHint = qHint.qid_hint || `llm_discovered_${idx}`;

      console.log(`[DISCOVERY] intended=${intendedType} anchor=${anchorSelector} conf=${confidence}`);

      // Resolve anchor element
      let anchorEl = resolveAnchor(anchorSelector, parentText);

      if (!anchorEl) {
        console.warn(`[LLM-APPLY] Failed to resolve anchor for question ${idx}`);
        return;
      }

      // V5.1.0: Extract actual question text from DOM if missing or invisible
      const cleanParentText = parentText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      if (!cleanParentText || cleanParentText.length < 3) {
        console.log(`[LLM-APPLY] Question text missing or invisible (had: "${parentText.substring(0, 20)}"), extracting from DOM...`);
        parentText = extractQuestionTextFromContext(anchorEl);
        console.log(`[LLM-APPLY] Extracted text: "${parentText.substring(0, 60)}..."`);
      } else {
        parentText = cleanParentText;
      }

      // Extract runtime facts from DOM
      let facts = extractRuntimeFacts(anchorEl);
      let currentAnchor = anchorEl;

      // V5.1.0: If no elements found, try broadening scope immediately
      if (facts.elements.length === 0 && (intendedType === 'radio' || intendedType === 'checkbox')) {
        console.log(`[LLM-APPLY] No elements found at anchor, broadening scope...`);

        // Strategy 1: Climb up parent tree
        const broaderEl = broadenScope(anchorEl);
        if (broaderEl && broaderEl !== anchorEl) {
          console.log(`[LLM-APPLY] Broadened to parent container`);
          currentAnchor = broaderEl;
          facts = extractRuntimeFacts(broaderEl);
        }

        // Strategy 2: If still no elements, search entire dialog/modal
        if (facts.elements.length === 0) {
          console.log(`[LLM-APPLY] Still no elements, searching entire dialog...`);
          const dialog = document.querySelector('[role="dialog"], .dialog-question, .MuiDialog-root, .modal, [class*="dialog"]');
          if (dialog) {
            console.log(`[LLM-APPLY] Found dialog container, re-extracting...`);
            currentAnchor = dialog;
            facts = extractRuntimeFacts(dialog);

            // V5.1.1: Record healing - dialog search succeeded
            if (facts.elements.length > 0 && window.selfHeal) {
              const platform = window.selfHeal.detectPlatform();
              window.selfHeal.recordHealing(platform, 'dialogSearch', {
                type: 'selector',
                selectors: ['[role="dialog"]', '.MuiDialog-root', '.dialog-question']
              });
            }
          }
        }
      }

      // Reconcile type: intended vs actual DOM structure
      let decidedType = reconcileType(intendedType, facts);

      // If reconciliation failed, try inferring from question text
      if (!decidedType) {
        decidedType = inferFromText(parentText, facts);
      }

      // Still no type? Fall back to intended or unknown
      if (!decidedType) {
        decidedType = intendedType !== 'unknown' ? intendedType : null;
      }

      if (!decidedType) {
        console.warn(`[LLM-APPLY] Could not determine type for question ${idx}`);
        return;
      }

      // Build question data
      const questionData = {
        question_id: qidHint,
        qid_hint: qidHint,
        question_type: decidedType,
        question_text: parentText,
        parent_text: parentText,
        intended_type: intendedType,
        anchorSelector,
        anchorEl: currentAnchor, // Use broadened anchor if scope was expanded
        runtime: facts,
        required: false,
        elements: facts.elements || [],
        options: []
      };

      // Populate options for radio/checkbox
      if ((decidedType === 'radio' || decidedType === 'checkbox') && facts.labels.length > 0) {
        questionData.options = facts.labels.map((label, i) => ({
          label,
          value: facts.elements[i]?.value || label,
          id: facts.elements[i]?.id
        }));
      }

      // Set singular element for compatibility
      if (questionData.elements.length > 0) {
        questionData.element = questionData.elements[0];
      }

      // Only add if we have elements
      if (questionData.elements.length > 0) {
        questions.push(questionData);
        console.log(`[LLM-APPLY] ✓ Extracted question: "${questionData.question_text.substring(0, 60)}..." type=${decidedType} elements=${questionData.elements.length}`);
      } else {
        console.warn(`[LLM-APPLY] Question ${idx} has no elements, skipping`);
      }

    } catch (error) {
      console.error(`[LLM-APPLY] Failed to apply template for question ${idx}:`, error);
    }
  });

  console.log(`[LLM-APPLY] Extracted ${questions.length} questions from structure map`);

  return questions;
}

// ============================================
// 🔧 V5.1.0: SELF-CORRECTING FEEDBACK LOOP
// ============================================

/**
 * 3.1 Capture fail signals
 */
function recordFillFailure(q, reason, detail = {}) {
  const entry = {
    qid_hint: q.qid_hint || q.question_id || 'unknown',
    parent_text: q.parent_text || q.question_text || '',
    type: q.question_type || q.type || 'unknown',
    intended_type: q.intended_type || null,
    reason,
    detail,
    anchorSelector: q.anchorSelector || null,
    timestamp: Date.now()
  };

  failureLog.push(entry);
  console.log(`[FAIL] qid=${entry.qid_hint} reason=${reason}`, detail);

  // Keep only last 100 failures to avoid memory bloat
  if (failureLog.length > 100) failureLog.shift();
}

/**
 * 3.2 Self-repair loop
 */
async function attemptFillWithRepair(q, answer) {
  const MAX_REPAIR_ATTEMPTS = 2;
  let attemptCount = 0;

  while (attemptCount < MAX_REPAIR_ATTEMPTS) {
    attemptCount++;

    // Try to fill
    const fillResult = await tryFillQuestion(q, answer);

    if (fillResult.success) {
      console.log(`[FILL] ok qid=${q.question_id} type=${q.question_type}`);

      // Promote learning if this was a repair success
      if (attemptCount > 1) {
        promoteLearning(q, 'repaired');
      }

      return true;
    }

    // First attempt failed
    if (attemptCount === 1) {
      console.log(`[FILL] fail qid=${q.question_id} attempt=1/${MAX_REPAIR_ATTEMPTS}`);

      // Analyze failure
      const failureReason = classifyFailure(q, fillResult);
      recordFillFailure(q, failureReason, { error: fillResult.error });

      // Attempt repair
      await repairQuestion(q, failureReason);
    } else {
      // Second attempt also failed
      console.log(`[FILL] fail qid=${q.question_id} attempt=2/${MAX_REPAIR_ATTEMPTS} - giving up`);
      recordFillFailure(q, 'REPAIR_EXHAUSTED', { attempts: attemptCount });
      return false;
    }
  }

  return false;
}

/**
 * Classify failure type
 */
function classifyFailure(q, fillResult) {
  const error = fillResult.error || '';

  if (error.includes('JSON') || error.includes('parse')) return 'JSON_PARSE';
  if (!q.elements || q.elements.length === 0) return 'ELEMENT_NOT_FOUND';
  if (q.question_type === 'radio' || q.question_type === 'checkbox') {
    if (!q.options || q.options.length === 0) return 'NO_OPTIONS_FOUND';
  }
  if (q.runtime && q.intended_type && q.question_type !== q.intended_type) return 'TYPE_MISMATCH';

  return 'UNKNOWN';
}

/**
 * Repair question based on failure
 */
async function repairQuestion(q, reason) {
  console.log(`[REPAIR] starting reason=${reason}`);

  // Step 1: Try reclassifying type via micro-hint
  if (reason === 'TYPE_MISMATCH' || reason === 'NO_OPTIONS_FOUND') {
    const newType = await selfRepairQuestion(q);

    if (newType && newType !== q.question_type) {
      console.log(`[REPAIR] type->${newType} via micro-hint`);
      q.question_type = newType;
      q.type = newType; // Compatibility

      // Re-extract runtime facts with new type
      if (q.anchorEl) {
        const facts = extractRuntimeFacts(q.anchorEl);
        q.runtime = facts;

        // Re-populate options if type changed to radio/checkbox
        if ((newType === 'radio' || newType === 'checkbox') && facts.elements) {
          q.elements = facts.elements;
          q.element = facts.elements[0];
          q.options = facts.labels.map((label, idx) => ({
            label,
            value: facts.elements[idx]?.value || label,
            id: facts.elements[idx]?.id
          }));
        }
      }

      promoteLearning(q, 'reclassified_type');
      return;
    }
  }

  // Step 2: Try broadening scope
  if (reason === 'ELEMENT_NOT_FOUND' || reason === 'NO_OPTIONS_FOUND') {
    const broaderEl = broadenScope(q.anchorEl || q.element);

    if (broaderEl && broaderEl !== q.anchorEl) {
      console.log(`[REPAIR] broadened scope`);
      q.anchorEl = broaderEl;

      // Re-extract facts from broader scope
      const facts = extractRuntimeFacts(broaderEl);
      q.runtime = facts;

      if (facts.elements && facts.elements.length > 0) {
        q.elements = facts.elements;
        q.element = facts.elements[0];

        if (q.question_type === 'radio' || q.question_type === 'checkbox') {
          q.options = facts.labels.map((label, idx) => ({
            label,
            value: facts.elements[idx]?.value || label,
            id: facts.elements[idx]?.id
          }));
        }

        promoteLearning(q, 'broadened_scope');
      }
    }
  }
}

/**
 * 3.3 LLM micro-hint (cheap, JSON only)
 */
async function selfRepairQuestion(q) {
  console.log(`[REPAIR] requesting micro-hint for qid=${q.qid_hint || q.question_id}`);
  costCounters.llm_repair_calls++;

  const containerHTML = q.anchorEl ? q.anchorEl.outerHTML.substring(0, 2000) : '';
  const parentText = q.parent_text || q.question_text || '';

  const prompt = REPAIR_MICRO_HINT_PROMPT
    .replace('{{PARENT_TEXT}}', JSON.stringify(parentText))
    .replace('{{CONTAINER_HTML}}', JSON.stringify(containerHTML));

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'callClaude',
      data: {
        model: 'claude-3-5-haiku-20241022',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256,
        temperature: 0
      }
    });

    if (!response.success) {
      console.warn(`[REPAIR] micro-hint failed:`, response.error);
      return null;
    }

    const parsed = parseClaudeJSON(response.data);
    const type = parsed?.type || null;

    console.log(`[REPAIR] micro-hint returned type=${type}`);
    return type;

  } catch (error) {
    console.error(`[REPAIR] micro-hint error:`, error);
    return null;
  }
}

/**
 * 3.4 Runtime facts (framework-aware)
 */
function extractRuntimeFacts(anchorEl) {
  if (!anchorEl) {
    return {
      found_roles: [],
      clickable_count: 0,
      text_count: 0,
      slider_count: 0,
      matrix_shape: null,
      labels: [],
      elements: [],
      diag: 'no_anchor'
    };
  }

  const facts = {
    found_roles: [],
    clickable_count: 0,
    text_count: 0,
    slider_count: 0,
    matrix_shape: null,
    labels: [],
    elements: [],
    diag: {}
  };

  // Find all interactive elements
  const allElements = anchorEl.querySelectorAll(
    'button, input, textarea, select, [role="radio"], [role="checkbox"], [role="button"], [role="option"], ' +
    '[class*="option"], [class*="choice"], [class*="radio"], [class*="checkbox"]'
  );

  allElements.forEach(el => {
    // Skip invisible
    if (el.offsetParent === null) return;

    // Skip navigation buttons
    const text = el.textContent?.trim() || '';
    if (text.toLowerCase().includes('continue') || text.toLowerCase().includes('next')) return;

    const tagName = el.tagName.toLowerCase();
    const type = el.getAttribute('type')?.toLowerCase();
    const role = el.getAttribute('role')?.toLowerCase();

    // Classify element
    if (type === 'radio' || role === 'radio') {
      facts.found_roles.push('radio');
      facts.clickable_count++;
      facts.labels.push(text || el.value || el.getAttribute('aria-label') || '');
      facts.elements.push(el);
    } else if (type === 'checkbox' || role === 'checkbox') {
      facts.found_roles.push('checkbox');
      facts.clickable_count++;
      facts.labels.push(text || el.value || el.getAttribute('aria-label') || '');
      facts.elements.push(el);
    } else if (tagName === 'button' || role === 'button' || role === 'option') {
      facts.found_roles.push('button');
      facts.clickable_count++;
      facts.labels.push(text);
      facts.elements.push(el);
    } else if (type === 'text' || type === 'number' || type === 'email' || type === 'tel') {
      facts.found_roles.push('text');
      facts.text_count++;
      facts.elements.push(el);
    } else if (tagName === 'textarea') {
      facts.found_roles.push('textarea');
      facts.text_count++;
      facts.elements.push(el);
    } else if (type === 'range' || el.classList.contains('slider')) {
      facts.found_roles.push('slider');
      facts.slider_count++;
      facts.elements.push(el);
    } else if (tagName === 'select') {
      facts.found_roles.push('select');
      facts.elements.push(el);
    }
  });

  // Detect matrix pattern
  const tables = anchorEl.querySelectorAll('table');
  if (tables.length > 0) {
    const table = tables[0];
    const rows = table.querySelectorAll('tr').length;
    const cols = table.querySelectorAll('th, td').length / rows || 0;
    if (rows > 1 && cols > 1) {
      facts.matrix_shape = { rows, cols };
    }
  }

  facts.diag = {
    total_elements: allElements.length,
    visible_elements: facts.elements.length
  };

  console.log(`[EXTRACT] clickable=${facts.clickable_count} text=${facts.text_count} slider=${facts.slider_count} matrix=${facts.matrix_shape ? 'yes' : 'null'}`);

  return facts;
}

/**
 * 3.5 Validation & reconciliation
 */
function isValid(type, facts) {
  switch (type) {
    case 'text':
    case 'textarea':
      return facts.text_count > 0;
    case 'radio':
    case 'checkbox':
      return facts.clickable_count > 0;
    case 'slider':
      return facts.slider_count > 0;
    case 'matrix':
      return facts.matrix_shape !== null;
    default:
      return false;
  }
}

function reconcileType(intended, facts) {
  // If intended type is valid, use it
  if (intended && isValid(intended, facts)) {
    console.log(`[VALIDATE] ok type=${intended}`);
    return intended;
  }

  // Otherwise, infer from facts
  if (facts.clickable_count > 1) {
    const inferredType = facts.found_roles.includes('checkbox') ? 'checkbox' : 'radio';
    console.log(`[VALIDATE] mismatch(TYPE_MISMATCH) intended=${intended} inferred=${inferredType}`);
    return inferredType;
  }

  if (facts.text_count > 0) {
    const inferredType = facts.found_roles.includes('textarea') ? 'textarea' : 'text';
    console.log(`[VALIDATE] mismatch(TYPE_MISMATCH) intended=${intended} inferred=${inferredType}`);
    return inferredType;
  }

  if (facts.slider_count > 0) {
    console.log(`[VALIDATE] mismatch(TYPE_MISMATCH) intended=${intended} inferred=slider`);
    return 'slider';
  }

  if (facts.matrix_shape) {
    console.log(`[VALIDATE] mismatch(TYPE_MISMATCH) intended=${intended} inferred=matrix`);
    return 'matrix';
  }

  console.log(`[VALIDATE] mismatch(NO_OPTIONS_FOUND) intended=${intended} facts=empty`);
  return null;
}

function inferFromText(parentText, facts) {
  const text = parentText.toLowerCase();

  // Check for choice indicators
  if (/which of the following|select all|choose|pick/i.test(text)) {
    if (/select all|choose all|check all/i.test(text)) return 'checkbox';
    return facts.clickable_count > 1 ? 'radio' : null;
  }

  // Check for text indicators
  if (/please (type|enter|write)|in the box|your answer/i.test(text)) {
    if (/paragraph|detail|explain/i.test(text)) return 'textarea';
    return 'text';
  }

  // Check for slider indicators
  if (/rate|scale|slider|drag/i.test(text)) {
    return 'slider';
  }

  return null;
}

/**
 * 3.6 Learning
 */
function promoteLearning(q, reason) {
  console.log(`[LEARN] promoted qid=${q.question_id} reason=${reason}`);

  // Extract successful pattern
  const pattern = {
    anchor_selector: q.anchorSelector,
    decided_type: q.question_type,
    option_roles: q.runtime?.found_roles || [],
    heuristics: { reason, ts: Date.now() },
    trust: 0.6 // Initial trust
  };

  // Get platform fingerprint
  const fingerprint = getPlatformFingerprint();

  // Upsert to cache
  upsertLearnedPattern(fingerprint, pattern);
}

async function upsertLearnedPattern(fingerprint, entry) {
  const cacheKey = `structure_${fingerprint}`;

  try {
    const cached = await chrome.storage.local.get(cacheKey);
    let structure = cached[cacheKey] || { questions: [], patterns: [] };

    // Ensure patterns array exists
    if (!structure.patterns) structure.patterns = [];

    // Find existing pattern with same anchor
    const existingIdx = structure.patterns.findIndex(p => p.anchor_selector === entry.anchor_selector);

    if (existingIdx >= 0) {
      // Update trust (increase on success)
      const existing = structure.patterns[existingIdx];
      existing.trust = Math.min(1.0, (existing.trust || 0.5) + 0.1);
      existing.last_used = Date.now();
      existing.heuristics = entry.heuristics;
      console.log(`[CACHE] update anchor=${entry.anchor_selector} trust=${existing.trust.toFixed(2)}`);
    } else {
      // Add new pattern
      structure.patterns.push({
        ...entry,
        last_used: Date.now()
      });
      console.log(`[CACHE] new pattern anchor=${entry.anchor_selector}`);
    }

    // Save back
    await chrome.storage.local.set({ [cacheKey]: structure });

  } catch (error) {
    console.error('[LEARN] Failed to upsert pattern:', error);
  }
}

/**
 * 3.7 Helpers
 */
function resolveAnchor(selector, parentText) {
  if (selector) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  // Fallback: search by text
  if (parentText) {
    const allText = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, label, legend, .question, .q');
    for (const el of allText) {
      if (el.textContent.trim().includes(parentText.substring(0, 50))) {
        return el;
      }
    }
  }

  return null;
}

function broadenScope(el) {
  if (!el) return null;

  // Climb up to find container with questions/options
  const containers = ['.question', '.q', 'fieldset', 'section', 'li', 'div'];
  let current = el.parentElement;

  while (current && current !== document.body) {
    // Check if this element matches container patterns
    for (const selector of containers) {
      if (selector.startsWith('.')) {
        if (current.classList.contains(selector.substring(1))) {
          return current;
        }
      } else if (current.tagName.toLowerCase() === selector) {
        return current;
      }
    }
    current = current.parentElement;
  }

  return el;
}

/**
 * Helper: Parse Claude JSON response safely
 */
function parseClaudeJSON(responseData) {
  try {
    const content = responseData.content?.[0]?.text || '';

    // Try direct parse
    try {
      return JSON.parse(content);
    } catch (e) {
      // Try extracting JSON from markdown code blocks
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch (e2) {
          // Continue to next strategy
        }
      }

      // Try finding JSON object in text (handle explanatory text)
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          return JSON.parse(objMatch[0]);
        } catch (e3) {
          // Continue to fallback
        }
      }
    }

    // Fallback: return empty structure instead of null
    console.error('[JSON_PARSE] Raw response was not valid JSON:', content.substring(0, 500));
    recordFillFailure({ qid_hint: 'parse_error' }, 'JSON_PARSE', {
      content: content.substring(0, 500)
    });

    // Return structured fallback
    return { questions: [], error: 'JSON_PARSE' };

  } catch (error) {
    console.error('[JSON_PARSE] Failed to parse Claude response:', error);
    return { questions: [], error: 'JSON_PARSE' };
  }
}

/**
 * Helper: Try to fill a single question (wraps existing fillQuestion logic)
 */
async function tryFillQuestion(q, answer) {
  try {
    // Call existing fillQuestion function
    await fillQuestion(q, answer);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

// Repair Micro-Hint Prompt
const REPAIR_MICRO_HINT_PROMPT = `Return JSON only.

Given a single question container snippet and the parent question text, infer the most likely type from roles/structure.

Input:
{
  "parent_text": {{PARENT_TEXT}},
  "snippet": {{CONTAINER_HTML}}
}

Output:
{"type":"text"|"textarea"|"radio"|"checkbox"|"slider"|"matrix"|"unknown"}`;

// Start survey detection
function startSurveyDetection() {
  console.log('Starting survey detection...');
  addWildpoptartButton();
  detectQuestions();
}

// Stop survey detection
function stopSurveyDetection() {
  console.log('Stopping survey detection...');
  removeWildpoptartButton();
}

// Add floating button to page
function addWildpoptartButton() {
  // IMPORTANT: Only add button in top-level frame, not in iframes (ads, embeds, etc.)
  // This prevents duplicate buttons when "all_frames": true is enabled

  // Exception: If parent is a frameset, we SHOULD add the button to the child frame
  // because framesets can't render HTML content - only frames can (v1.9.23)
  let parentIsFrameset = false;
  try {
    parentIsFrameset = window.parent && window.parent.document &&
                      (window.parent.document.querySelector('frameset') !== null);
  } catch (e) {
    // Cross-origin restriction, assume not a frameset
  }

  // If we ARE a frameset ourselves, don't add button (can't render it)
  const isFrameset = document.querySelector('frameset') !== null;
  if (isFrameset) {
    console.log('[BUTTON] Skipping button on frameset document (will inject into child frame instead)');
    return;
  }

  // Skip if we're in an iframe/frame UNLESS the parent is a frameset
  if (window.self !== window.top && !parentIsFrameset) {
    console.log('[BUTTON] Skipping button in iframe/child frame');
    return;
  }

  if (parentIsFrameset) {
    console.log('[BUTTON] Parent is frameset, adding button to this frame (survey content frame)');
  }

  if (document.getElementById('wildpoptart-btn')) return;

  const button = document.createElement('button');
  button.id = 'wildpoptart-btn';
  button.className = 'wildpoptart-floating-btn';
  button.innerHTML = '🍰 Fill Survey';
  button.title = 'Click to auto-fill survey with AI';

  button.addEventListener('click', () => {
    // Process survey in this frame
    processSurvey();

    // ALSO forward to all child frames (for frameset pages)
    if (window.frames && window.frames.length > 0) {
      console.log(`[BUTTON] Forwarding to ${window.frames.length} child frames`);
      for (let i = 0; i < window.frames.length; i++) {
        try {
          window.frames[i].postMessage({ action: 'fillSurvey', source: 'wildpoptart' }, '*');
        } catch (e) {
          console.log(`[BUTTON] Could not forward to frame ${i}:`, e.message);
        }
      }
    }
  });

  document.body.appendChild(button);
}

// Remove floating button
function removeWildpoptartButton() {
  const button = document.getElementById('wildpoptart-btn');
  if (button) button.remove();
}

// Helper function to check if two strings have significant word overlap
function hasSignificantOverlap(str1, str2) {
  const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 3); // Only words > 3 chars
  const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  if (words1.length === 0 || words2.length === 0) return false;

  const commonWords = words1.filter(w => words2.includes(w));
  const overlapRatio = commonWords.length / Math.min(words1.length, words2.length);

  // If >50% of the shorter string's words appear in the longer string
  return overlapRatio > 0.5;
}

// 🔧 V1.9.58: Normalize text for Unicode-safe matching (handles French special chars, non-breaking spaces, etc.)
function normalizeText(text) {
  if (!text) return '';

  return text
    // Convert to string and trim
    .toString().trim()
    // Replace all types of spaces with regular space
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
    // Normalize multiple spaces to single space
    .replace(/\s+/g, ' ')
    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize composed characters (e.g., é becomes e + combining accent, then back to é)
    .normalize('NFC')
    // Convert to lowercase for case-insensitive comparison
    .toLowerCase();
}

// 🔧 LEVEL 4 FUZZY SIMILARITY: Token-based similarity scoring
// Returns a score between 0 and 1 based on word overlap ratio
function similarity(a, b) {
  const A = normalizeText(a);
  const B = normalizeText(b);

  if (!A || !B) return 0;
  if (A === B) return 1;

  const setA = new Set(A.split(' '));
  const setB = new Set(B.split(' '));
  const intersection = [...setA].filter(x => setB.has(x)).length;

  return intersection / Math.max(setA.size, setB.size);
}

// 🧠 LEVEL 5: Apply learned label transformations before comparison
function applyLearnedTransformations(text, platform, questionType) {
  let transformed = text;

  // Find learned label normalization rules
  const rules = findMatchingHeuristics(platform, questionType, 'labelNormalization');

  for (const rule of rules) {
    if (rule.confidence >= 0.7) {
      try {
        // Apply transformation based on rule type
        if (rule.rule.pattern === 'remove_underscores') {
          transformed = transformed.replace(/_/g, ' ');
        } else if (rule.rule.pattern === 'remove_dashes') {
          transformed = transformed.replace(/-/g, ' ');
        } else if (rule.rule.pattern === 'remove_numbers') {
          transformed = transformed.replace(/\d+/g, '');
        } else if (rule.rule.transform) {
          // Custom regex transformation
          const regex = new RegExp(rule.rule.transform.pattern, rule.rule.transform.flags || 'g');
          transformed = transformed.replace(regex, rule.rule.transform.replacement || '');
        }
      } catch (e) {
        console.warn(`[META-LEARNING] Error applying learned transformation:`, e);
      }
    }
  }

  return transformed;
}

// 🧠 LEVEL 5: Similarity check with auto-tuned threshold
function similarityMatch(a, b, platform, questionType, threshold = null) {
  // Get auto-tuned threshold if not provided
  const tunedThreshold = threshold !== null ? threshold : getAutoTunedParams(platform, questionType).fuzzyThreshold;

  // Apply learned transformations
  const transformedA = applyLearnedTransformations(a, platform, questionType);
  const transformedB = applyLearnedTransformations(b, platform, questionType);

  // Compute similarity
  const sim = similarity(transformedA, transformedB);

  return {
    match: sim >= tunedThreshold,
    score: sim,
    threshold: tunedThreshold
  };
}

// 🎯 Detect Decipher rank-order grid (ranksort) questions
function detectDecipherRanksortQuestions() {
  const questions = [];

  // Look for ranksort containers
  const ranksortContainers = document.querySelectorAll('.sq-ranksort-container');

  ranksortContainers.forEach((container, index) => {
    try {
      // Find the parent question div
      const questionDiv = container.closest('.question');
      if (!questionDiv) {
        console.log(`[RANKSORT] Container ${index} has no parent .question div`);
        return;
      }

      const questionId = questionDiv.id.replace('question_', '');
      console.log(`[RANKSORT] Detected ranksort question: ${questionId}`);

      // Extract question text
      const questionTextEl = questionDiv.querySelector('.question-text');
      const questionText = questionTextEl ? questionTextEl.textContent.trim() : '';

      // Extract all cards (items to be ranked)
      const cards = Array.from(container.querySelectorAll('.sq-ranksort-card'));
      const items = cards.map(card => {
        const textEl = card.querySelector('.sq-ranksort-card-text');
        const text = textEl ? textEl.textContent.trim() : '';
        const cardId = card.id;
        const dataIndex = card.getAttribute('data-index');

        return {
          text,
          cardId,
          dataIndex,
          element: card
        };
      });

      // Extract buckets (rank positions)
      const buckets = Array.from(container.querySelectorAll('.sq-ranksort-bucket'));
      const rankPositions = buckets.map((bucket, idx) => {
        const textEl = bucket.querySelector('.sq-ranksort-bucket-text');
        const text = textEl ? textEl.textContent.trim() : `#${idx + 1}`;
        return {
          text,
          rank: idx,
          element: bucket
        };
      });

      // Extract minRanks from jsexport if available
      let minRanks = rankPositions.length;
      const scriptTags = document.querySelectorAll('script');
      for (const script of scriptTags) {
        if (script.textContent.includes(`"label": "${questionId}"`)) {
          const match = script.textContent.match(/"minRanks":\s*(\d+)/);
          if (match) {
            minRanks = parseInt(match[1]);
            console.log(`[RANKSORT] Extracted minRanks=${minRanks} from jsexport`);
          }
          break;
        }
      }

      console.log(`[RANKSORT] Found ${items.length} items, ${rankPositions.length} buckets, minRanks=${minRanks}`);

      // Create question object
      const question = {
        question_id: questionId,
        question_text: questionText,
        question_type: 'ranksort',
        element: container,
        items,
        rankPositions,
        minRanks,
        isRanksort: true
      };

      questions.push(question);
    } catch (e) {
      console.error(`[RANKSORT] Error detecting ranksort question:`, e);
    }
  });

  return questions;
}

// Detect Quest Mindshare custom div-based questions
function detectQuestMindshareQuestions() {
  const questions = [];

  // Look for message containers with question text
  const messageContainers = document.querySelectorAll('[data-testid="message-text"]');

  messageContainers.forEach((messageEl, index) => {
    const questionText = messageEl.textContent.trim();

    // Skip if this looks like a welcome message or doesn't seem like a question
    if (questionText.length === 0 || questionText.toLowerCase().includes('welcome') || questionText.toLowerCase().includes('thank')) {
      return;
    }

    // Find the parent container
    const container = messageEl.closest('[data-testid="message-container"]');
    if (!container) return;

    // Look for option buttons in the same parent or nearby
    const parentSection = container.parentElement?.parentElement;
    if (!parentSection) return;

    // Find all option divs with data-testid="option-*"
    const options = parentSection.querySelectorAll('[data-testid^="option-"]');

    if (options.length > 0) {
      // Check if this question is already answered by looking for instructions
      const instructions = parentSection.querySelector('[data-testid="instructions"]');
      if (!instructions || instructions.textContent.trim() === '') {
        console.log(`[QUEST] Skipping already-answered question: "${questionText}"`);
        return;
      }

      console.log(`[QUEST] Found unanswered question "${questionText}" with ${options.length} options`);

      // Extract option data
      const optionData = Array.from(options).map((opt, idx) => {
        const label = opt.textContent.trim();
        console.log(`[QUEST] Option ${idx}: "${label}"`);
        return {
          label: label,
          value: label,
          index: idx,
          element: opt
        };
      });

      // Determine if this is multi-select or single-select (reuse instructions variable)
      const instructionsText = instructions ? instructions.textContent.toLowerCase() : '';
      const isMultiSelect = instructionsText.includes('select all') || instructionsText.includes('all that apply');

      console.log(`[QUEST] Question type: ${isMultiSelect ? 'MULTI-SELECT (checkbox)' : 'SINGLE-SELECT (radio)'}`);
      console.log(`[QUEST] Instructions: "${instructions ? instructions.textContent.trim() : 'none'}"`);

      // Create question data
      const questionId = `quest_question_${index}`;
      questions.push({
        question_id: questionId,
        question_text: questionText,
        question_type: isMultiSelect ? 'checkbox' : 'radio',
        required: true,
        options: optionData,
        elements: Array.from(options), // Store the option elements for clicking
        isQuestMindshare: true, // Flag to identify this custom format
        parentSection: parentSection // Store parent for confirmation button
      });
    }
  });

  return questions;
}

// Detect generic div-based survey questions (role="button")
function detectDivBasedQuestions() {
  const questions = [];

  console.log('[DIV-SURVEY] Checking for div-based survey questions...');

  // FIRST: Check for Askia-style .responseItem divs with hidden inputs
  const askiaQuestions = [];

  // Look for hidden inputs that are part of Askia surveys
  const hiddenInputs = document.querySelectorAll('input[type="hidden"][id^="U"]');
  console.log(`[DIV-SURVEY] Found ${hiddenInputs.length} hidden inputs with id^="U"`);

  hiddenInputs.forEach((hiddenInput, index) => {
    console.log(`[DIV-SURVEY] Checking hidden input: id="${hiddenInput.id}" name="${hiddenInput.name}"`);
    const inputId = hiddenInput.id;
    const inputName = hiddenInput.name;

    // Find the question text - look for nearby h1, h2, or .askia-caption
    // For Askia surveys, the h1 is often in a different table row, so find the table first
    const table = hiddenInput.closest('table');
    const form = hiddenInput.closest('form');
    const questionContainer = table || form || hiddenInput.closest('.askiaquestions, [class*="question"]');

    if (!questionContainer) {
      console.log(`[DIV-SURVEY] No question container found for input ${hiddenInput.id}`);
      return;
    }

    console.log(`[DIV-SURVEY] Found container: ${questionContainer.tagName} ${questionContainer.className}`);

    const questionHeading = questionContainer.querySelector('h1, h2, .askia-caption, [class*="caption"]');
    if (!questionHeading) {
      console.log(`[DIV-SURVEY] No question heading found in container (tried h1, h2, .askia-caption)`);
      return;
    }

    const questionText = questionHeading.textContent.trim();
    if (!questionText || questionText.length === 0) {
      console.log(`[DIV-SURVEY] Question text is empty`);
      return;
    }

    console.log(`[DIV-SURVEY] Found question text: "${questionText.substring(0, 60)}"`);

    // Look for .response.responseItem divs near this hidden input
    const responseDivs = questionContainer.querySelectorAll('.response.responseItem, .responseItem');
    console.log(`[DIV-SURVEY] Found ${responseDivs.length} responseDivs`);

    if (responseDivs.length > 0) {
      console.log(`[DIV-SURVEY] Found Askia question: "${questionText}" with ${responseDivs.length} responseItem divs`);

      // Extract options from the divs
      const optionData = Array.from(responseDivs).map((div, idx) => {
        const label = div.getAttribute('aria-label') || div.querySelector('.response_text')?.textContent?.trim() || div.textContent.trim();
        const value = div.getAttribute('data-value') || label;

        console.log(`[DIV-SURVEY] Askia option ${idx + 1}: "${label}" (value: ${value})`);

        return {
          label: label,
          value: value,
          index: idx,
          element: div
        };
      });

      askiaQuestions.push({
        question_id: inputId || inputName || `askia_question_${index}`,
        question_text: questionText,
        question_type: 'radio', // Askia responseItem divs are typically single-select
        required: true,
        options: optionData,
        elements: Array.from(responseDivs),
        isDivBased: true,
        isAskia: true,
        hiddenInput: hiddenInput,
        container: questionContainer
      });
    }
  });

  if (askiaQuestions.length > 0) {
    console.log(`[DIV-SURVEY] Found ${askiaQuestions.length} Askia div-based questions`);
    return askiaQuestions;
  }

  // SECOND: Check for generic role="button" answer patterns (prescreeners, modern surveys)
  const genericQuestions = [];

  // Look for h1 question prompts with answer buttons
  const h1Questions = document.querySelectorAll('h1[class*="question"], h1[id*="question"], h1.question-prompt');

  h1Questions.forEach((h1, index) => {
    const questionText = h1.textContent.trim();
    if (!questionText || questionText.length === 0) return;

    console.log(`[DIV-SURVEY] Found h1 question: "${questionText.substring(0, 60)}"`);

    // Find the question container (parent that contains both question and answers)
    const questionContainer = h1.closest('[class*="question-container"], [class*="question-card"], .question, [id*="question"]') || h1.parentElement;

    // Look for answer buttons with role="button" near this question
    const answerButtons = questionContainer.querySelectorAll('[role="button"].choice-option, [role="button"][class*="answer"], [role="button"][class*="choice"]');

    if (answerButtons.length > 0) {
      console.log(`[DIV-SURVEY] Found ${answerButtons.length} role="button" answers for question`);

      // Extract answer text
      const optionData = Array.from(answerButtons).map((btn, idx) => {
        // Try multiple selectors for answer text
        const answerTextEl = btn.querySelector('.cr-ct, [class*="answer-choice"], .choice-text, .answer-text') || btn;
        const label = answerTextEl.textContent.trim();
        console.log(`[DIV-SURVEY] Option ${idx + 1}: "${label}"`);

        return {
          label: label,
          value: label,
          index: idx,
          element: btn
        };
      });

      // Determine if single or multi-select
      const isMultiSelect = questionText.toLowerCase().includes('select all') ||
                           questionText.toLowerCase().includes('all that apply') ||
                           answerButtons[0]?.querySelector('[type="checkbox"]');

      const questionId = h1.id || questionContainer.id || `div_question_${index}`;

      genericQuestions.push({
        question_id: questionId,
        question_text: questionText,
        question_type: isMultiSelect ? 'checkbox' : 'radio',
        required: true,
        options: optionData,
        elements: Array.from(answerButtons),
        isDivBased: true,
        container: questionContainer
      });
    }
  });

  if (genericQuestions.length > 0) {
    console.log(`[DIV-SURVEY] Found ${genericQuestions.length} generic div-based questions`);
    return genericQuestions;
  }

  // SECOND: Look for Quest Mindshare style containers
  const questionContainers = document.querySelectorAll('.js-question, [data-question-display-same-page]');

  questionContainers.forEach((container, index) => {
    // Find question text - might be in the same container OR in a sibling .question element
    let questionTextEl = container.querySelector('[data-testid="question-text"], .question__text');

    // If not found in container, check for sibling .question element
    if (!questionTextEl) {
      const questionWrapper = document.querySelector('.question-wrapper .question');
      if (questionWrapper) {
        questionTextEl = questionWrapper.querySelector('[data-testid="question-text"], .question__text');
      }
    }

    if (!questionTextEl) {
      console.log('[DIV-SURVEY] No question text found in container or siblings');
      return;
    }

    const questionText = questionTextEl.textContent.trim();
    if (!questionText || questionText.length === 0) {
      console.log('[DIV-SURVEY] Empty question text');
      return;
    }

    // Find answer options
    const answersContainer = container.querySelector('.answers');
    if (!answersContainer) {
      console.log('[DIV-SURVEY] No answers container found');
      return;
    }

    const answerDivs = answersContainer.querySelectorAll('[role="button"].answer, .answer[role="button"]');
    if (answerDivs.length === 0) {
      console.log('[DIV-SURVEY] No answer buttons found');
      return;
    }

    console.log(`[DIV-SURVEY] Found question: "${questionText}" with ${answerDivs.length} options`);

    // Determine question type (single-choice or multiple-choice)
    const firstAnswer = answerDivs[0];
    const isSingleChoice = firstAnswer.classList.contains('answer--single-choice');
    const isMultipleChoice = firstAnswer.classList.contains('answer--multiple-choice');

    // Also check the prompt text
    const promptEl = container.querySelector('[data-testid="question-prompt"], .question__prompt');
    const promptText = promptEl ? promptEl.textContent.toLowerCase() : '';
    const isMultiSelect = isMultipleChoice || promptText.includes('select all') || promptText.includes('all that apply');

    console.log(`[DIV-SURVEY] Question type: ${isMultiSelect ? 'MULTI-SELECT (checkbox)' : 'SINGLE-SELECT (radio)'}`);

    // Extract option data
    const optionData = Array.from(answerDivs).map((div, idx) => {
      const label = div.textContent.trim();
      const value = div.id || label;
      console.log(`[DIV-SURVEY] Option ${idx + 1}: id="${div.id}", label="${label}"`);
      return {
        label: label,
        value: value,
        index: idx,
        element: div
      };
    });

    // Create question data
    const questionId = container.id || `div_question_${index}`;
    questions.push({
      question_id: questionId,
      question_text: questionText,
      question_type: isMultiSelect ? 'checkbox' : 'radio',
      required: true,
      options: optionData,
      elements: Array.from(answerDivs),
      isDivBased: true, // Flag to identify this custom format
      container: container
    });
  });

  return questions;
}

// V5.1.0: Promise to track ongoing detection
let detectionPromise = null;

// Detect all questions on the page
async function detectQuestions() {
  // If detection already in progress, wait for it to complete instead of returning stale data
  if (isDetecting && detectionPromise) {
    console.log('[DETECTION] ⏸️ Detection already in progress, waiting for it to complete...');
    return await detectionPromise;
  }

  // Prevent detection while filling questions
  if (isFillingQuestions) {
    console.log('[DETECTION] ⏸️ Currently filling questions, skipping detection...');
    return detectedQuestions;
  }

  isDetecting = true;

  // V5.1.0: Create promise that will resolve when detection completes
  detectionPromise = (async () => {
    try {
      return await _detectQuestionsInternal();
    } finally {
      isDetecting = false;
      detectionPromise = null;
      console.log('[DETECTION] Detection lock released');
    }
  })();

  return await detectionPromise;
}

// Internal detection logic (extracted from detectQuestions)
async function _detectQuestionsInternal() {
  detectedQuestions = [];
  skippedPreFilledCount = 0; // Reset counter for this detection run

  // V1.9.61: Track detected question texts to identify duplicates (for dialog detection)
  const detectedQuestionTexts = new Set();

  // V5.1.1: Self-healing - detect platform for adaptive learning
  const platform = window.selfHeal?.detectPlatform() || 'unknown';
  const detectionStartTime = performance.now();

  console.log('[DETECTION] Starting fresh question detection...');
  console.log(`[HEAL] Platform detected: ${platform}`);

  // FIRST: Check for Decipher ranksort questions
  const ranksortQuestions = detectDecipherRanksortQuestions();
  if (ranksortQuestions.length > 0) {
    console.log(`[DETECTION] Found ${ranksortQuestions.length} Decipher ranksort questions`);
    detectedQuestions.push(...ranksortQuestions);
  }

  // SECOND: Check for Quest Mindshare custom div-based questions
  const customQuestions = detectQuestMindshareQuestions();
  if (customQuestions.length > 0) {
    console.log(`[DETECTION] Found ${customQuestions.length} Quest Mindshare custom questions`);
    detectedQuestions.push(...customQuestions);
    return detectedQuestions;
  }

  // SECOND: Check for generic div-based survey questions (role="button")
  const divBasedQuestions = detectDivBasedQuestions();
  if (divBasedQuestions.length > 0) {
    console.log(`[DETECTION] Found ${divBasedQuestions.length} div-based custom questions`);
    detectedQuestions.push(...divBasedQuestions);
    return detectedQuestions;
  }

  // THIRD: Check for Confirmit slider questions (jQuery UI sliders)
  // Check this BEFORE label-radios to avoid false positives from navigation elements
  // Confirmit uses <div class="cm-sliders-container"> with hidden inputs and jQuery UI sliders
  console.log('[CONFIRMIT-SLIDER] Checking for Confirmit slider questions...');
  const sliderContainer = document.querySelector('.cm-sliders-container');

  if (sliderContainer) {
    console.log('[CONFIRMIT-SLIDER] Found .cm-sliders-container');

    // Get slider configuration from data attributes
    const minValue = parseInt(sliderContainer.getAttribute('data-min')) || 1;
    const maxValue = parseInt(sliderContainer.getAttribute('data-max')) || 5;
    const stepValue = parseInt(sliderContainer.getAttribute('data-step')) || 1;

    console.log(`[CONFIRMIT-SLIDER] Slider config: min=${minValue}, max=${maxValue}, step=${stepValue}`);

    // Find question text
    const questionTextElement = document.querySelector('.cm-qtext');
    const questionText = questionTextElement ? questionTextElement.textContent.trim() : 'Slider question';
    console.log(`[CONFIRMIT-SLIDER] Question text: "${questionText}"`);

    // Find all slider rows
    const sliderRows = Array.from(document.querySelectorAll('.cm-slider-container'));
    console.log(`[CONFIRMIT-SLIDER] Found ${sliderRows.length} slider rows`);

    if (sliderRows.length > 0) {
      const sliders = [];

      sliderRows.forEach((row, index) => {
        // Get left and right labels
        const leftLabel = row.querySelector('.cm-slider-row__left-label-cell label');
        const rightLabel = row.querySelector('.cm-slider-row__right-label-cell label');
        const hiddenInput = row.querySelector('input.cm-numeric-input[type="hidden"]');

        if (leftLabel && rightLabel && hiddenInput) {
          const leftText = leftLabel.textContent.trim();
          const rightText = rightLabel.textContent.trim();
          const inputId = hiddenInput.id;

          console.log(`[CONFIRMIT-SLIDER] Row ${index + 1}: "${leftText}" <-> "${rightText}" (input: ${inputId})`);

          sliders.push({
            id: inputId,
            leftLabel: leftText,
            rightLabel: rightText,
            hiddenInput: hiddenInput,
            sliderDiv: row.querySelector('.cm-slider'),
            sliderHandle: row.querySelector('.ui-slider-handle'),
            minValue: minValue,
            maxValue: maxValue,
            stepValue: stepValue
          });
        }
      });

      if (sliders.length > 0) {
        console.log(`[CONFIRMIT-SLIDER] ✓ Detected Confirmit slider question with ${sliders.length} sliders`);

        detectedQuestions.push({
          question_id: 'confirmit-slider-' + sliders[0].id,
          question_text: questionText,
          question_type: 'confirmit_slider',
          required: true,
          sliders: sliders
        });

        return detectedQuestions;
      }
    }
  }

  // FOURTH: Check for label-based radio buttons (Angular surveys with no actual input elements)
  // Example: <label class="radio">Male</label><label class="radio">Female</label>
  console.log('[LABEL-SURVEY] Checking for label-based custom questions...');
  const radioLabels = document.querySelectorAll('label.radio');
  if (radioLabels.length >= 2) {
    console.log(`[LABEL-SURVEY] Found ${radioLabels.length} radio labels, checking if they're part of a question...`);

    // Find the question heading (h3.title or nearby heading) - skip empty headings
    const allHeadings = document.querySelectorAll('h3.title, .title, h3, h2, h1');
    let questionHeading = null;
    for (const heading of allHeadings) {
      if (heading.textContent.trim()) {
        questionHeading = heading;
        break; // Use the first non-empty heading
      }
    }

    if (questionHeading) {
      const questionText = questionHeading.textContent.trim();
      console.log(`[LABEL-SURVEY] Found question: "${questionText}"`);

      // Extract option labels
      const options = Array.from(radioLabels).map(label => ({
        label: label.textContent.trim(),
        value: label.textContent.trim(),
        element: label
      }));

      console.log(`[LABEL-SURVEY] Detected label-based radio question with ${options.length} options`);

      detectedQuestions.push({
        question_id: 'label-radio-question',
        question_text: questionText,
        question_type: 'label-radio', // Custom type for label-based radios
        required: false,
        options: options,
        elements: Array.from(radioLabels) // Store labels as elements for clicking
      });

      return detectedQuestions;
    }
  }

  // Find all form elements
  const allInputs = document.querySelectorAll('input, textarea, select');

  // Group radio and checkbox inputs by name
  const groupedInputs = new Map();
  const individualInputs = [];

  allInputs.forEach((input) => {
    const type = input.type || input.tagName.toLowerCase();

    // Skip hidden, submit, button, and image buttons (image buttons are for navigation)
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') {
      return;
    }

    // IPSOS Vue.js fix (v1.9.27): Skip IPSOS hidden radios/selects that have Vue.js counterparts
    // IPSOS uses dual elements: hidden (simple IDs like _Q0_C0, _Q0_C, _Q1_C) + visible Vue.js (long IDs)
    // BUT: Only skip if a Vue.js counterpart actually exists (some IPSOS pages don't have Vue)
    if (input.id && /^_Q\d+_C\d*$/.test(input.id)) {
      const inputName = input.name;
      const inputValue = input.value;

      // Look for a Vue.js element with same name OR value but different ID pattern
      const hasVueCounterpart = Array.from(document.querySelectorAll('input, select')).some(el => {
        // Skip self
        if (el.id === input.id) return false;

        // Check if this element has a non-simple ID (Vue pattern)
        const hasComplexId = el.id && !/^_Q\d+_C\d*$/.test(el.id);

        // Check if it shares name or value
        const sharesName = el.name && inputName && (
          el.name === inputName ||
          el.name.includes(inputName) ||
          inputName.includes(el.name)
        );
        const sharesValue = inputValue && el.value === inputValue;

        return hasComplexId && (sharesName || sharesValue);
      });

      if (hasVueCounterpart) {
        console.log(`[DETECTION] Skipping IPSOS hidden element: ID="${input.id}" (has Vue.js counterpart)`);
        return;
      }
    }

    // Skip visually hidden TEXT/TEXTAREA inputs (fraud detection, tracking, debugging fields)
    // BUT: Don't skip radio/checkbox - they're often styled with hidden inputs + visible labels (Bootstrap btn-check pattern)
    if (type === 'text' || type === 'textarea' || type === 'email' || type === 'number' || type === 'tel') {
      const inlineStyle = input.getAttribute('style') || '';
      const computedStyle = window.getComputedStyle(input);
      const isVisuallyHidden = inlineStyle.includes('visibility: hidden') ||
                              inlineStyle.includes('visibility:hidden') ||
                              inlineStyle.includes('display: none') ||
                              inlineStyle.includes('display:none') ||
                              computedStyle.visibility === 'hidden' ||
                              computedStyle.display === 'none';

      if (isVisuallyHidden) {
        console.log(`[DETECTION] Skipping visually hidden text field: ID="${input.id}" name="${input.name}" (hidden field - likely fraud detection/tracking)`);
        return;
      }

      // ALSO check if parent container is hidden (conditional fields that are only shown based on other answers)
      let parent = input.parentElement;
      while (parent && parent !== document.body) {
        const parentStyle = parent.getAttribute('style') || '';
        const parentComputed = window.getComputedStyle(parent);
        const isParentHidden = parentStyle.includes('display: none') ||
                              parentStyle.includes('display:none') ||
                              parentComputed.display === 'none';

        if (isParentHidden) {
          console.log(`[DETECTION] Skipping text field with hidden parent container: ID="${input.id}" name="${input.name}" (conditional field not currently visible)`);
          return;
        }
        parent = parent.parentElement;
      }

      // Skip inline open-ended (OE) fields that are part of radio/checkbox options
      // These are "Other, please specify: ____" type fields that should only be filled if their radio/checkbox is selected
      const classList = input.className || '';
      const isInlineOE = classList.includes('oe-inline') ||
                        classList.includes('oe inline') ||
                        (classList.includes('oe') && classList.includes('inline'));

      if (isInlineOE) {
        console.log(`[DETECTION] Skipping inline open-ended field: ID="${input.id}" name="${input.name}" class="${input.className}" (part of radio/checkbox option)`);
        return;
      }

      // Also check if the text input is directly inside a radio/checkbox option structure
      // by looking for nearby radio/checkbox inputs with similar naming patterns
      if (type === 'text' || type === 'textarea') {
        const inputName = input.name || input.id || '';
        // Check if there's a radio/checkbox nearby with a name that suggests this text field is its OE component
        // Common patterns: oe4284.0 paired with ans4284.0.0, or oe_Q2 paired with Q2, etc.
        const oePattern = /^oe[_\d]*/i;
        if (oePattern.test(inputName)) {
          // Look for a parent container that might have a radio/checkbox
          const container = input.closest('.element, .answer, .option, .cell-text, label');
          if (container) {
            const nearbyRadioOrCheckbox = container.querySelector('input[type="radio"], input[type="checkbox"]');
            if (nearbyRadioOrCheckbox) {
              console.log(`[DETECTION] Skipping text field that appears to be part of radio/checkbox option: ID="${input.id}" name="${input.name}" (found nearby radio/checkbox)`);
              return;
            }
          }
        }
      }
    }

    // Skip Google Translate widget inputs
    if (input.id && input.id.startsWith('goog-gt-')) {
      console.log(`[DETECTION] Skipping Google Translate input: ID="${input.id}"`);
      return;
    }

    // Skip inputs inside Google Translate container
    if (input.closest('#google_translate_element, .goog-te-gadget, [class*="goog-te-"]')) {
      console.log(`[DETECTION] Skipping Google Translate element: ID="${input.id}"`);
      return;
    }

    // Skip honeypot fields (spam traps) - these are usually visually hidden
    // Common honeypot field names: website, url, homepage, comment_author_url
    const honeypotNames = ['website', 'url', 'homepage', 'comment_author_url', 'user_email', 'user_url'];
    if (input.name && honeypotNames.includes(input.name.toLowerCase())) {
      const computedStyle = window.getComputedStyle(input);
      const isHidden = computedStyle.display === 'none' ||
                      computedStyle.visibility === 'hidden' ||
                      computedStyle.opacity === '0' ||
                      input.offsetParent === null;
      if (isHidden) {
        console.log(`[DETECTION] Skipping honeypot field: name="${input.name}" (hidden)`);
        return;
      }
    }

    // Skip captcha fields (reCAPTCHA, hCaptcha)
    if (input.id && (input.id.includes('captcha') || input.id.includes('recaptcha'))) {
      return;
    }

    // Skip Ipsos phantom test fields (the_answer_1, the_answer_2, etc.)
    // These are hidden backup fields that cause DOMExceptions when we try to fill them
    if (input.id && input.id.match(/^the_answer_\d+$/)) {
      console.log(`[DETECTION] Skipping phantom test field: ID="${input.id}"`);
      return;
    }

    // Group radio and checkbox by name
    if ((type === 'radio' || type === 'checkbox') && input.name) {
      // V1.9.68: Skip exclusive radios (like "Prefer not to answer") that are part of checkbox groups
      // These are mutually exclusive options within the same question, not separate questions
      if (type === 'radio' && input.getAttribute('isexclusive') === 'true') {
        console.log(`[DETECTION] Skipping exclusive radio: ID="${input.id}" name="${input.name}" (mutually exclusive option, not a separate question)`);
        return;
      }

      // 🔧 LEVEL 5 MATRIX PATCH: For Decipher matrices, group by base name only
      // Example: ans5084.0.1, ans5084.0.2, ans5084.1.1, ans5084.1.2 → all grouped under "ans5084"
      // This allows treating all sub-rows (ans5084.0.x, ans5084.1.x, etc.) as one parent question
      let groupKey = input.name;

      // Detect Decipher matrix pattern: ansXXXX.N.M or ansXXXX.N format
      const decipherMatrixPattern = /^(ans\d+)\.\d+/;
      const match = input.name.match(decipherMatrixPattern);

      if (match) {
        // Use only the base name (e.g., "ans5084" from "ans5084.0.1")
        groupKey = match[1];
        console.log(`[LEVEL5 MATRIX PATCH] Regrouping ${input.name} → ${groupKey}`);
      }

      if (!groupedInputs.has(groupKey)) {
        groupedInputs.set(groupKey, []);
      }
      groupedInputs.get(groupKey).push(input);
    } else {
      // Skip text inputs associated with radio/checkbox "Other" options
      // Pattern: Text input is inside same <li> as a radio/checkbox, and input isn't checked
      if (type === 'text' || type === 'textarea') {
        const listItem = input.closest('li, div.Selection, .choice, .option');
        if (listItem) {
          const associatedRadioOrCheckbox = listItem.querySelector('input[type="radio"], input[type="checkbox"]');
          if (associatedRadioOrCheckbox && !associatedRadioOrCheckbox.checked) {
            console.log(`[DETECTION] Skipping text input "${input.id}" - associated with unchecked option "${associatedRadioOrCheckbox.value}"`);
            return;
          }
        }
      }

      // V1.9.31: Skip select dropdowns with hidden parent containers (IPSOS progressive forms)
      // This respects forms where fields appear progressively based on previous answers
      if (type === 'select') {
        const parentTd = input.closest('td');
        if (parentTd) {
          const parentStyle = parentTd.getAttribute('style') || '';
          const parentComputed = window.getComputedStyle(parentTd);
          const isParentHidden = parentStyle.includes('display: none') ||
                                parentStyle.includes('display:none') ||
                                parentComputed.display === 'none';

          if (isParentHidden) {
            console.log(`[DETECTION] Skipping select with hidden parent container: ID="${input.id}" name="${input.name}" (progressive form - field not yet visible)`);
            return;
          }
        }
      }

      // V5.1.1: Skip Material UI checkboxes without name attribute
      // These are detected better by LLM fallback as a grouped question
      if (type === 'checkbox' && !input.name) {
        const isInDialog = input.closest('[role="dialog"], .MuiDialog-root, .dialog-question');
        const hasGenericId = !input.id || input.id.startsWith('q_checkbox_');
        if (isInDialog && hasGenericId) {
          console.log(`[DETECTION] Skipping Material UI checkbox without name: ID="${input.id}" (will be detected by LLM as grouped question)`);
          return;
        }
      }

      // Individual inputs (text, textarea, select, etc.)
      individualInputs.push(input);
    }
  });

  // ADDITIONAL: Group radio buttons that don't have a name but are part of the same question
  const ungroupedRadios = individualInputs.filter(inp => inp.type === 'radio');

  if (ungroupedRadios.length > 1) {
    console.log(`[GROUPING] Processing ${ungroupedRadios.length} ungrouped radio buttons`);

    // Deduplicate by ID or name (some UIs have multiple radio buttons per option)
    // NOTE: Can't use .value because all unchecked radios have value="on"
    const uniqueRadios = [];
    const seenIdentifiers = new Set();
    ungroupedRadios.forEach(radio => {
      const identifier = radio.id || radio.name || radio.value;
      if (!seenIdentifiers.has(identifier)) {
        seenIdentifiers.add(identifier);
        uniqueRadios.push(radio);
      }
    });

    if (uniqueRadios.length !== ungroupedRadios.length) {
      console.log(`[GROUPING] Deduplicated ${ungroupedRadios.length} radios to ${uniqueRadios.length} unique options by value`);
    }

    // If we have multiple unique radios, group them together
    if (uniqueRadios.length >= 2) {
      console.log(`[GROUPING] Grouping ${uniqueRadios.length} ungrouped radio buttons as one question`);
      const groupName = 'ungrouped_radios_' + (uniqueRadios[0].id || 'group');
      groupedInputs.set(groupName, uniqueRadios);

      // Remove ALL radios (including duplicates) from individualInputs
      ungroupedRadios.forEach(radio => {
        const idx = individualInputs.indexOf(radio);
        if (idx > -1) individualInputs.splice(idx, 1);
      });
    }
  }

  // ADDITIONAL: Group checkboxes that don't have a name but share an ID prefix
  // Example: ans3413.0.0, ans3413.0.1, ans3413.0.2 -> group by "ans3413.0"
  // Example: QR~QID1218157215~21, QR~QID1218157215~16 -> group by "QR~QID1218157215"
  const ungroupedCheckboxes = individualInputs.filter(inp => inp.type === 'checkbox' && inp.id);

  if (ungroupedCheckboxes.length > 1) {
    // Find checkboxes with common ID prefixes
    const prefixGroups = new Map();

    ungroupedCheckboxes.forEach(checkbox => {
      // Extract prefix (everything before last delimiter and number)
      // ans3413.0.7 -> ans3413.0
      // QR~QID1218157215~21 -> QR~QID1218157215
      // flexRadioDefault0 -> flexRadioDefault
      // selection-item-0-undefined -> selection-item
      const match = checkbox.id.match(/^(.+)[.~](\d+)$/) ||
                   checkbox.id.match(/^(.+\.\d+)\.\d+$/) ||
                   checkbox.id.match(/^(.+-)\d+-.+$/) ||  // NEW: Match pattern like selection-item-0-undefined
                   checkbox.id.match(/^([a-zA-Z_-]+)(\d+)$/);  // Match letters followed by numbers
      if (match) {
        const prefix = match[1];
        if (!prefixGroups.has(prefix)) {
          prefixGroups.set(prefix, []);
        }
        prefixGroups.get(prefix).push(checkbox);
      }
    });

    // Add groups with 2+ checkboxes to groupedInputs
    prefixGroups.forEach((checkboxes, prefix) => {
      if (checkboxes.length >= 2) {
        console.log(`[GROUPING] Found ${checkboxes.length} checkboxes with prefix "${prefix}"`);
        groupedInputs.set(prefix, checkboxes);
        // Remove these from individualInputs
        checkboxes.forEach(cb => {
          const idx = individualInputs.indexOf(cb);
          if (idx > -1) individualInputs.splice(idx, 1);
        });
      }
    });
  }

  // ADDITIONAL: Group number inputs that share an ID prefix (matrix-style questions)
  // Example: ans1057186.0.2, ans1057186.0.4, ans1057186.0.1 -> group by "ans1057186.0"
  const ungroupedNumberInputs = individualInputs.filter(inp => inp.type === 'number' && inp.id);

  if (ungroupedNumberInputs.length > 1) {
    // Find number inputs with common ID prefixes
    const numberPrefixGroups = new Map();

    ungroupedNumberInputs.forEach(numberInput => {
      // Extract prefix (everything before last delimiter and number)
      // ans1057186.0.2 -> ans1057186.0
      const match = numberInput.id.match(/^(.+)[.~](\d+)$/) ||
                   numberInput.id.match(/^(.+\.\d+)\.\d+$/);
      if (match) {
        const prefix = match[1];
        if (!numberPrefixGroups.has(prefix)) {
          numberPrefixGroups.set(prefix, []);
        }
        numberPrefixGroups.get(prefix).push(numberInput);
      }
    });

    // Add groups with 2+ number inputs to groupedInputs
    numberPrefixGroups.forEach((numberInputs, prefix) => {
      if (numberInputs.length >= 2) {
        console.log(`[GROUPING] Found ${numberInputs.length} number inputs with prefix "${prefix}" - treating as matrix question`);
        groupedInputs.set(prefix, numberInputs);
        // Remove these from individualInputs
        numberInputs.forEach(ni => {
          const idx = individualInputs.indexOf(ni);
          if (idx > -1) individualInputs.splice(idx, 1);
        });
      }
    });
  }

  // MERGE single-checkbox groups with common prefixes
  // Find groups with only 1 checkbox that share a common prefix
  const singleCheckboxGroups = [];
  groupedInputs.forEach((inputs, name) => {
    if (inputs.length === 1 && inputs[0].type === 'checkbox') {
      singleCheckboxGroups.push({ name, inputs });
    }
  });

  if (singleCheckboxGroups.length > 1) {
    // Try to merge by common prefix
    const prefixMergeMap = new Map();

    singleCheckboxGroups.forEach(({ name, inputs }) => {
      // Extract prefix: ans94071.0.0 -> ans94071.0
      // Extract prefix: QR~QID1218157215~21 -> QR~QID1218157215
      // Extract prefix: flexRadioDefault0 -> flexRadioDefault
      // Extract prefix: _QPage2__BTCheck_C__1 -> _QPage2__BTCheck_C
      // Extract prefix: _QPage2__BTCheck_CNA -> _QPage2__BTCheck_C
      // Extract prefix: selection-item-0-undefined -> selection-item
      const match = name.match(/^(.+)[.~](\d+)$/) ||
                   name.match(/^(.+\.\d+)\.\d+$/) ||
                   name.match(/^(.+)__(\d+)$/) ||           // Double underscore + number
                   name.match(/^(.+)__([A-Z]+)$/) ||        // Double underscore + capital letters (NA, YES, etc)
                   name.match(/^(.+)_(\d+)$/) ||            // Single underscore + number
                   name.match(/^(.+-)\d+-.+$/) ||           // Hyphen + number + hyphen + text (selection-item-0-undefined)
                   name.match(/^([a-zA-Z_-]+)(\d+)$/);      // Match letters followed by numbers
      if (match) {
        const prefix = match[1];
        if (!prefixMergeMap.has(prefix)) {
          prefixMergeMap.set(prefix, []);
        }
        prefixMergeMap.get(prefix).push({ name, inputs });
      }
    });

    // Merge groups with same prefix
    prefixMergeMap.forEach((groups, prefix) => {
      if (groups.length >= 2) {
        console.log(`[MERGE] Merging ${groups.length} single-checkbox groups with prefix "${prefix}"`);

        // Combine all inputs
        const allInputs = groups.flatMap(g => g.inputs);

        // Remove original groups
        groups.forEach(g => groupedInputs.delete(g.name));

        // Add merged group
        groupedInputs.set(prefix, allInputs);
      }
    });
  }

  // Process grouped radio/checkbox questions
  groupedInputs.forEach((inputs, name) => {
    if (inputs.length > 0) {
      const questionData = extractGroupedQuestionData(inputs, name, detectedQuestionTexts);
      if (questionData) {
        detectedQuestions.push(questionData);
      }
    }
  });

  // SPECIAL: Detect and group radio button matrices (e.g., Likert scale grids)
  // Check if multiple radio groups share the same table/container and have the same options
  const radioQuestions = detectedQuestions.filter(q => q.question_type === 'radio');

  if (radioQuestions.length >= 2) {
    console.log(`[MATRIX] Checking ${radioQuestions.length} radio questions for matrix grouping...`);

    // Group radio questions by their parent table/container
    // Use WeakMap to group by actual table/container element (not ID)
    const tableElementGroups = new Map();
    const tableToId = new WeakMap();
    let tableCounter = 0;

    radioQuestions.forEach(question => {
      const firstInput = question.element || question.elements?.[0];
      if (!firstInput) return;

      // EXPANDED: Look for table OR div containers that might contain a matrix
      // Check for: <table>, [role="grid"], or divs with "matrix", "grid", "question" in class
      let container = firstInput.closest('table, [role="grid"]');

      // If no table found, look for div containers commonly used for matrices
      // IMPORTANT: Skip .matrix_column (that's a single cell, not the whole matrix!)
      if (!container) {
        container = firstInput.closest('div[class*="question-list"], div[class*="pre-question"]');
      }

      // Angular.js specific: look for ng-repeat or ng-controller parent containers
      // These typically wrap the entire matrix, not just one row
      if (!container) {
        container = firstInput.closest('[ng-repeat*="question"], [ng-controller], div.ng-scope:has(> [ng-repeat])');
      }

      // Last resort: look for any container with multiple .question_martix children
      // (This would be a shared parent of all matrix rows)
      if (!container) {
        let parent = firstInput.parentElement;
        while (parent && parent !== document.body) {
          // Count how many question_martix divs are in this parent
          const matrixRows = parent.querySelectorAll('.question_martix, div[class*="question_mart"]');
          if (matrixRows.length >= 2) {
            container = parent;
            console.log(`[MATRIX] Found shared parent with ${matrixRows.length} matrix rows`);
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (container) {
        // Get or create a stable ID for this container element
        if (!tableToId.has(container)) {
          tableToId.set(container, `table_${tableCounter++}`);
        }
        const tableId = tableToId.get(container);

        console.log(`[MATRIX] Question ${question.question_id} assigned to container: ${tableId} (tag: ${container.tagName}, class: ${container.className})`);

        if (!tableElementGroups.has(tableId)) {
          tableElementGroups.set(tableId, []);
        }
        tableElementGroups.get(tableId).push(question);
      } else {
        console.log(`[MATRIX] Question ${question.question_id} has NO container - cannot group`);
      }
    });

    const tableGroups = tableElementGroups;

    console.log(`[MATRIX-RADIO] Found ${tableGroups.size} container(s) with radio questions:`);
    tableGroups.forEach((questions, tableId) => {
      console.log(`[MATRIX-RADIO]   Container ${tableId}: ${questions.length} questions`);
    });

    // Check each table group for matrix patterns
    tableGroups.forEach((questions, tableId) => {
      console.log(`[MATRIX-RADIO] Analyzing container ${tableId} with ${questions.length} questions...`);
      if (questions.length < 2) {
        console.log(`[MATRIX-RADIO]   ↳ Skipping - need at least 2 rows for a matrix`);
        return; // Need at least 2 rows for a matrix
      }

      // Check if all questions have the same number of options
      const firstOptions = questions[0].options;
      const allSameOptions = questions.every(q =>
        q.options &&
        q.options.length === firstOptions.length
      );

      if (!allSameOptions) {
        console.log(`[MATRIX] Table has ${questions.length} radio groups but different option counts - not a matrix`);
        return;
      }

      // 🔧 V1.9.99: For CarouselApp matrices, extract column labels from carousel scale cards
      const isCarouselApp = document.querySelector('.mx-carouselapp-container, .mx-carousel') &&
                           document.querySelector('.mx-carouselapp-scaleholder-inner');

      let cleanOptions;
      if (isCarouselApp) {
        console.log(`[MATRIX] CarouselApp detected - extracting column labels from carousel scale cards`);
        const scaleCards = Array.from(document.querySelectorAll('.mx-carouselapp-scale'));
        cleanOptions = scaleCards.map((card, idx) => {
          const labelEl = card.querySelector('.label, .mx-card .label');
          const label = labelEl ? labelEl.textContent.trim() : firstOptions[idx]?.label || `Option ${idx + 1}`;
          const value = firstOptions[idx]?.value || label;
          console.log(`[MATRIX] Carousel column ${idx + 1}: label="${label}", value="${value}"`);
          return { label, value };
        });
      } else {
        // Standard matrix: Extract clean option labels (remove row text prefixes)
        cleanOptions = firstOptions.map((opt, idx) => {
        // Try to extract just the scale text (e.g., "Strongly agree" from "Mark Carney... Strongly agree")
        const label = opt.label;

        // Common pattern: "Row text Scale text" -> extract "Scale text"
        // Look for common scale keywords
        const scaleKeywords = ['strongly', 'somewhat', 'neither', 'agree', 'disagree', 'likely', 'important', 'satisfied', 'approve', 'disapprove'];
        const words = label.toLowerCase().split(' ');

        let scaleText = label;
        for (let i = 0; i < words.length; i++) {
          if (scaleKeywords.some(keyword => words[i].includes(keyword))) {
            // Found scale keyword, extract from here to end
            scaleText = label.split(' ').slice(i).join(' ');
            break;
          }
        }

        return {
          label: scaleText.trim(),
          value: opt.value || scaleText.trim()
        };
      });
      }

      console.log(`[MATRIX] Found matrix with ${questions.length} rows and ${cleanOptions.length} columns`);
      console.log(`[MATRIX] Options:`, cleanOptions.map(o => o.label));

      // Extract row labels (sub-questions) - remove the option text
      const rows = questions.map(q => {
        // Try to get row label from data-row-label attribute on first element
        let cleanRowText = null;
        if (q.elements && q.elements.length > 0) {
          const firstElement = q.elements[0];
          if (firstElement.hasAttribute('data-row-label')) {
            cleanRowText = firstElement.getAttribute('data-row-label').trim();
            console.log(`[MATRIX] Extracted row label from data-row-label: "${cleanRowText}"`);
          }

          // Angular.js: Look for row label in parent .matrix_question_opt or similar
          if (!cleanRowText) {
            const rowLabelDiv = firstElement.closest('.question_martix, .matrix-row, [class*="row"]')?.querySelector('.matrix_question_opt, .optiontext, [ng-bind-html*="QuestionText"]');
            if (rowLabelDiv) {
              const text = rowLabelDiv.textContent.trim();
              // Make sure it's not one of the column options
              const isNotColumnOption = !cleanOptions.some(opt =>
                text.toLowerCase() === opt.label.toLowerCase() ||
                text.toLowerCase().includes(opt.label.toLowerCase())
              );
              if (isNotColumnOption && text.length > 2 && text.length < 500) {
                cleanRowText = text;
                console.log(`[MATRIX] Extracted row label from Angular matrix div: "${cleanRowText}"`);
              }
            }
          }
        }

        // Fallback to parsing question text
        if (!cleanRowText) {
          const rowText = q.question_text;
          // Remove scale text from row labels if present
          cleanRowText = rowText;
          cleanOptions.forEach(opt => {
            if (rowText.endsWith(opt.label)) {
              cleanRowText = rowText.substring(0, rowText.length - opt.label.length).trim();
            }
          });
        }

        return {
          label: cleanRowText,
          question_id: q.question_id,
          elements: q.elements
        };
      });

      // Find the main question text (look outside the table/container)
      const firstInput = questions[0].element || questions[0].elements?.[0];
      const container = firstInput.closest('table, [role="grid"], div[class*="matrix"], div[class*="grid"], div[class*="question-list"], div[class*="pre-question"], [ng-repeat], [ng-controller]');
      let mainQuestionText = 'Matrix question';

      if (container) {
        // Look for heading before the container
        let sibling = container.previousElementSibling;
        for (let i = 0; i < 5 && sibling; i++) {
          const text = sibling.textContent.trim();
          if (text.includes('?') && text.length < 500 && text.length > 10) {
            mainQuestionText = text;
            console.log(`[MATRIX] Found main question from sibling: "${mainQuestionText.substring(0, 80)}"`);
            break;
          }
          sibling = sibling.previousElementSibling;
        }

        // Check for question text in parent divs with specific classes
        if (mainQuestionText === 'Matrix question') {
          const questionBack = container.querySelector('.questionback, .question, [class*="question-text"]');
          if (questionBack) {
            const text = questionBack.textContent.trim();
            if (text.length > 10 && text.length < 1000) {
              mainQuestionText = text;
              console.log(`[MATRIX] Found main question from .questionback: "${mainQuestionText.substring(0, 80)}"`);
            }
          }
        }

        // Check for Angular.js template question text
        if (mainQuestionText === 'Matrix question') {
          const ngQuestionText = container.querySelector('[ng-bind-html*="QuestionText"], .ng-binding');
          if (ngQuestionText && ngQuestionText.textContent.includes('?')) {
            const text = ngQuestionText.textContent.trim();
            if (text.length > 10 && text.length < 1000) {
              mainQuestionText = text;
              console.log(`[MATRIX] Found main question from Angular binding: "${mainQuestionText.substring(0, 80)}"`);
            }
          }
        }

        // Also check table caption or thead (for table-based matrices)
        if (mainQuestionText === 'Matrix question' && container.tagName === 'TABLE') {
          const caption = container.querySelector('caption');
          const legend = container.closest('fieldset')?.querySelector('legend');
          if (caption && caption.textContent.trim()) {
            mainQuestionText = caption.textContent.trim();
          } else if (legend && legend.textContent.trim()) {
            mainQuestionText = legend.textContent.trim();
          }
        }
      }

      // Create matrix question
      const matrixQuestion = {
        question_id: `matrix_${questions[0].question_id}`,
        question_text: mainQuestionText,
        question_type: 'matrix',
        isMatrix: true,
        rows: rows,
        columns: cleanOptions,
        required: questions.some(q => q.required),
        elements: questions.flatMap(q => q.elements || [])
      };

      // Remove individual row questions from detectedQuestions
      questions.forEach(q => {
        const index = detectedQuestions.indexOf(q);
        if (index > -1) {
          detectedQuestions.splice(index, 1);
        }
      });

      // Add matrix question
      detectedQuestions.push(matrixQuestion);
      console.log(`[MATRIX] Created matrix question with ${rows.length} rows x ${cleanOptions.length} columns`);
    });
  }

  // V1.9.42: Group checkboxes with same question text (multi-select questions with different names)
  // Example: "Do you work in any of the following?" with checkboxes for each occupation
  const checkboxQuestions = detectedQuestions.filter(q => q.question_type === 'checkbox');

  if (checkboxQuestions.length >= 2) {
    console.log(`[CHECKBOX_GROUP] Checking ${checkboxQuestions.length} checkbox questions for shared question text...`);

    // Group by question text (first 100 chars to handle minor variations)
    const questionTextGroups = new Map();
    checkboxQuestions.forEach(q => {
      const textKey = q.question_text.substring(0, 100);
      if (!questionTextGroups.has(textKey)) {
        questionTextGroups.set(textKey, []);
      }
      questionTextGroups.get(textKey).push(q);
    });

    // Process groups with 2+ checkboxes sharing same question text
    const groupsToMerge = [];
    questionTextGroups.forEach((questions, textKey) => {
      if (questions.length >= 2) {
        // Check if they're all in the same question container (by questionname attribute)
        const firstElement = questions[0].element;
        if (!firstElement) return;

        const firstQuestionContainer = firstElement.closest('[questionname]');
        if (firstQuestionContainer) {
          const questionName = firstQuestionContainer.getAttribute('questionname');

          // V1.9.61: Check if all checkboxes share the same questionname OR share a common prefix
          // Example: q60-5, q60-4, q60-1 all share prefix "q60-"
          const allSameQuestion = questions.every(q => {
            const container = q.element?.closest('[questionname]');
            return container && container.getAttribute('questionname') === questionName;
          });

          if (allSameQuestion) {
            console.log(`[CHECKBOX_GROUP] ✓ Found ${questions.length} checkboxes with shared question (${questionName}): "${textKey.substring(0, 50)}..."`);
            groupsToMerge.push(questions);
          } else {
            // V1.9.61: Check if checkboxes share a common question prefix (e.g., "q60-")
            const questionNames = questions.map(q => {
              const container = q.element?.closest('[questionname]');
              return container?.getAttribute('questionname');
            }).filter(Boolean);

            if (questionNames.length === questions.length) {
              // Extract common prefix by finding the longest common prefix before the last hyphen/number
              const prefixes = questionNames.map(name => {
                const match = name.match(/^([a-zA-Z]+\d+)-/);
                return match ? match[1] : null;
              }).filter(Boolean);

              const allSamePrefix = prefixes.length === questionNames.length &&
                                   prefixes.every(p => p === prefixes[0]);

              if (allSamePrefix) {
                console.log(`[CHECKBOX_GROUP] ✓ Found ${questions.length} checkboxes with shared question prefix (${prefixes[0]}-*): "${textKey.substring(0, 50)}..."`);
                groupsToMerge.push(questions);
              } else {
                // V1.9.63 fallback: Check input name attributes directly when questionname prefix doesn't match
                const inputNames = questions.map(q => q.element?.name).filter(Boolean);
                if (inputNames.length === questions.length) {
                  const inputPrefixes = inputNames.map(name => {
                    let match = name.match(/^([A-Z]+\d+)\[/);
                    if (match) return match[1];
                    match = name.match(/^([a-z]+\d+)-/);
                    if (match) return match[1];
                    match = name.match(/answer-([a-z]+\d+)-/);
                    if (match) return match[1];
                    return null;
                  }).filter(Boolean);

                  const allSameInputPrefix = inputPrefixes.length === inputNames.length &&
                                            inputPrefixes.every(p => p === inputPrefixes[0]);

                  if (allSameInputPrefix) {
                    console.log(`[CHECKBOX_GROUP] ✓ Found ${questions.length} checkboxes with shared input name prefix (${inputPrefixes[0]}*)`);
                    groupsToMerge.push(questions);
                  } else {
                    console.log(`[CHECKBOX_GROUP] ✗ Checkboxes have same text but different questionname attributes, not grouping`);
                  }
                } else {
                  console.log(`[CHECKBOX_GROUP] ✗ Checkboxes have same text but different questionname attributes, not grouping`);
                }
              }
            } else {
              console.log(`[CHECKBOX_GROUP] ✗ Checkboxes have same text but different questionname attributes, not grouping`);
            }
          }
        } else {
          // No questionname attribute, fall back to checking input name attributes directly
          // V1.9.63: Check if checkbox inputs share a common name prefix (more reliable than container matching)
          // Example: name="Q120[1]", "Q120[2]" all share prefix "Q120"
          const inputNames = questions.map(q => q.element?.name).filter(Boolean);

          if (inputNames.length === questions.length) {
            // Extract prefix from input names (e.g., "Q120[1]" -> "Q120", "q60-5" -> "q60")
            const prefixes = inputNames.map(name => {
              // Try pattern: Q120[1] -> Q120
              let match = name.match(/^([A-Z]+\d+)\[/);
              if (match) return match[1];

              // Try pattern: q60-5 -> q60
              match = name.match(/^([a-z]+\d+)-/);
              if (match) return match[1];

              // Try pattern: answer-q60-5 -> q60
              match = name.match(/answer-([a-z]+\d+)-/);
              if (match) return match[1];

              return null;
            }).filter(Boolean);

            const allSamePrefix = prefixes.length === inputNames.length &&
                                 prefixes.every(p => p === prefixes[0]);

            if (allSamePrefix) {
              console.log(`[CHECKBOX_GROUP] ✓ Found ${questions.length} checkboxes with shared input name prefix (${prefixes[0]}*): "${textKey.substring(0, 50)}..."`);
              groupsToMerge.push(questions);
            } else {
              // Final fallback: check if all in same general container
              const firstContainer = firstElement.closest('.question, .questionContainer, .survey-question, fieldset');
              if (firstContainer) {
                const allSameContainer = questions.every(q =>
                  q.element?.closest('.question, .questionContainer, .survey-question, fieldset') === firstContainer
                );
                if (allSameContainer) {
                  console.log(`[CHECKBOX_GROUP] ✓ Found ${questions.length} checkboxes in same container: "${textKey.substring(0, 50)}..."`);
                  groupsToMerge.push(questions);
                } else {
                  console.log(`[CHECKBOX_GROUP] ✗ Checkboxes have same text but couldn't group (different containers, no common prefix)`);
                }
              } else {
                console.log(`[CHECKBOX_GROUP] ✗ Checkboxes have same text but couldn't group (no container found)`);
              }
            }
          } else {
            console.log(`[CHECKBOX_GROUP] ✗ Checkboxes missing name attributes, cannot group`);
          }
        }
      }
    });

    // Merge each group into a single multi-select checkbox question
    groupsToMerge.forEach(questions => {
      const firstQuestion = questions[0];
      const allOptions = questions.map(q => q.options[0]); // Each has 1 option
      const allElements = questions.map(q => q.element);

      const mergedQuestion = {
        question_id: questions.map(q => q.question_id).join('|'), // Combined ID
        element: null, // No single element
        elements: allElements, // All checkbox elements
        question_text: firstQuestion.question_text,
        question_type: 'checkbox',
        required: questions.some(q => q.required),
        options: allOptions,
        isMultiSelect: true // Flag for multi-select
      };

      // Remove individual questions from detectedQuestions
      questions.forEach(q => {
        const idx = detectedQuestions.indexOf(q);
        if (idx > -1) detectedQuestions.splice(idx, 1);
      });

      // Add merged question
      detectedQuestions.push(mergedQuestion);
      console.log(`[CHECKBOX_GROUP] ✓ Merged ${questions.length} checkboxes into 1 multi-select question with ${allOptions.length} options`);
    });
  }

  // SPECIAL: Detect and group CHECKBOX button matrices (similar to radio matrices but for "select all that apply" grids)
  const remainingCheckboxQuestions = detectedQuestions.filter(q => q.question_type === 'checkbox');

  if (remainingCheckboxQuestions.length >= 2) {
    console.log(`[MATRIX] Checking ${remainingCheckboxQuestions.length} checkbox questions for matrix grouping...`);

    // Group checkbox questions by their parent table
    const tableElementGroups = new Map();
    const tableToId = new WeakMap();
    let tableCounter = 0;

    remainingCheckboxQuestions.forEach(question => {
      const firstInput = question.element || question.elements?.[0];
      if (!firstInput) return;

      // EXPANDED: Look for table OR div containers that might contain a matrix
      let container = firstInput.closest('table, [role="grid"]');

      // If no table found, look for div containers commonly used for matrices
      if (!container) {
        container = firstInput.closest('div[class*="matrix"], div[class*="grid"], div[class*="question-list"], div[class*="pre-question"]');
      }

      // Angular.js specific: look for ng-repeat parent containers
      if (!container) {
        container = firstInput.closest('[ng-repeat], [ng-controller], .ng-scope');
      }

      if (container) {
        if (!tableToId.has(container)) {
          tableToId.set(container, `table_${tableCounter++}`);
        }
        const tableId = tableToId.get(container);

        if (!tableElementGroups.has(tableId)) {
          tableElementGroups.set(tableId, []);
        }
        tableElementGroups.get(tableId).push(question);
      }
    });

    const tableGroups = tableElementGroups;

    // Check each table group for matrix patterns
    tableGroups.forEach((questions, tableId) => {
      if (questions.length < 2) return; // Need at least 2 rows for a matrix

      // Check if all questions have the same number of options
      const firstOptions = questions[0].options;
      const allSameOptions = questions.every(q =>
        q.options &&
        q.options.length === firstOptions.length
      );

      if (!allSameOptions) {
        console.log(`[MATRIX] Table has ${questions.length} checkbox groups but different option counts - not a matrix`);
        return;
      }

      console.log(`[MATRIX] Found checkbox matrix with ${questions.length} rows and ${firstOptions.length} columns`);
      console.log(`[MATRIX] Checkbox matrix options:`, firstOptions.map(o => o.label));

      // For Qualtrics checkbox matrices, we need to extract column and row labels separately
      // Each checkbox has aria-labelledby with 2 IDs: "header~QID~N" (row) and "QID-X-xY-col-label" (column)

      // Extract column labels (brands) by parsing ALL checkboxes across ALL rows
      const columnLabels = new Map();
      questions.forEach(q => {
        q.elements.forEach(checkbox => {
          if (checkbox.hasAttribute('aria-labelledby')) {
            const labelIds = checkbox.getAttribute('aria-labelledby').split(/\s+/);
            const colLabelId = labelIds.find(id => id.includes('-col-label'));

            if (colLabelId) {
              const colElement = document.getElementById(colLabelId);
              if (colElement) {
                const colText = colElement.textContent.trim();
                if (colText && !columnLabels.has(colText)) {
                  columnLabels.set(colText, colLabelId);
                  console.log(`[MATRIX] Found column: "${colText}"`);
                }
              }
            }
          }
        });
      });

      // Build clean column options
      const cleanOptions = Array.from(columnLabels.keys()).map(label => ({
        label: label,
        value: label
      }));

      console.log(`[MATRIX] Extracted ${cleanOptions.length} unique columns:`, cleanOptions.map(c => c.label));

      // Extract row labels (situations) by parsing the row header elements
      const rows = questions.map(q => {
        let rowLabel = q.question_text;

        // Try to extract row label from aria-labelledby
        if (q.elements && q.elements.length > 0) {
          const firstCheckbox = q.elements[0];
          if (firstCheckbox.hasAttribute('aria-labelledby')) {
            const labelIds = firstCheckbox.getAttribute('aria-labelledby').split(/\s+/);
            const rowLabelId = labelIds.find(id => id.includes('header~'));

            if (rowLabelId) {
              const rowElement = document.getElementById(rowLabelId);
              if (rowElement) {
                const rowText = rowElement.textContent.trim();
                if (rowText && rowText.length > 0 && rowText.length < 200) {
                  rowLabel = rowText;
                  console.log(`[MATRIX] Extracted row label: "${rowText.substring(0, 60)}"`);
                }
              }
            }
          }
        }

        return {
          label: rowLabel,
          question_id: q.question_id,
          elements: q.elements
        };
      });

      // Find the main question text
      const table = questions[0].element.closest('table, [role="grid"]');
      let mainQuestionText = 'Select all that apply';

      if (table) {
        let sibling = table.previousElementSibling;
        for (let i = 0; i < 5 && sibling; i++) {
          const text = sibling.textContent.trim();
          if (text.length > 10 && text.length < 500) {
            mainQuestionText = text;
            console.log(`[MATRIX] Found main question: "${mainQuestionText.substring(0, 80)}"`);
            break;
          }
          sibling = sibling.previousElementSibling;
        }

        if (mainQuestionText === 'Select all that apply') {
          const caption = table.querySelector('caption');
          const legend = table.closest('fieldset')?.querySelector('legend');
          if (caption && caption.textContent.trim()) {
            mainQuestionText = caption.textContent.trim();
          } else if (legend && legend.textContent.trim()) {
            mainQuestionText = legend.textContent.trim();
          }
        }
      }

      // Create checkbox matrix question
      const matrixQuestion = {
        question_id: `checkbox_matrix_${questions[0].question_id}`,
        question_text: mainQuestionText,
        question_type: 'checkbox_matrix',
        isMatrix: true,
        rows: rows,
        columns: cleanOptions,
        required: questions.some(q => q.required),
        elements: questions.flatMap(q => q.elements || [])
      };

      // Remove individual row questions from detectedQuestions
      questions.forEach(q => {
        const index = detectedQuestions.indexOf(q);
        if (index > -1) {
          detectedQuestions.splice(index, 1);
        }
      });

      // Add checkbox matrix question
      detectedQuestions.push(matrixQuestion);
      console.log(`[MATRIX] Created checkbox matrix question with ${rows.length} rows x ${cleanOptions.length} columns`);
    });
  }

  // 🔧 LEVEL 5 MATRIX PATCH: Safety pass to rebuild incomplete matrix groups
  // Check if any matrix groups have fewer rows than expected based on the input count
  function rebuildMatrixGroup(baseName) {
    console.log(`[LEVEL5 MATRIX PATCH] Rebuilding matrix group for ${baseName}`);

    // Find all inputs with this base name pattern
    const matrixInputs = Array.from(document.querySelectorAll(`input[name^="${baseName}."]`));

    if (matrixInputs.length === 0) {
      console.warn(`[LEVEL5 MATRIX PATCH] No inputs found for ${baseName}`);
      return;
    }

    // Extract unique row indices (e.g., from ans5084.0.1, ans5084.1.2 → [0, 1])
    const rowIndices = new Set();
    matrixInputs.forEach(input => {
      const match = input.name.match(/^ans\d+\.(\d+)\./);
      if (match) {
        rowIndices.add(parseInt(match[1]));
      }
    });

    console.log(`[LEVEL5 MATRIX PATCH] Found ${rowIndices.size} unique rows for ${baseName}:`, Array.from(rowIndices));

    // Group inputs by row
    const rowGroups = new Map();
    matrixInputs.forEach(input => {
      const match = input.name.match(/^(ans\d+\.\d+)\./);
      if (match) {
        const rowKey = match[1];
        if (!rowGroups.has(rowKey)) {
          rowGroups.set(rowKey, []);
        }
        rowGroups.get(rowKey).push(input);
      }
    });

    console.log(`[LEVEL5 MATRIX PATCH] Grouped into ${rowGroups.size} row groups`);

    // Reprocess each row as a checkbox group
    rowGroups.forEach((inputs, rowKey) => {
      const questionData = extractGroupedQuestionData(inputs, rowKey, detectedQuestionTexts);
      if (questionData) {
        // Check if this question already exists
        const exists = detectedQuestions.some(q => q.question_id === questionData.question_id);
        if (!exists) {
          detectedQuestions.push(questionData);
          console.log(`[LEVEL5 MATRIX PATCH] Added missing row: ${rowKey}`);
        }
      }
    });
  }

  // Run safety check on all matrix groups
  groupedInputs.forEach((inputs, name) => {
    // Check if this is a Decipher matrix base name (ansXXXX without dots)
    if (/^ans\d+$/.test(name)) {
      // Count how many unique sub-rows exist in the DOM
      const allMatrixInputs = Array.from(document.querySelectorAll(`input[name^="${name}."]`));
      const uniqueRows = new Set();

      allMatrixInputs.forEach(input => {
        const match = input.name.match(/^ans\d+\.(\d+)\./);
        if (match) {
          uniqueRows.add(parseInt(match[1]));
        }
      });

      // Count how many rows we detected as separate questions
      const detectedRows = detectedQuestions.filter(q =>
        q.question_id && q.question_id.startsWith(name)
      ).length;

      if (uniqueRows.size > 0 && detectedRows < uniqueRows.size) {
        console.warn(`[LEVEL5 MATRIX PATCH] Incomplete matrix detected for ${name}: found ${uniqueRows.size} rows in DOM but only ${detectedRows} detected`);
        rebuildMatrixGroup(name);
      }
    }
  });

  // SPECIAL: Group multi-part postal/zip code fields (e.g., part16b, part26c with maxlength="3")
  const postalCodeFields = individualInputs.filter(input => {
    const type = input.type || input.tagName.toLowerCase();
    if (type !== 'text' || input.maxLength !== 3) return false;

    // Check if field ID/name suggests it's part of a postal code
    const inputId = (input.id || '').toLowerCase();
    const inputName = (input.name || '').toLowerCase();
    const isPartField = inputId.includes('part') || inputName.includes('part');
    const isPostalField = inputId.includes('postal') || inputName.includes('postal') ||
                         inputId.includes('zip') || inputName.includes('zip');

    // Also check parent containers for postal/zip keywords
    let hasPostalParent = false;
    let container = input.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!container) break;
      const containerText = (container.id || '').toLowerCase() + (container.className || '').toLowerCase();
      if (containerText.includes('postal') || containerText.includes('zip')) {
        hasPostalParent = true;
        break;
      }
      container = container.parentElement;
    }

    return isPartField || isPostalField || hasPostalParent;
  });

  if (postalCodeFields.length >= 2) {
    console.log(`[GROUPING] Found ${postalCodeFields.length} postal code fields, checking if they should be grouped...`);

    // Check if they share a common question container
    const postalGroups = new Map();

    postalCodeFields.forEach(field => {
      // Find the parent question container (go up multiple levels)
      let container = field;
      for (let i = 0; i < 6; i++) {
        container = container.parentElement;
        if (!container) break;

        // Look for postal/zip keywords in container
        const containerText = container.textContent.toLowerCase();
        if ((containerText.includes('postal') || containerText.includes('zip')) &&
            containerText.includes('code')) {
          // Found a postal code container
          const containerId = container.id || `postal_container_${Date.now()}`;
          if (!postalGroups.has(containerId)) {
            postalGroups.set(containerId, []);
          }
          postalGroups.get(containerId).push(field);
          break;
        }
      }
    });

    // Group postal code fields that share a container
    postalGroups.forEach((fields, containerId) => {
      if (fields.length >= 2) {
        console.log(`[GROUPING] Grouping ${fields.length} postal code fields together`);

        // Find the shared question text
        const firstField = fields[0];
        let questionText = findQuestionText(firstField);

        // If question text is generic, look harder for postal code question
        if (questionText.includes('Question') || questionText.includes('Please answer')) {
          let container = firstField;
          for (let i = 0; i < 8; i++) {
            container = container.parentElement;
            if (!container) break;

            const containerText = container.textContent;
            const lines = containerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            for (const line of lines) {
              if ((line.toLowerCase().includes('postal') || line.toLowerCase().includes('zip')) &&
                  line.includes('?') && line.length < 200) {
                questionText = line;
                console.log(`[GROUPING] Found postal code question: "${questionText}"`);
                break;
              }
            }
            if (!questionText.includes('Question')) break;
          }
        }

        // Create a grouped question for the postal code fields
        const groupName = `postal_code_group_${containerId}`;
        const groupedQuestion = {
          question_id: groupName,
          element: firstField,
          elements: fields,
          question_text: questionText,
          question_type: 'text',
          required: fields.some(f => f.required),
          options: [],
          isPostalCodeGroup: true, // Flag for special handling
          postalCodeFields: fields.map(f => ({
            id: f.id,
            maxLength: f.maxLength,
            element: f
          }))
        };

        detectedQuestions.push(groupedQuestion);

        // Remove these fields from individualInputs
        fields.forEach(field => {
          const idx = individualInputs.indexOf(field);
          if (idx > -1) individualInputs.splice(idx, 1);
        });
      }
    });
  }

  // SPECIAL: Group multi-part date fields (Month/Day/Year dropdowns)
  const selectElements = individualInputs.filter(input => {
    const tagName = input.tagName.toLowerCase();
    return tagName === 'select';
  });

  if (selectElements.length >= 2) {
    console.log(`[GROUPING] Found ${selectElements.length} select dropdowns, checking for multi-part date questions...`);

    // Group select elements by their common parent container
    const containerGroups = new Map();

    selectElements.forEach(select => {
      // Find nearest common container (row, div with class="row", form-group, etc.)
      const container = select.closest('.row, .form-row, .form-group, [class*="date"], [class*="birth"]');
      if (container) {
        const containerId = container.id || container.className || 'container';
        if (!containerGroups.has(containerId)) {
          containerGroups.set(containerId, []);
        }
        containerGroups.get(containerId).push(select);
      }
    });

    // Check each group for date questions
    containerGroups.forEach((selects, containerId) => {
      if (selects.length >= 2 && selects.length <= 3) {
        // Look for date-related question text in nearby labels or parent elements
        let questionText = '';

        // Try finding label
        const firstSelect = selects[0];
        const labelFor = firstSelect.getAttribute('id');
        if (labelFor) {
          const label = document.querySelector(`label[for="${labelFor}"]`);
          if (label) {
            questionText = label.textContent.trim();
          }
        }

        // Try finding question text from container
        if (!questionText) {
          const container = firstSelect.closest('.row, .form-row, .form-group, [class*="date"], [class*="birth"]');
          if (container) {
            const parentLabel = container.previousElementSibling;
            if (parentLabel && (parentLabel.tagName === 'LABEL' || parentLabel.classList.contains('form-label'))) {
              questionText = parentLabel.textContent.trim();
            }
          }
        }

        // Check if this looks like a date question
        const lowerText = questionText.toLowerCase();
        const isDateQuestion = lowerText.includes('birth') ||
                              lowerText.includes('date of birth') ||
                              lowerText.includes('dob') ||
                              lowerText.includes('when were you born') ||
                              (lowerText.includes('date') && (lowerText.includes('your') || lowerText.includes('what')));

        if (isDateQuestion) {
          console.log(`[GROUPING] Found multi-part date question: "${questionText}" with ${selects.length} dropdowns`);

          // Create a grouped date question
          const groupName = `date_group_${containerId}_${Date.now()}`;
          const groupedDateQuestion = {
            question_id: groupName,
            element: selects[0],
            elements: selects,
            question_text: questionText,
            question_type: 'date',
            required: selects.some(s => s.required),
            options: [],
            isDateGroup: true, // Flag for special handling
            dateFields: selects.map((s, idx) => {
              // Determine field type by options
              const firstOption = s.options[1]; // Skip default "Month"/"Day"/"Year" option
              const optionText = firstOption ? firstOption.textContent.toLowerCase() : '';

              let fieldType = 'unknown';
              if (optionText.includes('january') || optionText.includes('february') || s.options.length <= 13) {
                fieldType = 'month';
              } else if (s.options.length <= 32) {
                fieldType = 'day';
              } else if (s.options.length > 32) {
                fieldType = 'year';
              }

              return {
                element: s,
                type: fieldType,
                index: idx
              };
            })
          };

          detectedQuestions.push(groupedDateQuestion);

          // Remove these selects from individualInputs
          selects.forEach(select => {
            const idx = individualInputs.indexOf(select);
            if (idx > -1) individualInputs.splice(idx, 1);
          });
        }
      }
    });
  }

  // V1.9.36: Group text inputs that share a common parent question (Van Westendorp, multi-field questions)
  // Example: "At what price..." with fields "Too Cheap", "A Bargain", "Expensive", "Too Expensive"
  const ungroupedTextInputs = individualInputs.filter(inp => inp.type === 'text' || inp.type === 'textarea');

  if (ungroupedTextInputs.length >= 2) {
    console.log(`[TEXT_GROUPING] Checking ${ungroupedTextInputs.length} text inputs for common parent question`);

    // Group by common parent container
    const parentGroups = new Map();

    ungroupedTextInputs.forEach(input => {
      // Find parent container (text-input-group, question-fieldset, or similar)
      const parentContainer = input.closest('.text-input-group, .question-fieldset, .question-body, [class*="question"]');
      if (parentContainer) {
        const parentKey = parentContainer.className + '_' + Array.from(parentContainer.children).indexOf(input.closest('div, .text-input-container'));

        if (!parentGroups.has(parentContainer)) {
          parentGroups.set(parentContainer, []);
        }
        parentGroups.get(parentContainer).push(input);
      }
    });

    // For each group with 2+ inputs, check if they share a common question heading
    parentGroups.forEach((inputs, container) => {
      if (inputs.length >= 2) {
        // Look for common question heading
        const heading = container.querySelector('.user-generated, .question-title-container, h3, h4, [class*="question-text"]');
        if (heading) {
          const headingText = heading.textContent.trim();

          // Check if it's a real question (not just a label)
          if (headingText.length > 20 && (headingText.includes('?') || headingText.toLowerCase().includes('price') || headingText.toLowerCase().includes('cost'))) {
            console.log(`[TEXT_GROUPING] ✓ Found common question for ${inputs.length} text inputs: "${headingText.substring(0, 80)}"`);

            // Process each text input as a separate question, but with the parent question context
            inputs.forEach((input, idx) => {
              const questionData = extractQuestionData(input);
              if (questionData) {
                // Prepend parent question to the field label
                const fieldLabel = questionData.question_text;
                questionData.question_text = `${headingText} - ${fieldLabel}`;

                // Only add if not already added
                if (!detectedQuestions.find(q => q.question_id === questionData.question_id)) {
                  detectedQuestions.push(questionData);
                }
              }
            });

            // Remove from individualInputs (already processed)
            inputs.forEach(input => {
              const idx = individualInputs.indexOf(input);
              if (idx > -1) individualInputs.splice(idx, 1);
            });
          }
        }
      }
    });
  }

  // Process individual inputs
  individualInputs.forEach((input) => {
    const questionData = extractQuestionData(input);
    if (questionData) {
      // Only add if not already added by ID
      if (!detectedQuestions.find(q => q.question_id === questionData.question_id)) {
        detectedQuestions.push(questionData);
      }
    }
  });

  // 🔧 V1.9.57: SPECIAL: Detect "Prefer not to answer" checkboxes and group with associated input fields
  // These are mutually exclusive - either check the box OR fill the input, NOT both!
  // THIS MUST RUN AFTER INDIVIDUAL INPUTS ARE PROCESSED!
  console.log('[CONDITIONAL] Scanning for "Prefer not to answer" checkboxes with associated inputs...');

  const preferNotToAnswerCheckboxes = detectedQuestions.filter(q => {
    if (q.question_type !== 'checkbox') return false;

    // Check if this is a single checkbox (not a checkbox group)
    if (q.options && q.options.length > 1) return false;

    // Check if the label indicates "Prefer not to answer" or similar
    const labelText = (q.question_text || '').toLowerCase();
    return labelText.includes('prefer not to answer') ||
           labelText.includes('prefer not to say') ||
           labelText.includes('rather not say') ||
           labelText.includes('choose not to answer');
  });

  if (preferNotToAnswerCheckboxes.length > 0) {
    console.log(`[CONDITIONAL] Found ${preferNotToAnswerCheckboxes.length} "Prefer not to answer" checkbox(es)`);

    preferNotToAnswerCheckboxes.forEach(checkboxQuestion => {
      const checkboxElement = checkboxQuestion.element;
      if (!checkboxElement) return;

      // Find the container that holds both the checkbox and the input fields
      const container = checkboxElement.closest('fieldset, div[class*="question"], div[class*="Question"], form, .panel, .group');
      if (!container) {
        console.log(`[CONDITIONAL] No container found for checkbox "${checkboxQuestion.question_id}"`);
        return;
      }

      // Look for associated text/number/tel/email/select inputs in the same container
      const associatedInputQuestions = detectedQuestions.filter(q => {
        if (q === checkboxQuestion) return false; // Skip the checkbox itself
        if (!['text', 'number', 'tel', 'email', 'select'].includes(q.question_type)) return false;
        if (!q.element) return false;

        // Check if the input is in the same container
        const inputContainer = q.element.closest('fieldset, div[class*="question"], div[class*="Question"], form, .panel, .group');
        return inputContainer === container;
      });

      if (associatedInputQuestions.length === 0) {
        console.log(`[CONDITIONAL] No associated inputs found for checkbox "${checkboxQuestion.question_id}"`);
        return;
      }

      console.log(`[CONDITIONAL] ✓ Found ${associatedInputQuestions.length} input(s) associated with "Prefer not to answer" checkbox`);
      console.log(`[CONDITIONAL]   Checkbox ID: ${checkboxQuestion.question_id}`);
      associatedInputQuestions.forEach(q => {
        console.log(`[CONDITIONAL]   Input ID: ${q.question_id} (${q.question_type})`);
      });

      // Extract the main question text (should be from the input fields, not the checkbox label)
      const mainQuestionText = associatedInputQuestions[0].question_text || checkboxQuestion.question_text;

      // Create a grouped conditional question
      const conditionalQuestion = {
        question_id: `conditional_${associatedInputQuestions[0].question_id}`,
        question_text: mainQuestionText,
        question_type: 'conditional',
        isConditional: true,
        preferNotToAnswerCheckbox: {
          id: checkboxQuestion.question_id,
          element: checkboxQuestion.element,
          label: checkboxQuestion.question_text
        },
        inputFields: associatedInputQuestions.map(q => ({
          id: q.question_id,
          type: q.question_type,
          element: q.element,
          label: q.question_text,
          options: q.options, // For select dropdowns
          placeholder: q.element?.placeholder
        })),
        required: associatedInputQuestions.some(q => q.required) || checkboxQuestion.required
      };

      // Remove the checkbox and associated inputs from detectedQuestions
      const indexCheckbox = detectedQuestions.indexOf(checkboxQuestion);
      if (indexCheckbox > -1) {
        detectedQuestions.splice(indexCheckbox, 1);
      }

      associatedInputQuestions.forEach(q => {
        const index = detectedQuestions.indexOf(q);
        if (index > -1) {
          detectedQuestions.splice(index, 1);
        }
      });

      // Add the grouped conditional question
      detectedQuestions.push(conditionalQuestion);
      console.log(`[CONDITIONAL] ✓ Created conditional question: "${conditionalQuestion.question_text.substring(0, 60)}..."`);
    });
  }

  // SPECIAL: Detect and group numeric input matrices (e.g., percentage allocation questions)
  // Look for text/number inputs with numbered IDs (e.g., QR~QID173~1, QR~QID173~2)
  // THIS MUST RUN AFTER INDIVIDUAL INPUTS ARE PROCESSED!
  const numericQuestions = detectedQuestions.filter(q => {
    if (q.question_type !== 'text' && q.question_type !== 'number') return false;

    // Check if ID has numbered suffix pattern: QR~QID###~# or similar
    const hasNumberedSuffix = /~\d+$/.test(q.question_id);
    if (!hasNumberedSuffix) return false;

    // Additional check: is it type="number" or inputmode="numeric/decimal"?
    const isExplicitlyNumeric = q.element?.type === 'number' ||
                               q.element?.getAttribute('inputmode') === 'numeric' ||
                               q.element?.getAttribute('inputmode') === 'decimal';

    // Check if it's in a table (common for percentage allocation, but not required)
    const isInTable = q.element?.closest('table, [role="grid"], .Matrix') !== null;

    // INCLUDE if: explicitly numeric OR in a table OR just has numbered suffix
    // We'll validate later by checking for "Total" rows to confirm it's a matrix
    return isExplicitlyNumeric || isInTable || hasNumberedSuffix;
  });

  if (numericQuestions.length >= 2) {
    console.log(`[NUMERIC_MATRIX] Found ${numericQuestions.length} potential numeric input fields, checking for grouping...`);

    // Group by common prefix (e.g., QR~QID173~1, QR~QID173~2 -> QR~QID173)
    const numericPrefixMap = new Map();
    numericQuestions.forEach(q => {
      const match = q.question_id.match(/^(.+)~\d+$/);
      if (match) {
        const prefix = match[1];
        if (!numericPrefixMap.has(prefix)) {
          numericPrefixMap.set(prefix, []);
        }
        numericPrefixMap.get(prefix).push(q);
      }
    });

    // Process each prefix group
    numericPrefixMap.forEach((questions, prefix) => {
      if (questions.length >= 2) {
        // Filter out "Total" rows (they're auto-calculated, read-only)
        const nonTotalQuestions = questions.filter(q => {
          const lowerText = q.question_text.toLowerCase();
          const lowerId = q.question_id.toLowerCase();
          return !lowerText.includes('total') && !lowerId.includes('total');
        });

        if (nonTotalQuestions.length < 2) {
          console.log(`[NUMERIC_MATRIX] Only ${nonTotalQuestions.length} non-total rows, skipping group`);
          return;
        }

        console.log(`[NUMERIC_MATRIX] Grouping ${nonTotalQuestions.length} numeric inputs (filtered ${questions.length - nonTotalQuestions.length} Total rows) with prefix "${prefix}"`);

        // Try to extract parent question text
        const firstElement = nonTotalQuestions[0].element;
        const table = firstElement?.closest('table, [role="grid"], .Matrix');

        let parentQuestionText = '';

        // Try table-based extraction first
        if (table) {
          const legend = table.querySelector('legend');
          const caption = table.querySelector('caption');
          const questionHeader = table.closest('fieldset')?.querySelector('legend') ||
                                table.closest('[class*="Question"]')?.querySelector('[class*="Text"]');

          if (legend) {
            parentQuestionText = legend.textContent.trim();
          } else if (caption) {
            parentQuestionText = caption.textContent.trim();
          } else if (questionHeader) {
            parentQuestionText = questionHeader.textContent.trim();
          } else {
            const questionDiv = table.closest('[class*="question"], [class*="Question"]');
            if (questionDiv) {
              const textElement = questionDiv.querySelector('[class*="text"], [class*="Text"]');
              if (textElement) {
                parentQuestionText = textElement.textContent.trim();
              }
            }
          }
        }

        // If no table or no text found, try finding question text from element's parent containers
        if (!parentQuestionText) {
          // Try fieldset legend
          const fieldset = firstElement?.closest('fieldset');
          if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend) {
              parentQuestionText = legend.textContent.trim();
            }
          }

          // Try Qualtrics question container
          if (!parentQuestionText) {
            const questionContainer = firstElement?.closest('[class*="Question"], [class*="question"], .QuestionOuter');
            if (questionContainer) {
              // Look for question text element
              const textElement = questionContainer.querySelector('[class*="QuestionText"], [class*="questionText"], .QuestionText');
              if (textElement) {
                parentQuestionText = textElement.textContent.trim();
              }
            }
          }
        }

        // Create grouped percentage allocation question
        const groupedQuestion = {
          question_id: prefix,
          question_text: parentQuestionText || 'Percentage allocation',
          question_type: 'percentage_allocation',
          required: nonTotalQuestions.some(q => q.required),
          rows: nonTotalQuestions.map(q => ({
            label: q.question_text,
            id: q.question_id,
            element: q.element
          })),
          isPercentageAllocation: true
        };

        // Remove ALL individual numeric questions (including Total rows)
        questions.forEach(q => {
          const index = detectedQuestions.indexOf(q);
          if (index > -1) {
            detectedQuestions.splice(index, 1);
          }
        });

        // Add grouped question
        detectedQuestions.push(groupedQuestion);
        console.log(`[NUMERIC_MATRIX] ✓ Created percentage_allocation question: "${groupedQuestion.question_text.substring(0, 60)}..." (${groupedQuestion.rows.length} rows)`);
      }
    });
  }

  // DEDUPLICATION: Remove duplicate questions based on question ID (not text!)
  // V1.9.28 FIX: Only deduplicate if BOTH ID and text are same
  // Multi-child forms have same text but different IDs - those are DIFFERENT questions!
  const uniqueQuestions = [];
  const seenQuestionIds = new Set();

  detectedQuestions.forEach((q) => {
    // Check if we've seen this exact question_id before
    if (seenQuestionIds.has(q.question_id)) {
      console.log(`[DEDUP] Skipping duplicate question ID: "${q.question_id}" - "${q.question_text.substring(0, 50)}"`);
    } else {
      uniqueQuestions.push(q);
      seenQuestionIds.add(q.question_id);
    }
  });

  // Replace detectedQuestions with deduplicated list
  detectedQuestions = uniqueQuestions;

  console.log(`[DETECTION] Detected ${detectedQuestions.length} questions (after deduplication):`);

  // Log each question for debugging
  let debugInfo = `Detected ${detectedQuestions.length} questions:\n`;
  detectedQuestions.forEach((q, idx) => {
    const logLine = `  ${idx + 1}. [${q.question_type}] ID:"${q.question_id}" TEXT:"${q.question_text.substring(0, 50)}..." (${q.options?.length || 0} options)`;
    console.log(logLine);
    debugInfo += `${idx + 1}. ID:${q.question_id} - ${q.question_text.substring(0, 60)}\n`;

    // Check if input already has a value (leftover from previous fill)
    if (q.element && q.element.value) {
      console.warn(`  ⚠️ Question ${q.question_id} input already has value: "${q.element.value}"`);
    }
  });

  // Don't show debug notification here - too early and gets replaced

  // 🔧 V1.9.15: Show notification if we skipped pre-filled questions
  if (skippedPreFilledCount > 0) {
    const message = `⏭️ Skipped ${skippedPreFilledCount} pre-filled question${skippedPreFilledCount > 1 ? 's' : ''} to avoid session conflicts. These will keep their existing answers.`;
    console.log(`[DETECTION] ${message}`);
    showNotification(message, 'info');
  }

  // ============================================
  // 🔧 V1.9.100: LLM FALLBACK LAYER
  // ============================================
  // If rule-based detection failed or found incomplete questions, use LLM to discover structure

  const hasIncompleteQuestions = detectedQuestions.some(q =>
    !q.question_text || q.question_text.length < 10 ||
    q.question_text.includes('FIRST MENTION') ||
    q.question_text.includes('SECOND MENTION')
  );

  // V5.1.1: Also run LLM if we only found simple inputs (no radio/checkbox)
  // Material UI surveys often have both questions visible, but rule-based only finds text inputs
  const onlySimpleInputs = detectedQuestions.length > 0 && detectedQuestions.every(q =>
    q.question_type === 'text' || q.question_type === 'textarea' || q.question_type === 'number'
  );

  if (detectedQuestions.length === 0 || hasIncompleteQuestions || onlySimpleInputs) {
    const reason = detectedQuestions.length === 0 ? 'no questions' :
                   hasIncompleteQuestions ? 'incomplete questions' :
                   'only simple inputs detected';
    console.log(`[LLM-FALLBACK] Rule-based detection incomplete (${reason}), checking for cached structure or using LLM...`);

    try {
      // Check for cached structure map
      const fingerprint = getPlatformFingerprint();
      const cacheKey = `structure_${fingerprint}`;

      const cached = await chrome.storage.local.get(cacheKey);

      // V1.9.100: Check cache version to invalidate old caches after code updates
      const STRUCTURE_CACHE_VERSION = 14; // V5.1.1: Run LLM fallback when only simple inputs detected
      console.log(`[LLM-CACHE-DEBUG] Current code version: ${STRUCTURE_CACHE_VERSION}`);

      if (cached && cached[cacheKey]) {
        const cachedStructure = cached[cacheKey];
        console.log(`[LLM-CACHE-DEBUG] Cached version: ${cachedStructure.cache_version}`);

        // Invalidate cache if version mismatch
        if (cachedStructure.cache_version !== STRUCTURE_CACHE_VERSION) {
          console.log(`[LLM-FALLBACK] Cache version mismatch (cached: ${cachedStructure.cache_version}, current: ${STRUCTURE_CACHE_VERSION}), regenerating...`);
          await chrome.storage.local.remove(cacheKey);
        } else {
          console.log(`[CACHE] hit fp=${fingerprint}`);

          try {
            const llmQuestions = applyStructureMap(cachedStructure);

          if (llmQuestions.length > 0) {
            console.log(`[LLM-FALLBACK] ✓ Extracted ${llmQuestions.length} questions using cached structure`);

            // V5.1.0: Merge with rule-based questions instead of replacing
            const mergedQuestions = [...detectedQuestions];

            for (const llmQ of llmQuestions) {
              const exists = mergedQuestions.find(q =>
                q.question_id === llmQ.question_id ||
                (q.question_text && llmQ.question_text && q.question_text.includes(llmQ.question_text.substring(0, 30)))
              );

              if (!exists) {
                mergedQuestions.push(llmQ);
                console.log(`[LLM-FALLBACK] Added cached LLM question: ${llmQ.question_id}`);
              } else {
                console.log(`[LLM-FALLBACK] Skipping duplicate: ${llmQ.question_id}`);
              }
            }

            detectedQuestions = mergedQuestions;
            console.log(`[LLM-FALLBACK] Final question count: ${detectedQuestions.length} (${llmQuestions.length} from cache, merged with rule-based)`);
            return detectedQuestions;
          } else {
            console.warn('[LLM-FALLBACK] Cached structure produced no questions, regenerating...');
            await chrome.storage.local.remove(cacheKey);
          }
          } catch (error) {
            console.error('[LLM-FALLBACK] Cached structure failed:', error);
            await chrome.storage.local.remove(cacheKey);
          }
        }
      }

      // No cache or cache failed - use LLM to discover structure
      console.log('[LLM-FALLBACK] No cached structure, using Claude to discover (first time on this platform)...');

      const minimalHTML = getMinimalFormHTML();
      const structure = await discoverStructureWithLLM(minimalHTML);

      // V5.1.0: Add cache version and patterns array to structure
      structure.cache_version = STRUCTURE_CACHE_VERSION;
      structure.patterns = structure.patterns || []; // Initialize patterns for learning

      // Cache the structure for future use
      await chrome.storage.local.set({
        [cacheKey]: structure,
        [`${cacheKey}_timestamp`]: Date.now()
      });

      console.log(`[CACHE] saved fp=${fingerprint}`);

      // Apply the discovered structure
      const llmQuestions = applyStructureMap(structure);

      if (llmQuestions.length > 0) {
        console.log(`[LLM-FALLBACK] ✓ Discovered and extracted ${llmQuestions.length} questions using LLM`);

        // V5.1.0: Merge with rule-based questions instead of replacing
        // This ensures both rule-based and LLM-discovered questions are available
        const mergedQuestions = [...detectedQuestions];

        for (const llmQ of llmQuestions) {
          // Check if this question already exists (by ID or similar text)
          const exists = mergedQuestions.find(q =>
            q.question_id === llmQ.question_id ||
            (q.question_text && llmQ.question_text && q.question_text.includes(llmQ.question_text.substring(0, 30)))
          );

          if (!exists) {
            mergedQuestions.push(llmQ);
            console.log(`[LLM-FALLBACK] Added LLM question: ${llmQ.question_id}`);
          } else {
            console.log(`[LLM-FALLBACK] Skipping duplicate: ${llmQ.question_id}`);
          }
        }

        detectedQuestions = mergedQuestions;
        console.log(`[LLM-FALLBACK] Final question count: ${detectedQuestions.length} (${llmQuestions.length} from LLM, merged with rule-based)`);
      } else {
        console.warn('[LLM-FALLBACK] LLM discovery produced no questions');
      }

    } catch (error) {
      console.error('[LLM-FALLBACK] Failed to use LLM fallback:', error);
      console.log('[LLM-FALLBACK] Continuing with rule-based results (if any)');
    }
  }

  // V5.1.0: Log cost counters
  console.log(`[COST] hint=${costCounters.llm_hint_calls} repair=${costCounters.llm_repair_calls}`);

  // V5.1.1: Self-healing - learn detection timing
  if (window.selfHeal && detectedQuestions.length > 0) {
    const detectionTime = performance.now() - detectionStartTime;
    if (detectionTime > 100) { // Only learn if detection took significant time
      window.selfHeal.learnDelay(platform, Math.round(detectionTime));
    }
  }

  return detectedQuestions;
}

// Extract grouped question data (for radio/checkbox/number matrix groups)
function extractGroupedQuestionData(inputs, name, detectedQuestionTexts = null) {
  if (!inputs || inputs.length === 0) return null;

  const firstInput = inputs[0];
  let type = firstInput.type;

  // 🔧 V1.9.12 FIX: Checkboxes with the same name attribute act like radio buttons (mutually exclusive)
  // This is a common pattern with Bootstrap button groups (data-toggle="buttons")
  // If all inputs are checkboxes with the SAME name, treat as radio (single selection)
  // 🔧 V1.9.49 FIX: BUT check for multi-select indicators first! Some platforms use same-name checkboxes for multi-select
  if (type === 'checkbox' && inputs.length > 1) {
    const allSameName = inputs.every(input => input.name === name);
    if (allSameName) {
      // Check if this is actually a multi-select checkbox group
      const isMultiSelect = inputs.some(input => {
        // Check input class names
        if (input.className && (
          input.className.includes('multi-select') ||
          input.className.includes('multi_select') ||
          input.className.includes('multiselect')
        )) {
          return true;
        }

        // Check parent/container class names
        const container = input.closest('[class*="multi-select"], [class*="multi_select"], [class*="multiselect"]');
        if (container) {
          return true;
        }

        // Check for data attributes indicating multi-select
        if (input.hasAttribute('data-multiple') || input.hasAttribute('data-multi-select')) {
          return true;
        }

        return false;
      });

      if (isMultiSelect) {
        console.log(`[DETECTION] ✓ Checkboxes with same name="${name}" but has multi-select indicators - keeping as CHECKBOX (multi-selection)`);
        // Keep type as 'checkbox'
      } else {
        console.log(`[DETECTION] ✓ Checkboxes with same name="${name}" detected - treating as RADIO (single selection)`);
        type = 'radio';
      }
    }
  }

  // V1.9.80: Skip checkbox groups that already have a checked option (already answered)
  // BUT: Don't skip radio groups - surveys often send users back to fix wrong answers
  // EXCEPTION 1: Don't skip radio groups in tables - they might be part of a matrix
  // EXCEPTION 2: Don't skip if there's an error message (user needs to fix their answer)
  if (type === 'checkbox') {
    const hasChecked = inputs.some(input => input.checked);
    if (hasChecked) {
      // V1.9.80: Check if there's an error message - if so, user needs to fix their answer
      const container = firstInput.closest('.question, [role="radiogroup"], [role="group"], [class*="question"], .mx-stage');
      const hasError = container && container.querySelector('.question-error-text, .question-error, .error-text, [class*="error"], .fa-exclamation-triangle, .fa-exclamation');

      if (hasError) {
        console.log(`[DETECTION] ⚠️ Question has error message - will re-detect to read constraint: name="${name}"`);
        // Continue to constraint detection below
      } else {
        console.log(`[DETECTION] Skipping already-answered checkbox group: name="${name}"`);
        return null;
      }
    }
  }

  // 🔧 V1.9.92 CRITICAL FIX: DO NOT skip pre-filled radio questions!
  // Previous logic (v1.9.15) skipped pre-filled radios to avoid Qualtrics session conflicts.
  // BUT THIS BREAKS ATTENTION CHECKS which come pre-filled with WRONG answers!
  //
  // NEW APPROACH:
  // 1. Always include pre-filled questions in detection
  // 2. Send them to Claude WITH the current selected value (as "current_answer")
  // 3. Claude decides if it matches the persona
  // 4. fillQuestion() will compare current vs. desired answer:
  //    - If SAME: skip clicking (no session conflict)
  //    - If DIFFERENT: change it (fixes attention checks)
  //
  // This handles BOTH cases correctly:
  // - Attention checks: wrong pre-fill → Claude picks right answer → we change it ✅
  // - Old sessions: correct pre-fill → Claude picks same answer → we don't touch it ✅
  if (type === 'radio') {
    const hasChecked = inputs.some(input => input.checked);
    if (hasChecked) {
      console.log(`[DETECTION] ✓ Including pre-filled radio question for verification: name="${name}" (will check if answer matches persona)`);
      // Note: We'll mark this as pre-filled below so fillQuestion can handle it carefully
    }
  }

  // For grouped inputs, find question text from the container, not individual inputs
  const questionText = findQuestionTextForGroup(inputs);

  const isRequired = inputs.some(input =>
    input.required || input.hasAttribute('required') || input.hasAttribute('aria-required')
  );

  // For number input matrices, extract row labels as sub-questions
  // For radio/checkbox groups, extract options
  const isNumberMatrix = type === 'number';
  const options = inputs.map(input => {
    // For options, get the label text specifically for this input
    const optionLabel = getOptionLabel(input);

    // V1.9.33: Handle image-based options (getOptionLabel returns {image, text} object)
    let labelText = optionLabel;
    let imageUrl = null;
    let hasImage = false;

    if (typeof optionLabel === 'object' && optionLabel !== null && optionLabel.image) {
      hasImage = true;
      imageUrl = optionLabel.image;
      labelText = optionLabel.text;
      console.log(`[EXTRACT_OPTION] For input ID="${input.id}", extracted IMAGE option: "${imageUrl}"`);
    }

    // Detect "None of the above" / mutually exclusive options
    const inputClass = (input.className || '').toLowerCase();
    const labelLower = (labelText || '').toLowerCase();
    const isNoneOfAbove = inputClass.includes('none-of-the-above') ||
                          inputClass.includes('nota') ||
                          inputClass.includes('exclusive') ||
                          labelLower.includes("i don't") ||
                          labelLower.includes("none of the above") ||
                          labelLower.includes("not applicable") ||
                          labelLower.includes("n/a");

    if (!hasImage) {
      console.log(`[EXTRACT_OPTION] For input ID="${input.id}", extracted label: "${labelText}"${isNoneOfAbove ? ' [NONE-OF-ABOVE]' : ''}`);
    }

    return {
      label: labelText,
      value: input.value || labelText,
      id: input.id,
      isNoneOfAbove: isNoneOfAbove, // Flag for mutually exclusive options
      image: imageUrl, // V1.9.33: Image URL for vision-based questions
      hasImage: hasImage // V1.9.33: Flag to indicate this is an image option
    };
  });

  // Use name as question_id, but make sure it's a string
  const questionId = String(name);

  // 🔧 V1.9.13 CAROUSEL DETECTION: Check if this is a carousel/swipe question
  // Carousels reuse the same answer buttons across multiple items, so we need to re-answer each slide
  const isCarousel = firstInput.closest('[data-warp-role="carousel"], .carousel, .swipe-container, [class*="scroll"]') ||
                    document.querySelector('[data-warp-role="carousel"], [data-warp-role="srtForward"], [data-warp-role="srtBack"]') ||
                    document.querySelector('.carousel-inner, .carousel.slide');

  if (isCarousel) {
    console.log(`[CAROUSEL] ✓ Detected carousel/swipe question - will re-answer even if buttons are selected`);
  }

  // 🔧 V1.9.14 CAROUSEL ITEM TEXT: Find the current carousel item being rated
  let carouselItemText = '';
  if (isCarousel) {
    // Look for the active carousel item
    const activeItem = document.querySelector('.carousel .item.active, .carousel-inner .item.active, [data-warp-role="carousel"] .item.active');
    if (activeItem) {
      // Look for the label/text within the active item
      const itemLabel = activeItem.querySelector('.carousel-text, label, [class*="text"], [class*="label"]');
      if (itemLabel) {
        carouselItemText = itemLabel.textContent.trim();
        console.log(`[CAROUSEL] ✓ Found active carousel item text: "${carouselItemText}"`);
      } else {
        // Fallback: use the entire active item's text content
        carouselItemText = activeItem.textContent.trim();
        // Clean up if it's too long or has hidden input data
        if (carouselItemText.length > 200 || carouselItemText.includes('trigger=')) {
          const cleanText = carouselItemText.split('\n')[0].trim();
          if (cleanText.length > 0 && cleanText.length < 200) {
            carouselItemText = cleanText;
            console.log(`[CAROUSEL] ✓ Found active carousel item text (cleaned): "${carouselItemText}"`);
          }
        }
      }
    }

    if (!carouselItemText) {
      console.log(`[CAROUSEL] ⚠️ Could not find active carousel item text`);
    }
  }

  // Skip questions we've already answered in this session IF they're still in "answered" state
  // This prevents re-answering persistent controls like language selectors on every page
  // EXCEPTION: Don't skip carousel questions - they reuse the same buttons across slides
  if (answeredQuestionIds.has(questionId) && !isCarousel) {
    // Check if any input in this group is checked/selected
    const hasChecked = inputs.some(input => input.checked || (input.value && input.value.trim().length > 0));

    if (hasChecked) {
      console.log(`[SKIP] Already answered grouped question in session and still answered: "${questionText}" (ID: ${questionId})`);
      return null;
    } else {
      console.log(`[RE-ANSWER] Grouped question was answered before but now unselected - will re-answer: "${questionText}" (ID: ${questionId})`);
    }
  }

  // 🔧 V1.9.19 FIX: Check for "none of the above" options in BOTH radio AND checkbox questions
  // Previously only checked checkboxes, but attention checks can be radio too!
  const hasNoneOfAbove = options.some(opt => opt.isNoneOfAbove);
  const noneOfAboveOptions = options.filter(opt => opt.isNoneOfAbove).map(opt => opt.label);

  // Build question text with warning if needed
  let finalQuestionText = questionText;

  // For carousel questions, append the specific item being rated
  if (isCarousel && carouselItemText) {
    finalQuestionText = `${questionText}: ${carouselItemText}`;
    console.log(`[CAROUSEL] ✓ Enhanced question with item text: "${finalQuestionText.substring(0, 100)}..."`);
  }

  // 🔧 V1.9.18: Improved "None of the above" instruction for attention checks
  if (hasNoneOfAbove && noneOfAboveOptions.length > 0) {
    const warning = `\n\n🚨 IMPORTANT: "${noneOfAboveOptions.join(', ')}" means the correct answer is NOT in the list. Select this option ONLY when none of the other options are correct (e.g., attention checks where the right answer is missing). NEVER select "${noneOfAboveOptions.join(', ')}" together with other options.`;
    finalQuestionText += warning;
    console.log(`[NONE-OF-ABOVE] Added warning to question: ${warning.substring(0, 100)}...`);
  }

  // V1.9.33: Check if this is a vision question (has image options)
  const hasImageOptions = options.some(opt => opt.hasImage);
  if (hasImageOptions) {
    console.log(`[VISION] ✓ Detected vision question with ${options.filter(opt => opt.hasImage).length} image options`);
  }

  // 🔧 V1.9.92: Capture current pre-filled answer for attention check detection
  // If question has a pre-filled value, we'll send it to Claude so it can verify it matches the persona
  let currentAnswer = null;
  if (type === 'radio') {
    const checkedInput = inputs.find(input => input.checked);
    if (checkedInput) {
      const checkedOption = options.find(opt => opt.id === checkedInput.id || opt.value === checkedInput.value);
      if (checkedOption) {
        currentAnswer = checkedOption.label;
        console.log(`[PRE-FILLED] Radio question has current answer: "${currentAnswer}"`);
      }
    }
  } else if (type === 'checkbox') {
    const checkedInputs = inputs.filter(input => input.checked);
    if (checkedInputs.length > 0) {
      currentAnswer = checkedInputs.map(input => {
        const checkedOption = options.find(opt => opt.id === input.id || opt.value === input.value);
        return checkedOption ? checkedOption.label : null;
      }).filter(label => label !== null);
      if (currentAnswer.length > 0) {
        console.log(`[PRE-FILLED] Checkbox question has current answers: ${JSON.stringify(currentAnswer)}`);
      } else {
        currentAnswer = null;
      }
    }
  }

  // Detect constraints from the question container (instructions, errors, etc.)
  const questionData = {
    question_id: questionId,
    element: firstInput, // Reference to first element (for name attribute)
    elements: inputs, // All elements in the group
    question_text: finalQuestionText,
    question_type: isNumberMatrix ? 'number_matrix' : type, // 'number_matrix', 'radio' or 'checkbox'
    required: isRequired,
    options: options, // For number matrices, these are row labels; for radio/checkbox, these are selectable options
    isNumberMatrix: isNumberMatrix, // Flag to identify matrix questions
    hasNoneOfAbove: hasNoneOfAbove, // Flag to indicate mutually exclusive options present
    isCarousel: isCarousel, // Flag to indicate this is a carousel/swipe question
    hasImageOptions: hasImageOptions, // V1.9.33: Flag to indicate this question has image-based options (vision required)
    current_answer: currentAnswer // V1.9.92: Pre-filled answer (for attention check verification)
  };

  // Find the question container to look for constraints
  const container = firstInput.closest('.question, [role="radiogroup"], [role="group"], [class*="question"], .mx-stage');

  console.log(`[CONSTRAINT_DETECT] Checking constraints for "${questionText.substring(0, 50)}"`);
  console.log(`[CONSTRAINT_DETECT] Container found: ${container ? 'YES' : 'NO'}`);
  if (container) {
    console.log(`[CONSTRAINT_DETECT] Container: <${container.tagName}> classes="${container.className}"`);

    // V1.9.80: Look for instruction text (added .mrQuestionText for IPSOS)
    const instructionEl = container.querySelector('.instruction-text, .comment, [class*="instruction"], [class*="comment"], .mrQuestionText, .mrFieldText');
    const instructionText = instructionEl ? instructionEl.textContent : '';

    // Look for error text (often contains constraint info)
    const errorEl = container.querySelector('.question-error-text, .question-error, .error-text, [class*="error"], .fa-exclamation-triangle');
    const errorText = errorEl ? errorEl.textContent : '';

    // V1.9.80: If no instruction found, grab all text from container as fallback
    const fallbackText = (!instructionText && container) ? container.textContent : '';
    const combinedText = (instructionText + ' ' + errorText + ' ' + fallbackText).toLowerCase();

    console.log(`[CONSTRAINT_DETECT] Instruction: "${instructionText.substring(0, 100)}"`);
    console.log(`[CONSTRAINT_DETECT] Error: "${errorText.substring(0, 100)}"`);
    console.log(`[CONSTRAINT_DETECT] Fallback used: ${!instructionText ? 'YES' : 'NO'}`);
    console.log(`[CONSTRAINT_DETECT] Combined text (first 200 chars): "${combinedText.substring(0, 200)}"`);

    // V1.9.79: Enhanced patterns to catch "up to a maximum of X", "select up to X", etc.
    // Parse "at most N", "top N", "maximum N", "select N", "up to X", "no more than X"
    const maxMatch = combinedText.match(/(?:up to (?:a )?maximum of?|select up to (?:a )?maximum of?|at most|top|maximum of?|select|up to|no more than)\s+(\d+)/i);
    if (maxMatch) {
      questionData.maxAllowed = parseInt(maxMatch[1]);
      console.log(`[CONSTRAINT_DETECT] ✓ Found maxAllowed: ${questionData.maxAllowed}`);
    }

    // Parse "at least N", "minimum N"
    const minMatch = combinedText.match(/(?:at least|minimum of?)\s+(\d+)/i);
    if (minMatch) {
      questionData.minRequired = parseInt(minMatch[1]);
      console.log(`[CONSTRAINT_DETECT] ✓ Found minRequired: ${questionData.minRequired}`);
    }

    // Detect ranking questions
    if (/rank|ranking|strongest|weakest|most.*least|order.*preference/i.test(combinedText)) {
      questionData.isRanking = true;
      console.log(`[CONSTRAINT_DETECT] ✓ Detected ranking question`);
    }

    // For ranking questions, if we found maxAllowed, that's also the ranking depth
    if (questionData.isRanking && questionData.maxAllowed) {
      console.log(`[CONSTRAINT_DETECT] ✓ Ranking depth: ${questionData.maxAllowed}`);
    }
  }

  // V1.9.61: Conservative dialog button filter
  // Skip questions that appear to be confirmation dialogs
  if (detectedQuestionTexts && options.length === 1) {
    const optionText = options[0].label.toLowerCase();
    const questionTextLower = questionText.toLowerCase();

    // Check if this is a confirmation dialog with destructive action
    const hasConfirmKeyword = optionText.includes('confirm') || questionTextLower.includes('confirm');
    const hasDestructiveKeyword =
      optionText.match(/\b(clear|reset|delete|remove)\b/) ||
      questionTextLower.match(/\b(clear|reset|delete|remove)\b/);

    // Check if this question text is a duplicate (already seen)
    const isDuplicate = detectedQuestionTexts.has(questionText);

    if (hasConfirmKeyword && hasDestructiveKeyword && isDuplicate) {
      console.log(`[DIALOG_FILTER] 🚫 Skipping confirmation dialog: "${questionText}" with option "${options[0].label}"`);
      return null; // Skip this question
    }

    // Track this question text for future duplicate detection
    detectedQuestionTexts.add(questionText);
  }

  return questionData;
}

// Find question text for a group of radio/checkbox inputs
function findQuestionTextForGroup(inputs) {
  if (!inputs || inputs.length === 0) return 'Question';

  console.log(`[FIND_GROUP_TEXT] Looking for question text for ${inputs.length} inputs`);

  // Find common parent container
  let commonParent = inputs[0].parentElement;

  // Go up more levels to find the full question container (increased from 3 to 6)
  for (let i = 0; i < 6; i++) {
    if (!commonParent) break;

    // Look for legend (fieldset label)
    const legend = commonParent.querySelector('legend');
    if (legend) {
      const text = legend.textContent.trim();
      if (text.length > 0 && text.length < 500) {
        console.log(`[FIND_GROUP_TEXT] Found via legend: "${text.substring(0, 80)}"`);
        return text;
      }
    }

    // FIRST: Look for specific question text elements (higher priority)
    // These are more likely to be the actual question than generic divs/labels
    const specificQuestionSelectors = [
      '.zappi-header-text',
      '.question-description-container .zappi-header-text',
      '[class*="question-text"]',
      '[class*="question-label"]',  // Consent/profiler questions
      '[class*="question-description"]',  // Consent/profiler descriptions
      '[id^="question_text_"]',
      'h1.question-text',
      '.survey-question-text',
      '[role="radiogroup"] > [class*="header"]',
      '[role="group"] > [class*="header"]',
      '.questionback .question',  // V1.9.16: Angular forms with question in separate div
      '#lblQuestiontext',  // V1.9.16: Specific ID for question text
      'span.question',  // V1.9.16: Generic question span
      '.mrQuestionText'  // V1.9.27: IPSOS Interactive question text
    ];

    for (const selector of specificQuestionSelectors) {
      // V1.9.16: Search both in commonParent AND in parent's children (siblings)
      const searchContainers = [commonParent];
      if (commonParent.parentElement) {
        searchContainers.push(commonParent.parentElement);
      }

      for (const container of searchContainers) {
        const questionElement = container.querySelector(selector);
        if (questionElement) {
          // Make sure this element doesn't contain any of our inputs (it's not an option label)
          const containsInput = inputs.some(inp => questionElement.contains(inp));
          // Also make sure it's not a label FOR one of our inputs
          const isLabelFor = inputs.some(inp => questionElement.getAttribute('for') === inp.id);

          if (!containsInput && !isLabelFor) {
            const text = questionElement.textContent.trim();
            const lowerText = text.toLowerCase();

            // Always accept consent/privacy/data collection questions regardless of length/keywords
            const isConsentQuestion = lowerText.includes('consent') ||
                                     lowerText.includes('privacy') ||
                                     lowerText.includes('data') ||
                                     lowerText.includes('allow') ||
                                     lowerText.includes('agree') ||
                                     lowerText.includes('profile') ||
                                     lowerText.includes('collection');

            if (text.length > 10 && text.length < 500 && (isConsentQuestion || text.includes('?'))) {
              console.log(`[FIND_GROUP_TEXT] Found via specific selector "${selector}": "${text.substring(0, 80)}"`);
              return text;
            }
          }
        }
      }
    }

    // SECOND: Look for any heading or label before the inputs (fallback)
    const headings = commonParent.querySelectorAll('h1, h2, h3, h4, h5, h6, .question, [class*="question"], p');
    for (const heading of headings) {
      // Make sure this heading is not a label FOR a specific radio/checkbox (those are option labels)
      // Also check if it's a sibling of any input (likely an option label)
      const isOptionLabel = inputs.some(input =>
        heading.getAttribute('for') === input.id ||
        heading.contains(input) ||
        (heading.parentElement && heading.parentElement.contains(input) && heading.nextElementSibling === input)
      );

      if (!isOptionLabel) {
        const text = heading.textContent.trim();
        // Look for text that contains question-like content or "select" instructions
        if (text.length > 10 && text.length < 500 &&
            !text.toLowerCase().includes('male') &&
            !text.toLowerCase().includes('female')) {
          // Check if it looks like a question or instruction
          const lowerText = text.toLowerCase();
          if (text.includes('?') ||
              lowerText.includes('select') ||
              lowerText.includes('choose') ||
              lowerText.includes('check') ||
              lowerText.includes('which of') ||
              lowerText.includes('have you') ||
              lowerText.includes('best describes')) {
            console.log(`[FIND_GROUP_TEXT] Found via heading: "${text.substring(0, 80)}"`);
            return text;
          }
        }
      }
    }

    commonParent = commonParent.parentElement;
  }

  // CHECK FOR GRID/MATRIX QUESTIONS: Look for row or column headers in table
  const firstInput = inputs[0];
  console.log(`[FIND_GROUP_TEXT] Checking matrix - first input:`, firstInput.id || firstInput.name, `inputs count: ${inputs.length}`);

  const tableCell = firstInput.closest('td');
  console.log(`[FIND_GROUP_TEXT] Table cell found:`, !!tableCell);

  if (tableCell) {
    const table = tableCell.closest('table');
    console.log(`[FIND_GROUP_TEXT] Table found:`, !!table);

    if (table) {
      // Determine if this is a ROW-based matrix or COLUMN-based matrix
      // Check input ID or name pattern: ans[groupID].[column].[row] (3 parts)
      // IMPORTANT: Use ID first (more reliable for matrix questions), fall back to name
      const inputIdentifier = firstInput.id || firstInput.name || '';
      const nameParts = inputIdentifier.match(/^[a-z]+(\d+)\.(\d+)\.(\d+)$/);

      console.log(`[FIND_GROUP_TEXT] Matrix check - identifier: "${inputIdentifier}", nameParts:`, nameParts);

      if (nameParts && nameParts.length === 4) {
        // Parse all input IDs/names to determine if row-based or column-based
        const columnIndices = new Set();
        const rowIndices = new Set();

        inputs.forEach(inp => {
          const identifier = inp.id || inp.name || '';
          const parts = identifier.match(/^[a-z]+(\d+)\.(\d+)\.(\d+)$/);
          if (parts && parts.length === 4) {
            columnIndices.add(parts[2]);  // Column index
            rowIndices.add(parts[3]);     // Row index
          }
        });

        console.log(`[FIND_GROUP_TEXT] Matrix analysis - columns: ${columnIndices.size} (${[...columnIndices]}), rows: ${rowIndices.size} (${[...rowIndices]})`);

        const isRowBased = rowIndices.size === 1 && columnIndices.size > 1;  // Same row, different columns
        const isColumnBased = columnIndices.size === 1 && rowIndices.size > 1;  // Same column, different rows

        console.log(`[FIND_GROUP_TEXT] isRowBased: ${isRowBased}, isColumnBased: ${isColumnBased}`);

        if (isColumnBased) {
          // COLUMN-BASED MATRIX (e.g., Most/Least likely)
          // All inputs have same column index, different row indices
          // We need the COLUMN header (e.g., "Most likely" or "Least likely")
          const columnIndex = parseInt(nameParts[2]);
          console.log(`[FIND_GROUP_TEXT] Detected column-based matrix, looking for column ${columnIndex} header`);

          // Find header row
          const headerRow = table.querySelector('tr.row-col-legends, tr:has(th[scope="col"])');
          if (headerRow) {
            const headers = Array.from(headerRow.querySelectorAll('th'));
            console.log(`[FIND_GROUP_TEXT] Found ${headers.length} column headers`);

            // Try to match column index to header position
            // Headers might include row labels, so we need to find the right offset
            // Try multiple strategies to find the correct header

            // Strategy 1: Direct index match (works if no row label column)
            if (headers[columnIndex]) {
              const headerText = headers[columnIndex].textContent.trim();
              if (headerText && headerText.length > 0 && headerText.length < 200 && !headerText.match(/^(option|item|row)/i)) {
                console.log(`[FIND_GROUP_TEXT] Found via direct column index ${columnIndex}: "${headerText.substring(0, 80)}"`);
                return headerText;
              }
            }

            // Strategy 2: Skip first header if it looks like a row label (e.g., "Options", "Items")
            const offset = headers[0] && headers[0].textContent.trim().match(/^(option|item|row|statement)/i) ? 1 : 0;
            const adjustedIndex = columnIndex + offset;
            if (headers[adjustedIndex]) {
              const headerText = headers[adjustedIndex].textContent.trim();
              if (headerText && headerText.length > 0 && headerText.length < 200) {
                console.log(`[FIND_GROUP_TEXT] Found via adjusted column index ${adjustedIndex} (offset: ${offset}): "${headerText.substring(0, 80)}"`);
                return headerText;
              }
            }

            // Strategy 3: Find headers with scope="col" and match by position
            const columnHeaders = Array.from(headerRow.querySelectorAll('th[scope="col"]'));
            if (columnHeaders[columnIndex]) {
              const headerText = columnHeaders[columnIndex].textContent.trim();
              if (headerText && headerText.length > 0 && headerText.length < 200) {
                console.log(`[FIND_GROUP_TEXT] Found via scope=col headers at index ${columnIndex}: "${headerText.substring(0, 80)}"`);
                return headerText;
              }
            }
          }
        } else if (isRowBased) {
          // ROW-BASED MATRIX (e.g., importance ratings)
          // All inputs have same row index, different column indices
          // We need the ROW header (the statement text)
          const rowIndex = parseInt(nameParts[3]);
          console.log(`[FIND_GROUP_TEXT] Detected row-based matrix, looking for row ${rowIndex} header`);

          // Find all rows in the table
          const allRows = Array.from(table.querySelectorAll('tr'));

          // Look for the row header (th with scope="row") at the matching row
          for (const tr of allRows) {
            const rowHeader = tr.querySelector('th[scope="row"]');
            if (rowHeader) {
              // Check if this row contains our input by looking for the row index in any input ID/name
              const rowInputs = Array.from(tr.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
              if (rowInputs.length > 0) {
                const firstRowInput = rowInputs[0];
                const rowInputIdentifier = firstRowInput.id || firstRowInput.name || '';
                const rowInputParts = rowInputIdentifier.match(/^[a-z]+(\d+)\.(\d+)\.(\d+)$/);
                if (rowInputParts && parseInt(rowInputParts[3]) === rowIndex) {
                  const headerText = rowHeader.textContent.trim();
                  if (headerText && headerText.length > 0 && headerText.length < 500) {
                    console.log(`[FIND_GROUP_TEXT] Found via table ROW header: "${headerText.substring(0, 80)}"`);

                    // Check if this looks like a row label (not a full question)
                    const looksLikeLabel = !headerText.includes('?') && headerText.length < 100;

                    if (looksLikeLabel) {
                      // Try to find the actual question heading outside the table
                      console.log(`[FIND_GROUP_TEXT] Row header looks like a label, searching for question heading outside table`);
                      const tableContainer = table.closest('.question, [class*="question"], .survey-section, .page-content, .mx-stage');
                      if (tableContainer) {
                        const questionElements = tableContainer.querySelectorAll('h1, h2, h3, h4, h5, legend, .question-text, [class*="question-text"], [id*="question_text"], [class*="question-heading"]');
                        for (const el of questionElements) {
                          // Make sure this element is NOT inside the table
                          if (!table.contains(el)) {
                            const text = el.textContent.trim();
                            // Good question headings usually have "?" or are reasonably long
                            if (text.length > 20 && text.length < 500) {
                              console.log(`[FIND_GROUP_TEXT] ✓ Found question heading outside table: "${text.substring(0, 80)}"`);
                              return text;
                            }
                          }
                        }
                      }
                      console.log(`[FIND_GROUP_TEXT] No question heading found outside table, using row header`);
                    }

                    return headerText;
                  }
                }
              }
            }
          }
        }
      } else {
        // COLUMN-BASED MATRIX (items in columns, like stores) - legacy format without 3-part names
        // Use the existing column header detection
        const row = tableCell.parentElement;
        const cells = Array.from(row.children);
        const columnIndex = cells.indexOf(tableCell);

        const headerRow = table.querySelector('tr.row-col-legends, tr:has(th[scope="col"])');
        if (headerRow) {
          const headers = Array.from(headerRow.querySelectorAll('th'));
          if (headers[columnIndex]) {
            const headerText = headers[columnIndex].textContent.trim();
            if (headerText && headerText.length > 0 && headerText.length < 200) {
              console.log(`[FIND_GROUP_TEXT] Found via table COLUMN header: "${headerText.substring(0, 80)}"`);

              // Check if this looks like a column label (brand name, not a full question)
              const looksLikeLabel = !headerText.includes('?') && headerText.length < 100;

              if (looksLikeLabel) {
                // Try to find the actual question heading outside the table
                console.log(`[FIND_GROUP_TEXT] Column header looks like a label, searching for question heading outside table`);
                const tableContainer = table.closest('.question, [class*="question"], .survey-section, .page-content, .mx-stage');
                if (tableContainer) {
                  const questionElements = tableContainer.querySelectorAll('h1, h2, h3, h4, h5, legend, .question-text, [class*="question-text"], [id*="question_text"], [class*="question-heading"]');
                  for (const el of questionElements) {
                    // Make sure this element is NOT inside the table
                    if (!table.contains(el)) {
                      const text = el.textContent.trim();
                      // Good question headings usually have "?" or are reasonably long
                      if (text.length > 20 && text.length < 500) {
                        console.log(`[FIND_GROUP_TEXT] ✓ Found question heading outside table: "${text.substring(0, 80)}"`);
                        return text;
                      }
                    }
                  }
                }
                console.log(`[FIND_GROUP_TEXT] No question heading found outside table, using column header`);
              }

              return headerText;
            }
          }
        }
      }
    }
  }

  // Fallback: use the generic findQuestionText on first input
  console.log(`[FIND_GROUP_TEXT] Using fallback`);
  const inputLabel = findQuestionText(firstInput);

  // For number inputs or if the label looks like a row label (not a question),
  // try to find the actual question heading outside the table
  const isNumberInput = firstInput.type === 'number';
  const looksLikeRowLabel = inputLabel && !inputLabel.includes('?') && inputLabel.length < 150;

  if ((isNumberInput || looksLikeRowLabel) && tableCell) {
    console.log(`[FIND_GROUP_TEXT] Number matrix detected - searching for question heading outside table`);
    const table = tableCell.closest('table');
    if (table) {
      const tableContainer = table.closest('.question, [class*="question"], .survey-section, .page-content');
      if (tableContainer) {
        const questionElements = tableContainer.querySelectorAll('h1, h2, h3, h4, h5, legend, .question-text, [class*="question-text"], [id*="question_text"]');
        for (const el of questionElements) {
          // Make sure this element is NOT inside the table (we want the heading above/outside the table)
          if (!table.contains(el)) {
            const text = el.textContent.trim();
            // Good question headings usually have "?" or are reasonably long
            if (text.length > 10 && text.length < 500) {
              console.log(`[FIND_GROUP_TEXT] ✓ Found question heading outside table: "${text.substring(0, 80)}"`);
              return text;
            }
          }
        }
      }
    }
  }

  // Also check for bilingual option labels
  if (inputLabel && inputLabel.includes(' / ')) {
    // This looks like a bilingual option label (e.g., "English / Anglais")
    console.log(`[FIND_GROUP_TEXT] Input label looks like bilingual option ("${inputLabel}"), using generic text`);
    return 'Please select an option';
  }

  // 🔧 V1.9.10 FIX: If inputLabel looks like an answer option (not a question),
  // search for the actual question text in sibling sections (e.g., carousel questions)
  const looksLikeAnswerOption = inputLabel &&
                                !inputLabel.includes('?') &&
                                inputLabel.length < 100 &&
                                (inputLabel.toLowerCase().includes('interested') ||
                                 inputLabel.toLowerCase().includes('agree') ||
                                 inputLabel.toLowerCase().includes('likely') ||
                                 inputLabel.toLowerCase().includes('yes') ||
                                 inputLabel.toLowerCase().includes('no') ||
                                 inputLabel.toLowerCase().match(/^(not|very|quite|somewhat|neither)/i));

  if (looksLikeAnswerOption) {
    console.log(`[FIND_GROUP_TEXT] Input label looks like an answer option ("${inputLabel}"), searching for actual question in page...`);

    // Search the entire document for question text elements
    // Priority 1: Look for data-role="questionText" attribute
    const dataRoleQuestion = document.querySelector('[data-role="questionText"]');
    if (dataRoleQuestion) {
      const text = dataRoleQuestion.textContent.trim();
      if (text.length > 10 && text.length < 500) {
        console.log(`[FIND_GROUP_TEXT] ✓ Found via data-role="questionText": "${text.substring(0, 80)}"`);
        return text;
      }
    }

    // Priority 2: Look for h1/h2/h3 in header section or question container
    const questionContainers = document.querySelectorAll('.header, section.header, .question-container, [class*="question-header"], [role="heading"]');
    for (const container of questionContainers) {
      const headings = container.querySelectorAll('h1, h2, h3, h4');
      for (const heading of headings) {
        const text = heading.textContent.trim();
        // Good questions usually have '?' or specific keywords
        if (text.length > 10 && text.length < 500 &&
            (text.includes('?') ||
             text.toLowerCase().includes('how ') ||
             text.toLowerCase().includes('what ') ||
             text.toLowerCase().includes('please ') ||
             text.toLowerCase().includes('select ') ||
             text.toLowerCase().includes('indicate '))) {
          console.log(`[FIND_GROUP_TEXT] ✓ Found via heading in container: "${text.substring(0, 80)}"`);
          return text;
        }
      }
    }

    // Priority 3: Look for any h1 on the page that looks like a question
    const allH1s = document.querySelectorAll('h1');
    for (const h1 of allH1s) {
      const text = h1.textContent.trim();
      if (text.length > 10 && text.length < 500 && text.includes('?')) {
        console.log(`[FIND_GROUP_TEXT] ✓ Found via h1 with ?: "${text.substring(0, 80)}"`);
        return text;
      }
    }

    console.log(`[FIND_GROUP_TEXT] Could not find actual question text, using answer option label as fallback`);
  }

  // 🔧 V1.9.17: LAST RESORT - Search document-wide for Angular/specific question text elements
  // This handles cases where question text is a high-level sibling, not in commonParent tree
  console.log(`[FIND_GROUP_TEXT] V1.9.17: Attempting document-wide search for question text before final fallback`);
  const documentWideSelectors = [
    '#lblQuestiontext',
    '.questionback .question',
    'span.question',
    '[data-role="questionText"]',
    '.question-text',
    '.mrQuestionText'  // V1.9.27: IPSOS Interactive question text
  ];

  for (const selector of documentWideSelectors) {
    const questionElement = document.querySelector(selector);
    if (questionElement) {
      const text = questionElement.textContent.trim();
      // Make sure it's not an input label and looks like a question
      const containsInput = inputs.some(inp => questionElement.contains(inp));
      if (!containsInput && text.length > 10 && text.length < 500) {
        console.log(`[FIND_GROUP_TEXT] ✓ Found via document-wide search "${selector}": "${text.substring(0, 80)}"`);
        return text;
      }
    }
  }

  console.log(`[FIND_GROUP_TEXT] Returning fallback input label: "${inputLabel?.substring(0, 50)}"`);
  return inputLabel;
}

// Get the label text specifically for a single radio/checkbox option
// V1.9.33: Now also detects and returns image URLs for vision-based questions
function getOptionLabel(input) {
  const inputId = input.id || input.name || 'unknown';

  // V1.9.33: FIRST - Check if this option contains an image (for vision-based questions)
  let imageUrl = null;
  let textLabel = null;

  // Check label[for] for images
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) {
      const img = label.querySelector('img');
      if (img && img.src) {
        imageUrl = img.src;
        // Get text label, excluding the img element
        const clone = label.cloneNode(true);
        const imgs = clone.querySelectorAll('img');
        imgs.forEach(i => i.remove());
        const inputs = clone.querySelectorAll('input, textarea, select');
        inputs.forEach(inp => inp.remove());
        textLabel = clone.textContent.trim();
        console.log(`[getOptionLabel] ID="${inputId}" → IMAGE: "${imageUrl}" + TEXT: "${textLabel}"`);
        // Return object with both image and text
        return { image: imageUrl, text: textLabel || imageUrl.split('/').pop() };
      }
    }
  }

  // Check parent label for images
  const parentLabelForImage = input.closest('label');
  if (parentLabelForImage) {
    const img = parentLabelForImage.querySelector('img');
    if (img && img.src) {
      imageUrl = img.src;
      const clone = parentLabelForImage.cloneNode(true);
      const imgs = clone.querySelectorAll('img');
      imgs.forEach(i => i.remove());
      const inputs = clone.querySelectorAll('input, textarea, select');
      inputs.forEach(inp => inp.remove());
      textLabel = clone.textContent.trim();
      console.log(`[getOptionLabel] ID="${inputId}" → IMAGE: "${imageUrl}" + TEXT: "${textLabel}"`);
      return { image: imageUrl, text: textLabel || imageUrl.split('/').pop() };
    }
  }

  // No image found - continue with normal text extraction
  // Try aria-label or aria-labelledby (most reliable, modern accessibility standard)
  if (input.hasAttribute('aria-label')) {
    const text = input.getAttribute('aria-label').trim();
    if (text.length > 0) {
      console.log(`[getOptionLabel] ID="${inputId}" → aria-label: "${text}"`);
      return text;
    }
  }

  // Try data-column-label (used in matrix/grid questions)
  if (input.hasAttribute('data-column-label')) {
    const text = input.getAttribute('data-column-label').trim();
    if (text.length > 0) {
      console.log(`[getOptionLabel] ID="${inputId}" → data-column-label: "${text}"`);
      return text;
    }
  }

  // Try data-row-label (used in matrix/grid questions for row labels)
  if (input.hasAttribute('data-row-label')) {
    const text = input.getAttribute('data-row-label').trim();
    if (text.length > 0) {
      console.log(`[getOptionLabel] ID="${inputId}" → data-row-label: "${text}"`);
      return text;
    }
  }

  // Try aria-labelledby - handles paired comparisons and standard labels
  if (input.hasAttribute('aria-labelledby')) {
    const labelIds = input.getAttribute('aria-labelledby').trim().split(/\s+/);

    // Check if this is a paired comparison question (has _left and _right IDs)
    const leftId = labelIds.find(id => id.includes('_left'));
    const rightId = labelIds.find(id => id.includes('_right'));

    if (leftId && rightId) {
      // Paired comparison: determine which statement this radio represents
      // Usually value="0" is left, value="1" is right
      const isLeftOption = input.value === "0" || input.id.includes('.0.');
      const targetId = isLeftOption ? leftId : rightId;

      const labelEl = document.getElementById(targetId);
      if (labelEl) {
        const text = labelEl.textContent.trim();
        console.log(`[PAIRED_COMPARISON] Extracted ${isLeftOption ? 'LEFT' : 'RIGHT'} statement: "${text.substring(0, 50)}"`);
        if (text.length > 0) return text;
      }
    } else {
      // Check for Qualtrics checkbox matrix pattern: "header~QID~N" (row) + "QID-X-xY-col-label" (column)
      const hasRowHeader = labelIds.some(id => id.includes('header~'));
      const colLabelId = labelIds.find(id => id.includes('-col-label'));

      if (hasRowHeader && colLabelId) {
        // This is a Qualtrics checkbox matrix - extract ONLY the column label (brand/item)
        const colElement = document.getElementById(colLabelId);
        if (colElement) {
          const colText = colElement.textContent.trim();
          if (colText.length > 0) {
            console.log(`[getOptionLabel] ID="${inputId}" → Qualtrics matrix column: "${colText}"`);
            return colText;
          }
        }
      }

      // Standard aria-labelledby: try all IDs and concatenate
      const texts = labelIds.map(id => {
        const el = document.getElementById(id);
        return el ? el.textContent.trim() : '';
      }).filter(t => t.length > 0);

      if (texts.length > 0) {
        const combinedText = texts.join(' ');
        if (combinedText.length > 0) return combinedText;
      }
    }
  }

  // Try label with for attribute
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) {
      let text = label.textContent.trim();

      // Clean up image URL tags (e.g., {@imageURL::https://...@})
      text = text.replace(/\{@imageURL::[^@}]+@\}/g, '').trim();

      // Clean up other survey tags (e.g., {@globalExclusive::true@})
      text = text.replace(/\{@[^@}]+::[^@}]+@\}/g, '').trim();

      // If label has format "Short: Long description", extract just the short part
      if (text.includes(':') && text.indexOf(':') < text.length * 0.3) {
        text = text.split(':')[0].trim() + ':';
      }
      if (text.length > 0) {
        console.log(`[getOptionLabel] ID="${inputId}" → label[for]: "${text}"`);
        return text;
      }
    }
  }

  // Try parent label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll('input, textarea, select');
    inputs.forEach(inp => inp.remove());
    let text = clone.textContent.trim();

    text = text.replace(/\{@imageURL::[^@}]+@\}/g, '').trim();
    text = text.replace(/\{@[^@}]+::[^@}]+@\}/g, '').trim();

    if (text.includes(':') && text.indexOf(':') < text.length * 0.3) {
      text = text.split(':')[0].trim() + ':';
    }
    if (text.length > 0) return text;
  }

  // Try next sibling (Qualtrics pattern: input followed by label text)
  // BUT: Skip SVG elements that just say "radio" or "checkbox"
  let nextSibling = input.nextElementSibling;
  while (nextSibling) {
    // Skip SVG/icon elements
    if (nextSibling.tagName === 'svg' || nextSibling.tagName === 'SVG' ||
        nextSibling.classList.contains('fir-icon') ||
        nextSibling.classList.contains('icon')) {
      nextSibling = nextSibling.nextElementSibling;
      continue;
    }

    const text = nextSibling.textContent.trim();
    if (text.length > 0 && text.length < 200 && text !== 'radio' && text !== 'checkbox') {
      return text;
    }
    nextSibling = nextSibling.nextElementSibling;
    if (!nextSibling || nextSibling.tagName === 'INPUT') break;
  }

  // Try parent's next sibling (another Qualtrics pattern)
  const parent = input.parentElement;
  if (parent) {
    let parentNext = parent.nextElementSibling;
    while (parentNext) {
      const text = parentNext.textContent.trim();
      if (text.length > 0 && text.length < 200 && !text.includes('?')) {
        return text;
      }
      parentNext = parentNext.nextElementSibling;
      if (!parentNext) break;
    }
  }

  // Try nearby text in parent container (Qualtrics fieldset pattern)
  const container = input.closest('li, div, td');
  if (container) {
    const clone = container.cloneNode(true);
    const inputs = clone.querySelectorAll('input, textarea, select, button, svg');
    inputs.forEach(inp => inp.remove());
    let text = clone.textContent.trim();

    text = text.replace(/\{@imageURL::[^@}]+@\}/g, '').trim();
    text = text.replace(/\{@[^@}]+::[^@}]+@\}/g, '').trim();

    if (text.length > 0 && text.length < 200) {
      return text;
    }
  }

  const fallbackValue = input.value || input.id || 'Option';
  console.warn(`[getOptionLabel] Could not find label for input ID="${input.id}", falling back to: "${fallbackValue}"`);
  console.warn(`[getOptionLabel] Input attributes:`, {
    id: input.id,
    name: input.name,
    value: input.value,
    type: input.type,
    'data-column-label': input.getAttribute('data-column-label'),
    'data-row-label': input.getAttribute('data-row-label'),
    'aria-label': input.getAttribute('aria-label')
  });
  return fallbackValue;
}

// Extract question data from an input element
function extractQuestionData(element) {
  const type = element.type || element.tagName.toLowerCase();

  // Skip hidden, submit, button, and image buttons (image buttons are for navigation)
  if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') {
    return null;
  }

  const questionText = findQuestionText(element);

  // V1.9.43: Skip text inputs with JavaScript code as question text
  // These are technical fields, not real survey questions
  if ((type === 'text' || type === 'textarea') &&
      (questionText.includes('(') && questionText.includes(')') &&
       (questionText.includes('Survey.') || questionText.includes('function') ||
        questionText.includes('{') || questionText.includes(';')))) {
    console.log(`[SKIP] Skipping text field with JavaScript question text: "${questionText.substring(0, 80)}"`);
    return null;
  }

  // V1.9.43: Skip text inputs with placeholder/technical values like "_"
  // These are likely hidden technical fields
  if ((type === 'text' || type === 'textarea') && element.value === '_') {
    console.log(`[SKIP] Skipping text field with placeholder value "_": ID="${element.id}"`);
    return null;
  }

  // V1.9.43: Skip text inputs with technical ID patterns like "ra__NUMBER"
  // These are often tracking or technical fields, not survey questions
  if ((type === 'text' || type === 'textarea') && /^ra__\d+$/.test(element.id)) {
    console.log(`[SKIP] Skipping text field with technical ID pattern: ID="${element.id}"`);
    return null;
  }

  // Skip "Prefer not to answer" checkboxes - they're optional fields, not actual questions
  const lowerText = questionText.toLowerCase();
  const elementId = (element.id || '').toLowerCase();
  const elementName = (element.name || '').toLowerCase();

  // V1.9.38: Also check the checkbox's label text, not just question text
  let checkboxLabel = '';
  if (type === 'checkbox' || type === 'radio') {
    checkboxLabel = getOptionLabel(element).toLowerCase();
    console.log(`[DEBUG] Checkbox ID="${element.id}" label extracted: "${checkboxLabel}"`);
  }

  // V1.9.39: Also check if checkbox is marked as exclusive with openendid (paired with text input)
  const isExclusive = element.getAttribute('isexclusive') === 'true';
  const hasOpenEndId = element.hasAttribute('openendid');

  // V1.9.45: Also check for "no-answer" class - common pattern for opt-out checkboxes
  const hasNoAnswerClass = element.classList.contains('no-answer');

  if (type === 'checkbox' &&
      (lowerText.includes('prefer not to') ||
       lowerText.includes('prefer not to answer') ||
       elementId.includes('prefernot') ||         // Matches: preferNotToAnswer, prefernotanswer, etc
       elementName.includes('prefernot') ||
       elementName.includes('_na_') ||            // V1.9.45: Common pattern for "no answer" checkboxes
       hasNoAnswerClass ||                        // V1.9.45: Check for no-answer class
       checkboxLabel.includes('prefer not to answer') ||  // V1.9.38: Check label text
       checkboxLabel.includes('prefer not to say') ||
       checkboxLabel.includes('decline to answer') ||
       checkboxLabel.includes('rather not say') ||
       checkboxLabel.includes('do not wish to answer') ||  // V1.9.39: More variations
       checkboxLabel.includes("don't wish to answer") ||
       checkboxLabel.includes('choose not to answer') ||
       checkboxLabel.includes('wish not to answer') ||
       (isExclusive && hasOpenEndId))) {  // V1.9.39: Also skip if marked as exclusive with text input
    console.log(`[SKIP] Skipping "Prefer not to answer" checkbox: "${questionText}" (label: "${checkboxLabel}", exclusive: ${isExclusive}, openendid: ${hasOpenEndId}, no-answer class: ${hasNoAnswerClass})`);
    return null;
  }

  // Skip "Other (please specify)" type fields - they're conditional and shouldn't be auto-filled
  if ((type === 'text' || type === 'textarea') &&
      (lowerText.includes('other') && (lowerText.includes('specify') || lowerText.includes('please')))) {
    console.log(`[SKIP] Skipping conditional "Other" field: "${questionText}"`);
    return null;
  }

  // Skip search/filter boxes - they're just helpers, not actual questions
  if (type === 'text' || type === 'search') {
    const elementClass = (element.className || '').toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();

    const searchKeywords = ['search', 'filter', 'type to', 'find', 'lookup'];
    const isSearchBox = searchKeywords.some(keyword =>
      lowerText.includes(keyword) ||
      elementId.includes(keyword) ||
      elementName.includes(keyword) ||
      elementClass.includes(keyword) ||
      placeholder.includes(keyword) ||
      ariaLabel.includes(keyword)
    );

    if (isSearchBox) {
      console.log(`[SKIP] Skipping search/filter box: "${questionText.substring(0, 50)}"`);
      return null;
    }
  }

  // Skip feedback/contact forms - these are NOT survey questions
  if (type === 'text' || type === 'textarea' || type === 'email') {
    const elementClass = (element.className || '').toLowerCase();
    const elementId = (element.id || '').toLowerCase();

    // Feedback form keywords
    const feedbackKeywords = [
      'feedback', 'issue', 'problem', 'error', 'bug', 'complaint',
      'faced', 'encountered', 'difficulty', 'trouble', 'concern'
    ];

    // Contact form keywords
    const contactKeywords = [
      'contact', 'support', 'help', 'email us', 'reach us', 'get in touch'
    ];

    const isFeedbackForm = feedbackKeywords.some(keyword =>
      lowerText.includes(keyword) ||
      elementId.includes(keyword) ||
      elementClass.includes(keyword)
    );

    const isContactForm = contactKeywords.some(keyword =>
      lowerText.includes(keyword) ||
      elementId.includes(keyword) ||
      elementClass.includes(keyword)
    );

    // EXCEPTION: Don't skip if this is clearly a legitimate survey question asking for specific information
    // Examples: "What is the primary reason you provided the rating you did? Your feedback is important"
    //           "Why did you choose that rating? Please provide feedback"
    const isLegitimateQuestion = lowerText.includes('what') || lowerText.includes('why') ||
                                  lowerText.includes('reason') || lowerText.includes('explain') ||
                                  lowerText.includes('primary reason') || lowerText.includes('please provide');

    // EXCEPTION: Don't skip if field is required or has error styling (means it's part of survey flow)
    const isRequired = element.required || element.hasAttribute('required') ||
                       element.hasAttribute('aria-required') ||
                       elementClass.includes('required') || elementClass.includes('has-error');

    // Special case: "Email address" fields in footer/contact sections
    const isEmailField = lowerText === 'email address' || lowerText === 'email' ||
                         lowerText === 'your email' || elementId.includes('email');

    if (isFeedbackForm && !isLegitimateQuestion && !isRequired) {
      console.log(`[SKIP] Skipping feedback form: "${questionText.substring(0, 80)}"`);
      return null;
    }

    if (isContactForm && !isLegitimateQuestion && !isRequired) {
      console.log(`[SKIP] Skipping contact form: "${questionText.substring(0, 80)}"`);
      return null;
    }

    // Skip standalone email fields unless they're clearly survey questions
    // (e.g., "What email provider do you use?" is a survey question, but "Email address" alone is usually contact)
    if (isEmailField && !lowerText.includes('provider') && !lowerText.includes('which') &&
        !lowerText.includes('what') && !lowerText.includes('use')) {
      console.log(`[SKIP] Skipping standalone email field (likely contact form): "${questionText}"`);
      return null;
    }
  }

  // Skip questions where the question heading is hidden (data nodes for ranking UI)
  const questionContainer = element.closest('.question');
  if (questionContainer) {
    const questionHeading = questionContainer.querySelector('.question-text, [id^="question_text_"]');
    if (questionHeading) {
      const headingStyle = window.getComputedStyle(questionHeading);
      if (headingStyle.display === 'none' || headingStyle.visibility === 'hidden') {
        console.log(`[SKIP] Skipping hidden question (data node): "${questionText.substring(0, 50)}"`);
        return null;
      }
    }
  }

  const isRequired = element.required || element.hasAttribute('required') ||
                     element.hasAttribute('aria-required');

  // Use element ID as priority, then name, then generate a deterministic one
  let questionId = element.id || element.name;
  if (!questionId) {
    // Generate a deterministic ID based on question text hash (so same question = same ID)
    const hash = simpleHash(questionText);
    questionId = `q_${element.type}_${hash}`;
  }

  // Skip questions we've already answered in this session IF they're still in "answered" state
  // This prevents re-answering persistent controls like language selectors on every page
  // BUT allows re-answering if user manually unselects for debugging
  if (answeredQuestionIds.has(questionId)) {
    // Check if this question is still in "answered" state
    let isStillAnswered = false;

    if (type === 'select' || element.tagName.toLowerCase() === 'select') {
      // For dropdowns, check if a non-placeholder option is selected
      const selectedValue = element.value;
      const selectedOption = element.options[element.selectedIndex];
      const selectedText = selectedOption ? selectedOption.textContent.trim() : '';
      const isPlaceholder = !selectedValue ||
                           selectedText.toLowerCase().includes('select') ||
                           selectedText.toLowerCase().includes('choose') ||
                           selectedText.toLowerCase().includes('--');
      isStillAnswered = selectedValue && !isPlaceholder;
    } else if (type === 'radio') {
      // For radio buttons, check if this specific radio is checked
      isStillAnswered = element.checked;
    } else if (type === 'checkbox') {
      // For checkboxes, check if checked
      isStillAnswered = element.checked;
    } else if (type === 'text' || type === 'textarea') {
      // For text inputs, check if there's a value
      isStillAnswered = element.value && element.value.trim().length > 0;
    }

    if (isStillAnswered) {
      console.log(`[SKIP] Already answered this question in session and still answered: "${questionText}" (ID: ${questionId})`);
      return null;
    } else {
      console.log(`[RE-ANSWER] Question was answered before but now unselected - will re-answer: "${questionText}" (ID: ${questionId})`);
    }
  }

  const questionData = {
    question_id: String(questionId),
    element: element,
    question_text: questionText,
    question_type: normalizeQuestionType(type),
    required: isRequired,
    options: []
  };

  // V1.9.32: Capture pre-filled values for number inputs (often default placeholders like "0")
  if (type === 'number' && element.value && element.value.trim() !== '') {
    questionData.current_value = element.value;
    console.log(`[DETECTION] Number input has pre-filled value: "${element.value}" (likely a placeholder)`);
  }

  // Extract options for different input types
  if (type === 'radio' || type === 'checkbox') {
    questionData.options = extractRadioCheckboxOptions(element);
  } else if (type === 'select' || element.tagName.toLowerCase() === 'select') {
    questionData.options = extractSelectOptions(element);
  } else if (type === 'range') {
    questionData.min = element.min || 0;
    questionData.max = element.max || 100;
    questionData.step = element.step || 1;
  } else if (type === 'text' || type === 'textarea') {
    // Capture character limits for text inputs
    console.log(`[TEXT_INPUT] Checking element: type="${element.type}" tagName="${element.tagName}" maxLength="${element.maxLength}" hasMaxLength=${element.hasAttribute('maxlength')}`);

    // Check both maxLength property and maxlength attribute
    let maxLen = element.maxLength;
    if (!maxLen || maxLen === -1 || maxLen >= 999999) {
      // Try getting from attribute directly
      const maxLengthAttr = element.getAttribute('maxlength');
      if (maxLengthAttr) {
        maxLen = parseInt(maxLengthAttr);
      }
    }

    // If no HTML maxLength, search for validation text on the page (like "100 characters maximum")
    if (!maxLen || maxLen === -1 || maxLen >= 999999) {
      console.log(`[TEXT_INPUT] No HTML maxLength, searching for validation text near input...`);

      // Search in parent containers for character limit hints
      let container = element.parentElement;
      for (let i = 0; i < 5 && container; i++) { // Search up to 5 levels up
        const containerText = container.textContent || '';

        // Match patterns like "100 characters", "max 100", "100 char limit", etc.
        const charLimitMatch = containerText.match(/(\d+)\s*character/i) ||
                               containerText.match(/max(?:imum)?[:\s]*(\d+)/i) ||
                               containerText.match(/(\d+)\s*char/i);

        if (charLimitMatch && charLimitMatch[1]) {
          const foundLimit = parseInt(charLimitMatch[1]);
          if (foundLimit > 0 && foundLimit <= 1000) { // Reasonable text input limit
            maxLen = foundLimit;
            console.log(`[TEXT_INPUT] Found validation text with limit: ${foundLimit} chars in container text: "${containerText.substring(0, 100)}"`);
            break;
          }
        }

        container = container.parentElement;
      }
    }

    if (maxLen && maxLen > 0 && maxLen < 999999) {
      questionData.maxLength = maxLen;
      console.log(`[TEXT_INPUT] ✓ Detected maxLength=${maxLen} for question: "${questionText.substring(0, 50)}"`);
    } else {
      console.log(`[TEXT_INPUT] No character limit detected (maxLength=${maxLen})`);
    }
  }

  return questionData;
}

// Find associated question text for an input
function findQuestionText(element) {
  console.log(`[FIND_QUESTION_TEXT] Looking for question text for element:`, element.id || element.name);

  // IMPORTANT: Never use element.value as question text!
  // Make sure we're not accidentally picking up filled-in answers

  // V1.9.32: Check if input is in an IPSOS grid/matrix table
  const gridTable = element.closest('table.mrGridTable, table.mrQuestionTable');
  if (gridTable) {
    console.log(`[FIND_QUESTION_TEXT] Input is in IPSOS grid table, extracting grid question text...`);

    // Get main question from table summary attribute
    const tableSummary = gridTable.getAttribute('summary');
    let mainQuestion = tableSummary ? tableSummary.trim() : '';

    // Clean up HTML entities in summary (e.g., &lt;b&gt; → <b>, then remove tags)
    if (mainQuestion) {
      mainQuestion = mainQuestion
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<\/?b>/gi, '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Get row label from sibling <td> with class mrGridCategoryText
    const inputRow = element.closest('tr');
    if (inputRow) {
      const rowLabelCell = inputRow.querySelector('td.mrGridCategoryText span.mrQuestionText, td.mrGridCategoryText');
      if (rowLabelCell) {
        const rowLabel = rowLabelCell.textContent.trim();
        if (rowLabel && mainQuestion) {
          // Combine main question + row label
          const combinedText = `${mainQuestion} - Age group: ${rowLabel}`;
          console.log(`[FIND_QUESTION_TEXT] Found grid question: "${combinedText.substring(0, 100)}"`);
          return combinedText;
        } else if (rowLabel) {
          // Just row label if no main question
          console.log(`[FIND_QUESTION_TEXT] Found grid row label: "${rowLabel}"`);
          return rowLabel;
        }
      }
    }

    // If we found main question but no row label, use main question
    if (mainQuestion) {
      console.log(`[FIND_QUESTION_TEXT] Found table summary: "${mainQuestion.substring(0, 100)}"`);
      return mainQuestion;
    }
  }

  // Try label with for attribute (most reliable)
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) {
      const text = label.textContent.trim();
      // Only use if it's reasonable question length (not entire paragraphs)
      if (text.length > 0 && text.length < 200) {
        // V1.9.35: Check if label is just a field marker like "(1)", "(2)", "1.", etc.
        // If so, search for parent question heading
        const isSimpleMarker = /^\(?\d+\)?\.?$/.test(text) || // Matches: (1), 1, 1., (2), etc.
                              /^[A-Z]\.?$/.test(text);       // Matches: A, B., C, etc.

        if (isSimpleMarker) {
          console.log(`[FIND_QUESTION_TEXT] Label "${text}" is a field marker, searching for parent question...`);

          // Search parent containers for actual question text
          let container = element;
          for (let i = 0; i < 8; i++) {
            container = container.parentElement;
            if (!container) break;

            // Look for question heading in parent
            const headingSelectors = [
              '.user-generated', // SurveyMonkey
              '[class*="question-text"]',
              '.question',
              'h1, h2, h3, h4',
              'p',
              'label',
              'span.mrQuestionText'
            ];

            for (const selector of headingSelectors) {
              const heading = container.querySelector(selector);
              if (heading && !heading.contains(element)) {
                const headingText = heading.textContent.trim();
                // Make sure it's not another field marker
                const isHeadingMarker = /^\(?\d+\)?\.?$/.test(headingText);
                if (headingText.length > 10 && headingText.length < 500 && !isHeadingMarker) {
                  console.log(`[FIND_QUESTION_TEXT] ✓ Found parent question: "${headingText.substring(0, 80)}"`);
                  return headingText;
                }
              }
            }
          }

          console.log(`[FIND_QUESTION_TEXT] Could not find parent question, using marker as fallback: "${text}"`);
        }

        console.log(`[FIND_QUESTION_TEXT] Found via label[for]: "${text.substring(0, 50)}"`);
        return text;
      }
    }
  }

  // Try aria-label
  if (element.getAttribute('aria-label')) {
    return element.getAttribute('aria-label').trim();
  }

  // Try aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElement = document.getElementById(labelledBy);
    if (labelElement) {
      return labelElement.textContent.trim();
    }
  }

  // Try parent label
  const parentLabel = element.closest('label');
  if (parentLabel) {
    // Get only the label text, not the input value
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll('input, textarea, select');
    inputs.forEach(inp => inp.remove());
    const text = clone.textContent.trim();
    if (text.length > 0 && text.length < 200) {
      return text;
    }
  }

  // Try looking for nearby label in parent container (for Angular forms with mismatched for/id)
  const container = element.closest('.form-group, .question-container, [class*="question"]');
  if (container) {
    const nearbyLabel = container.querySelector('label.form-control-label, label[class*="label"]');
    if (nearbyLabel) {
      const text = nearbyLabel.textContent.trim().replace(/\*$/, '').trim(); // Remove trailing *
      if (text.length > 0 && text.length < 200) {
        console.log(`[FIND_QUESTION_TEXT] Found via nearby label in container: "${text.substring(0, 50)}"`);
        return text;
      }
    }
  }

  // Look for question text by searching up the DOM tree (INCREASED FROM 5 TO 8 LEVELS)
  let currentElement = element;
  for (let level = 0; level < 8; level++) {
    const parent = currentElement.parentElement;
    if (!parent) break;

    // Look for text directly before the input (common pattern)
    let previousElement = currentElement.previousElementSibling;
    while (previousElement) {
      const text = previousElement.textContent.trim();
      // Check if it looks like a question (has question mark, colon, or starts with capital)
      if (text.length > 0 && text.length < 200 &&
          (text.includes('?') || text.endsWith(':') || /^[A-Z]/.test(text))) {
        // Make sure it's not just a number or code-like text
        // Also exclude option labels like "Prefer not to answer", "Don't know any"
        const lowerText = text.toLowerCase();
        const isOptionLabel = lowerText.includes('prefer not to') ||
                             lowerText.includes("don't know") ||
                             lowerText.includes("dont know");

        if (!/^[a-z0-9._-]+$/i.test(text) && !isOptionLabel) {
          console.log(`[FIND_QUESTION_TEXT] Found via previousSibling: "${text.substring(0, 50)}"`);
          return text;
        }
      }
      previousElement = previousElement.previousElementSibling;
    }

    // Look for headings or strong text in parent
    const heading = parent.querySelector('h1, h2, h3, h4, h5, h6, legend, strong, b, .question, .question-text, .MuiTypography-root');
    if (heading) {
      let text = heading.textContent.trim();

      // V5.1.1: Strip zero-width spaces before checking
      const cleanText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

      const lowerText = cleanText.toLowerCase();
      // Exclude option labels
      const isOptionLabel = lowerText.includes('prefer not to') ||
                           lowerText.includes("don't know") ||
                           lowerText.includes("dont know");

      if (cleanText.length > 0 && cleanText.length < 200 && !/^[a-z0-9._-]+$/i.test(cleanText) && !isOptionLabel) {
        console.log(`[FIND_QUESTION_TEXT] Found via heading: "${cleanText.substring(0, 50)}"`);

        // V5.1.1: Record healing - zero-width space stripping worked
        if (text.length > 0 && cleanText.length > 0 && text !== cleanText && window.selfHeal) {
          const platform = window.selfHeal.detectPlatform();
          window.selfHeal.recordHealing(platform, 'zeroWidthSpace', {
            type: 'selector',
            selectors: ['.MuiTypography-root', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'legend']
          });
        }

        return cleanText;
      }
    }

    // Look for divs with class names that suggest question text
    const questionDiv = parent.querySelector('[class*="question"], [class*="title"], [class*="label"]');
    if (questionDiv && questionDiv !== element) {
      const text = questionDiv.textContent.trim();
      const lowerText = text.toLowerCase();
      // Exclude option labels
      const isOptionLabel = lowerText.includes('prefer not to') ||
                           lowerText.includes("don't know") ||
                           lowerText.includes("dont know");

      if (text.length > 0 && text.length < 200 && !/^[a-z0-9._-]+$/i.test(text) && !isOptionLabel) {
        console.log(`[FIND_QUESTION_TEXT] Found via questionDiv: "${text.substring(0, 50)}"`);
        return text;
      }
    }

    // Look for any text in parent that looks like a question
    const allText = parent.textContent.trim();
    // Extract first sentence/line that looks like a question
    const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      if (line.length > 3 && line.length < 200 &&
          (line.includes('?') || /^(What|How|Where|When|Why|Which|Who|Do|Does|Did|Is|Are|Can|Could|Would|Should|Enter|Select|Choose|Please)/i.test(line))) {
        // Make sure it's not field name, code, or option labels
        const lowerLine = line.toLowerCase();
        const isOptionLabel = lowerLine.includes('prefer not to') ||
                             lowerLine.includes("don't know") ||
                             lowerLine.includes("dont know");

        if (!/^[a-z0-9._-]+$/i.test(line) && !line.includes('function') && !line.includes('{') && !isOptionLabel) {
          console.log(`[FIND_QUESTION_TEXT] Found via parent text: "${line.substring(0, 50)}"`);
          return line;
        }
      }
    }

    currentElement = parent;
  }

  // V5.1.1: Last resort - search entire dialog/form container for visible question text
  // This handles Material UI and Angular/IPSOS cases where question text is outside immediate parent
  const fullContainer = element.closest('[role="dialog"], .MuiDialog-root, .MuiFormControl-root, .question, .dialog-question, form');
  if (fullContainer) {
    // Look for MUI Typography or heading elements in the container
    const containerHeading = fullContainer.querySelector('.MuiTypography-root, h1, h2, h3, h4, h5, h6, [role="heading"], legend, label');
    if (containerHeading) {
      let containerText = containerHeading.textContent.trim();

      // Strip zero-width spaces
      containerText = containerText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

      if (containerText && containerText.length > 3 && containerText.length < 500) {
        // Take first line if multi-line
        const firstLine = containerText.split('\n')[0].trim();
        if (firstLine.length > 3) {
          console.log(`[FIND_QUESTION_TEXT] Found via dialog container: "${firstLine.substring(0, 80)}"`);
          return firstLine;
        }
      }
    }
  }

  // Try placeholder as last resort
  if (element.placeholder && element.placeholder.length < 100 && element.placeholder.length > 2) {
    // Make sure placeholder isn't just "Enter" or similar
    if (!/^(enter|type|input|click)/i.test(element.placeholder)) {
      return element.placeholder;
    }
  }

  // Use field name/id only if it doesn't look like a technical identifier
  if (element.name && element.name.length < 50 && !/[0-9._-]{3,}/.test(element.name)) {
    return element.name;
  }

  if (element.id && element.id.length < 50 && !/[0-9._-]{3,}/.test(element.id)) {
    return element.id;
  }

  // Last resort: generic
  return 'Question (please provide answer based on context)';
}

// Normalize question type for Claude API
// Simple hash function for generating deterministic IDs from question text
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

function normalizeQuestionType(type) {
  const typeMap = {
    'text': 'text',
    'email': 'text',
    'tel': 'text',
    'url': 'text',
    'number': 'number',
    'date': 'date',
    'textarea': 'textarea',
    'radio': 'radio',
    'checkbox': 'checkbox',
    'select': 'select',
    'select-one': 'select',
    'select-multiple': 'select',  // FIX: Keep as select, not checkbox
    'range': 'range'
  };

  return typeMap[type] || 'text';
}

// Extract options for radio/checkbox groups
function extractRadioCheckboxOptions(element) {
  const name = element.name;
  if (!name) return [];

  const group = document.querySelectorAll(`input[name="${name}"]`);
  const options = [];

  group.forEach(input => {
    const label = findQuestionText(input);
    const value = input.value || label;

    if (!options.find(opt => opt.value === value)) {
      options.push({
        label: label,
        value: value
      });
    }
  });

  return options;
}

// Extract options from select element
function extractSelectOptions(element) {
  const options = [];
  const optionElements = element.querySelectorAll('option');

  optionElements.forEach(opt => {
    if (opt.value && opt.value !== '') {
      options.push({
        label: opt.textContent.trim(),
        value: opt.value
      });
    }
  });

  return options;
}

// Process survey and send to Claude API
async function processSurvey() {
  showLoading('Scanning page for questions...');

  // Detect questions
  const questions = await detectQuestions();

  if (questions.length > 0) {
    showLoading(`Found ${questions.length} question(s). Sending to Claude AI...`);
  }

  if (questions.length === 0) {
    // Before showing error, check if this is a continue/intro page
    console.log('[SURVEY] No questions detected, checking for continue page...');
    const continueClicked = await handleContinuePage(true); // Force = true (0 questions means we should click continue)

    if (continueClicked) {
      showNotification('Continue button clicked! Waiting for next page...', 'success');
      // Wait for page to load, then auto-process if in auto-fill mode
      await sleep(2000);
      if (autoFillEnabled) {
        await processSurvey();
      }
      return;
    }

    showNotification('No survey questions detected on this page.', 'warning');
    return;
  }

  // Load previous persona if exists
  const storage = await chrome.storage.local.get(['currentPersona', 'lastSurveyUrl']);
  currentPersona = storage.currentPersona || null;
  const lastUrl = storage.lastSurveyUrl || '';

  // Only use previous persona if we're on the same survey (multi-page survey)
  // If URL changed completely, this is a new survey - start fresh
  const currentUrl = window.location.href;
  const isSameSurvey = currentUrl.includes(lastUrl.split('?')[0]) || lastUrl.includes(currentUrl.split('?')[0]);

  if (!isSameSurvey) {
    console.log('[SURVEY] New survey detected - clearing previous persona');
    currentPersona = null;
  }

  // V1.9.33: Fetch images for vision questions before sending to Claude
  const visionQuestions = questions.filter(q => q.hasImageOptions);
  if (visionQuestions.length > 0) {
    showLoading(`Found ${visionQuestions.length} image-based question(s). Fetching images for vision analysis...`);
    console.log(`[VISION] Fetching images for ${visionQuestions.length} vision question(s)...`);

    // Fetch all images for all vision questions
    for (const question of visionQuestions) {
      console.log(`[VISION] Processing question: ${question.question_id}`);
      for (const option of question.options) {
        if (option.hasImage && option.image) {
          const base64 = await fetchImageAsBase64(option.image);
          if (base64) {
            option.imageBase64 = base64;
            console.log(`[VISION] ✓ Image ready for option: ${option.label}`);
          } else {
            console.error(`[VISION] ✗ Failed to fetch image for option: ${option.label}`);
          }
        }
      }
    }
    showLoading(`Images fetched! Sending to Claude Vision API...`);
  }

  // V5.1.0: Guard against empty question text before calling LLM
  for (const q of questions) {
    // Strip invisible characters before checking
    const cleanText = (q.question_text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

    if (!cleanText || cleanText.length < 3) {
      console.warn(`[SKIP] Question ${q.question_id} missing visible text (had: "${q.question_text?.substring(0, 20)}"). Trying DOM fallback...`);
      if (q.element || q.anchorEl) {
        const fallbackText = extractQuestionTextFromContext(q.element || q.anchorEl);
        q.question_text = fallbackText;
        console.log(`[SKIP] Recovered text: "${fallbackText.substring(0, 60)}..."`);
      } else {
        q.question_text = '(no visible question text)';
      }
    } else {
      // Update with cleaned text
      q.question_text = cleanText;
    }

    // Final hard guard - if still missing after all attempts
    const finalClean = (q.question_text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (!finalClean || finalClean.length < 3) {
      console.warn(`[SKIP] Question ${q.question_id} still missing readable text after fallback.`);
      q.question_text = '(missing visible question text)';
    }
  }

  // Prepare data for Claude API
  const surveyData = {
    questions: questions.map(q => ({
      question_id: q.question_id,
      question_text: q.question_text,
      question_type: q.question_type,
      required: q.required,
      options: q.options,
      min: q.min,
      max: q.max,
      maxLength: q.maxLength,  // Character limit for text inputs
      maxAllowed: q.maxAllowed,  // Maximum number of selections allowed
      minRequired: q.minRequired,  // Minimum number of selections required
      isRanking: q.isRanking,  // Whether this is a ranking question
      isNumberMatrix: q.isNumberMatrix,  // Whether this is a number matrix question
      isMatrix: q.isMatrix,  // Whether this is a radio/checkbox matrix (Likert scale grid)
      rows: q.rows,  // For matrix questions: array of {label, question_id, elements}
      columns: q.columns,  // For matrix questions: array of {label, value}
      hasImageOptions: q.hasImageOptions,  // V1.9.33: Flag for vision questions
      sliders: q.sliders ? q.sliders.map(s => ({  // V1.9.96: For Confirmit slider questions (clean serializable data only)
        id: s.id,
        leftLabel: s.leftLabel,
        rightLabel: s.rightLabel,
        minValue: s.minValue,
        maxValue: s.maxValue,
        stepValue: s.stepValue
      })) : undefined
    })),
    previousPersona: currentPersona,
    pageContext: {
      url: currentUrl,
      title: document.title,
      pageText: extractPageContext()
    }
  };

  console.log('[SURVEY] Sending to Claude:', {
    questionCount: surveyData.questions.length,
    questionIds: surveyData.questions.map(q => q.question_id),
    hasPreviousPersona: !!currentPersona,
    url: currentUrl,
    visionQuestions: visionQuestions.length  // V1.9.33: Count of vision questions
  });

  // Debug: Log options for each question
  surveyData.questions.forEach((q, idx) => {
    if (q.question_type === 'confirmit_slider') {
      console.log(`[SURVEY] Q${idx + 1} "${q.question_id}" - ${q.sliders?.length || 0} sliders`);
      console.log(`[SURVEY-DEBUG] Slider data being sent:`, q.sliders);
    } else {
      console.log(`[SURVEY] Q${idx + 1} "${q.question_id}" - ${q.options?.length || 0} options:`, q.options?.map(o => o.label) || []);
    }
  });

  console.log('Sending survey data to Claude API...');
  console.log('Survey data:', surveyData);

  // 🔒 CRITICAL: Set filling lock BEFORE sending API request to prevent race conditions
  // This prevents duplicate detections while waiting for Claude's response
  isFillingQuestions = true;
  console.log('[FILL] 🔒 Filling lock acquired (before API call)');

  // Send to background script for Claude API call
  try {
    // Add timeout to detect if background script doesn't respond
    let responseReceived = false;
    let timeoutWarningShown = false;
    // Show progress updates during long waits
    const timeout60 = setTimeout(() => {
      if (!responseReceived) {
        timeoutWarningShown = true;
        console.warn('[SURVEY] Still waiting for Claude API response after 60 seconds...');
        showLoading(
          '⏳ Still processing (60+ seconds)... Complex survey, Claude AI is thinking deeply. Request is still running.'
        );
      }
    }, 60000); // 60 second timeout

    const timeout120 = setTimeout(() => {
      if (!responseReceived) {
        console.warn('[SURVEY] Still waiting for Claude API response after 120 seconds...');
        showLoading(
          '⏳⏳ Still processing (2+ minutes)... Very complex survey with many questions. Request is still running - please be patient.'
        );
      }
    }, 120000); // 120 second timeout

    chrome.runtime.sendMessage(
      { action: 'analyzeWithClaude', data: surveyData },
      (response) => {
        responseReceived = true;
        clearTimeout(timeout60);
        clearTimeout(timeout120);

        // If timeout warning was shown, let user know it completed
        if (timeoutWarningShown) {
          console.log('[SURVEY] ✓ Response received after timeout warning!');
          showLoading('Response received! Processing answers...');
        }

        // Check for extension context errors
        if (chrome.runtime.lastError) {
          console.error('Runtime error:', chrome.runtime.lastError);
          showNotification(
            'Extension was reloaded. Please refresh this page and try again.',
            'error'
          );
          isFillingQuestions = false; // Release lock on error
          console.log('[FILL] 🔓 Filling lock released (runtime error)');
          return;
        }

        if (!response) {
          console.error('No response from background script');
          showNotification('No response from extension. Please refresh the page.', 'error');
          isFillingQuestions = false; // Release lock on error
          console.log('[FILL] 🔓 Filling lock released (no response)');
          return;
        }

        console.log('Received response from background:', response);

        if (response.error) {
          console.error('API error:', response.error);

          // 🔧 V1.9.94: Automatic rate limit handling (FIXED: use setTimeout instead of await)
          const isRateLimit = response.error.toLowerCase().includes('rate limit');

          if (isRateLimit && autoFillEnabled) {
            console.warn('[RATE-LIMIT] ⚠️ Hit Claude API rate limit - waiting 60 seconds before retry...');
            showNotification('Rate limit hit! Waiting 60 seconds...', 'warning');

            // Release lock first
            isFillingQuestions = false;

            // Use setTimeout instead of await (can't use await in non-async callback)
            setTimeout(() => {
              console.log('[RATE-LIMIT] ✓ 60 seconds elapsed, retrying...');
              showNotification('Retrying survey...', 'info');
              processSurvey(); // Retry
            }, 60000); // 60 seconds
            return; // Exit this handler
          } else {
            showNotification(`Error: ${response.error}`, 'error');
            isFillingQuestions = false; // Release lock on error
            console.log('[FILL] 🔓 Filling lock released (API error)');
          }
        } else if (response.success && response.data) {
          console.log('Successfully received answers, starting to fill...');
          // Note: fillSurveyWithAnswers will release the lock in its finally block
          fillSurveyWithAnswers(response.data);
        } else {
          console.error('Invalid response format:', response);
          showNotification('Invalid response from AI. Please try again.', 'error');
          isFillingQuestions = false; // Release lock on error
          console.log('[FILL] 🔓 Filling lock released (invalid response)');
        }
      }
    );
  } catch (error) {
    console.error('Error sending message:', error);
    showNotification(
      'Extension error. Please refresh this page and try again.',
      'error'
    );
    isFillingQuestions = false; // Release lock on error
    console.log('[FILL] 🔓 Filling lock released (exception)');
  }
}

// Extract page context for better understanding
function extractPageContext() {
  // Get main text content (reduced to 500 chars to save tokens)
  const bodyText = document.body.innerText || '';
  return bodyText.substring(0, 500);
}

// Find and click Continue/Next/Submit button
function clickContinueButton() {
  console.log('Looking for Continue/Next/Submit button...');

  // SPECIAL CASE: Country/language selection pages where the option itself is the navigation
  // Pattern 1: Radio buttons for country, then separate clickable elements for language variants
  // Pattern 2: Pure language selection (English/French/etc.) where radio click auto-submits
  // Solution: Detect if Continue buttons are hidden and language selection just happened
  console.log('[SPECIAL] Checking for country/language selection navigation...');

  // Look for recently checked radio buttons
  const checkedRadios = document.querySelectorAll('input[type="radio"]:checked');

  for (const radio of checkedRadios) {
    const labelText = (radio.labels?.[0]?.textContent || '').toLowerCase().trim();

    console.log(`[SPECIAL] Checking radio with label: "${labelText}"`);

    // Check if this is a language selection
    const isLanguage = labelText.includes('english') || labelText.includes('français') ||
                      labelText.includes('french') || labelText.includes('español') ||
                      labelText.includes('spanish') || labelText.includes('deutsch') ||
                      labelText.includes('german') || labelText.includes('日本語') ||
                      labelText.includes('japanese') || labelText.includes('中文') ||
                      labelText.includes('italiano') || labelText.includes('português');

    // Check if this is a country selection
    const isCountry = labelText.includes('canada') || labelText.includes('united states') ||
                     labelText.includes('australia') || labelText.includes('united kingdom') ||
                     labelText.includes('france') || labelText.includes('germany') ||
                     labelText.includes('mexico') || labelText.includes('brazil');

    if (isLanguage || isCountry) {
      console.log(`[SPECIAL] Detected ${isLanguage ? 'language' : 'country'} selection: "${labelText}"`);

      // Check if the question text mentions language selection
      const questionText = document.body.textContent.toLowerCase();
      const isLanguageQuestion = questionText.includes('which language') ||
                                questionText.includes('quelle langue') ||
                                questionText.includes('idioma') ||
                                questionText.includes('language you would like');

      if (isLanguage && isLanguageQuestion) {
        // This is likely an auto-submit language page
        // Check if there are visible Continue buttons
        const visibleContinueButtons = Array.from(document.querySelectorAll('button, input[type="submit"], a'))
          .filter(btn => {
            const text = (btn.textContent || btn.value || '').toLowerCase();
            const hasText = text.includes('continue') || text.includes('next') || text.includes('submit');
            const isVisible = btn.offsetParent !== null &&
                            window.getComputedStyle(btn).visibility !== 'hidden' &&
                            window.getComputedStyle(btn).display !== 'none';
            return hasText && isVisible;
          });

        if (visibleContinueButtons.length === 0) {
          console.log('[SPECIAL] ✓ Detected auto-submit language selection page (no visible Continue button)');
          console.log('[SPECIAL] The radio selection already triggered navigation, waiting for page to load...');
          return true; // Already navigating, no need to click Continue
        }
      }

      // For country selections, look for clickable elements that combine country + language
      if (isCountry) {
        console.log(`[SPECIAL] Looking for country+language navigation element...`);

        // Now look for clickable elements that combine country + language
        // Examples: "Canada (English)", "Canada (Français)", "United States (English)"
        const allClickables = [
          ...document.querySelectorAll('a'),
          ...document.querySelectorAll('span[class*="country"]'),
          ...document.querySelectorAll('div[class*="country"]'),
          ...document.querySelectorAll('[onclick]'),
          ...document.querySelectorAll('.country-name')
        ];

        for (const clickable of allClickables) {
          const clickText = (clickable.textContent || '').toLowerCase().trim();

          // Check if this clickable element contains the country AND a language
          const containsCountry = clickText.includes(labelText);
          const containsLanguage = clickText.includes('english') || clickText.includes('français') ||
                                  clickText.includes('french') || clickText.includes('español') ||
                                  clickText.includes('deutsch') || clickText.includes('日本語');

          if (containsCountry && containsLanguage) {
            console.log(`[SPECIAL] ✓ Found country+language navigation: "${clickText}"`);
            console.log(`[SPECIAL] Attempting to click: "${clickable.textContent.trim()}"`);

            // Click the element
            clickable.click();
            clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            // Also try clicking parent if this is just text inside a larger clickable
            const clickableParent = clickable.closest('a, button, [onclick], [role="button"]');
            if (clickableParent && clickableParent !== clickable) {
              console.log(`[SPECIAL] Also clicking parent container`);
              clickableParent.click();
              clickableParent.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }

            return true;
          }
        }

        console.log(`[SPECIAL] Country detected but no matching language element found`);
      }
    }
  }

  console.log('[SPECIAL] No country/language selection navigation detected, proceeding with standard button search...');

  // Common button text patterns (case-insensitive)
  const buttonTexts = [
    'yes', // Privacy consent / agreement pages
    'continue',
    'next',
    'submit',
    'proceed',
    'accept', // Accept privacy policy / consent buttons
    'confirm', // Confirm selections / answers
    'go',
    'forward',
    'start', // Start button at beginning of surveys
    'start survey',
    'begin',
    'siguiente', // Spanish
    'continuar', // Spanish
    'suivant', // French
    'weiter', // German
    'nextpage', // Common in forms
    'vorwärts', // German forward
    '→', // Arrow symbols (Unicode)
    '➜',
    '⇒',
    '➔',
    '➞',
    '➡',
    '»',
    '>>'
  ];

  // Find all clickable elements (including divs/spans that might be buttons)
  const allButtons = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('input[type="button"]'),
    ...document.querySelectorAll('input[type="submit"]'),
    ...document.querySelectorAll('input[type="image"]'), // Image buttons!
    ...document.querySelectorAll('a'),
    ...document.querySelectorAll('[role="button"]'),
    ...document.querySelectorAll('[onclick]'),
    ...document.querySelectorAll('.btn'),
    ...document.querySelectorAll('.button'),
    // Clickable divs/spans (common in React apps)
    ...document.querySelectorAll('div[onclick]'),
    ...document.querySelectorAll('span[onclick]'),
    // Elements with cursor:pointer (often clickable buttons)
    ...Array.from(document.querySelectorAll('div, span')).filter(el => {
      const style = window.getComputedStyle(el);
      const hasCursorPointer = style.cursor === 'pointer';
      const hasFontAwesome = style.fontFamily && style.fontFamily.toLowerCase().includes('fontawesome');
      const isShort = el.textContent.trim().length <= 50;
      // Include if: cursor pointer + short text, OR FontAwesome font (icon buttons)
      return (hasCursorPointer && isShort) || hasFontAwesome;
    })
  ];

  console.log(`Found ${allButtons.length} potential buttons`);

  let candidateButtons = [];

  // Look for button with matching text
  for (const button of allButtons) {
    // Log ALL buttons first (before skipping)
    const buttonText = (button.textContent || button.value || button.title || '').toLowerCase().trim();
    const buttonId = (button.id || '').toLowerCase();
    const buttonClass = (button.className || '').toLowerCase();
    const buttonName = (button.name || '').toLowerCase();
    const buttonSrc = (button.src || '').toLowerCase(); // For image buttons
    const buttonAlt = (button.alt || '').toLowerCase(); // Alt text for images

    console.log(`[BTN] Found: text="${buttonText.substring(0, 50)}" id="${buttonId}" class="${buttonClass.substring(0, 80)}"`);

    // Skip our own wildpoptart button!
    if (button.id === 'wildpoptart-btn' || button.classList.contains('wildpoptart-floating-btn')) {
      console.log(`[BTN] ↳ Skipping wildpoptart button`);
      continue;
    }

    // 🚨 CRITICAL: Skip buttons inside modals (like "Report this question" popup)
    let isInModal = false;
    let parent = button.parentElement;
    while (parent) {
      const parentClass = (parent.className || '').toLowerCase();
      const parentId = (parent.id || '').toLowerCase();
      if (parentClass.includes('modal') || parentId.includes('modal')) {
        isInModal = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (isInModal) {
      console.log(`[BTN] ↳ 🚫 SKIPPING MODAL BUTTON: "${buttonText}"`);
      continue;
    }

    // 🚨 CRITICAL: NEVER EVER click Back/Previous/Cancel buttons!
    const isBackButton = /\b(back|previous|cancel|return|go back|volver|retour|zurück|voltar|indietro)\b/i.test(buttonText) ||
                         /\b(back|previous|cancel|return)\b/i.test(buttonId) ||
                         /\b(back|previous|cancel|return)\b/i.test(buttonClass);
    if (isBackButton) {
      console.log(`[BTN] ↳ 🚫 SKIPPING BACK BUTTON: "${buttonText}"`);
      continue;
    }

    // Check if button text/attributes match
    for (const pattern of buttonTexts) {
      if (buttonText.includes(pattern) ||
          buttonId.includes(pattern) ||
          buttonClass.includes(pattern) ||
          buttonName.includes(pattern) ||
          buttonSrc.includes(pattern) ||    // Check src attribute (for image buttons)
          buttonAlt.includes(pattern)) {     // Check alt text

        console.log(`✓ Potential Continue button: "${buttonText}" (matched pattern: "${pattern}")`);

        // Check visibility and adjust score
        let score = calculateButtonScore(button, buttonText, pattern);
        const computedStyle = window.getComputedStyle(button);
        const isVisible = button.offsetParent !== null &&
                         computedStyle.display !== 'none' &&
                         computedStyle.visibility !== 'hidden';

        // 🚨 CRITICAL: Detect if "yes"/"no" buttons are answer options, not navigation
        // This prevents clicking answer options when Next button is disabled
        if (pattern === 'yes' || buttonText.toLowerCase().trim() === 'no') {
          // Check if this looks like an answer option button:
          // 1. Has a sibling "yes"/"no" button nearby (answer pair)
          // 2. Is inside a question container
          // 3. There are unanswered questions on the page

          const parent = button.closest('div, form, fieldset');
          if (parent) {
            // Look for sibling yes/no buttons
            const siblingButtons = parent.querySelectorAll('button, input[type="button"], [role="button"]');
            let hasYesNoSibling = false;

            for (const sibling of siblingButtons) {
              if (sibling === button) continue;
              const siblingText = (sibling.textContent || sibling.value || '').toLowerCase().trim();
              if (siblingText === 'yes' || siblingText === 'no') {
                hasYesNoSibling = true;
                break;
              }
            }

            // Check if there are unanswered questions (radio/checkbox without checked)
            const unansweredRadios = document.querySelectorAll('input[type="radio"]:not(:checked)');
            const hasUnansweredQuestions = unansweredRadios.length > 0;

            if (hasYesNoSibling && hasUnansweredQuestions) {
              console.log(`[SCORE] ⚠️ "${buttonText}" appears to be an answer option (has yes/no sibling + unanswered questions)`);
              score = Math.floor(score / 10); // Drastically reduce score
              console.log(`[SCORE] Reduced score from ${score * 10} to ${score} for answer option button`);
            }
          }
        }

        // If button is NOT visible, divide score by 10
        if (!isVisible) {
          score = Math.floor(score / 10);
          console.log(`[SCORE] Button "${buttonText}" is HIDDEN - score reduced from ${score * 10} to ${score}`);
        }

        candidateButtons.push({
          element: button,
          text: buttonText || buttonAlt || 'image button',
          score: score,
          isVisible: isVisible
        });
      }
    }
  }

  // ALWAYS check for icon-only navigation buttons (FontAwesome, SVG arrows, submit buttons)
  // These might have empty text but are the actual form submit buttons
  console.log('[CONTINUE] Checking for icon-only/SVG navigation buttons...');

  for (const button of allButtons) {
    // Skip our own wildpoptart button!
    if (button.id === 'wildpoptart-btn' || button.classList.contains('wildpoptart-floating-btn')) {
      continue;
    }

    const buttonText = (button.textContent || '').trim();
    const buttonId = (button.id || '').toLowerCase();
    const buttonClass = (button.className || '').toLowerCase();

    // Skip carousel navigation buttons (swiper, slick, etc.)
    if (buttonClass.includes('swiper-button') || buttonClass.includes('slick-arrow') ||
        buttonClass.includes('carousel-control')) {
      continue;
    }

    // Skip buttons inside modals
    let isInModal = false;
    let parent = button.parentElement;
    while (parent) {
      const parentClass = (parent.className || '').toLowerCase();
      const parentId = (parent.id || '').toLowerCase();
      if (parentClass.includes('modal') || parentId.includes('modal')) {
        isInModal = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (isInModal) {
      continue;
    }
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();

    // Check inline style for FontAwesome
    const inlineStyle = button.getAttribute('style') || '';
    const hasFontAwesomeStyle = inlineStyle.toLowerCase().includes('fontawesome');

    // Check if element is visible and positioned like a next button (right side of page)
    const rect = button.getBoundingClientRect();
    const isOnRightSide = rect.right > window.innerWidth * 0.6; // Right 40% of screen
    const isVisible = rect.width > 0 && rect.height > 0;

    // Check for submit button and SVG icons (like Feather icons)
    const isSubmitButton = button.type === 'submit';
    const hasSVG = button.querySelector('svg') !== null;

    // Check for child <i> tags with arrow-related class names
    const childIcons = button.querySelectorAll('i');
    let hasArrowIcon = false;
    for (const icon of childIcons) {
      const iconClass = (icon.className || '').toLowerCase();
      if (iconClass.includes('arrow') || iconClass.includes('next') || iconClass.includes('forward') ||
          iconClass.includes('chevron') || iconClass.includes('right')) {
        hasArrowIcon = true;
        break;
      }
    }

    const isNavClass = buttonClass.includes('btn-blue') || buttonClass.includes('btn-primary') || buttonClass.includes('btn-green');
    const isFormSubmitId = buttonId.includes('submitquestion') || buttonId.includes('submit_question') || buttonId.includes('next_button');

    console.log(`[ICON_CHECK] text="${buttonText}" id="${buttonId}" class="${buttonClass.substring(0, 50)}" submit=${isSubmitButton} svg=${hasSVG} arrowIcon=${hasArrowIcon} formId=${isFormSubmitId}`);

    // Check if it's likely a navigation button:
    // 1. FontAwesome class OR inline FontAwesome style OR SVG icon OR arrow icon
    // 2. Very short text (just an icon character) or empty
    // 3. aria-label suggests navigation
    // 4. Positioned on right side (typical for next buttons)
    // 5. Submit button type (strong signal for form progression)
    const isFontAwesome = buttonClass.includes('fontawesome') || buttonClass.includes('fa-') || buttonClass.includes('icon') || hasFontAwesomeStyle;
    const isIconButton = isFontAwesome || hasSVG || hasArrowIcon;
    const isShortIcon = buttonText.length <= 2; // Icons are typically 0-2 chars
    const hasNavLabel = ariaLabel.includes('next') || ariaLabel.includes('continue') ||
                        ariaLabel.includes('forward') || ariaLabel.includes('proceed');

    // Be more aggressive: if it's on the right side, short text, and visible, it's probably a next button
    // Also detect submit buttons with SVG/arrow icons (common in modern surveys)
    // HIGHEST PRIORITY: Buttons with IDs like "submitquestion1" (main form submit buttons)
    if (isVisible && (isFormSubmitId || (isIconButton && isShortIcon) || hasNavLabel || (isShortIcon && isOnRightSide) || (isSubmitButton && isShortIcon) || (isSubmitButton && hasSVG && isNavClass) || (isSubmitButton && hasArrowIcon))) {
      console.log(`[CONTINUE] ✓ Found icon-only nav button: text="${buttonText}" id="${buttonId}" class="${buttonClass.substring(0, 50)}" submit=${isSubmitButton} svg=${hasSVG} arrowIcon=${hasArrowIcon} formId=${isFormSubmitId}`);

      // For FontAwesome icons, try clicking the parent element (it might be the actual clickable area)
      const elementToClick = (isFontAwesome && button.parentElement) ? button.parentElement : button;

      // Calculate score (higher is better)
      let score = 70;
      if (isFormSubmitId && isSubmitButton) score = 200; // Highest priority - form submit button with proper ID
      else if (isFormSubmitId) score = 195; // Very high - proper form submit ID
      else if (isSubmitButton && hasArrowIcon) score = 99; // Submit button with arrow icon (like <i class="long-arrow">)
      else if (isSubmitButton && hasSVG && isNavClass) score = 98; // Submit button with SVG and nav class
      else if (isSubmitButton && hasSVG) score = 95; // Submit button with SVG icon
      else if (hasNavLabel) score = 90;
      else if (isSubmitButton && isShortIcon) score = 88;
      else if (isOnRightSide && isShortIcon) score = 85;
      else if (isFontAwesome) score = 80;

      // 🚨 CRITICAL: Check visibility and heavily penalize hidden buttons
      const computedStyle = window.getComputedStyle(elementToClick);
      const isVisible = elementToClick.offsetParent !== null &&
                       computedStyle.display !== 'none' &&
                       computedStyle.visibility !== 'hidden';

      // If button is NOT visible, divide score by 10 (so visible buttons are strongly preferred)
      if (!isVisible) {
        score = Math.floor(score / 10);
        console.log(`[SCORE] Button "${buttonText}" is HIDDEN - score reduced from ${score * 10} to ${score}`);
      }

      candidateButtons.push({
        element: elementToClick,
        text: buttonText || ariaLabel || 'submit button',
        score: score,
        isVisible: isVisible
      });
    }
  }

  // Sort by score (higher is better)
  candidateButtons.sort((a, b) => b.score - a.score);

  // Try to click the best candidate
  for (const candidate of candidateButtons) {
    const button = candidate.element;

    console.log(`Trying to click: "${candidate.text}" (score: ${candidate.score}, visible: ${candidate.isVisible})`);

    // Check if enabled
    const isEnabled = !button.disabled && !button.hasAttribute('disabled');

    console.log(`  Visible: ${candidate.isVisible}, Enabled: ${isEnabled}`);

    // ONLY click visible buttons (hidden buttons had their scores reduced, so we shouldn't get here)
    if (candidate.isVisible && isEnabled) {
      console.log('✓ Clicking visible button!');

      // Try multiple click methods
      button.click();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // V1.9.17: Removed inline script injection (blocked by CSP)
      // Angular ng-click will be triggered by standard click events + wait time
      if (button.hasAttribute('ng-click')) {
        console.log('  ↳ Detected Angular ng-click button (will handle via click events)');
      }

      // Also try triggering submit if it's in a form
      const form = button.closest('form');
      if (form) {
        console.log('  Also dispatching submit event on form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }

      return true;
    } else {
      console.log('  Skipping (not clickable)');
    }
  }

  // FALLBACK: If no button found, try to find ANY visible button on the right side of the page
  // This is common for survey Next buttons that might not match our text patterns
  console.log('[FALLBACK] No standard Continue button found, checking for right-aligned buttons...');

  // V1.9.51: Also check for navigation divs (some surveys use divs with onclick for navigation)
  const navDivs = document.querySelectorAll('#rightNav, #innerRightNav, [class*="rightNav"], [class*="right-nav"], [class*="next-nav"]');

  const allVisibleButtons = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('input[type="button"]'),
    ...document.querySelectorAll('input[type="submit"]'),
    ...document.querySelectorAll('input[type="image"]'),
    ...navDivs  // V1.9.51: Include navigation divs
  ];

  for (const button of allVisibleButtons) {
    // Skip our wildpoptart button
    if (button.id === 'wildpoptart-btn' || button.classList.contains('wildpoptart-floating-btn')) {
      continue;
    }

    const rect = button.getBoundingClientRect();
    const isOnRightSide = rect.right > window.innerWidth * 0.5; // Right half of screen
    const isVisible = rect.width > 0 && rect.height > 0 && button.offsetParent !== null;
    const isEnabled = !button.disabled && !button.hasAttribute('disabled');

    if (isVisible && isEnabled && isOnRightSide) {
      const buttonText = (button.textContent || button.value || button.alt || '').trim();

      // 🚨 CRITICAL: NEVER click "Back", "Previous", "Cancel" buttons!
      const isBackButton = /\b(back|previous|cancel|return|go back|volver|retour|zurück|voltar|indietro)\b/i.test(buttonText);
      if (isBackButton) {
        console.log(`[FALLBACK] ⚠️ Skipping "${buttonText}" button (back navigation)`);
        continue;
      }

      console.log(`[FALLBACK] Found right-aligned button: "${buttonText}" - attempting click`);

      button.click();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Also try form submit
      const form = button.closest('form');
      if (form) {
        console.log('[FALLBACK] Also dispatching submit event on form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }

      return true;
    }
  }

  console.log('No clickable Continue button found');
  return false;
}

// Calculate button relevance score
function calculateButtonScore(button, text, pattern) {
  let score = 0;

  // Exact match = highest score
  if (text === pattern) score += 100;

  // Text starts with pattern = high score
  if (text.startsWith(pattern)) score += 50;

  // Text contains pattern = medium score
  if (text.includes(pattern)) score += 25;

  // Button is a submit type = bonus
  if (button.type === 'submit') score += 20;

  // Button is in a form = bonus
  if (button.closest('form')) score += 10;

  // Button has primary/action class = bonus
  const classes = button.className.toLowerCase();
  if (classes.includes('primary') || classes.includes('action') || classes.includes('submit')) {
    score += 15;
  }

  // Penalize if text is very long (probably not a submit button)
  if (text.length > 30) score -= 20;

  return score;
}

// Fill survey with Claude's answers
async function fillSurveyWithAnswers(response) {
  // Note: isFillingQuestions lock is already acquired in processSurvey() before API call
  // This prevents race conditions where multiple detections happen while waiting for response

  try {
  showLoading('Filling survey...');

  console.log('Claude response:', response);

  const { persona, answers} = response;

  console.log('Full answers array:', JSON.stringify(answers, null, 2));

  // Show what Claude answered for debugging
  let answersDebug = `Claude's Answers:\n`;
  answers.forEach((a, idx) => {
    let answerText;
    if (a.row_answers) {
      // Matrix question - show count of rows
      answerText = `${a.row_answers.length} rows filled`;
    } else {
      answerText = typeof a.answer === 'string' ? a.answer : JSON.stringify(a.answer);
    }
    // Safety: ensure answerText is always a string
    answerText = String(answerText || 'no answer');
    answersDebug += `${idx + 1}. Q: "${a.question_text?.substring(0, 40) || 'unknown'}"\n   A: "${answerText.substring(0, 40)}"\n`;
  });
  showNotification(answersDebug, 'info');

  // Store persona for consistency
  currentPersona = persona;
  await chrome.storage.local.set({
    currentPersona: persona,
    lastSurveyUrl: window.location.href
  });

  console.log(`Attempting to fill ${answers.length} answers`);
  console.log('Detected questions IDs:', detectedQuestions.map(q => q.question_id));
  console.log('Answer IDs from Claude:', answers.map(a => a.question_id));

  // Log first answer as example
  if (answers.length > 0) {
    console.log('Example answer structure:', answers[0]);
  }

  // VALIDATE MOST/LEAST QUESTIONS: Ensure same option isn't selected for both
  const mostLeastQuestions = answers.filter(a =>
    a.question_text && (a.question_text.toLowerCase().includes('most likely') ||
                       a.question_text.toLowerCase().includes('least likely'))
  );

  if (mostLeastQuestions.length === 2) {
    const mostQ = mostLeastQuestions.find(q => q.question_text.toLowerCase().includes('most likely'));
    const leastQ = mostLeastQuestions.find(q => q.question_text.toLowerCase().includes('least likely'));

    if (mostQ && leastQ && mostQ.answer === leastQ.answer) {
      console.error('❌ VALIDATION FAILED: Same answer selected for Most and Least likely!');
      console.error(`Most likely: "${mostQ.answer}"`);
      console.error(`Least likely: "${leastQ.answer}"`);
      showNotification('ERROR: Most/Least validation failed - same answer selected for both. Stopping.', 'error');
      hideLoading();
      return;
    } else if (mostQ && leastQ) {
      console.log('✓ Most/Least validation passed - different answers selected');
    }
  }

  let filledCount = 0;

  // Fill each answer
  for (const answer of answers) {
    // V1.9.63: Try exact match first, then check for merged question IDs
    let question = detectedQuestions.find(q => q.question_id === answer.question_id);

    // If not found, check if this ID is part of a merged question (pipe-separated IDs)
    if (!question) {
      question = detectedQuestions.find(q => {
        // Check if the question ID contains the answer ID as part of a merged ID
        // Example: "answer-q120-1" should match "answer-q120-12|answer-q120-3|answer-q120-1|..."
        const ids = q.question_id.split('|');
        return ids.includes(answer.question_id);
      });

      if (question) {
        console.log(`[MERGED] Matched "${answer.question_id}" to merged question "${question.question_id}"`);
      }
    }

    if (!question) {
      console.warn(`❌ Question ${answer.question_id} not found in detectedQuestions`);
      console.warn('Available question IDs:', detectedQuestions.map(q => q.question_id));
      console.warn('Claude tried to answer:', answer);
      continue;
    }

    console.log(`✓ Filling question "${answer.question_id}" (${question.question_type}): "${question.question_text.substring(0, 40)}" with answer:`, answer.answer);

    // V5.1.0: Use self-correcting repair loop
    const fillSuccess = await attemptFillWithRepair(question, answer);

    if (fillSuccess) {
      filledCount++;
    } else {
      console.warn(`❌ Failed to fill question "${answer.question_id}" after repair attempts`);
    }

    // Add random delay between questions (but not after the last one)
    const isLastQuestion = filledCount === answers.length;
    if (!isLastQuestion) {
      const delay = 3000 + Math.random() * 1000; // Random between 3000-4000ms
      console.log(`[DELAY] Waiting ${Math.round(delay)}ms before next question...`);
      await sleep(delay);
    }
  }

  console.log(`Successfully filled ${filledCount} out of ${answers.length} answers`);

  // Check if this was a Quest Mindshare survey (one question at a time)
  const isQuestMindshare = detectedQuestions.some(q => q.isQuestMindshare);

  if (isQuestMindshare) {
    console.log('[QUEST] Checking for next question...');
    await sleep(1000); // Wait for next question to appear

    // Check if there's a continue button to click
    const continueClicked = await handleContinuePage();
    if (continueClicked) {
      console.log('[QUEST] Continue button clicked, waiting for next page...');
      await sleep(2000); // Wait for next page to load
      await processSurvey(); // Continue processing
      return;
    }

    // Re-detect questions to see if a new one appeared
    const newQuestions = await detectQuestions();
    if (newQuestions.length > 0) {
      // Check if we just failed to answer this same question (infinite loop prevention)
      const newQuestionText = newQuestions[0].question_text;
      const lastQuestionText = detectedQuestions[0]?.question_text;

      if (newQuestionText === lastQuestionText && filledCount === 0) {
        console.error('[QUEST] Failed to answer question, stopping retry loop');
        showNotification(`Could not answer question: "${newQuestionText}". Please answer manually.`, 'error');
        return;
      }

      console.log(`[QUEST] Found ${newQuestions.length} new question(s), continuing auto-fill...`);
      // Automatically process the new question
      await processSurvey();
      return; // Don't show completion message yet
    } else {
      console.log('[QUEST] No more questions detected, survey complete');
    }
  }

  // 🚨 CRITICAL: Check for locale/language selector pages
  // These pages show the Continue button ONLY AFTER you select an option
  const pageText = document.body.innerText;
  const isCountrySelector = pageText.includes('Area/Region Selection');
  const isLanguageSelector = pageText.includes('Language Selection');
  const isLocaleSelector = document.querySelector('#profiler-choice.locale-selector') ||
                           document.querySelector('.locale-card') ||
                           isCountrySelector || isLanguageSelector;

  if (isCountrySelector) {
    // Country pages auto-navigate when you select - NO button click needed
    console.log('[LOCALE] 🌍 Country selected - waiting for auto-navigation to language page...');
    showNotification(`Country selected! Waiting for language selection...`, 'success');

    if (autoFillEnabled) {
      await sleep(3000); // Wait for page to auto-navigate
      await autoFillSurvey(); // Process language page
    }
    return;
  }

  if (isLanguageSelector || isLocaleSelector) {
    // Language pages show Continue button AFTER selection - poll until it appears (up to 5 seconds)
    console.log('[LOCALE] 🌍 Language selector detected - polling for Continue button...');

    let continueButtonFound = false;
    for (let i = 0; i < 10; i++) { // Check 10 times (5 seconds total)
      await sleep(500);

      // Check if Continue button exists now
      const continueBtn = document.querySelector('button.btn-primary') ||
                         document.querySelector('button:not(.btn-dark)') ||
                         Array.from(document.querySelectorAll('button')).find(btn =>
                           btn.textContent.toLowerCase().trim() === 'continue'
                         );

      if (continueBtn) {
        console.log(`[LOCALE] ✓ Continue button appeared after ${(i + 1) * 0.5}s - CLICKING NOW!`);

        // 🚨 CRITICAL: Click it IMMEDIATELY before it disappears!
        continueBtn.click();
        continueBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        console.log('[LOCALE] ✓ Clicked Continue button directly from polling');

        if (autoFillEnabled) {
          await sleep(3000); // Wait for page transition
          await autoFillSurvey(); // Process next page
        }

        return; // EXIT - don't call clickContinueButton()
      }
    }

    if (!continueButtonFound) {
      console.log('[LOCALE] ⚠️ Continue button never appeared after 5s');
    }
  } else {
    // Normal pages - short wait before clicking
    // V1.9.16: Longer wait for Angular forms to complete digest cycle and update validation
    const isAngularPage = document.querySelector('[ng-app], [ng-controller]') ||
                         document.body.innerHTML.includes('ng-');

    // V1.9.77: Extra time for IPSOS to validate after rowpicker clicks
    const hasIPSOSRowpicker = document.querySelector('[tabindex="0"]') &&
                              window.getComputedStyle(document.querySelector('[tabindex="0"]') || document.body).cursor === 'pointer';

    if (isAngularPage && hasIPSOSRowpicker) {
      console.log('[ANGULAR+IPSOS] Detected Angular + IPSOS rowpicker, waiting 2.5s for validation to complete');
      await sleep(2500);
    } else if (isAngularPage) {
      console.log('[ANGULAR] Detected Angular page, waiting 1.5s for digest cycle to complete');
      await sleep(1500);
    } else {
      await sleep(500);
    }
  }

  // Auto-click continue/submit button
  console.log('[NEXT_BTN] Attempting to click Next button after filling...');
  const clicked = clickContinueButton();

  if (clicked) {
    console.log('[NEXT_BTN] ✓ Successfully clicked Next button');
    showNotification(`Survey filled with ${filledCount} answers! Continuing...`, 'success');

    // If auto-fill is enabled, wait for next page and continue automatically
    if (autoFillEnabled) {
      console.log('[AUTO-FILL] Continue clicked, waiting for next page...');

      // 🔧 V1.9.93: Smarter page transition detection instead of fixed 5-second wait
      const currentUrl = window.location.href;
      const currentTitle = document.title;
      let transitionDetected = false;

      // Poll for page change (URL or title change indicates new page)
      for (let i = 0; i < 50; i++) { // Max 10 seconds (50 x 200ms)
        await sleep(200);

        if (window.location.href !== currentUrl || document.title !== currentTitle) {
          console.log(`[AUTO-FILL] ✓ Page transition detected after ${(i+1)*0.2}s`);
          transitionDetected = true;
          await sleep(1000); // Wait 1 more second for page to fully load
          break;
        }
      }

      if (!transitionDetected) {
        console.log('[AUTO-FILL] ⚠️ No page transition detected after 10s, checking for new questions anyway...');
        await sleep(1000);
      }

      await autoFillSurvey(); // Process next page
    } else {
      // Manual mode - also add delay to let page transition complete
      await sleep(2000);
    }
  } else {
    console.log('[NEXT_BTN] ❌ Failed to find/click Next button');

    // 🔧 V1.9.93: In auto-fill mode, try harder to find the Next button
    if (autoFillEnabled) {
      console.log('[AUTO-FILL] Retrying Next button click in 2 seconds...');
      await sleep(2000);

      // Try clicking again (button might have appeared after validation)
      const retryClicked = clickContinueButton();
      if (retryClicked) {
        console.log('[AUTO-FILL] ✓ Retry successful! Waiting for next page...');
        await sleep(3000);
        await autoFillSurvey();
      } else {
        console.log('[AUTO-FILL] ⚠️ Retry failed - manual click required');
        showNotification(`Survey filled! Please click Next button manually.`, 'warning');
      }
    } else {
      showNotification(`Survey filled with ${filledCount} answers! Click Continue to proceed.`, 'success');
    }
  }
  } finally {
    isFillingQuestions = false;  // Release the filling lock
    console.log('[FILL] Filling lock released');
  }
}

// Save question to database
async function saveQuestionToDatabase(question, answer) {
  try {
    // Create lightweight question record
    const questionRecord = {
      timestamp: Date.now(),
      question_text: question.question_text,
      question_type: question.question_type,
      options: question.options ? question.options.map(o => o.label || o.value) : [],
      answer_given: Array.isArray(answer.answer) ? answer.answer : [answer.answer],
      url: window.location.href
    };

    // Add to current session
    currentSurveySession.questions.push(questionRecord);

    // Save to Chrome storage
    const storageKey = 'wildpoptart_question_db';
    const result = await chrome.storage.local.get([storageKey]);
    const database = result[storageKey] || [];

    // Add question to database
    database.push(questionRecord);

    // Keep only last 500 questions (prevent storage overflow)
    const trimmedDb = database.slice(-500);

    await chrome.storage.local.set({ [storageKey]: trimmedDb });

    console.log(`[DB] Question saved. Total questions in DB: ${trimmedDb.length}`);

    // Track that we've answered this question in this session
    answeredQuestionIds.add(question.question_id);
    console.log(`[SESSION] Added question_id "${question.question_id}" to answered set. Total answered: ${answeredQuestionIds.size}`);
  } catch (error) {
    console.error('[DB] Error saving question:', error);
  }
}

// Export database as JSON
async function exportQuestionDatabase() {
  const storageKey = 'wildpoptart_question_db';
  const result = await chrome.storage.local.get([storageKey]);
  const database = result[storageKey] || [];

  const dataStr = JSON.stringify(database, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `wildpoptart_questions_${Date.now()}.json`;
  a.click();

  console.log(`[DB] Exported ${database.length} questions`);
}

// Capture debug snapshot (screenshot + HTML + logs)
async function captureDebugSnapshot() {
  try {
    console.log('[DEBUG SNAPSHOT] Collecting debug information...');

    // Collect HTML
    const html = document.documentElement ? document.documentElement.outerHTML : '<html><body>Unable to capture HTML</body></html>';
    console.log('[DEBUG SNAPSHOT] HTML collected:', html.length, 'characters');

    // Collect logs
    const logs = (debugLogs || []).map(log => {
      const time = new Date(log.timestamp).toISOString();
      return `[${time}] [${log.type.toUpperCase()}] ${log.message}`;
    }).join('\n');
    console.log('[DEBUG SNAPSHOT] Logs collected:', debugLogs.length, 'entries');

    // Collect current questions detected
    const questionsJson = JSON.stringify(detectedQuestions || [], null, 2);
    console.log('[DEBUG SNAPSHOT] Questions collected:', (detectedQuestions || []).length, 'questions');

    // Request screenshot from background script
    let screenshotDataUrl = null;
    try {
      console.log('[DEBUG SNAPSHOT] Requesting screenshot from background...');
      const response = await chrome.runtime.sendMessage({ action: 'captureScreenshot' });
      screenshotDataUrl = response?.screenshot || null;
      console.log('[DEBUG SNAPSHOT] Screenshot received:', screenshotDataUrl ? 'yes' : 'no');
    } catch (error) {
      console.error('[DEBUG SNAPSHOT] Failed to capture screenshot:', error);
    }

    // Package everything into a single JSON file
    const debugData = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      hasAnswered: debugLogs.some(log => log.message.includes('fillQuestion called')),
      screenshot: screenshotDataUrl,
      html: html,
      logs: logs,
      detectedQuestions: questionsJson,
      metadata: {
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      }
    };

    // Download as JSON file
    console.log('[DEBUG SNAPSHOT] Creating download...');
    const dataStr = JSON.stringify(debugData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `wildpoptart_debug_${Date.now()}.json`;
    a.click();

    console.log('[DEBUG SNAPSHOT] Debug snapshot saved!');
    console.log(`  - ${debugLogs.length} log entries`);
    console.log(`  - ${detectedQuestions.length} questions detected`);
    console.log(`  - Screenshot: ${screenshotDataUrl ? 'captured' : 'failed'}`);
  } catch (error) {
    console.error('[DEBUG SNAPSHOT] Fatal error:', error);
    throw error; // Re-throw to be caught by the message handler
  }
}

// Fill individual question
async function fillQuestion(question, answer) {
  // 🧠 LEVEL 5: META-LEARNING - Detect platform and apply learned rules
  const platform = window.selfHeal?.detectPlatform() || 'unknown';
  const questionType = question.question_type;

  console.log(`[META-LEARNING] Filling ${platform}.${questionType} question: ${question.question_id}`);

  // Get auto-tuned parameters for this platform/question type
  const tunedParams = getAutoTunedParams(platform, questionType);
  console.log(`[META-LEARNING] Using tuned params: wait=${tunedParams.waitTime}ms, fuzzy=${tunedParams.fuzzyThreshold.toFixed(2)}`);

  // Check for learned label normalization rules
  const labelRules = findMatchingHeuristics(platform, questionType, 'labelNormalization');
  if (labelRules.length > 0) {
    console.log(`[LEARNED_RULE_APPLIED] Found ${labelRules.length} label normalization rule(s) for ${platform}.${questionType}`);
    for (const rule of labelRules) {
      console.log(`[LEARNED_RULE_APPLIED]   ${rule.ruleType}: ${JSON.stringify(rule.rule)} (confidence: ${(rule.confidence * 100).toFixed(1)}%)`);
    }
  }

  // Track fill attempt (will be updated with success/failure at the end)
  const fillAttemptStart = Date.now();
  let fillSuccess = false;

  // For label-radio type, elements are stored differently
  const element = question.question_type === 'label-radio' ? null : question.element;
  const type = question.question_type;

  console.log(`fillQuestion called for ${question.question_id}, type: ${type}`);

  // Handle matrix questions (Likert scale grids and checkbox grids)
  if (question.isMatrix && answer.row_answers) {
    const isCheckboxMatrix = question.question_type === 'checkbox_matrix';
    console.log(`[MATRIX] Filling ${isCheckboxMatrix ? 'checkbox' : 'radio'} matrix question with ${answer.row_answers.length} rows`);
    console.log(`[MATRIX] Available columns:`, question.columns.map(c => c.label));

    // 🔧 V1.9.83: IPSOS CAROUSEL MATRIX DETECTION
    // Check if this is an IPSOS carousel-style matrix where only one row is visible at a time
    const progressIndicator = document.querySelector('[class*="prog-progress-bar"], .prog-indicator, [class*="progress-bar-item"]');
    const carouselContainer = document.querySelector('.prog-the-answer-container[role="radio"], div[role="radio"], [role="radio"].prog-the-answer-container');
    const isIPSOSCarouselMatrix = !isCheckboxMatrix && progressIndicator && carouselContainer;

    // 🔧 V1.9.98: CAROUSELAPP MATRIX DETECTION (Research Now / mx-carouselapp)
    // Check for mx-carouselapp carousel (shows items in carousel, scale options below)
    const mxCarouselContainer = document.querySelector('.mx-carouselapp-container, .mx-carousel');
    const mxProgressIndicator = document.querySelector('.swiper-progress-current');
    const mxScaleHolder = document.querySelector('.mx-carouselapp-scaleholder-inner');
    const isCarouselAppMatrix = !isCheckboxMatrix && mxCarouselContainer && mxProgressIndicator && mxScaleHolder;

    console.log(`[CAROUSEL-DETECT] Checking for IPSOS carousel matrix...`);
    console.log(`[CAROUSEL-DETECT] Progress indicator found: ${!!progressIndicator}`);
    console.log(`[CAROUSEL-DETECT] Carousel container found: ${!!carouselContainer}`);
    console.log(`[CAROUSEL-DETECT] Is checkbox matrix: ${isCheckboxMatrix}`);
    console.log(`[CAROUSEL-DETECT] IPSOS result: ${isIPSOSCarouselMatrix}`);
    console.log(`[CAROUSEL-DETECT] Checking for CarouselApp matrix...`);
    console.log(`[CAROUSEL-DETECT] MX carousel container found: ${!!mxCarouselContainer}`);
    console.log(`[CAROUSEL-DETECT] MX progress indicator found: ${!!mxProgressIndicator}`);
    console.log(`[CAROUSEL-DETECT] MX scale holder found: ${!!mxScaleHolder}`);
    console.log(`[CAROUSEL-DETECT] CarouselApp result: ${isCarouselAppMatrix}`);

    if (isIPSOSCarouselMatrix) {
      console.log(`[IPSOS-CAROUSEL-MATRIX] ✓ Detected IPSOS carousel matrix (one row at a time)`);
      console.log(`[IPSOS-CAROUSEL-MATRIX] Will process ${answer.row_answers.length} rows sequentially with auto-advance`);

      // Process each row one at a time (carousel shows one row at a time)
      for (let rowIndex = 0; rowIndex < answer.row_answers.length; rowIndex++) {
        const rowAnswer = answer.row_answers[rowIndex];
        const row = question.rows.find(r => r.question_id === rowAnswer.row_id);

        if (!row) {
          console.warn(`[IPSOS-CAROUSEL-MATRIX] Row ${rowAnswer.row_id} not found, skipping`);
          continue;
        }

        console.log(`[IPSOS-CAROUSEL-MATRIX] Processing row ${rowIndex + 1}/${answer.row_answers.length}: "${row.label}"`);
        console.log(`[IPSOS-CAROUSEL-MATRIX] Answer: "${rowAnswer.answer}"`);

        // 🔧 V1.9.87: Wait for DOM to fully load all radio divs with text content
        // IPSOS carousel advances asynchronously, need to poll until all options are rendered
        let radioDivs = [];
        let retries = 0;
        const maxRetries = 20; // 20 retries * 300ms = 6 seconds max wait
        const minExpectedDivs = 8; // Minimum number of radio divs with text we expect to find (raised from 5)
        const expectedFullCount = 11; // IPSOS typically has 11 options (1-10 scale + Not Applicable)
        let previousCount = 0;
        let stableCount = 0;

        console.log(`[IPSOS-CAROUSEL-MATRIX] Waiting for radio divs to fully load...`);

        while (retries < maxRetries) {
          // Query all radio divs
          const allDivs = Array.from(document.querySelectorAll('div[role="radio"].prog-the-answer-container, .prog-the-answer-container[role="radio"]'));

          // Count how many have actual text content (not empty/transitioning)
          const divsWithText = allDivs.filter(div => {
            const labelElement = div.querySelector('.mrQuestionText, .prog-the-answer, [class*="answer-text"], b, span');
            const label = labelElement ? labelElement.textContent.trim() : div.textContent.trim();
            return label && label.length > 0;
          });

          const currentCount = divsWithText.length;
          console.log(`[IPSOS-CAROUSEL-MATRIX] DOM poll attempt ${retries + 1}/${maxRetries}: ${currentCount}/${allDivs.length} divs have text content`);

          // Track stability: if count hasn't changed for 3 consecutive polls, consider it stable
          if (currentCount === previousCount && currentCount >= minExpectedDivs) {
            stableCount++;
            if (stableCount >= 3) {
              radioDivs = allDivs;
              console.log(`[IPSOS-CAROUSEL-MATRIX] ✓ DOM stable at ${currentCount} divs (no change for ${stableCount} polls)`);
              break;
            }
          } else {
            stableCount = 0;
          }

          // If we reached the expected full count with all divs loaded, we're done
          if (currentCount >= expectedFullCount && currentCount === allDivs.length) {
            radioDivs = allDivs;
            console.log(`[IPSOS-CAROUSEL-MATRIX] ✓ DOM fully loaded: ${radioDivs.length} radio divs ready`);
            break;
          }

          previousCount = currentCount;

          // Wait 300ms before next poll (increased from 200ms)
          await sleep(300);
          retries++;
        }

        // If we still don't have divs after all retries, use whatever we found
        if (radioDivs.length === 0) {
          radioDivs = Array.from(document.querySelectorAll('div[role="radio"].prog-the-answer-container, .prog-the-answer-container[role="radio"]'));
          console.warn(`[IPSOS-CAROUSEL-MATRIX] ⚠️ DOM polling timed out, using ${radioDivs.length} divs found (some may be empty)`);
        }

        console.log(`[IPSOS-CAROUSEL-MATRIX] Found ${radioDivs.length} radio divs with role="radio"`);

        // Find the matching radio div based on the answer
        let matched = false;
        for (const radioDiv of radioDivs) {
          // Extract label text from the radio div
          const labelElement = radioDiv.querySelector('.mrQuestionText, .prog-the-answer, [class*="answer-text"], b, span');
          const label = labelElement ? labelElement.textContent.trim() : radioDiv.textContent.trim();

          // Skip empty labels (divs without text content)
          if (!label || label.length === 0) {
            continue;
          }

          console.log(`[IPSOS-CAROUSEL-MATRIX] Checking radio div: "${label}"`);

          // Match against Claude's answer
          // Normalize both: remove "__" prefix from answer, and compare
          let answerNormalized = rowAnswer.answer.replace(/^__/, '').toLowerCase().trim();
          let labelNormalized = label.replace(/^__/, '').toLowerCase().trim();

          // Also try removing " - poor", " - excellent" suffixes from labels
          labelNormalized = labelNormalized.replace(/\s*-\s*(poor|excellent|applicable|disagree|agree).*$/i, '');

          console.log(`[IPSOS-CAROUSEL-MATRIX] Normalized answer: "${answerNormalized}", normalized label: "${labelNormalized}"`);

          // Skip if normalized label is empty after cleanup
          if (!labelNormalized || labelNormalized.length === 0) {
            continue;
          }

          // Check for exact match or if label contains the answer
          const matches = answerNormalized === labelNormalized ||
                         labelNormalized.includes(answerNormalized) ||
                         answerNormalized.includes(labelNormalized);

          if (matches) {
            console.log(`[IPSOS-CAROUSEL-MATRIX] ✓ Match found! Clicking radio div: "${label}"`);

            // Focus the element first (IPSOS may require focus)
            radioDiv.focus();

            // Set aria-checked to true
            radioDiv.setAttribute('aria-checked', 'true');

            // Dispatch comprehensive events on the div (mousedown, mouseup, click)
            const mousedownEvent = new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              view: window,
              detail: 1
            });
            radioDiv.dispatchEvent(mousedownEvent);

            const mouseupEvent = new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              view: window,
              detail: 1
            });
            radioDiv.dispatchEvent(mouseupEvent);

            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              detail: 1
            });
            radioDiv.dispatchEvent(clickEvent);

            // Also use the native click method
            radioDiv.click();
            console.log(`[IPSOS-CAROUSEL-MATRIX] ✓ Clicked radio div for row "${row.label}"`);

            // Highlight the element
            highlightElement(radioDiv);

            matched = true;
            break;
          }
        }

        if (!matched) {
          console.warn(`[IPSOS-CAROUSEL-MATRIX] ❌ Could not find matching radio div for answer: "${rowAnswer.answer}"`);

          // 🔧 V1.9.90: Click fallback option to keep carousel moving
          // Find a middle-range option (prefer 5-7) from available divs
          const fallbackOptions = radioDivs.filter(div => {
            const labelElement = div.querySelector('.mrQuestionText, .prog-the-answer, [class*="answer-text"], b, span');
            const label = labelElement ? labelElement.textContent.trim() : div.textContent.trim();
            return label && label.length > 0 && label.match(/^[5-7]$/);
          });

          let clickedFallback = false;
          if (fallbackOptions.length > 0) {
            const fallbackDiv = fallbackOptions[0];
            console.warn(`[IPSOS-CAROUSEL-MATRIX] ⚠️ Clicking fallback option to advance carousel`);
            fallbackDiv.focus();
            fallbackDiv.setAttribute('aria-checked', 'true');
            fallbackDiv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, detail: 1 }));
            fallbackDiv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, detail: 1 }));
            fallbackDiv.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
            fallbackDiv.click();
            highlightElement(fallbackDiv);
            clickedFallback = true;
            matched = true; // Mark as matched so we wait for advancement
          } else {
            // If no middle options, click first available non-empty option
            const anyOption = radioDivs.find(div => {
              const labelElement = div.querySelector('.mrQuestionText, .prog-the-answer, [class*="answer-text"], b, span');
              const label = labelElement ? labelElement.textContent.trim() : div.textContent.trim();
              return label && label.length > 0;
            });

            if (anyOption) {
              console.warn(`[IPSOS-CAROUSEL-MATRIX] ⚠️ Clicking first available option to advance carousel`);
              anyOption.focus();
              anyOption.setAttribute('aria-checked', 'true');
              anyOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, detail: 1 }));
              anyOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, detail: 1 }));
              anyOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
              anyOption.click();
              highlightElement(anyOption);
              clickedFallback = true;
              matched = true; // Mark as matched so we wait for advancement
            } else if (radioDivs.length > 0) {
              // 🔧 V1.9.91: Last resort - if ALL divs are empty (0/11 with text), click first div anyway
              // DOM may load after click, or IPSOS may accept clicks on empty divs
              const firstDiv = radioDivs[0];
              console.warn(`[IPSOS-CAROUSEL-MATRIX] ⚠️ All divs empty (${radioDivs.length} divs, 0 with text), clicking first div to advance carousel`);
              firstDiv.focus();
              firstDiv.setAttribute('aria-checked', 'true');
              firstDiv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, detail: 1 }));
              firstDiv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, detail: 1 }));
              firstDiv.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
              firstDiv.click();
              highlightElement(firstDiv);
              clickedFallback = true;
              matched = true; // Mark as matched so we wait for advancement
            }
          }
        }

        // Wait for carousel to automatically advance to next row
        // IPSOS carousels advance automatically after clicking
        if (rowIndex < answer.row_answers.length - 1) {
          // 🔧 V1.9.89: Wait for progress indicator to confirm carousel advanced
          console.log(`[IPSOS-CAROUSEL-MATRIX] Waiting for carousel to advance to row ${rowIndex + 2}...`);

          // Poll for progress indicator update to confirm advancement
          let advancementConfirmed = false;
          let advanceRetries = 0;
          const maxAdvanceRetries = 30; // 30 * 200ms = 6 seconds max
          const expectedCompletedCount = rowIndex + 1; // Number of completed rows after this click

          while (advanceRetries < maxAdvanceRetries && !advancementConfirmed) {
            // Check if progress indicator shows the row as completed
            // 🔧 V1.9.90: Fixed selector - only match actual progress bar items, not other "complete" classes
            const completedBars = document.querySelectorAll('.prog-progress-bar-item-status.item-status-complete, [class*="prog-progress-bar-item-status-"][class*="item-status-comple"]');
            const currentCompletedCount = completedBars.length;

            console.log(`[IPSOS-CAROUSEL-MATRIX] Progress check ${advanceRetries + 1}/${maxAdvanceRetries}: ${currentCompletedCount} completed bars (expecting ${expectedCompletedCount})`);

            if (currentCompletedCount >= expectedCompletedCount) {
              advancementConfirmed = true;
              console.log(`[IPSOS-CAROUSEL-MATRIX] ✓ Carousel advancement confirmed (${currentCompletedCount} bars completed)`);
              break;
            }

            await sleep(200);
            advanceRetries++;
          }

          if (!advancementConfirmed) {
            console.warn(`[IPSOS-CAROUSEL-MATRIX] ⚠️ Could not confirm carousel advancement, proceeding anyway`);
          }

          // Additional wait for DOM to settle after advancement confirmed
          console.log(`[IPSOS-CAROUSEL-MATRIX] Waiting 1000ms for DOM to settle after advancement...`);
          await sleep(1000);
          console.log(`[IPSOS-CAROUSEL-MATRIX] Ready for row ${rowIndex + 2}/${answer.row_answers.length}`);
        } else {
          console.log(`[IPSOS-CAROUSEL-MATRIX] Last row completed, waiting for Next button to appear...`);
          await sleep(1500);
        }
      }

      console.log(`[IPSOS-CAROUSEL-MATRIX] ✓ Completed all ${answer.row_answers.length} rows`);

      // Save matrix question to database
      await saveQuestionToDatabase(question, answer);
      return;
    }

    // 🔧 V1.9.98: CAROUSELAPP MATRIX HANDLING (Research Now / mx-carouselapp)
    if (isCarouselAppMatrix) {
      console.log(`[CAROUSELAPP-MATRIX] ✓ Detected CarouselApp carousel matrix (one item at a time)`);
      console.log(`[CAROUSELAPP-MATRIX] Will process ${answer.row_answers.length} rows sequentially`);

      // Get current slide info
      const currentSlideEl = document.querySelector('.swiper-progress-current');
      const totalSlidesEl = document.querySelector('.swiper-progress-total');
      const currentSlide = currentSlideEl ? parseInt(currentSlideEl.textContent) : 1;
      const totalSlides = totalSlidesEl ? parseInt(totalSlidesEl.textContent) : answer.row_answers.length;

      console.log(`[CAROUSELAPP-MATRIX] Currently on slide ${currentSlide}/${totalSlides}`);

      // Process each row/slide
      for (let rowIndex = 0; rowIndex < answer.row_answers.length; rowIndex++) {
        const rowAnswer = answer.row_answers[rowIndex];
        const row = question.rows.find(r => r.question_id === rowAnswer.row_id);

        if (!row) {
          console.warn(`[CAROUSELAPP-MATRIX] Row ${rowAnswer.row_id} not found, skipping`);
          continue;
        }

        console.log(`[CAROUSELAPP-MATRIX] Processing slide ${rowIndex + 1}/${answer.row_answers.length}: "${row.label}"`);
        console.log(`[CAROUSELAPP-MATRIX] Answer: "${rowAnswer.answer}"`);

        // Wait for the current slide to be visible
        await sleep(500);

        // Find all scale options (they're below the carousel)
        const scaleCards = Array.from(document.querySelectorAll('.mx-carouselapp-scale'));
        console.log(`[CAROUSELAPP-MATRIX] Found ${scaleCards.length} scale option cards`);

        // Find the matching scale card based on the answer
        let matched = false;
        for (const card of scaleCards) {
          // Extract label from the card
          const labelEl = card.querySelector('.label, .mx-card .label');
          const label = labelEl ? labelEl.textContent.trim() : '';
          const answerText = rowAnswer.answer;

          console.log(`[CAROUSELAPP-MATRIX] Checking scale card: "${label}" against answer: "${answerText}"`);

          // 🔧 LEVEL 4: Use fuzzy similarity matching for CarouselApp matrix
          const sim = similarity(answerText, label);
          const isMatch = sim > 0.8;

          if (isMatch && sim < 1.0) {
            console.log(`[LEVEL 4 MATCH] CarouselApp: "${label}" ↔ "${answerText}" (sim=${sim.toFixed(2)})`);
          } else if (!isMatch && sim > 0.5) {
            console.log(`[LEVEL 4 NO MATCH] CarouselApp: "${label}" ↔ "${answerText}" (sim=${sim.toFixed(2)})`);
          }

          if (isMatch) {
            console.log(`[CAROUSELAPP-MATRIX] ✓ Match found! Clicking scale card: "${label}"`);

            // Click the card
            card.click();
            await sleep(300);

            // Verify selection by checking for mx-card-selected class
            const isSelected = card.classList.contains('mx-card-selected') ||
                             card.querySelector('.mx-card-selected');
            console.log(`[CAROUSELAPP-MATRIX] Card selected status: ${!!isSelected}`);

            matched = true;
            break;
          }
        }

        if (!matched) {
          console.warn(`[CAROUSELAPP-MATRIX] Could not find matching scale card for answer: "${rowAnswer.answer}"`);
        }

        // If not the last row, advance to next slide
        if (rowIndex < answer.row_answers.length - 1) {
          console.log(`[CAROUSELAPP-MATRIX] Advancing to next slide...`);

          // Find and click the next button
          const nextButton = document.querySelector('.swiper-button-next:not(.swiper-button-disabled)');
          if (nextButton) {
            nextButton.click();
            await sleep(800); // Wait for slide transition
            console.log(`[CAROUSELAPP-MATRIX] ✓ Advanced to next slide`);
          } else {
            console.warn(`[CAROUSELAPP-MATRIX] Could not find enabled next button`);
          }
        }
      }

      console.log(`[CAROUSELAPP-MATRIX] ✓ Completed all ${answer.row_answers.length} slides`);

      // Save matrix question to database
      await saveQuestionToDatabase(question, answer);
      return;
    }

    // STANDARD MATRIX HANDLING (all rows visible at once)
    for (const rowAnswer of answer.row_answers) {
      const row = question.rows.find(r => r.question_id === rowAnswer.row_id);
      if (!row) {
        console.warn(`[MATRIX] Row ${rowAnswer.row_id} not found in matrix`);
        continue;
      }

      const elements = row.elements || [];

      if (isCheckboxMatrix) {
        // CHECKBOX MATRIX: answer can be an array of values to check
        const answersToCheck = Array.isArray(rowAnswer.answer) ? rowAnswer.answer : [rowAnswer.answer];
        console.log(`[MATRIX] Filling row "${row.label}" with ${answersToCheck.length} answer(s):`, answersToCheck);
        console.log(`[MATRIX] Row has ${elements.length} checkboxes`);

        let checkedCount = 0;
        for (const checkbox of elements) {
          const label = getOptionLabel(checkbox);
          console.log(`[MATRIX] Checking checkbox ID="${checkbox.id}" label="${label}"`);

          // Check if this checkbox should be checked
          // 🔧 LEVEL 4: Use fuzzy similarity matching for matrix checkboxes
          const shouldCheck = answersToCheck.some(ans => {
            return question.columns.some(col => {
              const labelSim = similarity(ans, label);
              const colSim = similarity(ans, col.label);
              const maxSim = Math.max(labelSim, colSim);
              const matches = maxSim > 0.8;

              if (matches) {
                console.log(`[LEVEL 4 MATCH] Matrix: "${label}" ↔ "${ans}" (sim=${maxSim.toFixed(2)})`);
              } else if (maxSim > 0.5) {
                console.log(`[LEVEL 4 NO MATCH] Matrix: "${label}" ↔ "${ans}" (sim=${maxSim.toFixed(2)})`);
              }

              return matches;
            });
          });

          if (shouldCheck) {
            console.log(`[MATRIX] ✓ Checking checkbox: "${label}" for row "${row.label}"`);
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            checkbox.dispatchEvent(new Event('input', { bubbles: true }));
            checkbox.dispatchEvent(new Event('click', { bubbles: true }));

            if (typeof $ !== 'undefined' && $(checkbox).length) {
              $(checkbox).trigger('change');
            }

            highlightElement(checkbox);
            checkedCount++;
          }
        }

        if (checkedCount === 0) {
          console.warn(`[MATRIX] ❌ No checkboxes matched for row "${row.label}" with answers:`, answersToCheck);
        } else {
          console.log(`[MATRIX] ✓ Checked ${checkedCount} checkbox(es) for row "${row.label}"`);
        }
      } else {
        // RADIO MATRIX: single answer per row
        const radioElements = elements;
        console.log(`[MATRIX] Filling row "${row.label}" with Claude's answer: "${rowAnswer.answer}"`);
        console.log(`[MATRIX] Row has ${radioElements.length} radio buttons`);

        let filled = false;
        for (const radio of radioElements) {
          const label = getOptionLabel(radio);
          console.log(`[MATRIX] Checking radio ID="${radio.id}" label="${label}" against answer="${rowAnswer.answer}"`);

          // FIXED: Compare radio button label directly against Claude's answer
          // Don't loop through all columns - that returns true if ANY column matches!
          const answerLower = rowAnswer.answer.toLowerCase().trim();
          const labelLower = label.toLowerCase().trim();

          // Use exact match only to avoid false positives
          // (e.g., "do not influence" should not match "influence")
          const matchesAnswer = answerLower === labelLower;

          if (matchesAnswer) {
            console.log(`[MATRIX] Match found! Radio label="${label}" matches answer="${rowAnswer.answer}"`);
          }

          if (matchesAnswer) {
            console.log(`[MATRIX] ✓ Matched radio: "${label}" for row "${row.label}"`);
            const radioId = radio.id;
            console.log(`[MATRIX] ↳ Radio ID: ${radioId}`);

            // 🔧 V1.9.47 CSP-COMPLIANT EVENT DISPATCHING
            // Previous approach injected inline scripts which violated Content Security Policy
            // Now using proper event dispatching from content script context

            // Find parent div with ng-click handler
            let parentDiv = radio.closest('[ng-click]');
            if (!parentDiv) {
              parentDiv = radio.closest('div.matrix_column, div[class*="option"], div[class*="choice"]');
            }

            console.log(`[MATRIX] Found parent div:`, parentDiv?.className || 'none');

            // Set the radio as checked (DOM state)
            radio.checked = true;
            console.log(`[MATRIX] Set radio.checked = true`);

            // Dispatch comprehensive events on the radio input
            const eventTypes = ['change', 'input', 'click'];
            eventTypes.forEach(eventType => {
              const event = new Event(eventType, {
                bubbles: true,
                cancelable: true,
                composed: true
              });
              radio.dispatchEvent(event);
              console.log(`[MATRIX] Dispatched "${eventType}" event on radio`);
            });

            // Also dispatch MouseEvent for more compatibility
            const mouseEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              detail: 1
            });
            radio.dispatchEvent(mouseEvent);
            console.log(`[MATRIX] Dispatched MouseEvent on radio`);

            // If there's a parent div with ng-click, click it to trigger Angular handlers
            if (parentDiv) {
              // Click the parent div (this triggers ng-click in Angular)
              parentDiv.click();
              console.log(`[MATRIX] Clicked parent div to trigger ng-click handler`);

              // Dispatch additional events on parent div for Angular
              const parentClickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                detail: 1
              });
              parentDiv.dispatchEvent(parentClickEvent);
              console.log(`[MATRIX] Dispatched click event on parent div`);

              highlightElement(parentDiv);
            } else {
              // Fallback: just click the radio
              radio.click();
              console.log(`[MATRIX] No parent div found, clicked radio directly`);
              highlightElement(radio);
            }

            // Check if radio is checked after a delay
            setTimeout(() => {
              console.log(`[MATRIX] After 100ms: radio.checked = ${radio.checked}, aria-invalid = ${radio.getAttribute('aria-invalid')}`);
            }, 100);

            filled = true;
            break;
          }
        }

        if (!filled) {
          console.warn(`[MATRIX] ❌ Could not find matching radio for row "${row.label}" with answer "${rowAnswer.answer}"`);
        }
      }

      await sleep(600); // Longer delay for Angular.js to process
    }

    // Save matrix question to database
    await saveQuestionToDatabase(question, answer);
    return;
  }

  // Handle percentage allocation questions
  if (question.isPercentageAllocation && answer.row_answers) {
    console.log(`[PERCENTAGE] Filling percentage allocation question with ${answer.row_answers.length} rows`);
    console.log(`[PERCENTAGE] Expected total: 100%`);

    for (const rowAnswer of answer.row_answers) {
      const row = question.rows.find(r => r.id === rowAnswer.row_id);
      if (!row) {
        console.warn(`[PERCENTAGE] Row ${rowAnswer.row_id} not found`);
        continue;
      }

      const element = row.element;
      if (!element) {
        console.warn(`[PERCENTAGE] No input element for row ${rowAnswer.row_id}`);
        continue;
      }

      // Extract numeric value from answer (in case Claude returns "25%" instead of "25")
      let numericValue = rowAnswer.answer;
      if (typeof numericValue === 'string') {
        numericValue = numericValue.replace(/%/g, '').trim();
        numericValue = parseFloat(numericValue);
      }

      if (isNaN(numericValue)) {
        console.warn(`[PERCENTAGE] Invalid numeric value for row "${row.label}": "${rowAnswer.answer}"`);
        continue;
      }

      console.log(`[PERCENTAGE] Filling row "${row.label}" (ID: ${row.id}) with value: ${numericValue}`);

      element.value = String(numericValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      if (typeof $ !== 'undefined' && $(element).length) {
        $(element).val(String(numericValue)).trigger('input').trigger('change');
      }

      highlightElement(element);
      await sleep(300); // Small delay between rows for visual feedback and to allow Total to update
    }

    console.log(`[PERCENTAGE] ✓ Filled ${answer.row_answers.length} percentage rows`);

    // Save percentage allocation question to database
    await saveQuestionToDatabase(question, answer);
    return;
  }

  // Handle grouped postal code fields
  if (question.isPostalCodeGroup) {
    console.log(`[POSTAL] Filling grouped postal code fields`);

    const postalCode = String(answer.answer).replace(/\s+/g, '').toUpperCase(); // Remove spaces, uppercase
    console.log(`[POSTAL] Postal code: "${postalCode}"`);

    // Split postal code into parts based on field count
    const fields = question.postalCodeFields || [];

    if (fields.length === 2) {
      // Canadian postal code format: 2 parts of 3 characters each (e.g., M4M 1Y8)
      const part1 = postalCode.substring(0, 3);
      const part2 = postalCode.substring(3, 6);

      console.log(`[POSTAL] Filling field 1 (${fields[0].id}) with: "${part1}"`);
      console.log(`[POSTAL] Filling field 2 (${fields[1].id}) with: "${part2}"`);

      fields[0].element.value = part1;
      fields[0].element.dispatchEvent(new Event('input', { bubbles: true }));
      fields[0].element.dispatchEvent(new Event('change', { bubbles: true }));
      highlightElement(fields[0].element);

      await sleep(500); // Small delay between fields

      fields[1].element.value = part2;
      fields[1].element.dispatchEvent(new Event('input', { bubbles: true }));
      fields[1].element.dispatchEvent(new Event('change', { bubbles: true }));
      highlightElement(fields[1].element);
    } else {
      // Distribute characters across fields based on maxLength
      let currentPos = 0;
      for (const field of fields) {
        const maxLen = field.maxLength || 3;
        const part = postalCode.substring(currentPos, currentPos + maxLen);
        console.log(`[POSTAL] Filling field (${field.id}) with: "${part}"`);

        field.element.value = part;
        field.element.dispatchEvent(new Event('input', { bubbles: true }));
        field.element.dispatchEvent(new Event('change', { bubbles: true }));
        highlightElement(field.element);

        currentPos += maxLen;
        await sleep(200);
      }
    }

    // Save question to database
    await saveQuestionToDatabase(question, answer);
    return;
  }

  // Handle grouped date fields (Month/Day/Year dropdowns)
  if (question.isDateGroup) {
    console.log(`[DATE] Filling grouped date fields`);

    const dateAnswer = String(answer.answer);
    console.log(`[DATE] Date answer: "${dateAnswer}"`);

    // Parse the date answer to extract month, day, year
    let month = null, day = null, year = null;

    // Try to parse different date formats
    if (dateAnswer.includes('/')) {
      // MM/DD/YYYY or DD/MM/YYYY format
      const parts = dateAnswer.split('/');
      if (parts.length === 3) {
        month = parts[0];
        day = parts[1];
        year = parts[2];
      }
    } else if (dateAnswer.includes('-')) {
      // YYYY-MM-DD format
      const parts = dateAnswer.split('-');
      if (parts.length === 3) {
        year = parts[0];
        month = parts[1];
        day = parts[2];
      }
    } else if (dateAnswer.match(/^[A-Za-z]+\s+\d+,?\s+\d{4}$/)) {
      // "April 26, 1992" or "April 26 1992" format
      const match = dateAnswer.match(/^([A-Za-z]+)\s+(\d+),?\s+(\d{4})$/);
      if (match) {
        const monthName = match[1];
        day = match[2];
        year = match[3];

        // Convert month name to number
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                           'july', 'august', 'september', 'october', 'november', 'december'];
        const monthIndex = monthNames.indexOf(monthName.toLowerCase());
        if (monthIndex >= 0) {
          month = String(monthIndex + 1);
        }
      }
    }

    // If we couldn't parse from answer, use persona defaults (33 years old, born April 26, 1992)
    if (!month || !day || !year) {
      console.log(`[DATE] Could not parse date from answer, using persona defaults`);
      month = '4';  // April
      day = '26';
      year = '1992';
    }

    console.log(`[DATE] Parsed: Month=${month}, Day=${day}, Year=${year}`);

    // Fill each date field
    const fields = question.dateFields || [];
    for (const field of fields) {
      const select = field.element;
      let value = null;

      if (field.type === 'month') {
        value = month;
        console.log(`[DATE] Filling MONTH dropdown with: ${value}`);
      } else if (field.type === 'day') {
        value = day;
        console.log(`[DATE] Filling DAY dropdown with: ${value}`);
      } else if (field.type === 'year') {
        value = year;
        console.log(`[DATE] Filling YEAR dropdown with: ${value}`);
      }

      if (value) {
        // Find and select the option with matching value
        let matched = false;
        for (const option of select.options) {
          if (option.value === value || option.value === String(value)) {
            option.selected = true;
            matched = true;
            console.log(`[DATE] ✓ Selected option: "${option.text}" (value: ${option.value})`);
            break;
          }
        }

        if (!matched) {
          console.warn(`[DATE] ⚠️ Could not find option with value "${value}" in ${field.type} dropdown`);
        }

        // Trigger change events
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
        highlightElement(select);

        await sleep(300); // Small delay between fields
      }
    }

    // Save question to database
    await saveQuestionToDatabase(question, answer);
    return;
  }

  // 🔧 V1.9.57: Handle conditional "Prefer not to answer" questions
  if (question.isConditional && question.question_type === 'conditional') {
    console.log(`[CONDITIONAL] Filling conditional question with prefer_not_to_answer=${answer.prefer_not_to_answer}`);

    // Check if user chose to prefer not to answer
    const preferNotToAnswer = answer.prefer_not_to_answer === true || answer.prefer_not_to_answer === 'true';

    if (preferNotToAnswer) {
      // Check the "Prefer not to answer" checkbox
      console.log(`[CONDITIONAL] Checking "Prefer not to answer" checkbox`);
      const checkbox = question.preferNotToAnswerCheckbox?.element;
      if (checkbox) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        checkbox.dispatchEvent(new Event('input', { bubbles: true }));
        checkbox.dispatchEvent(new Event('click', { bubbles: true }));
        highlightElement(checkbox);
        console.log(`[CONDITIONAL] ✓ Checked "Prefer not to answer" checkbox: ${checkbox.id}`);
      } else {
        console.warn(`[CONDITIONAL] ⚠️ Prefer not to answer checkbox element not found`);
      }
      // Do NOT fill input fields
      console.log(`[CONDITIONAL] ✓ Skipping input fields (prefer not to answer selected)`);
    } else {
      // Fill the input fields with the actual answer
      console.log(`[CONDITIONAL] Filling input fields with answer: "${answer.answer}"`);

      for (const field of question.inputFields) {
        const fieldElement = field.element;
        if (!fieldElement) {
          console.warn(`[CONDITIONAL] ⚠️ Input field element not found: ${field.id}`);
          continue;
        }

        if (field.type === 'select') {
          // Handle dropdown
          const selectElement = fieldElement;
          const answerValue = String(answer.answer || '');

          console.log(`[CONDITIONAL] Filling select dropdown with: "${answerValue}"`);

          // 🔧 LEVEL 4: Use fuzzy similarity matching for conditional select
          let matched = false;

          for (const option of selectElement.options) {
            const textSim = similarity(answerValue, option.text);
            const valueSim = option.value ? similarity(answerValue, option.value) : 0;
            const maxSim = Math.max(textSim, valueSim);
            const isMatch = maxSim > 0.8;

            if (isMatch && maxSim < 1.0) {
              console.log(`[LEVEL 4 MATCH] Conditional: "${option.text}" ↔ "${answerValue}" (sim=${maxSim.toFixed(2)})`);
            } else if (!isMatch && maxSim > 0.5) {
              console.log(`[LEVEL 4 NO MATCH] Conditional: "${option.text}" ↔ "${answerValue}" (sim=${maxSim.toFixed(2)})`);
            }

            if (isMatch) {
              selectElement.value = option.value;
              matched = true;
              console.log(`[CONDITIONAL] ✓ Selected option: "${option.text}" (value: "${option.value}")`);
              break;
            }
          }

          if (!matched) {
            console.warn(`[CONDITIONAL] ⚠️ No matching option found for: "${answerValue}"`);
          }

          selectElement.dispatchEvent(new Event('change', { bubbles: true }));
          selectElement.dispatchEvent(new Event('input', { bubbles: true }));
          highlightElement(selectElement);
        } else {
          // Handle text/number/tel/email inputs
          const inputValue = String(answer.answer || '');
          console.log(`[CONDITIONAL] Filling ${field.type} input with: "${inputValue}"`);

          // For postal code fields (2 parts), split the value
          if (question.inputFields.length === 2 && field.type === 'text') {
            const postalCode = inputValue.replace(/\s+/g, '').toUpperCase();
            const fieldIndex = question.inputFields.indexOf(field);

            if (fieldIndex === 0) {
              // First field - first 3 characters
              fieldElement.value = postalCode.substring(0, 3);
              console.log(`[CONDITIONAL] ✓ Filled postal code part 1: "${fieldElement.value}"`);
            } else if (fieldIndex === 1) {
              // Second field - last 3 characters
              fieldElement.value = postalCode.substring(3, 6);
              console.log(`[CONDITIONAL] ✓ Filled postal code part 2: "${fieldElement.value}"`);
            }
          } else {
            // Single field - fill with entire value
            fieldElement.value = inputValue;
            console.log(`[CONDITIONAL] ✓ Filled ${field.type} input: "${fieldElement.value}"`);
          }

          fieldElement.dispatchEvent(new Event('input', { bubbles: true }));
          fieldElement.dispatchEvent(new Event('change', { bubbles: true }));
          fieldElement.dispatchEvent(new Event('blur', { bubbles: true }));
          highlightElement(fieldElement);

          await sleep(200); // Small delay between fields
        }
      }

      // Do NOT check the "Prefer not to answer" checkbox
      console.log(`[CONDITIONAL] ✓ Skipping "Prefer not to answer" checkbox (actual answer provided)`);
    }

    // Save question to database
    await saveQuestionToDatabase(question, answer);
    return;
  }

  // Handle generic div-based survey questions
  if (question.isDivBased) {
    console.log(`[DIV-SURVEY] Filling div-based question (type: ${type})`);

    const options = question.options || [];
    let answersArray = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
    let matchedCount = 0;

    // Handle both single-select (radio) and multi-select (checkbox)
    if (type === 'checkbox') {
      console.log(`[DIV-SURVEY] Multi-select question, looking for ${answersArray.length} options:`, answersArray);
    } else {
      console.log(`[DIV-SURVEY] Single-select question, looking for: "${answersArray[0]}"`);
      answersArray = [answersArray[0]]; // Only use first for single-select
    }

    // Match and click options
    for (const selectedAnswer of answersArray) {
      let matched = false;

      // 🔧 LEVEL 4: Use fuzzy similarity matching for DIV-SURVEY
      for (const opt of options) {
        const labelSim = similarity(selectedAnswer, opt.label);
        const valueSim = opt.value ? similarity(selectedAnswer, opt.value) : 0;
        const maxSim = Math.max(labelSim, valueSim);
        const isMatch = maxSim > 0.8;

        if (isMatch && maxSim < 1.0) {
          console.log(`[LEVEL 4 MATCH] DIV-Survey: "${opt.label}" ↔ "${selectedAnswer}" (sim=${maxSim.toFixed(2)})`);
        } else if (!isMatch && maxSim > 0.5) {
          console.log(`[LEVEL 4 NO MATCH] DIV-Survey: "${opt.label}" ↔ "${selectedAnswer}" (sim=${maxSim.toFixed(2)})`);
        }

        if (isMatch) {
          console.log(`[DIV-SURVEY] ✓ Match - Clicking option: "${opt.label}"`);
          const optElement = opt.element;
          if (optElement) {
            // For Askia surveys, also update the hidden input
            if (question.isAskia && question.hiddenInput) {
              const value = opt.value || opt.label;
              question.hiddenInput.value = value;
              question.hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`[DIV-SURVEY] ✓ Updated hidden input ${question.hiddenInput.id} = "${value}"`);
            }

            optElement.click();
            optElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            matched = true;
            matchedCount++;
            await sleep(200); // Small delay between clicks
            break;
          }
        }
      }

      if (!matched) {
        console.warn(`[DIV-SURVEY] No option matched answer: "${selectedAnswer}"`);
      }
    }

    console.log(`[DIV-SURVEY] Matched ${matchedCount} out of ${answersArray.length} answers`);
    return;
  }

  // Handle Quest Mindshare custom div-based questions
  if (question.isQuestMindshare) {
    console.log(`[QUEST] Filling custom Quest Mindshare question (type: ${type})`);

    const options = question.options || [];
    let answersArray = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
    let matchedCount = 0;

    // Handle both single-select (radio) and multi-select (checkbox)
    if (type === 'checkbox') {
      console.log(`[QUEST] Multi-select question, looking for ${answersArray.length} options:`, answersArray);
    } else {
      console.log(`[QUEST] Single-select question, looking for: "${answersArray[0]}"`);
      answersArray = [answersArray[0]]; // Only use first for single-select
    }

    // Match and click options
    for (const selectedAnswer of answersArray) {
      let matched = false;

      // 🔧 LEVEL 4: Use fuzzy similarity matching for QUEST
      for (const opt of options) {
        const labelSim = similarity(selectedAnswer, opt.label);
        const valueSim = opt.value ? similarity(selectedAnswer, opt.value) : 0;
        const maxSim = Math.max(labelSim, valueSim);
        const isMatch = maxSim > 0.8;

        if (isMatch && maxSim < 1.0) {
          console.log(`[LEVEL 4 MATCH] Quest: "${opt.label}" ↔ "${selectedAnswer}" (sim=${maxSim.toFixed(2)})`);
        } else if (!isMatch && maxSim > 0.5) {
          console.log(`[LEVEL 4 NO MATCH] Quest: "${opt.label}" ↔ "${selectedAnswer}" (sim=${maxSim.toFixed(2)})`);
        }

        if (isMatch) {
          console.log(`[QUEST] ✓ Match - Clicking option: "${opt.label}"`);
          const optElement = opt.element;
          if (optElement) {
            optElement.click();
            optElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            matched = true;
            matchedCount++;
            await sleep(200); // Small delay between clicks
            break;
          }
        }
      }

      if (!matched) {
        console.warn(`[QUEST] No option matched answer: "${selectedAnswer}"`);
      }
    }

    console.log(`[QUEST] Matched ${matchedCount} out of ${answersArray.length} answers`);

    // Look for and click "Confirm my selections" button
    await sleep(500);
    const confirmButton = question.parentSection?.querySelector('[data-testid="confirm-selection"]');
    if (confirmButton) {
      console.log(`[QUEST] ✓ Clicking "Confirm my selections" button`);
      confirmButton.click();
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } else {
      console.log(`[QUEST] No confirmation button found (may not be needed for single-select)`);
    }

    return;
  }

  // Label-radio questions and merged checkbox questions don't have a single element, they have an elements array
  // V1.9.64: Also allow merged multi-select checkbox questions (isMultiSelect flag)
  // V1.9.96: Also allow confirmit_slider questions (use sliders array instead)
  if (!element && type !== 'label-radio' && type !== 'confirmit_slider' && !question.isMultiSelect) {
    console.error(`Element not found for question ${question.question_id}`);
    return;
  }

  try {
    switch (type) {
      case 'number_matrix':
        console.log(`[NUMBER_MATRIX] Filling matrix question with multiple number inputs`);
        const matrixAnswers = Array.isArray(answer.answer) ? answer.answer : [];
        console.log(`[NUMBER_MATRIX] Processing ${matrixAnswers.length} row answers:`, matrixAnswers);

        for (const rowAnswer of matrixAnswers) {
          const rowId = rowAnswer.id;
          const rowValue = rowAnswer.value;

          // Find the input element for this row
          const rowInput = document.getElementById(rowId);
          if (rowInput) {
            console.log(`[NUMBER_MATRIX] ✓ Filling ${rowId} with value: ${rowValue}`);
            rowInput.value = rowValue;
            rowInput.dispatchEvent(new Event('input', { bubbles: true }));
            rowInput.dispatchEvent(new Event('change', { bubbles: true }));
            highlightElement(rowInput);
            await sleep(300); // Small delay between rows
          } else {
            console.warn(`[NUMBER_MATRIX] ⚠️ Could not find input element with ID: ${rowId}`);
          }
        }

        console.log(`[NUMBER_MATRIX] ✓ Filled ${matrixAnswers.length} rows`);
        break;

      case 'confirmit_slider':
        console.log(`[CONFIRMIT-SLIDER] Filling Confirmit slider question`);

        // Claude should return an object with slider values: { "sliderID": "Left" or "Right" or a number }
        const sliderAnswers = answer.answer;
        console.log(`[CONFIRMIT-SLIDER] Received answers:`, sliderAnswers);

        if (!question.sliders || question.sliders.length === 0) {
          console.error('[CONFIRMIT-SLIDER] No sliders found in question data');
          break;
        }

        // Iterate through each slider and set its value
        for (const slider of question.sliders) {
          // Get the answer for this slider (either from object key or array)
          let sliderAnswer = null;

          if (typeof sliderAnswers === 'object' && !Array.isArray(sliderAnswers)) {
            // Object format: { "58477070_215800110": "3" }
            sliderAnswer = sliderAnswers[slider.id];
          } else if (Array.isArray(sliderAnswers)) {
            // Array format: ["3", "4", "2", ...]
            const sliderIndex = question.sliders.indexOf(slider);
            sliderAnswer = sliderAnswers[sliderIndex];
          }

          if (!sliderAnswer) {
            console.warn(`[CONFIRMIT-SLIDER] No answer found for slider ${slider.id}`);
            continue;
          }

          console.log(`[CONFIRMIT-SLIDER] Setting slider "${slider.leftLabel}" <-> "${slider.rightLabel}" to: "${sliderAnswer}"`);

          // Parse the answer - could be text like "Left"/"Right" or a number
          let numericValue = null;

          // Check if answer matches left or right label (case insensitive, partial match)
          const answerLower = String(sliderAnswer).toLowerCase().trim();
          const leftLower = slider.leftLabel.toLowerCase();
          const rightLower = slider.rightLabel.toLowerCase();

          if (answerLower.includes('left') || leftLower.includes(answerLower) || answerLower.includes(leftLower.split(' ')[0])) {
            // Left side = minimum value
            numericValue = slider.minValue;
            console.log(`[CONFIRMIT-SLIDER] Answer matches LEFT label, using min value: ${numericValue}`);
          } else if (answerLower.includes('right') || rightLower.includes(answerLower) || answerLower.includes(rightLower.split(' ')[0])) {
            // Right side = maximum value
            numericValue = slider.maxValue;
            console.log(`[CONFIRMIT-SLIDER] Answer matches RIGHT label, using max value: ${numericValue}`);
          } else {
            // Try parsing as a number
            numericValue = parseInt(sliderAnswer);
            if (isNaN(numericValue)) {
              console.warn(`[CONFIRMIT-SLIDER] Could not parse answer "${sliderAnswer}" as number`);
              // Default to middle value
              numericValue = Math.round((slider.minValue + slider.maxValue) / 2);
              console.log(`[CONFIRMIT-SLIDER] Using middle value: ${numericValue}`);
            }
          }

          // Clamp value to min/max range
          numericValue = Math.max(slider.minValue, Math.min(slider.maxValue, numericValue));
          console.log(`[CONFIRMIT-SLIDER] Final value (clamped): ${numericValue}`);

          // Set the hidden input value
          slider.hiddenInput.value = numericValue;
          slider.hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
          slider.hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));

          // Calculate slider position percentage (0% = left, 100% = right)
          const range = slider.maxValue - slider.minValue;
          const valueOffset = numericValue - slider.minValue;
          const percentage = (valueOffset / range) * 100;

          console.log(`[CONFIRMIT-SLIDER] Setting slider position to ${percentage}%`);

          // Move the slider handle visually
          if (slider.sliderHandle) {
            slider.sliderHandle.style.left = percentage + '%';
          }

          // Update the slider's aria-valuenow attribute
          if (slider.sliderDiv) {
            slider.sliderDiv.setAttribute('aria-valuenow', numericValue);
          }

          // Trigger jQuery UI slider events if jQuery is available
          if (typeof $ !== 'undefined' && $(slider.sliderDiv).length) {
            console.log(`[CONFIRMIT-SLIDER] Triggering jQuery UI slider change event`);
            try {
              // Use jQuery UI's slider() method to set value
              $(slider.sliderDiv).slider('value', numericValue);
            } catch (e) {
              console.warn(`[CONFIRMIT-SLIDER] jQuery UI slider method failed:`, e);
            }
          }

          // Update the displayed value (if there's a value display element)
          const valueDisplay = slider.hiddenInput.closest('.cm-slider-container')?.querySelector('.cm-slider-value');
          if (valueDisplay) {
            valueDisplay.textContent = numericValue;
          }

          highlightElement(slider.sliderDiv || slider.hiddenInput);
          await sleep(300);
        }

        console.log(`[CONFIRMIT-SLIDER] ✓ Filled ${question.sliders.length} sliders`);
        break;

      case 'text':
      case 'textarea':
      case 'number':
      case 'date':
        let valueToSet = answer.answer;

        // HARD LIMIT: Truncate text answers to 80 characters max
        // Don't trust Claude to follow length guidelines - enforce it in code
        if ((type === 'text' || type === 'textarea') && typeof valueToSet === 'string') {
          const MAX_CHARS = 80;
          if (valueToSet.length > MAX_CHARS) {
            console.warn(`[TEXT_LIMIT] Answer too long (${valueToSet.length} chars), truncating to ${MAX_CHARS}`);
            // Truncate at last complete sentence or word before limit
            valueToSet = valueToSet.substring(0, MAX_CHARS);
            // Trim to last complete word
            const lastSpace = valueToSet.lastIndexOf(' ');
            if (lastSpace > MAX_CHARS * 0.8) { // Only trim if we're not losing too much
              valueToSet = valueToSet.substring(0, lastSpace);
            }
            // Add period if it doesn't end with punctuation
            if (!/[.!?]$/.test(valueToSet)) {
              valueToSet += '.';
            }
            console.log(`[TEXT_LIMIT] Truncated to: "${valueToSet}" (${valueToSet.length} chars)`);
          }
        }

        // V1.9.40: Uncheck any exclusive checkboxes paired with this text input
        // These are "Do not wish to answer" / "Prefer not to answer" checkboxes marked with openendid
        const textInputId = element.id;
        if (textInputId) {
          const exclusiveCheckboxes = document.querySelectorAll(`input[type="checkbox"][isexclusive="true"][openendid="${textInputId}"]`);
          if (exclusiveCheckboxes.length > 0) {
            console.log(`[EXCLUSIVE] Found ${exclusiveCheckboxes.length} exclusive checkbox(es) paired with text input "${textInputId}"`);
            exclusiveCheckboxes.forEach(checkbox => {
              if (checkbox.checked) {
                console.log(`[EXCLUSIVE] Unchecking exclusive checkbox: ${checkbox.id}`);
                checkbox.checked = false;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                checkbox.dispatchEvent(new Event('input', { bubbles: true }));
              }
            });
          }
        }

        console.log(`Setting ${type} value to:`, valueToSet);
        element.value = valueToSet;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`Value set. Current value:`, element.value);

        // Check for validation errors after filling (for JS-enforced character limits)
        if (type === 'text' || type === 'textarea') {
          await sleep(800); // Wait longer for validation to run

          // Look for error messages on the page
          const errorMessages = [
            ...document.querySelectorAll('[class*="error"]'),
            ...document.querySelectorAll('[class*="Error"]'),
            ...document.querySelectorAll('[class*="invalid"]'),
            ...document.querySelectorAll('[class*="warning"]'),
            ...document.querySelectorAll('[role="alert"]')
          ];

          console.log(`[VALIDATION] Found ${errorMessages.length} potential error elements`);

          for (const errorEl of errorMessages) {
            // Only check visible error messages with actual text content
            const computedStyle = window.getComputedStyle(errorEl);
            const isVisible = computedStyle.display !== 'none' &&
                            computedStyle.visibility !== 'hidden' &&
                            computedStyle.opacity !== '0' &&
                            errorEl.offsetParent !== null;

            const errorText = (errorEl.textContent || '').trim();

            // Skip empty or hidden error messages
            if (!errorText || !isVisible) {
              continue;
            }

            console.log(`[VALIDATION] Checking visible error: "${errorText}"`);

            // Check if it's a character limit error
            const charLimitMatch = errorText.match(/(\d+)\s*character/i) ||
                                   errorText.match(/over\s*(\d+)/i) ||
                                   errorText.match(/max(?:imum)?[:\s]*(\d+)/i);

            if (charLimitMatch && charLimitMatch[1]) {
              const limit = parseInt(charLimitMatch[1]);
              const currentLength = (answer.answer || '').length;

              console.log(`[VALIDATION] ⚠️ Character limit error detected! Limit: ${limit}, Current: ${currentLength}`);

              if (currentLength > limit) {
                // Truncate the answer to fit the limit
                let truncated = answer.answer.substring(0, limit - 3) + '...'; // Leave room for ellipsis

                // Try to truncate at a word boundary for cleaner text
                const lastSpace = truncated.lastIndexOf(' ');
                if (lastSpace > limit * 0.7) { // If we can find a space in the last 30%, use it
                  truncated = truncated.substring(0, lastSpace) + '...';
                }

                console.log(`[VALIDATION] ✂️ Truncating to ${truncated.length} characters: "${truncated}"`);

                // Re-fill with truncated answer
                element.value = truncated;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));

                await sleep(300); // Wait to see if error clears
                console.log(`[VALIDATION] ✓ Value updated to truncated version`);
                break;
              }
            }
          }
        }
        break;

      case 'radio':
        console.log(`Radio group answer:`, answer.answer);

        // DEFENSIVE: Radio buttons should ONLY have ONE selection
        // If answer is an array, only use the first item
        let radioAnswer = answer.answer;
        if (Array.isArray(radioAnswer)) {
          console.warn(`⚠️ Radio button received array answer (should be string). Using first item only.`);
          radioAnswer = radioAnswer[0];
        }

        const radioElements = question.elements || document.querySelectorAll(`input[name="${element.name}"]`);
        console.log(`Found ${radioElements.length} radio buttons in group`);
        console.log(`Looking for single answer: "${radioAnswer}"`);

        // 🔧 V1.9.92 ATTENTION CHECK FIX: Check if question already has correct answer
        // If current_answer exists and matches the desired answer, skip clicking (avoids Qualtrics session errors)
        // If current_answer exists but DOESN'T match, we'll change it (fixes attention checks)
        if (question.current_answer) {
          console.log(`[ATTENTION-CHECK] Question has pre-filled answer: "${question.current_answer}"`);

          // Normalize both answers for comparison
          const normalizeForComparison = (str) => String(str).trim().toLowerCase().replace(/\s+/g, ' ');
          const normalizedCurrent = normalizeForComparison(question.current_answer);
          const normalizedDesired = normalizeForComparison(radioAnswer);

          if (normalizedCurrent === normalizedDesired) {
            console.log(`[ATTENTION-CHECK] ✓ Current answer matches desired answer - skipping click to avoid session conflicts`);
            break; // Exit the loop without clicking anything
          } else {
            console.log(`[ATTENTION-CHECK] ⚠️ Current answer "${question.current_answer}" DOES NOT match desired "${radioAnswer}"`);
            console.log(`[ATTENTION-CHECK] 🔧 This is likely an ATTENTION CHECK with wrong pre-fill - will change it!`);
          }
        }

        // Check if this is a carousel question (MX Framework)
        const carouselContainer = element.closest('.mx-stage') || document.querySelector('.mx-carousel');
        if (carouselContainer) {
          console.log(`[CAROUSEL] Detected MX carousel question, using carousel card click method`);

          // Find which radio button matches the answer
          let matchedRadio = null;
          const normalizeString = (str) => str.trim()
            .replace(/\s+/g, ' ')
            .replace(/[\u2018\u2019]/g, "'")  // Replace smart single quotes with '
            .replace(/[\u201C\u201D]/g, '"'); // Replace smart double quotes with "
          const normalizedAnswer = normalizeString(radioAnswer);

          for (const radio of radioElements) {
            const label = getOptionLabel(radio);
            const value = radio.value;
            const normalizedLabel = normalizeString(label);
            const normalizedValue = normalizeString(value);

            // 🔧 LEVEL 4: Use fuzzy similarity matching for carousel radio buttons
            const labelSim = similarity(radioAnswer, label);
            const valueSim = value ? similarity(radioAnswer, value) : 0;
            const maxSim = Math.max(labelSim, valueSim);
            const isMatch = maxSim > 0.8;

            if (isMatch && maxSim < 1.0) {
              console.log(`[LEVEL 4 MATCH] Carousel: "${label}" ↔ "${radioAnswer}" (sim=${maxSim.toFixed(2)})`);
            } else if (!isMatch && maxSim > 0.5) {
              console.log(`[LEVEL 4 NO MATCH] Carousel: "${label}" ↔ "${radioAnswer}" (sim=${maxSim.toFixed(2)})`);
            }

            if (isMatch) {
              matchedRadio = radio;
              console.log(`[CAROUSEL] Matched radio input: ${radio.id}`);
              break;
            }
          }

          if (matchedRadio) {
            // Extract the column/scale code from the radio ID (e.g., "ans1033640.5.8" -> column "5")
            const idParts = matchedRadio.id.match(/\.(\d+)\.\d+$/);
            if (idParts && idParts[1]) {
              const columnCode = 'c' + idParts[1];
              console.log(`[CAROUSEL] Looking for carousel scale card with data-code="${columnCode}"`);

              // Find and click the carousel scale card
              const scaleCard = document.querySelector(`.mx-carouselapp-scale[data-code="${columnCode}"]`);
              if (scaleCard) {
                console.log(`[CAROUSEL] ✓ Found carousel scale card, clicking...`);
                scaleCard.click();
                scaleCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

                // Also click the inner card element
                const innerCard = scaleCard.querySelector('.mx-card');
                if (innerCard) {
                  innerCard.click();
                  innerCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }

                // Wait for carousel animation
                await sleep(800);
                break;
              } else {
                console.warn(`[CAROUSEL] ⚠️ Could not find carousel scale card for code: ${columnCode}`);
              }
            } else {
              console.warn(`[CAROUSEL] ⚠️ Could not extract column code from radio ID: ${matchedRadio.id}`);
            }
          }

          // If carousel method didn't work, fall through to regular radio handling
          console.log(`[CAROUSEL] Falling back to regular radio button click`);
        }

        let radioMatched = false;
        radioElements.forEach(radio => {
          const labelData = getOptionLabel(radio);  // FIX: Use getOptionLabel to get the option text, not the question text
          // V5.1.1: Material UI buttons don't have .value attribute, use textContent as fallback
          const value = radio.value || radio.textContent?.trim() || '';

          // V1.9.33: Handle both string labels and object labels {image, text}
          let label = labelData;
          if (typeof labelData === 'object' && labelData !== null && labelData.text) {
            label = labelData.text;
            console.log(`[VISION] Extracted text from image option: "${label}"`);
          }

          console.log(`Radio option: id="${radio.id}", label="${label}", value="${value}"`);

          // Uncheck all first
          radio.checked = false;

          // 🔧 FIX: Normalize strings to handle whitespace/Unicode/quote differences
          // Replace all whitespace (spaces, tabs, newlines, non-breaking spaces) with single space
          // Replace smart quotes (curly quotes) with regular quotes
          const normalizeString = (str) => {
            // V1.9.33: Handle object labels by extracting text property
            let text = str;
            if (typeof str === 'object' && str !== null && str.text) {
              text = str.text;
            }
            return String(text).trim()
              .replace(/\s+/g, ' ')
              .replace(/[\u2018\u2019]/g, "'")  // Replace ' and ' (smart single quotes) with '
              .replace(/[\u201C\u201D]/g, '"'); // Replace " and " (smart double quotes) with "
          };
          const normalizedLabel = normalizeString(label);
          const normalizedAnswer = normalizeString(radioAnswer);
          const normalizedValue = normalizeString(value);

          // 🔧 ANGULAR.JS FIX: Handle duplicate text in labels (e.g., "Male Male" -> "Male")
          // If label is just the same word repeated, use single instance
          const labelWords = normalizedLabel.split(' ');
          let cleanedLabel = normalizedLabel;
          if (labelWords.length === 2 && labelWords[0] === labelWords[1]) {
            cleanedLabel = labelWords[0];
            console.log(`  ↳ Detected duplicate text in label, cleaned: "${cleanedLabel}"`);
          }
          // Also handle longer duplicates like "Male Male Male"
          if (labelWords.length > 2 && labelWords.every(w => w === labelWords[0])) {
            cleanedLabel = labelWords[0];
            console.log(`  ↳ Detected multiple duplicate text in label, cleaned: "${cleanedLabel}"`);
          }

          // 🐛 DEBUG: Log detailed comparison for this specific question
          if (radio.id.includes('340419896')) {
            console.log(`[DEBUG] Comparing option 2:`);
            console.log(`  Label raw: "${label}" (length: ${label.length})`);
            console.log(`  Answer raw: "${radioAnswer}" (length: ${radioAnswer.length})`);
            console.log(`  Exact match: ${label === radioAnswer}`);

            // Find the first character that differs
            let firstDiff = -1;
            const maxLen = Math.max(label.length, radioAnswer.length);
            for (let i = 0; i < maxLen; i++) {
              if (label[i] !== radioAnswer[i]) {
                firstDiff = i;
                break;
              }
            }

            if (firstDiff !== -1) {
              console.log(`  ⚠️ DIFFERENCE AT INDEX ${firstDiff}:`);
              console.log(`    Label char: "${label[firstDiff]}" (code: ${label.charCodeAt(firstDiff)})`);
              console.log(`    Answer char: "${radioAnswer[firstDiff]}" (code: ${radioAnswer.charCodeAt(firstDiff)})`);
              console.log(`    Context (label): "...${label.substring(Math.max(0, firstDiff-5), firstDiff+5)}..."`);
              console.log(`    Context (answer): "...${radioAnswer.substring(Math.max(0, firstDiff-5), firstDiff+5)}..."`);
            } else {
              console.log(`  ✓ All characters match! But === still returns false!?`);
              console.log(`    Label type: ${typeof label}`);
              console.log(`    Answer type: ${typeof radioAnswer}`);
            }
          }

          // ONLY check if this radio matches AND we haven't matched yet
          // 🧠 LEVEL 5: Use auto-tuned fuzzy matching with learned transformations
          const labelResult = similarityMatch(radioAnswer, label, platform, questionType);
          const valueResult = value ? similarityMatch(radioAnswer, value, platform, questionType) : { match: false, score: 0 };
          const cleanedResult = cleanedLabel !== normalizedLabel ? similarityMatch(radioAnswer, cleanedLabel, platform, questionType) : { match: false, score: 0 };
          const maxSim = Math.max(labelResult.score, valueResult.score, cleanedResult.score);
          const isMatch = labelResult.match || valueResult.match || cleanedResult.match;

          if (isMatch && maxSim < 1.0) {
            console.log(`[LEVEL 5 MATCH] Radio: "${label}" ↔ "${radioAnswer}" (sim=${maxSim.toFixed(2)}, threshold=${labelResult.threshold.toFixed(2)})`);
          } else if (!isMatch && maxSim > 0.5) {
            console.log(`[LEVEL 5 NO MATCH] Radio: "${label}" ↔ "${radioAnswer}" (sim=${maxSim.toFixed(2)}, threshold=${labelResult.threshold.toFixed(2)})`);
          }

          if (!radioMatched && isMatch) {
            console.log(`✓ Matched radio: "${label}" (value: ${value})`);

            // 🔧 CHECK FOR ANGULAR.JS: Detect Angular.js forms by checking for unevaluated attributes
            // Angular forms often have value="op.OptionId" or similar placeholders, and use ng-click on parent div
            // V5.1.1: Safe fallback for Material UI buttons that don't have value attribute
            const safeValue = value || '';
            const isAngularForm = safeValue.startsWith('op.') ||
                                 safeValue.startsWith('ng-') ||
                                 safeValue.includes('{{') ||
                                 radio.hasAttribute('ng-model') ||
                                 radio.hasAttribute('ng-value');

            if (isAngularForm) {
              console.log(`  ↳ Detected Angular.js form (value="${value}"), looking for ng-click parent...`);

              // Find parent div with ng-click attribute
              let ngClickParent = radio.closest('[ng-click]');
              if (!ngClickParent) {
                // Also check for parent div that might have Angular handlers
                ngClickParent = radio.closest('div.dvChkbox, div[class*="option"], div[class*="choice"]');
              }

              if (ngClickParent) {
                console.log(`  ↳ Found Angular ng-click parent: ${ngClickParent.className}`);

                // Click the parent div to trigger Angular's ng-click handler
                const rect = ngClickParent.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;

                ngClickParent.dispatchEvent(new MouseEvent('mousedown', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: x,
                  clientY: y,
                  button: 0
                }));

                ngClickParent.dispatchEvent(new MouseEvent('mouseup', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: x,
                  clientY: y,
                  button: 0
                }));

                ngClickParent.dispatchEvent(new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: x,
                  clientY: y,
                  button: 0
                }));

                ngClickParent.click();

                // Also try clicking the label
                if (radio.id) {
                  const associatedLabel = document.querySelector(`label[for="${radio.id}"]`);
                  if (associatedLabel) {
                    console.log(`  ↳ Also clicking Angular label for "${radio.id}"`);
                    const labelRect = associatedLabel.getBoundingClientRect();
                    const labelX = labelRect.left + labelRect.width / 2;
                    const labelY = labelRect.top + labelRect.height / 2;

                    associatedLabel.dispatchEvent(new MouseEvent('click', {
                      bubbles: true,
                      cancelable: true,
                      view: window,
                      clientX: labelX,
                      clientY: labelY,
                      button: 0
                    }));

                    associatedLabel.click();
                  }
                }

                // V1.9.17: Removed inline script injection (blocked by CSP)
                // Angular digest will be triggered by click events + wait time
                console.log(`  ↳ Angular digest will be handled by click events and wait time`);

                radioMatched = true;
                return; // Skip the regular radio button clicking logic
              } else {
                console.log(`  ↳ Warning: Angular form detected but no ng-click parent found, falling back to regular click`);
              }
            }

            // 🔧 V1.9.51: CHECK FOR CUSTOM ONCLICK DIVS: Some surveys hide the radio input and use a div with onclick handler
            // Example: <input id="mrSingleRadio-1" style="display:none">
            //          <div onclick="toggleRadioButton('option_1', 'mrSingleRadio-1', ...)" id="option_1">
            let targetElement = radio;
            const isHiddenInput = radio.classList.contains('sntHiddenElement') ||
                                 radio.classList.contains('hidden') ||
                                 radio.style.display === 'none' ||
                                 window.getComputedStyle(radio).display === 'none';

            if (isHiddenInput && radio.id) {
              // Look for a div with onclick that references this radio's ID
              const customButton = document.querySelector(`[onclick*="${radio.id}"]`);
              if (customButton && customButton.tagName === 'DIV') {
                console.log(`  ↳ Detected custom onclick div for hidden input, clicking div instead: ${customButton.id}`);
                targetElement = customButton;
              }
            }

            // 🔧 CHECK FOR ICHECK: Many surveys use iCheck jQuery plugin for custom radio buttons
            // iCheck creates a wrapper element (class="iradio" or "icheckbox") that overlays the actual input
            // We need to click the wrapper, not the hidden input
            if (targetElement === radio) { // Only check if we haven't found a custom button yet
              const iCheckWrapper = radio.parentElement?.querySelector('.iradio, .icheckbox') ||
                                   radio.closest('.iradio, .icheckbox') ||
                                   (radio.parentElement?.classList.contains('iradio') ||
                                    radio.parentElement?.classList.contains('icheckbox') ? radio.parentElement : null);

              if (iCheckWrapper) {
                console.log(`  ↳ Detected iCheck wrapper, clicking custom element instead of hidden input`);
                targetElement = iCheckWrapper;
              }
            }

            // 1. Focus the element (humans focus before clicking)
            try {
              targetElement.focus();
            } catch (e) { /* some elements can't be focused */ }

            // 2. Get element position for realistic event coordinates
            const rect = targetElement.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            // 3. Dispatch mousedown (humans press mouse before releasing)
            targetElement.dispatchEvent(new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: x,
              clientY: y,
              button: 0
            }));

            // 4. Dispatch mouseup
            targetElement.dispatchEvent(new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: x,
              clientY: y,
              button: 0
            }));

            // 5. Set checked property
            radio.checked = true;

            // 6. Dispatch click with realistic MouseEvent
            targetElement.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: x,
              clientY: y,
              button: 0
            }));

            // 7. Also use native click() method (some frameworks require this)
            try {
              targetElement.click();
            } catch (e) { /* click() might fail on some elements */ }

            // 8. Dispatch change and input events (forms expect these)
            // Dispatch on both the target element (might be iCheck wrapper) AND the actual radio input
            targetElement.dispatchEvent(new Event('change', { bubbles: true }));
            targetElement.dispatchEvent(new Event('input', { bubbles: true }));

            // Also dispatch on the actual radio input (if different from targetElement)
            if (targetElement !== radio) {
              radio.dispatchEvent(new Event('change', { bubbles: true }));
              radio.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // ALWAYS click the associated label if it exists
            // Many modern surveys have custom UI overlays that require label clicks
            // even if the radio isn't technically "hidden"
            if (radio.id) {
              const associatedLabel = document.querySelector(`label[for="${radio.id}"]`);
              if (associatedLabel) {
                console.log(`  ↳ Also clicking associated label for "${radio.id}"`);

                const labelRect = associatedLabel.getBoundingClientRect();
                const labelX = labelRect.left + labelRect.width / 2;
                const labelY = labelRect.top + labelRect.height / 2;

                // Realistic click sequence on label
                associatedLabel.dispatchEvent(new MouseEvent('mousedown', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: labelX,
                  clientY: labelY,
                  button: 0
                }));

                associatedLabel.dispatchEvent(new MouseEvent('mouseup', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: labelX,
                  clientY: labelY,
                  button: 0
                }));

                associatedLabel.dispatchEvent(new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: labelX,
                  clientY: labelY,
                  button: 0
                }));

                associatedLabel.click();
              }
            }

            // V1.9.62: IPSOS/Nfield rowpicker radio button support (similar to checkbox support from V1.9.42)
            // Check for IPSOS custom _rowpicker / __flexgrid_row pattern for radio buttons
            const container = document.querySelector('._rowpicker, [data-test="main-contain"]');
            if (container) {
              console.log(`[IPSOS-ROWPICKER-RADIO] Detected _rowpicker container for radio button`);

              // Find all clickable divs in the flexgrid
              const flexgridRow = container.querySelector('.__flexgrid_row');
              if (flexgridRow) {
                // Get all the option divs (they have tabindex and cursor: pointer)
                const optionDivs = Array.from(flexgridRow.children).filter(child => {
                  const hasTabindex = child.querySelector('[tabindex="0"]');
                  const hasLabel = child.querySelector('label');
                  return hasTabindex && hasLabel;
                });

                console.log(`[IPSOS-ROWPICKER-RADIO] Found ${optionDivs.length} option divs in flexgrid`);

                // Find the option div that matches our radio button's label
                const radioLabel = radio.id ? document.querySelector(`label[for="${radio.id}"]`) : null;
                const radioLabelText = radioLabel ? radioLabel.textContent.trim().toLowerCase() : '';

                for (const optionDiv of optionDivs) {
                  const optionLabel = optionDiv.querySelector('label');
                  const optionText = optionLabel ? optionLabel.textContent.trim().toLowerCase() : '';

                  if (optionText === radioLabelText) {
                    console.log(`[IPSOS-ROWPICKER-RADIO] ✓ Found matching option div for "${radioLabelText}"`);

                    // Click the clickable div (the one with tabindex="0")
                    const clickableDiv = optionDiv.querySelector('[tabindex="0"]');
                    if (clickableDiv) {
                      console.log(`[IPSOS-ROWPICKER-RADIO] Clicking custom clickable div for radio button...`);

                      // Simulate realistic click with coordinates
                      const rect = clickableDiv.getBoundingClientRect();
                      const x = rect.left + rect.width / 2;
                      const y = rect.top + rect.height / 2;

                      clickableDiv.dispatchEvent(new MouseEvent('mousedown', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: x,
                        clientY: y
                      }));

                      clickableDiv.dispatchEvent(new MouseEvent('mouseup', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: x,
                        clientY: y
                      }));

                      clickableDiv.dispatchEvent(new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: x,
                        clientY: y
                      }));

                      clickableDiv.click();

                      console.log(`[IPSOS-ROWPICKER-RADIO] ✓ Clicked custom div successfully`);
                      break; // Found and clicked, exit loop
                    }
                  }
                }
              }
            }

            // SPECIAL: Material-UI survey pages (like Lifepoints) use transparent overlay divs
            // The radio inputs are hidden in a table, but the visible UI with overlays is in a different part of the DOM
            // We need to find and click these overlay divs to trigger navigation
            // Check if this looks like a Material-UI page by looking for QARTS container
            const isQARTSPage = document.querySelector('[id*="QARTS"]') || document.querySelector('.qartstool');

            if (isQARTSPage) {
              console.log(`  ↳ Detected QARTS/Material-UI page, searching for clickable overlays by label text...`);

              // Search for Material-UI overlay divs by finding labels that match this option's text
              // The overlay divs are siblings of the label containers in the Material-UI section
              const labelText = getOptionLabel(radio); // Get full label text (e.g., "English")

              // Find all labels/spans in the visible UI that match this text
              const allLabels = Array.from(document.querySelectorAll('label, span'));
              let foundOverlay = false;

              for (const labelEl of allLabels) {
                if (labelEl.textContent.trim() === labelText) {
                  console.log(`  ↳ Found matching label in UI: "${labelText}"`);

                  // Look for overlay div in parent container
                  // The structure is usually: parent > content-div + overlay-div (siblings)
                  let container = labelEl.closest('div[style*="flex"]');
                  if (!container) {
                    container = labelEl.parentElement;
                  }

                  // Search up the parent chain for a container with an overlay div
                  let searchLevel = 0;
                  while (container && searchLevel < 5) {
                    // Look for overlay divs with tabindex and cursor:pointer
                    const overlayDivs = Array.from(container.querySelectorAll('div[tabindex][dir]'))
                      .filter(div => {
                        const style = window.getComputedStyle(div);
                        const inlineStyle = div.getAttribute('style') || '';
                        const hasPointerCursor = style.cursor === 'pointer' || inlineStyle.includes('cursor: pointer');
                        const isAbsolute = style.position === 'absolute' || inlineStyle.includes('position: absolute');
                        const hasZIndex = parseInt(style.zIndex) > 0 || inlineStyle.includes('z-index');
                        return hasPointerCursor && isAbsolute;
                      });

                    if (overlayDivs.length > 0) {
                      console.log(`  ↳ Found ${overlayDivs.length} overlay div(s) in parent container`);

                      for (const overlayDiv of overlayDivs) {
                        console.log(`  ↳ Clicking Material-UI overlay div`);

                        const overlayRect = overlayDiv.getBoundingClientRect();
                        const overlayX = overlayRect.left + overlayRect.width / 2;
                        const overlayY = overlayRect.top + overlayRect.height / 2;

                        // Full click sequence
                        overlayDiv.dispatchEvent(new MouseEvent('mousedown', {
                          bubbles: true,
                          cancelable: true,
                          view: window,
                          clientX: overlayX,
                          clientY: overlayY,
                          button: 0
                        }));

                        overlayDiv.dispatchEvent(new MouseEvent('mouseup', {
                          bubbles: true,
                          cancelable: true,
                          view: window,
                          clientX: overlayX,
                          clientY: overlayY,
                          button: 0
                        }));

                        overlayDiv.dispatchEvent(new MouseEvent('click', {
                          bubbles: true,
                          cancelable: true,
                          view: window,
                          clientX: overlayX,
                          clientY: overlayY,
                          button: 0
                        }));

                        overlayDiv.click();
                        overlayDiv.focus();
                        foundOverlay = true;
                      }

                      break;
                    }

                    container = container.parentElement;
                    searchLevel++;
                  }

                  if (foundOverlay) break;
                }
              }

              if (!foundOverlay) {
                console.log(`  ↳ No overlay divs found by label match, trying cell wrappers...`);

                // FALLBACK: Click table cell wrappers
                const cellWrappers = [
                  radio.closest('.cell-text'),
                  radio.closest('.cell-sub-wrapper'),
                  radio.closest('.cell-wrapper'),
                  radio.closest('td'),
                  radio.closest('[onclick]'),
                  radio.closest('.clickableCell')
                ].filter(el => el !== null);

                for (const wrapper of cellWrappers) {
                  console.log(`  ↳ Clicking table cell/wrapper: ${wrapper.className || wrapper.tagName}`);

                  const wrapperRect = wrapper.getBoundingClientRect();
                  const wrapperX = wrapperRect.left + wrapperRect.width / 2;
                  const wrapperY = wrapperRect.top + wrapperRect.height / 2;

                  wrapper.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: wrapperX,
                    clientY: wrapperY,
                    button: 0
                  }));

                  wrapper.click();
                }
              }
            }

            radioMatched = true;

            // IPSOS Vue.js fix (v1.9.26): Sync visible Vue.js radio button if present
            // IPSOS uses dual radios: hidden (simple IDs like _Q0_C0) + visible Vue.js (long IDs with data-v- attribute)
            // Check if this radio looks like a simple IPSOS hidden radio
            const isIPSOSHiddenRadio = radio.id && /^_Q\d+_C\d+$/.test(radio.id);

            if (isIPSOSHiddenRadio) {
              console.log(`[VUE-RADIO] Detected IPSOS hidden radio: ${radio.id}, looking for Vue.js radio...`);

              // Find Vue radios with same NAME and VALUE but DIFFERENT (longer) ID
              // Vue radios have IDs like "_Q_DDynamicPage_Qresp__gender_Cmale" vs hidden "_Q0_C1"
              const radioName = radio.name;
              const allRadiosWithName = Array.from(document.querySelectorAll(`input[type="radio"][name="${radioName}"][value="${value}"]`));

              // Filter to find the Vue radio (has longer ID, not matching the simple pattern)
              const vueRadios = allRadiosWithName.filter(r => r.id !== radio.id && !/^_Q\d+_C\d+$/.test(r.id));

              if (vueRadios.length > 0) {
                console.log(`[VUE-RADIO] Found ${vueRadios.length} Vue.js radio(s) with name="${radioName}" value="${value}"`);

                const vueRadio = vueRadios[0]; // Use first match
                console.log(`[VUE-RADIO] Syncing Vue radio: ${vueRadio.id}`);

                // Click the Vue radio and its label
                vueRadio.checked = true;
                vueRadio.click();
                vueRadio.dispatchEvent(new Event('change', { bubbles: true }));
                vueRadio.dispatchEvent(new Event('input', { bubbles: true }));

                // Also click its label if present
                if (vueRadio.id) {
                  const vueLabel = document.querySelector(`label[for="${vueRadio.id}"]`);
                  if (vueLabel) {
                    console.log(`[VUE-RADIO] Also clicking Vue label for "${vueRadio.id}"`);
                    vueLabel.click();
                  }
                }

                console.log(`[VUE-RADIO] ✓ Synced Vue radio button`);
              } else {
                console.log(`[VUE-RADIO] No Vue.js radio found (name="${radioName}", value="${value}")`);

                // V1.9.38: Check for IPSOS custom _rowpicker / __flexgrid_row pattern
                // These surveys use custom styled divs that need to be clicked instead of the hidden radio
                const container = document.querySelector('._rowpicker, [data-test="main-contain"]');
                if (container) {
                  console.log(`[IPSOS-ROWPICKER] Detected _rowpicker container, looking for custom clickable div...`);

                  // Find all clickable divs in the flexgrid
                  const flexgridRow = container.querySelector('.__flexgrid_row');
                  if (flexgridRow) {
                    // Get all the option divs (they have tabindex and cursor: pointer)
                    const optionDivs = Array.from(flexgridRow.children).filter(child => {
                      const hasTabindex = child.querySelector('[tabindex="0"]');
                      const hasLabel = child.querySelector('label');
                      return hasTabindex && hasLabel;
                    });

                    console.log(`[IPSOS-ROWPICKER] Found ${optionDivs.length} option divs in flexgrid`);

                    // Find the option div that matches our radio's label
                    const radioLabel = radio.id ? document.querySelector(`label[for="${radio.id}"]`) : null;
                    const radioLabelText = radioLabel ? radioLabel.textContent.trim().toLowerCase() : '';

                    for (const optionDiv of optionDivs) {
                      const optionLabel = optionDiv.querySelector('label');
                      const optionText = optionLabel ? optionLabel.textContent.trim().toLowerCase() : '';

                      if (optionText === radioLabelText) {
                        console.log(`[IPSOS-ROWPICKER] ✓ Found matching option div for "${radioLabelText}"`);

                        // Click the clickable div (the one with tabindex="0")
                        const clickableDiv = optionDiv.querySelector('[tabindex="0"]');
                        if (clickableDiv) {
                          console.log(`[IPSOS-ROWPICKER] Clicking custom clickable div...`);

                          // Simulate realistic click with coordinates
                          const rect = clickableDiv.getBoundingClientRect();
                          const x = rect.left + rect.width / 2;
                          const y = rect.top + rect.height / 2;

                          clickableDiv.dispatchEvent(new MouseEvent('mousedown', {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: x,
                            clientY: y
                          }));

                          clickableDiv.dispatchEvent(new MouseEvent('mouseup', {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: x,
                            clientY: y
                          }));

                          clickableDiv.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: x,
                            clientY: y
                          }));

                          clickableDiv.click();

                          console.log(`[IPSOS-ROWPICKER] ✓ Clicked custom div successfully`);
                          break; // Found and clicked, exit loop
                        }
                      }
                    }
                  }
                }

                // V1.9.34: For IPSOS image-based questions, simulate realistic click on label
                // IPSOS uses JavaScript event handlers that need full mouse event sequence
                const radioLabel = radio.id ? document.querySelector(`label[for="${radio.id}"]`) : null;
                if (radioLabel) {
                  console.log(`[IPSOS-VISION] Simulating realistic click on label...`);

                  // Get coordinates for realistic click
                  const rect = radioLabel.getBoundingClientRect();
                  const x = rect.left + rect.width / 2;
                  const y = rect.top + rect.height / 2;

                  // Dispatch full mouse event sequence (mousedown → mouseup → click)
                  radioLabel.dispatchEvent(new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: x,
                    clientY: y
                  }));

                  radioLabel.dispatchEvent(new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: x,
                    clientY: y
                  }));

                  radioLabel.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: x,
                    clientY: y
                  }));

                  // Also use native click as fallback
                  radioLabel.click();

                  console.log(`[IPSOS-VISION] ✓ Dispatched realistic mouse events on label`);
                }
              }
            }
          }
        });

        if (!radioMatched) {
          console.warn(`No radio button matched answer: "${radioAnswer}"`);

          // 🔧 V1.9.49: If answer contains commas, Claude might have thought this was multi-select
          // Try to match just the FIRST item from the comma-separated list before falling back to "None of the above"
          if (radioAnswer.includes(',')) {
            const firstItem = radioAnswer.split(',')[0].trim();
            console.log(`[FALLBACK] Answer contains commas - trying to match just first item: "${firstItem}"`);

            // Try to find a match for the first item
            const firstItemMatch = radioElements.find(radio => {
              const label = getOptionLabel(radio);
              const normalizedAnswer = firstItem.toLowerCase().trim();
              const normalizedLabel = label.toLowerCase().trim();

              // Try exact match first
              if (normalizedLabel === normalizedAnswer) {
                return true;
              }

              // Try substring match (label contains answer or vice versa)
              if (normalizedLabel.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedLabel)) {
                return true;
              }

              return false;
            });

            if (firstItemMatch) {
              console.log(`[FALLBACK] ✓ Found match for first item: "${getOptionLabel(firstItemMatch)}"`);

              // Use the same clicking logic
              const label = getOptionLabel(firstItemMatch);
              const isAngularForm = firstItemMatch.value.startsWith('op.') ||
                                   firstItemMatch.value.startsWith('ng-') ||
                                   firstItemMatch.value.includes('{{') ||
                                   firstItemMatch.hasAttribute('ng-model');

              if (isAngularForm) {
                let ngClickParent = firstItemMatch.closest('[ng-click]');
                if (!ngClickParent) {
                  ngClickParent = firstItemMatch.closest('div.dvChkbox, div[class*="option"], div[class*="choice"]');
                }
                if (ngClickParent) {
                  ngClickParent.click();
                  if (firstItemMatch.id) {
                    const associatedLabel = document.querySelector(`label[for="${firstItemMatch.id}"]`);
                    if (associatedLabel) {
                      associatedLabel.click();
                    }
                  }
                  radioMatched = true;
                  console.log(`[FALLBACK] ✓ Successfully selected first item via Angular click`);
                }
              } else {
                firstItemMatch.click();
                firstItemMatch.dispatchEvent(new Event('change', { bubbles: true }));
                if (firstItemMatch.id) {
                  const associatedLabel = document.querySelector(`label[for="${firstItemMatch.id}"]`);
                  if (associatedLabel) {
                    associatedLabel.click();
                  }
                }
                radioMatched = true;
                console.log(`[FALLBACK] ✓ Successfully selected first item via regular click`);
              }
            } else {
              console.log(`[FALLBACK] ❌ Could not match first item either, will try "None of the above"`);
            }
          }

          // 🔧 V1.9.21: Automatic fallback - if answer doesn't match and "None of the above" exists, select it
          // 🔧 V1.9.49: Only use this as last resort if first-item matching also failed
          if (!radioMatched && question.hasNoneOfAbove) {
            console.log(`[FALLBACK] Claude's answer "${radioAnswer}" not in list, automatically selecting "None of the above"`);

            // Find "None of the above" option
            const noneOption = radioElements.find(radio => {
              const label = getOptionLabel(radio);
              const normalizedLabel = label.toLowerCase().trim();
              return normalizedLabel.includes('none of the above') ||
                     normalizedLabel.includes('none of these') ||
                     normalizedLabel === 'none';
            });

            if (noneOption) {
              console.log(`[FALLBACK] ✓ Found "None of the above" option, clicking it...`);

              // Use the same clicking logic as normal radio buttons
              const label = getOptionLabel(noneOption);

              // Check for Angular form
              const isAngularForm = noneOption.value.startsWith('op.') ||
                                   noneOption.value.startsWith('ng-') ||
                                   noneOption.value.includes('{{') ||
                                   noneOption.hasAttribute('ng-model');

              if (isAngularForm) {
                let ngClickParent = noneOption.closest('[ng-click]');
                if (!ngClickParent) {
                  ngClickParent = noneOption.closest('div.dvChkbox, div[class*="option"], div[class*="choice"]');
                }
                if (ngClickParent) {
                  ngClickParent.click();
                  if (noneOption.id) {
                    const associatedLabel = document.querySelector(`label[for="${noneOption.id}"]`);
                    if (associatedLabel) {
                      associatedLabel.click();
                    }
                  }
                  radioMatched = true;
                  console.log(`[FALLBACK] ✓ Successfully selected "None of the above" via Angular click`);
                }
              } else {
                // Regular click
                noneOption.click();
                noneOption.dispatchEvent(new Event('change', { bubbles: true }));
                if (noneOption.id) {
                  const associatedLabel = document.querySelector(`label[for="${noneOption.id}"]`);
                  if (associatedLabel) {
                    associatedLabel.click();
                  }
                }
                radioMatched = true;
                console.log(`[FALLBACK] ✓ Successfully selected "None of the above" via regular click`);
              }
            } else {
              console.warn(`[FALLBACK] ⚠️ "None of the above" option not found in radio buttons`);
            }
          }
        }

        // 🔧 V1.9.13 CAROUSEL NAVIGATION: If this is a carousel question, click forward arrow
        if (radioMatched && question.isCarousel) {
          console.log(`[CAROUSEL] Question answered, looking for forward navigation button...`);

          // Wait a bit for the answer to register
          await sleep(300);

          // Find the forward arrow button
          const forwardButton = document.querySelector('[data-warp-role="srtForward"], .nav-forward:not(.hidden), .carousel-control-next, [class*="forward"]:not(.hidden)');

          if (forwardButton) {
            console.log(`[CAROUSEL] ✓ Found forward button, clicking to advance to next item...`);
            forwardButton.click();
            forwardButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            // Wait for carousel animation
            await sleep(500);

            console.log(`[CAROUSEL] Advanced to next carousel item`);
          } else {
            console.log(`[CAROUSEL] ⚠️ No forward button found - carousel may auto-advance`);
          }
        }

        break;

      case 'label-radio':
        console.log(`Label-based radio answer:`, answer.answer);

        // For label-based radios, we click the label directly
        let labelAnswer = answer.answer;
        if (Array.isArray(labelAnswer)) {
          console.warn(`⚠️ Label radio received array answer (should be string). Using first item only.`);
          labelAnswer = labelAnswer[0];
        }

        const labelElements = question.elements || [];
        console.log(`Found ${labelElements.length} label elements`);
        console.log(`Looking for label with text: "${labelAnswer}"`);

        let labelMatched = false;
        for (const label of labelElements) {
          const labelText = label.textContent.trim();
          console.log(`Label option: text="${labelText}"`);

          // 🔧 LEVEL 4: Use fuzzy similarity matching for label-radio
          const sim = similarity(labelAnswer, labelText);
          const isMatch = sim > 0.8;

          if (isMatch && sim < 1.0) {
            console.log(`[LEVEL 4 MATCH] Label-radio: "${labelText}" ↔ "${labelAnswer}" (sim=${sim.toFixed(2)})`);
          } else if (!isMatch && sim > 0.5) {
            console.log(`[LEVEL 4 NO MATCH] Label-radio: "${labelText}" ↔ "${labelAnswer}" (sim=${sim.toFixed(2)})`);
          }

          if (isMatch && !labelMatched) {
            console.log(`✓ Matched label: "${labelText}"`);

            // Click the label to select the option
            const rect = label.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            label.dispatchEvent(new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: x,
              clientY: y,
              button: 0
            }));

            label.dispatchEvent(new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: x,
              clientY: y,
              button: 0
            }));

            label.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: x,
              clientY: y,
              button: 0
            }));

            label.click();

            labelMatched = true;
            break;
          }
        }

        if (!labelMatched) {
          console.warn(`No label matched answer: "${labelAnswer}"`);
        }
        break;

      case 'checkbox':
        console.log(`Checkbox group answer:`, answer.answer);
        // V1.9.64: For merged multi-select questions, use question.elements array
        const checkboxElements = question.elements || (element ? document.querySelectorAll(`input[name="${element.name}"]`) : []);
        let answersArray = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
        console.log(`Found ${checkboxElements.length} checkboxes (from ${question.elements ? 'question.elements' : 'querySelector'}), looking for:`, answersArray);

        // 🧩 V5.1.2: Material UI Fallback Layer — only triggers when 0 native checkboxes are found
        if (checkboxElements.length === 0) {
          console.log('[FILL] 🧩 Activating Material UI checkbox fallback...');

          // Look for common MUI / React checkbox/button wrappers
          const muiCandidates = Array.from(document.querySelectorAll(
            '.MuiListItemButton-root, .MuiCheckbox-root, [role="checkbox"], .option-text'
          ));

          console.log(`[FILL] Found ${muiCandidates.length} Material UI checkbox candidates`);

          let muiMatchCount = 0;
          muiCandidates.forEach(el => {
            try {
              const labelEl =
                el.querySelector('.MuiListItemText-root') ||
                el.querySelector('.option-text') ||
                el.closest('.MuiListItemButton-root') ||
                el;
              const label = (labelEl?.innerText || labelEl?.textContent || '').trim();

              answersArray.forEach(ans => {
                // 🔧 LEVEL 4: Use fuzzy similarity matching for Material UI checkboxes
                const sim = similarity(ans, label);
                const match = sim > 0.8;

                if (match) {
                  console.log(`[LEVEL 4 MATCH] Material UI: "${label}" ↔ "${ans}" (sim=${sim.toFixed(2)})`);
                  el.click();
                  muiMatchCount++;
                  console.log(`[FILL] ✅ Clicked Material UI checkbox for "${ans}"`);

                  // Record self-healing success
                  if (window.selfHeal) {
                    const platform = window.selfHeal.detectPlatform();
                    window.selfHeal.recordHealing(platform, 'materialUI.checkbox', {
                      type: 'selector',
                      selectors: ['.MuiListItemButton-root', '.MuiCheckbox-root', '[role="checkbox"]']
                    });
                  }
                } else if (sim > 0.5) {
                  console.log(`[LEVEL 4 NO MATCH] Material UI: "${label}" ↔ "${ans}" (sim=${sim.toFixed(2)})`);
                }
              });
            } catch (err) {
              console.warn(`[FILL] ⚠️ MUI checkbox fallback error:`, err);
            }
          });

          console.log(`[FILL] Material UI fallback clicked ${muiMatchCount} checkboxes`);

          // Early exit since we used fallback path
          break;
        }

        // 🔧 V1.9.92 ATTENTION CHECK FIX: Check if checkboxes already have correct answers
        // If current_answer exists and matches the desired answers, skip clicking (avoids session errors)
        // If current_answer exists but DOESN'T match, we'll change it (fixes attention checks)
        if (question.current_answer && Array.isArray(question.current_answer)) {
          console.log(`[ATTENTION-CHECK] Checkboxes have pre-filled answers:`, question.current_answer);

          // Normalize both arrays for comparison
          const normalizeForComparison = (str) => String(str).trim().toLowerCase().replace(/\s+/g, ' ');
          const normalizedCurrent = question.current_answer.map(normalizeForComparison).sort();
          const normalizedDesired = answersArray.map(normalizeForComparison).sort();

          // Check if arrays are identical
          const arraysMatch = normalizedCurrent.length === normalizedDesired.length &&
                             normalizedCurrent.every((val, idx) => val === normalizedDesired[idx]);

          if (arraysMatch) {
            console.log(`[ATTENTION-CHECK] ✓ Current answers match desired answers - skipping click to avoid session conflicts`);
            break; // Exit the switch without clicking anything
          } else {
            console.log(`[ATTENTION-CHECK] ⚠️ Current answers DO NOT match desired answers`);
            console.log(`[ATTENTION-CHECK]   Current:`, normalizedCurrent);
            console.log(`[ATTENTION-CHECK]   Desired:`, normalizedDesired);
            console.log(`[ATTENTION-CHECK] 🔧 This is likely an ATTENTION CHECK with wrong pre-fill - will change it!`);
          }
        }

        // V1.9.66: Handle mutually exclusive "Prefer not to answer" radio buttons
        // Some surveys (IPSOS) have a radio button for "Prefer not to answer" that conflicts with checkboxes
        // We need to uncheck it before filling checkboxes to avoid validation errors
        if (checkboxElements.length > 0) {
          // Extract the question prefix from the first checkbox name (e.g., Q120-1 → Q120)
          const firstCheckbox = checkboxElements[0];
          if (firstCheckbox && firstCheckbox.name) {
            let questionPrefix = null;

            // Try different patterns: Q120-1 → Q120, answer-q120-1 → q120
            const prefixMatch = firstCheckbox.name.match(/^([A-Z]+\d+)-/);
            if (prefixMatch) {
              questionPrefix = prefixMatch[1];
            } else {
              const answerMatch = firstCheckbox.name.match(/answer-([a-z]+\d+)-/);
              if (answerMatch) {
                questionPrefix = answerMatch[1];
              }
            }

            if (questionPrefix) {
              console.log(`[MUTEX_RADIO] Checking for conflicting radio button with prefix: ${questionPrefix}`);

              // Look for radio buttons with similar naming pattern (e.g., Q120-997 or just Q120)
              const allRadios = document.querySelectorAll('input[type="radio"]');
              console.log(`[MUTEX_RADIO] Found ${allRadios.length} radio buttons on page`);

              for (const radio of allRadios) {
                // Check if radio is selected: either checked property OR has a non-empty value
                const isSelected = radio.checked || (radio.value && radio.value !== '');

                if (radio.name && isSelected) {
                  console.log(`[MUTEX_RADIO] Checking radio: name="${radio.name}" value="${radio.value}" id="${radio.id}" checked=${radio.checked}`);

                  // Try multiple patterns to extract the radio's question prefix:
                  // 1. Q120-997 → Q120 (with dash suffix)
                  // 2. Q120 → Q120 (exact match, no dash)
                  // 3. answer-q120-997 → q120 (with dash suffix)
                  // 4. answer-q120 → q120 (exact match, no dash)
                  let radioPrefix = null;

                  const radioMatchDash = radio.name.match(/^([A-Z]+\d+)-/);  // Q120-997
                  const radioMatchExact = radio.name.match(/^([A-Z]+\d+)$/);  // Q120
                  const radioAnswerMatchDash = radio.name.match(/answer-([a-z]+\d+)-/);  // answer-q120-997
                  const radioAnswerMatchExact = radio.name.match(/answer-([a-z]+\d+)$/);  // answer-q120

                  if (radioMatchDash) {
                    radioPrefix = radioMatchDash[1];
                  } else if (radioMatchExact) {
                    radioPrefix = radioMatchExact[1];
                  } else if (radioAnswerMatchDash) {
                    radioPrefix = radioAnswerMatchDash[1];
                  } else if (radioAnswerMatchExact) {
                    radioPrefix = radioAnswerMatchExact[1];
                  }

                  console.log(`[MUTEX_RADIO] Extracted radioPrefix: ${radioPrefix}`);

                  if (radioPrefix && radioPrefix.toLowerCase() === questionPrefix.toLowerCase()) {
                    // Found a radio with same question prefix - check if it's "Prefer not to answer"
                    const radioLabel = getOptionLabel(radio);
                    const labelText = typeof radioLabel === 'string' ? radioLabel.toLowerCase() :
                                     (radioLabel && radioLabel.text ? radioLabel.text.toLowerCase() : '');

                    // Common "prefer not to answer" patterns
                    const isPreferNotToAnswer = labelText.includes('prefer not') ||
                                               labelText.includes('rather not') ||
                                               labelText.includes('decline to answer') ||
                                               radio.value.match(/-99\d$/); // Common survey code for "prefer not to answer"

                    if (isPreferNotToAnswer) {
                      console.log(`[MUTEX_RADIO] ⚠️ Found checked "Prefer not to answer" radio: ${radio.name} (value: ${radio.value})`);
                      console.log(`[MUTEX_RADIO] Unchecking to allow checkbox selection...`);

                      radio.checked = false;
                      radio.dispatchEvent(new Event('change', { bubbles: true }));
                      radio.dispatchEvent(new Event('input', { bubbles: true }));

                      console.log(`[MUTEX_RADIO] ✓ Unchecked radio button: ${radio.name}`);

                      // V1.9.69: IPSOS uses a hidden input to track answer order (e.g., value="997,2")
                      // We need to remove the radio's value from this hidden input to fully uncheck it
                      const hiddenInput = document.querySelector(`input[type="hidden"][name="${radio.name}-m"]`) ||
                                         document.querySelector(`input[type="hidden"][questionname="${radio.name}-m"]`) ||
                                         document.querySelector(`input[type="hidden"].answerOrder`);

                      if (hiddenInput && hiddenInput.value) {
                        const radioValueId = radio.value.match(/\d+$/)?.[0]; // Extract number from "q120-997" → "997"
                        if (radioValueId) {
                          const currentValues = hiddenInput.value.split(',').map(v => v.trim());
                          const newValues = currentValues.filter(v => v !== radioValueId);
                          hiddenInput.value = newValues.join(',');

                          console.log(`[MUTEX_RADIO] ✓ Updated hidden input: "${hiddenInput.name}" from "${currentValues.join(',')}" to "${newValues.join(',')}"`);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // ⚠️ ENFORCE maxAllowed constraint
        if (question.maxAllowed !== undefined && answersArray.length > question.maxAllowed) {
          console.warn(`[CONSTRAINT] ⚠️ Claude provided ${answersArray.length} answers but maxAllowed is ${question.maxAllowed}`);
          console.warn(`[CONSTRAINT] Trimming to first ${question.maxAllowed} answers:`, answersArray.slice(0, question.maxAllowed));
          answersArray = answersArray.slice(0, question.maxAllowed);
        }

        let checkboxMatchCount = 0;

        // V1.9.77: Need index for IPSOS rowpicker matching
        checkboxElements.forEach((checkbox, checkboxIndex) => {
          const labelData = getOptionLabel(checkbox);  // FIX: Use getOptionLabel instead of findQuestionText
          // V5.1.1: Material UI checkboxes (buttons) don't have .value attribute, use textContent as fallback
          const value = checkbox.value || checkbox.textContent?.trim() || '';
          const id = checkbox.id;

          // V1.9.33: Handle both string labels and object labels {image, text}
          let label = labelData;
          if (typeof labelData === 'object' && labelData !== null && labelData.text) {
            label = labelData.text;
            console.log(`[VISION] Extracted text from image option: "${label}"`);
          }

          // Check if this checkbox should be checked
          // V5.1.1: Safe handling for Material UI checkboxes without value attribute
          // 🧠 LEVEL 5: Use auto-tuned fuzzy matching with learned transformations
          const safeValue = value || '';
          const shouldCheck = answersArray.some(ans => {
            const labelResult = similarityMatch(ans, label, platform, questionType);
            const valueResult = safeValue ? similarityMatch(ans, value, platform, questionType) : { match: false, score: 0 };
            const maxSim = Math.max(labelResult.score, valueResult.score);
            const match = labelResult.match || valueResult.match;

            if (match) {
              console.log(`[LEVEL 5 MATCH] "${label}" ↔ "${ans}" (sim=${maxSim.toFixed(2)}, threshold=${labelResult.threshold.toFixed(2)})`);
            } else if (maxSim > 0.5) {
              // Log near-misses for debugging
              console.log(`[LEVEL 5 NO MATCH] "${label}" ↔ "${ans}" (sim=${maxSim.toFixed(2)}, threshold=${labelResult.threshold.toFixed(2)})`);
            }

            return match;
          });

          console.log(`Checkbox "${id}" - label: "${label}", value: "${value}", shouldCheck: ${shouldCheck}`);

          // Additional check: Don't check more than maxAllowed
          if (shouldCheck && question.maxAllowed !== undefined && checkboxMatchCount >= question.maxAllowed) {
            console.log(`[CONSTRAINT] ⚠️ Already checked ${checkboxMatchCount} items (maxAllowed: ${question.maxAllowed}), skipping "${label}"`);
            checkbox.checked = false;
          } else if (shouldCheck) {
            // V1.9.74: Check for IPSOS rowpicker FIRST - start from checkbox and navigate UP
            let ipsosHandled = false;

            console.log(`[IPSOS-ROWPICKER-CHECKBOX] Starting from checkbox "${checkbox.id}" (index ${checkboxIndex}/${checkboxElements.length}), looking for IPSOS container...`);

            // V1.9.77: Back to v1.9.74 approach BUT use checkboxIndex to pick the right div
            let clickableDiv = null;
            let currentElement = checkbox;
            let containerFound = false;

            for (let i = 0; i < 10 && currentElement; i++) {
              currentElement = currentElement.parentElement;
              if (!currentElement) break;

              const clickableDivs = currentElement.querySelectorAll('[tabindex="0"]');

              // Filter to IPSOS divs
              const ipsosClickableDivs = [];
              for (const div of clickableDivs) {
                const style = window.getComputedStyle(div);
                if (style.cursor === 'pointer' && style.position === 'absolute') {
                  ipsosClickableDivs.push(div);
                }
              }

              console.log(`[IPSOS-ROWPICKER-CHECKBOX] Level ${i}: found ${ipsosClickableDivs.length} IPSOS clickable divs`);

              // V1.9.77: If found 1, use it. If found multiple, use checkboxIndex to pick the right one
              if (ipsosClickableDivs.length === 1) {
                clickableDiv = ipsosClickableDivs[0];
                console.log(`[IPSOS-ROWPICKER-CHECKBOX] ✓ Found clickable overlay at level ${i} (single match)`);
                containerFound = true;
                break;
              } else if (ipsosClickableDivs.length > 1) {
                // Multiple divs found - use INDEX to pick the right one
                if (checkboxIndex < ipsosClickableDivs.length) {
                  clickableDiv = ipsosClickableDivs[checkboxIndex];
                  console.log(`[IPSOS-ROWPICKER-CHECKBOX] ✓ Found clickable overlay at level ${i} using INDEX ${checkboxIndex} of ${ipsosClickableDivs.length} divs`);
                  containerFound = true;
                  break;
                } else {
                  console.log(`[IPSOS-ROWPICKER-CHECKBOX] ⚠️ checkboxIndex ${checkboxIndex} >= divs length ${ipsosClickableDivs.length}, continuing search...`);
                }
              }
            }

            if (clickableDiv) {
              console.log(`[IPSOS-ROWPICKER-CHECKBOX] Found IPSOS clickable div for checkbox "${checkbox.id}"`);
              console.log(`[IPSOS-ROWPICKER-CHECKBOX] Clickable div style: position=${window.getComputedStyle(clickableDiv).position}, cursor=${window.getComputedStyle(clickableDiv).cursor}, zIndex=${window.getComputedStyle(clickableDiv).zIndex}`);

              // Get bounding rect
              const rect = clickableDiv.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;

              console.log(`[IPSOS-ROWPICKER-CHECKBOX] Clicking at coordinates (${x}, ${y})`);

              // Dispatch full event sequence
              clickableDiv.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
              clickableDiv.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window, clientX: x, clientY: y }));
              clickableDiv.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window, clientX: x, clientY: y }));

              clickableDiv.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
              }));

              clickableDiv.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0,
                buttons: 1
              }));

              clickableDiv.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
              }));

              clickableDiv.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0,
                buttons: 0
              }));

              clickableDiv.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0,
                detail: 1
              }));

              // Also try direct click
              try {
                clickableDiv.click();
                console.log(`[IPSOS-ROWPICKER-CHECKBOX] ✓ Executed clickableDiv.click()`);
              } catch (e) {
                console.log(`[IPSOS-ROWPICKER-CHECKBOX] clickableDiv.click() failed: ${e.message}`);
              }

              // Wait a bit and verify if checkbox was checked
              setTimeout(() => {
                console.log(`[IPSOS-ROWPICKER-CHECKBOX] Verification: checkbox.checked = ${checkbox.checked}`);
                const hiddenInput = document.querySelector(`input[type="hidden"].answerOrder`);
                if (hiddenInput) {
                  console.log(`[IPSOS-ROWPICKER-CHECKBOX] Verification: hidden input value = "${hiddenInput.value}"`);
                }
              }, 100);

              ipsosHandled = true;
              checkboxMatchCount++;
            } else {
              console.log(`[IPSOS-ROWPICKER-CHECKBOX] ⚠️ No IPSOS clickable div found for checkbox "${checkbox.id}"`);
            }

            // V1.9.71: Only use standard checkbox manipulation if IPSOS didn't handle it
            if (!ipsosHandled) {
              console.log(`[STANDARD-CHECKBOX] Using standard checkbox click for: ${id}`);

              // Simulate realistic human click sequence for checkboxes
              try {
                checkbox.focus();
              } catch (e) { /* some elements can't be focused */ }

              const rect = checkbox.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;

              // Dispatch realistic mouse events
              checkbox.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0
              }));

              checkbox.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0
              }));

              checkbox.checked = true;

              checkbox.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0
              }));

              try {
                checkbox.click();
              } catch (e) { /* click() might fail */ }

              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
              checkbox.dispatchEvent(new Event('input', { bubbles: true }));

              checkboxMatchCount++;
              console.log(`✓ Checked checkbox: ${id}`);
            }
          } else {
            checkbox.checked = false; // Uncheck if not in answer array
          }
        });

        console.log(`Checked ${checkboxMatchCount} out of ${answersArray.length} requested checkboxes`);
        if (question.maxAllowed !== undefined) {
          console.log(`[CONSTRAINT] ✓ Respected maxAllowed constraint: ${question.maxAllowed}`);
        }
        break;

      case 'select':
        console.log(`Select/dropdown answer:`, answer.answer);

        // Check if this is a multi-select dropdown
        const isMultiSelect = element.hasAttribute('multiple');
        console.log(`isMultiSelect: ${isMultiSelect}`);

        const options = element.querySelectorAll('option');

        if (isMultiSelect) {
          // Multi-select: Handle array of answers
          let answersArray = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
          console.log(`Multi-select dropdown: selecting ${answersArray.length} options`);

          let matchCount = 0;

          options.forEach(opt => {
            const optText = opt.textContent.trim();
            const optValue = opt.value;

            // 🔧 LEVEL 4: Use fuzzy similarity matching for multi-select dropdowns
            const isMatch = answersArray.some(ans => {
              const textSim = similarity(ans, optText);
              const valueSim = optValue ? similarity(ans, optValue) : 0;
              const maxSim = Math.max(textSim, valueSim);
              const match = maxSim > 0.8;

              if (match && maxSim < 1.0) {
                console.log(`[LEVEL 4 MATCH] Select: "${optText}" ↔ "${ans}" (sim=${maxSim.toFixed(2)})`);
              } else if (!match && maxSim > 0.5) {
                console.log(`[LEVEL 4 NO MATCH] Select: "${optText}" ↔ "${ans}" (sim=${maxSim.toFixed(2)})`);
              }

              return match;
            });

            if (isMatch) {
              console.log(`✓ Selecting option: "${optText}" (value: ${optValue})`);
              opt.selected = true;
              matchCount++;
            } else {
              opt.selected = false;
            }
          });

          // Trigger change event
          element.dispatchEvent(new Event('change', { bubbles: true }));

          // CRITICAL: For Bootstrap selectpicker, also trigger manual refresh
          if (element.classList.contains('selectpicker')) {
            console.log('[BOOTSTRAP] Triggering selectpicker refresh');
            // Try to refresh the Bootstrap selectpicker UI
            try {
              if (typeof $ !== 'undefined' && $.fn.selectpicker) {
                $(element).selectpicker('refresh');
              }
            } catch (e) {
              console.warn('[BOOTSTRAP] Could not refresh selectpicker:', e);
            }
          }

          console.log(`Selected ${matchCount} out of ${answersArray.length} requested options`);

        } else {
          // Single-select: Use first answer only
          let selectAnswer = Array.isArray(answer.answer) ? answer.answer[0] : answer.answer;
          console.log(`Single-select dropdown: "${selectAnswer}"`);

          let selectMatched = false;

          options.forEach(opt => {
            const optText = opt.textContent.trim();
            const optValue = opt.value;

            // 🧠 LEVEL 5: Use auto-tuned fuzzy matching with learned transformations
            const textResult = similarityMatch(selectAnswer, optText, platform, questionType);
            const valueResult = optValue ? similarityMatch(selectAnswer, optValue, platform, questionType) : { match: false, score: 0 };
            const maxSim = Math.max(textResult.score, valueResult.score);
            const isMatch = textResult.match || valueResult.match;

            if (isMatch && maxSim < 1.0) {
              console.log(`[LEVEL 5 MATCH] Select: "${optText}" ↔ "${selectAnswer}" (sim=${maxSim.toFixed(2)}, threshold=${textResult.threshold.toFixed(2)})`);
            } else if (!isMatch && maxSim > 0.5) {
              console.log(`[LEVEL 5 NO MATCH] Select: "${optText}" ↔ "${selectAnswer}" (sim=${maxSim.toFixed(2)}, threshold=${textResult.threshold.toFixed(2)})`);
            }

            if (!selectMatched && isMatch) {
              console.log(`✓ Matched option: "${optText}" (value: ${optValue})`);

              // IPSOS Interactive fix (v1.9.24): Fire focus event BEFORE changing value
              element.dispatchEvent(new Event('focus', { bubbles: true }));

              // Simulate user interaction with click event
              element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

              // Set the value and selected property
              element.value = opt.value;
              opt.selected = true;

              // Trigger multiple events for compatibility with different survey platforms
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));

              // Execute onchange handler if present (IPSOS fix)
              if (element.onchange) {
                console.log(`[IPSOS] Executing onchange handler for ${element.id}`);
                element.onchange.call(element, new Event('change'));
              }

              element.dispatchEvent(new Event('blur', { bubbles: true }));

              // Also trigger jQuery change event if jQuery is available (Ipsos uses jQuery)
              if (typeof $ !== 'undefined' && $(element).length) {
                console.log(`[IPSOS] Triggering jQuery change event for ${element.id}`);
                $(element).trigger('change');
              }

              // Highlight the element to show it was filled
              highlightElement(element);

              selectMatched = true;
            }
          });

          if (!selectMatched) {
            console.warn(`No option matched answer: "${selectAnswer}"`);
          }

          // IPSOS Vue.js fix (v1.9.25): Update visible Vue.js dropdown if present
          // IPSOS uses dual dropdowns: hidden (with ID) + visible Vue.js (no ID)
          if (selectMatched && element.classList.contains('mrDropdown')) {
            console.log(`[VUE] Detected IPSOS mrDropdown, looking for visible Vue.js dropdown...`);

            // Find all hidden and visible dropdowns, match by index
            const allMrDropdowns = Array.from(document.querySelectorAll('select.mrDropdown'));
            const allVueDropdowns = Array.from(document.querySelectorAll('select.vDropdown, select[data-v-]'));

            const mrIndex = allMrDropdowns.indexOf(element);
            console.log(`[VUE] This is mrDropdown #${mrIndex + 1} of ${allMrDropdowns.length}`);
            console.log(`[VUE] Found ${allVueDropdowns.length} Vue.js dropdowns on page`);

            // Match by index - 1st mrDropdown -> 1st vDropdown, 2nd -> 2nd, etc.
            if (mrIndex >= 0 && mrIndex < allVueDropdowns.length) {
              const vueDropdown = allVueDropdowns[mrIndex];
              console.log(`[VUE] Matched with vDropdown #${mrIndex + 1}, syncing value...`);

              // Set the Vue dropdown value to match
              vueDropdown.value = element.value;

              // Trigger events on Vue dropdown
              vueDropdown.dispatchEvent(new Event('focus', { bubbles: true }));
              vueDropdown.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              vueDropdown.dispatchEvent(new Event('input', { bubbles: true }));
              vueDropdown.dispatchEvent(new Event('change', { bubbles: true }));
              vueDropdown.dispatchEvent(new Event('blur', { bubbles: true }));

              console.log(`[VUE] ✓ Synced Vue dropdown to value: ${vueDropdown.value}`);
            } else {
              // V1.9.30: No Vue dropdown found, trigger events on original IPSOS dropdown
              console.log(`[VUE] No matching Vue.js dropdown found (index ${mrIndex} out of range)`);
              console.log(`[VUE] Triggering events on original mrDropdown for IPSOS validation...`);

              // Trigger native events
              element.dispatchEvent(new Event('focus', { bubbles: true }));
              element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.dispatchEvent(new Event('blur', { bubbles: true }));

              // V1.9.30: Also trigger jQuery events for IPSOS
              if (typeof $ !== 'undefined' && $ && $.fn) {
                $(element).trigger('focus').trigger('mousedown').trigger('input').trigger('change').trigger('blur');
                console.log(`[VUE] ✓ jQuery events triggered on mrDropdown`);
              }

              console.log(`[VUE] ✓ Events triggered on mrDropdown`);
            }
          }
        }
        break;

      case 'range':
        element.value = answer.answer;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        break;

      case 'ranksort':
        console.log(`[RANKSORT] Filling rank-order grid question`);
        console.log(`[RANKSORT] Answer format:`, answer.answer);

        // Answer should be an array of ranked items (ordered by rank)
        // Example: ["Flavour", "Price", "Organic"]
        let rankedItems = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
        console.log(`[RANKSORT] Need to rank ${rankedItems.length} items: ${rankedItems.join(', ')}`);

        // Get the buckets and cards
        const bucketElements = Array.from(element.querySelectorAll('.sq-ranksort-bucket'));
        const cardsList = element.querySelector('.sq-ranksort-cards');

        console.log(`[RANKSORT] Found ${bucketElements.length} buckets and ${question.items.length} cards`);

        // Track which cards were moved
        let movedCount = 0;

        // For each ranked item (in order), find matching card and move to bucket
        rankedItems.forEach((rankedItem, rankIndex) => {
          if (rankIndex >= bucketElements.length) {
            console.warn(`[RANKSORT] Rank ${rankIndex + 1} exceeds available buckets (${bucketElements.length})`);
            return;
          }

          // Find matching card using Level 5 fuzzy matching
          let bestMatch = null;
          let bestScore = 0;

          question.items.forEach(item => {
            const result = similarityMatch(rankedItem, item.text, platform, questionType);
            if (result.score > bestScore) {
              bestScore = result.score;
              bestMatch = item;
            }
          });

          if (!bestMatch || bestScore < tunedParams.fuzzyThreshold) {
            console.warn(`[RANKSORT] No match found for "${rankedItem}" (best score: ${bestScore.toFixed(2)})`);
            return;
          }

          console.log(`[LEVEL 5 MATCH] Ranksort: "${bestMatch.text}" ↔ "${rankedItem}" (sim=${bestScore.toFixed(2)}, threshold=${tunedParams.fuzzyThreshold.toFixed(2)})`);

          const card = bestMatch.element;
          const targetBucket = bucketElements[rankIndex];

          try {
            // METHOD 1: Try to use drag/drop simulation
            console.log(`[RANKSORT] Moving card "${bestMatch.text}" to rank ${rankIndex + 1} (${targetBucket.querySelector('.sq-ranksort-bucket-text')?.textContent || '#' + (rankIndex + 1)})`);

            // Get coordinates for drag simulation
            const cardRect = card.getBoundingClientRect();
            const bucketRect = targetBucket.getBoundingClientRect();

            const cardX = cardRect.left + cardRect.width / 2;
            const cardY = cardRect.top + cardRect.height / 2;
            const bucketX = bucketRect.left + bucketRect.width / 2;
            const bucketY = bucketRect.top + bucketRect.height / 2;

            // Simulate drag events
            const dragStartEvent = new DragEvent('dragstart', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: cardX,
              clientY: cardY,
              dataTransfer: new DataTransfer()
            });
            card.dispatchEvent(dragStartEvent);

            const dragEnterEvent = new DragEvent('dragenter', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: bucketX,
              clientY: bucketY
            });
            targetBucket.dispatchEvent(dragEnterEvent);

            const dragOverEvent = new DragEvent('dragover', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: bucketX,
              clientY: bucketY
            });
            targetBucket.dispatchEvent(dragOverEvent);

            const dropEvent = new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: bucketX,
              clientY: bucketY,
              dataTransfer: new DataTransfer()
            });
            targetBucket.dispatchEvent(dropEvent);

            const dragEndEvent = new DragEvent('dragend', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: bucketX,
              clientY: bucketY
            });
            card.dispatchEvent(dragEndEvent);

            // METHOD 2: Direct DOM manipulation as fallback
            // Move card to bucket by appending it
            targetBucket.appendChild(card);

            // Update the hidden select dropdown
            const selectElement = document.querySelector(`select[name*="${bestMatch.dataIndex}"]`);
            if (selectElement) {
              selectElement.value = String(rankIndex);
              selectElement.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`[RANKSORT] Updated hidden select for item ${bestMatch.dataIndex} to rank ${rankIndex}`);
            }

            // Update card's rank icon
            const rankIcon = card.querySelector('.sq-ranksort-icon-rank');
            if (rankIcon) {
              rankIcon.textContent = String(rankIndex + 1);
              rankIcon.classList.remove('sq-ranksort-hidden');
            }

            movedCount++;

            // Record successful pattern for meta-learning
            recordHeuristic(platform, questionType, 'ranksortMatch', {
              itemText: bestMatch.text,
              answerText: rankedItem,
              similarity: bestScore
            }, true);

          } catch (e) {
            console.error(`[RANKSORT] Error moving card:`, e);
            recordHeuristic(platform, questionType, 'ranksortError', {
              error: e.message
            }, false);
          }
        });

        console.log(`[RANKSORT] Moved ${movedCount} out of ${rankedItems.length} items to buckets`);

        // Trigger Decipher validation update if available
        try {
          if (typeof Survey !== 'undefined' && Survey.question && Survey.question.ranksort) {
            if (typeof Survey.question.ranksort.update === 'function') {
              console.log(`[RANKSORT] Calling Survey.question.ranksort.update()`);
              Survey.question.ranksort.update(question.question_id);
            }
          }
        } catch (e) {
          console.warn(`[RANKSORT] Could not trigger ranksort update:`, e);
        }

        // Trigger change event on container
        element.dispatchEvent(new Event('change', { bubbles: true }));

        break;
    }

    // Highlight filled element
    highlightElement(element);

  } catch (error) {
    console.error(`Error filling question ${question.question_id}:`, error);
    fillSuccess = false;

    // 🧠 LEVEL 5: Track fill failure
    trackFillAttempt(platform, questionType, false);

    // If this was a selector issue, record it as a failed heuristic
    if (error.message && error.message.includes('selector')) {
      recordHeuristic(platform, questionType, 'selectorFallback', {
        error: error.message,
        questionId: question.question_id
      }, false);
    }

    throw error; // Re-throw for upstream handling
  }

  // If we got here, fill was successful
  fillSuccess = true;

  // 🧠 LEVEL 5: Track fill success
  trackFillAttempt(platform, questionType, true);

  // Record successful fill time as potential learned heuristic
  const fillDuration = Date.now() - fillAttemptStart;
  if (fillDuration > tunedParams.waitTime * 2) {
    // This question took longer than expected - record it for future tuning
    recordHeuristic(platform, questionType, 'slowFill', {
      duration: fillDuration,
      expectedWait: tunedParams.waitTime
    }, true);
  }

  // Save question to database (after successful fill)
  await saveQuestionToDatabase(question, answer);
}

// Visual feedback helpers
function highlightElement(element) {
  // V1.9.64: Check if element exists (merged questions have null element)
  if (!element) return;

  element.style.transition = 'all 0.3s ease';
  element.style.backgroundColor = '#d4edda';

  setTimeout(() => {
    element.style.backgroundColor = '';
  }, 1000);
}

function showLoading(message) {
  removeNotification();

  const loading = document.createElement('div');
  loading.id = 'wildpoptart-loading';
  loading.className = 'wildpoptart-notification wildpoptart-loading';
  loading.innerHTML = `
    <div class="spinner"></div>
    <span>${message}</span>
  `;

  document.body.appendChild(loading);
}

function showNotification(message, type = 'info') {
  removeNotification();

  const notification = document.createElement('div');
  notification.id = 'wildpoptart-notification';
  notification.className = `wildpoptart-notification wildpoptart-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    removeNotification();
  }, 5000);
}

function removeNotification() {
  const existing = document.querySelectorAll('#wildpoptart-notification, #wildpoptart-loading');
  existing.forEach(el => el.remove());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// V1.9.33: Fetch image and convert to base64 for Claude Vision API
async function fetchImageAsBase64(imageUrl) {
  try {
    console.log(`[VISION] Fetching image: ${imageUrl}`);

    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`[VISION] Failed to fetch image: ${response.status} ${response.statusText}`);
      return null;
    }

    // Convert to blob, then to base64
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Extract base64 data (remove the data:image/...;base64, prefix)
        const base64data = reader.result.split(',')[1];
        console.log(`[VISION] ✓ Converted image to base64 (${base64data.length} bytes)`);
        resolve(base64data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`[VISION] Error fetching image ${imageUrl}:`, error);
    return null;
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['isActive', 'autoFill'], (result) => {
      // Enable autoFill by default if not set
      const autoFillSetting = result.autoFill !== undefined ? result.autoFill : true;

      console.log('[AUTO-FILL] Storage check - isActive:', result.isActive, 'autoFill:', autoFillSetting);

      if (result.isActive) {
        isActive = true;
        autoFillEnabled = autoFillSetting;
        startSurveyDetection();

        // AUTO-FILL: Automatically fill survey after page loads
        if (autoFillSetting) {
          console.log('[AUTO-FILL] ✅ ENABLED - will auto-fill in 2 seconds...');
          setTimeout(() => {
            console.log('[AUTO-FILL] Timeout triggered, calling autoFillSurvey()...');
            autoFillSurvey();
          }, 2000); // Wait 2 seconds for page to fully load
        } else {
          console.log('[AUTO-FILL] ❌ DISABLED - you must click 🍰 button manually');
        }
      } else {
        console.log('[AUTO-FILL] Extension is not active - click Activate in popup first');
      }

      // Set autoFill to true by default if it's not already set
      if (result.autoFill === undefined) {
        chrome.storage.local.set({ autoFill: true });
        console.log('[AUTO-FILL] Enabled by default');
      }
    });
  });
} else {
  chrome.storage.local.get(['isActive', 'autoFill'], (result) => {
    // Enable autoFill by default if not set
    const autoFillSetting = result.autoFill !== undefined ? result.autoFill : true;

    console.log('[AUTO-FILL] Storage check (else) - isActive:', result.isActive, 'autoFill:', autoFillSetting);

    if (result.isActive) {
      isActive = true;
      autoFillEnabled = autoFillSetting;
      startSurveyDetection();

      // AUTO-FILL: Automatically fill survey after page loads
      if (autoFillSetting) {
        console.log('[AUTO-FILL] ✅ ENABLED - will auto-fill in 2 seconds...');
        setTimeout(() => {
          console.log('[AUTO-FILL] Timeout triggered, calling autoFillSurvey()...');
          autoFillSurvey();
        }, 2000); // Wait 2 seconds for page to fully load
      } else {
        console.log('[AUTO-FILL] ❌ DISABLED - you must click 🍰 button manually');
      }
    } else {
      console.log('[AUTO-FILL] Extension is not active - click Activate in popup first');
    }

    // Set autoFill to true by default if it's not already set
    if (result.autoFill === undefined) {
      chrome.storage.local.set({ autoFill: true });
      console.log('[AUTO-FILL] Enabled by default');
    }
  });
}

// Auto-fill function - fills survey automatically without button click
async function autoFillSurvey() {
  // FIRST: Check if this is a user agreement/consent screen
  const agreementClicked = await handleUserAgreementScreen();
  if (agreementClicked) {
    console.log('[AUTO-FILL] User agreement screen handled, waiting for next page...');
    return; // Wait for next page to load
  }

  // SECOND: Check if this is an intro/welcome page with just a Continue button
  const continueClicked = await handleContinuePage();
  if (continueClicked) {
    console.log('[AUTO-FILL] Continue page handled, waiting for next page...');
    return; // Wait for next page to load
  }

  // Check if there are questions on the page
  const questions = await detectQuestions();

  if (questions.length === 0) {
    console.log('[AUTO-FILL] No questions detected, skipping auto-fill');
    return;
  }

  console.log(`[AUTO-FILL] Detected ${questions.length} questions, auto-filling...`);
  await processSurvey();
}

// Handle intro/welcome/continue pages
// @param {boolean} forceClick - If true, look for continue buttons even if inputs exist (e.g., when 0 unanswered questions)
async function handleContinuePage(forceClick = false) {
  console.log('[CONTINUE] Checking for intro/welcome page... (forceClick=' + forceClick + ')');

  // Keywords that indicate this is an intro/welcome/consent page
  const introKeywords = [
    'thank you in advance',
    'thank you for participating',
    'thank you for your participation',
    'welcome to',
    'welcome and thank you',
    'before we begin',
    'let\'s get started',
    'first stage of the survey',
    'this survey will take',
    'we appreciate your',
    'introduction',
    'please read',
    'the next few questions',
    'instructions',
    'opting into this survey',
    'consenting to answer',
    'by selecting',
    'i agree below',
    'consent to the capture'
  ];

  const pageText = document.body.innerText.toLowerCase();

  // Check if page contains intro keywords
  let isIntroPage = introKeywords.some(keyword => pageText.includes(keyword));

  // Also check for "Instructions" header/title
  const headers = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"]');
  for (const header of headers) {
    const headerText = header.textContent.toLowerCase().trim();
    if (headerText === 'instructions' || headerText.includes('instruction')) {
      console.log('[CONTINUE] ✓ Found "Instructions" header - this is an intro page');
      isIntroPage = true;
      break;
    }
  }

  // Count only VISIBLE input fields (exclude reCAPTCHA and other hidden fields)
  const allInputsOnPage = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select');
  let inputCount = 0;
  for (const inp of allInputsOnPage) {
    const computedStyle = window.getComputedStyle(inp);
    const isVisible = computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden' && inp.offsetParent !== null;
    if (isVisible) {
      inputCount++;
    }
  }
  console.log(`[CONTINUE] Found ${inputCount} visible input fields on page`);

  if (isIntroPage || inputCount === 0 || forceClick) {
    if (forceClick) {
      console.log('[CONTINUE] ✓ Force-clicking continue button (0 unanswered questions detected)');
    } else {
      console.log('[CONTINUE] ✓ Intro/welcome page detected (or no inputs found)');
    }

    // Look for Continue buttons AND navigation links
    // IMPORTANT: Order matters! Check most specific selectors first
    const continueButtonSelectors = [
      // 1. Specific submit inputs with navigation text
      'input[type="submit"][value*="Start"]',
      'input[type="submit"][value*="start"]',
      'input[type="submit"][value*="Continue"]',
      'input[type="submit"][value*="continue"]',
      'input[type="submit"][value*="Next"]',
      'input[type="submit"][value*="next"]',
      'input[type="submit"][value*="Begin"]',
      'input[type="submit"][value*="begin"]',

      // 2. Submit inputs by name/id/class
      'input[type="submit"][name*="continue"]',
      'input[type="submit"][id*="continue"]',
      'input[type="submit"][name*="next"]',
      'input[type="submit"][id*="next"]',
      'input[type="submit"].continue',
      'input[type="submit"].next',

      // 3. All submit inputs (catch-all for submit buttons)
      'input[type="submit"]',

      // V1.9.46: Add support for input[type="button"] (Qualtrics Next buttons)
      // 4. Button-type inputs with navigation text
      'input[type="button"][value*="Start"]',
      'input[type="button"][value*="start"]',
      'input[type="button"][value*="Continue"]',
      'input[type="button"][value*="continue"]',
      'input[type="button"][value*="Next"]',
      'input[type="button"][value*="next"]',
      'input[type="button"][value*="Begin"]',
      'input[type="button"][value*="begin"]',
      'input[type="button"][id*="Next"]',      // Matches "NextButton"
      'input[type="button"][id*="next"]',
      'input[type="button"][class*="Next"]',   // Matches "NextButton Button"
      'input[type="button"][class*="next"]',

      // V1.9.59: Add support for input[type="image"] (Adhoc-Recherche, old ASP.NET surveys)
      // 4b. Image-type inputs with navigation indicators
      'input[type="image"][class*="next"]',
      'input[type="image"][class*="Next"]',
      'input[type="image"][id*="next"]',
      'input[type="image"][id*="Next"]',
      'input[type="image"][alt*="next"]',
      'input[type="image"][alt*="Next"]',
      'input[type="image"][title*=">>>"]',     // Arrow symbols in title
      'input[type="image"][alt*=">>>"]',       // Arrow symbols in alt text
      'input[type="image"][title*=">>"]',
      'input[type="image"][alt*=">>"]',
      'input[type="image"]',                   // Catch-all for image inputs

      // 5. Submit-type buttons
      'button[type="submit"]',

      // 6. Specific button classes
      'button.continue',
      'button.next',
      'button.start',

      // 7. Navigation links
      'a.btn',
      'a[href*="start"]',
      'a[href*="continue"]',
      'a[href*="next"]',

      // 8. Generic selectors (LAST - most likely to match wrong elements)
      'button', // All buttons (will filter by text content below)
      'a' // All links (will filter by text content below)
    ];

    for (const selector of continueButtonSelectors) {
      const buttons = document.querySelectorAll(selector);

      for (const button of buttons) {
        // V1.9.59: For image inputs, also check title and alt attributes
        const buttonTitle = button.type === 'image' ? (button.getAttribute('title') || '') : '';
        const buttonAlt = button.type === 'image' ? (button.getAttribute('alt') || '') : '';
        const buttonText = (button.value || button.textContent || buttonTitle || buttonAlt || '').toLowerCase().trim();
        const buttonId = (button.id || '').toLowerCase();
        const buttonClass = (button.className || '').toLowerCase();
        const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
        const buttonHref = button.tagName === 'A' ? (button.getAttribute('href') || '').toLowerCase() : '';

        // Skip footer links (privacy, terms, contact, etc.)
        const isFooterLink = buttonText.includes('privacy') || buttonText.includes('terms') ||
                            buttonText.includes('conditions') || buttonText.includes('cookie') ||
                            buttonText.includes('our mission') || buttonText.includes('contact us') ||
                            buttonHref.includes('privacy') || buttonHref.includes('terms') ||
                            buttonHref.includes('contact');

        if (isFooterLink) {
          continue; // Skip this link
        }

        // Arrow symbols that indicate navigation
        const arrowSymbols = ['→', '➜', '⇒', '➔', '➞', '➡', '»', '>>>', '>>'];
        const hasArrowSymbol = arrowSymbols.some(arrow => buttonText.includes(arrow) || buttonTitle.includes(arrow) || buttonAlt.includes(arrow));

        // Check if this looks like a continue/next/start/submit/agree button or link
        if (buttonText.includes('continue') || buttonText.includes('next') ||
            buttonText.includes('start') || buttonText.includes('begin') ||
            buttonText.includes('enter') || buttonText.includes('submit') ||
            buttonText.includes('i agree') || buttonText.includes('agree') ||
            buttonText.includes('accept') || ariaLabel.includes('submit') ||
            ariaLabel.includes('continue') || ariaLabel.includes('next') ||
            ariaLabel.includes('agree') || buttonId.includes('continue') ||
            buttonId.includes('submit') || buttonId.includes('agree') ||
            buttonClass.includes('continue') || buttonClass.includes('submit') ||
            buttonClass.includes('start') || buttonHref.includes('start') ||
            buttonHref.includes('continue') || hasArrowSymbol) {

          // Check if visible and enabled
          const isVisible = button.offsetParent !== null || window.getComputedStyle(button).display !== 'none';
          const isEnabled = !button.disabled && !button.hasAttribute('disabled');

          if (isVisible && isEnabled) {
            console.log(`[CONTINUE] ✓ Found continue button: text="${buttonText}" id="${buttonId}" aria="${ariaLabel}" - CLICKING!`);
            console.log(`[CONTINUE] ↳ Button details: tagName="${button.tagName}", type="${button.type}", hasForm="${!!button.form}"`);

            // V1.9.59: If this is a submit or image button inside a form, click it (don't use form.submit())
            // Clicking image/submit buttons preserves their name/value in the submission
            if ((button.type === 'submit' || button.type === 'image') && button.form) {
              console.log(`[CONTINUE] ↳ This is a form ${button.type} button - clicking to submit with button data`);
              button.click();
              button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            } else if (button.type === 'submit' || button.type === 'image') {
              // Submit/image button but no form property - find parent form and click button
              const parentForm = button.closest('form');
              if (parentForm) {
                console.log(`[CONTINUE] ↳ Found parent form - clicking ${button.type} button to submit`);
                button.click();
                button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              } else {
                console.log(`[CONTINUE] ↳ No form found - using regular click`);
                button.click();
                button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              }
            } else {
              // Otherwise use regular click
              console.log(`[CONTINUE] ↳ Not a submit/image button - using regular click`);
              button.click();
              button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }

            // If auto-fill enabled, schedule next auto-fill for SPAs that don't reload
            if (autoFillEnabled) {
              setTimeout(async () => {
                console.log('[AUTO-FILL] Checking for questions after continue click...');
                await autoFillSurvey();
              }, 3000); // Wait 3 seconds for page transition
            }

            return true; // Continue button clicked
          }
        }
      }
    }

    // 🔧 V1.9.60: AGGRESSIVE FALLBACK STRATEGIES for intro pages
    // If we're on an intro page and haven't found a button yet, try more aggressive approaches
    if (forceClick || isIntroPage) {
      console.log('[CONTINUE] ⚠️ Priority selectors failed, trying aggressive fallback strategies for intro page...');

      // Helper: Check if button text indicates destructive action
      const isDestructiveButton = (btn) => {
        const destructiveKeywords = [
          'cancel', 'exit', 'quit', 'close', 'back',
          'previous', 'decline', 'no thanks', 'skip',
          'refuse', 'reject', 'deny', 'leave'
        ];

        const btnText = (btn.textContent || btn.value || btn.getAttribute('title') || btn.getAttribute('alt') || '').toLowerCase();
        return destructiveKeywords.some(word => btnText.includes(word));
      };

      // FALLBACK 1: Find buttons positioned at bottom-right (common Next button position)
      console.log('[CONTINUE] Fallback 1: Looking for bottom-right positioned buttons...');
      const allButtons = [
        ...document.querySelectorAll('button'),
        ...document.querySelectorAll('input[type="button"]'),
        ...document.querySelectorAll('input[type="submit"]'),
        ...document.querySelectorAll('input[type="image"]'),
        ...document.querySelectorAll('a.btn, a.button, [role="button"]')
      ];

      const bottomRightButtons = allButtons.filter(btn => {
        if (btn.id === 'wildpoptart-btn' || btn.classList.contains('wildpoptart-floating-btn')) return false;

        const rect = btn.getBoundingClientRect();
        const isVisible = btn.offsetParent !== null && window.getComputedStyle(btn).display !== 'none';
        const isEnabled = !btn.disabled && !btn.hasAttribute('disabled');

        // Bottom-right: x position > 50% of viewport width, y position > 50% of viewport height
        const isBottomRight = rect.left > window.innerWidth * 0.5 && rect.top > window.innerHeight * 0.5;

        // Skip destructive buttons
        if (isDestructiveButton(btn)) return false;

        return isVisible && isEnabled && isBottomRight;
      });

      if (bottomRightButtons.length > 0) {
        console.log(`[CONTINUE] ✓ Found ${bottomRightButtons.length} bottom-right button(s), clicking first one`);
        const btn = bottomRightButtons[0];
        console.log(`[CONTINUE] ↳ Clicking: tagName="${btn.tagName}", type="${btn.type}", text="${(btn.textContent || btn.value || '').substring(0, 30)}"`);
        btn.click();
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }

      // FALLBACK 2: Find ANY visible, enabled button (exclude footer links and destructive actions)
      console.log('[CONTINUE] Fallback 2: Looking for any visible button...');
      const anyVisibleButton = allButtons.find(btn => {
        if (btn.id === 'wildpoptart-btn' || btn.classList.contains('wildpoptart-floating-btn')) return false;

        const isVisible = btn.offsetParent !== null && window.getComputedStyle(btn).display !== 'none';
        const isEnabled = !btn.disabled && !btn.hasAttribute('disabled');
        const btnText = (btn.textContent || btn.value || '').toLowerCase();

        // Skip footer links
        const isFooter = btnText.includes('privacy') || btnText.includes('terms') ||
                        btnText.includes('contact') || btnText.includes('cookie');

        // Skip destructive buttons
        if (isDestructiveButton(btn)) return false;

        return isVisible && isEnabled && !isFooter;
      });

      if (anyVisibleButton) {
        console.log('[CONTINUE] ✓ Found visible button, clicking it');
        console.log(`[CONTINUE] ↳ Clicking: tagName="${anyVisibleButton.tagName}", type="${anyVisibleButton.type}", text="${(anyVisibleButton.textContent || anyVisibleButton.value || '').substring(0, 30)}"`);
        anyVisibleButton.click();
        anyVisibleButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }

      // FALLBACK 3: Find and submit any visible form
      console.log('[CONTINUE] Fallback 3: Looking for any form to submit...');
      const forms = document.querySelectorAll('form');
      for (const form of forms) {
        const isVisible = form.offsetParent !== null && window.getComputedStyle(form).display !== 'none';
        if (isVisible) {
          console.log('[CONTINUE] ✓ Found visible form, submitting it');

          // Look for submit button in form to click (preserves button data)
          const submitButtons = form.querySelectorAll('button[type="submit"], input[type="submit"], input[type="image"]');
          let clickedButton = false;

          for (const submitBtn of submitButtons) {
            const isBtnVisible = submitBtn.offsetParent !== null && window.getComputedStyle(submitBtn).display !== 'none';
            const isBtnEnabled = !submitBtn.disabled && !submitBtn.hasAttribute('disabled');

            // Skip destructive buttons
            if (isDestructiveButton(submitBtn)) continue;

            if (isBtnVisible && isBtnEnabled) {
              console.log('[CONTINUE] ↳ Clicking form submit button');
              submitBtn.click();
              clickedButton = true;
              break;
            }
          }

          if (!clickedButton) {
            console.log('[CONTINUE] ↳ No valid submit button, calling form.submit()');
            form.submit();
          }
          return true;
        }
      }

      // FALLBACK 4: Click the largest button (most prominent)
      console.log('[CONTINUE] Fallback 4: Looking for the largest/most prominent button...');
      let largestButton = null;
      let largestArea = 0;

      allButtons.forEach(btn => {
        if (btn.id === 'wildpoptart-btn' || btn.classList.contains('wildpoptart-floating-btn')) return;

        const rect = btn.getBoundingClientRect();
        const isVisible = btn.offsetParent !== null && window.getComputedStyle(btn).display !== 'none';
        const isEnabled = !btn.disabled && !btn.hasAttribute('disabled');
        const area = rect.width * rect.height;

        // Skip destructive buttons
        if (isDestructiveButton(btn)) return;

        if (isVisible && isEnabled && area > largestArea) {
          largestArea = area;
          largestButton = btn;
        }
      });

      if (largestButton && largestArea > 0) {
        console.log(`[CONTINUE] ✓ Found largest button (${Math.round(largestArea)}px²), clicking it`);
        console.log(`[CONTINUE] ↳ Clicking: tagName="${largestButton.tagName}", type="${largestButton.type}", text="${(largestButton.textContent || largestButton.value || '').substring(0, 30)}"`);
        largestButton.click();
        largestButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }
    }

    console.log('[CONTINUE] No clickable continue button found');
    return false;
  }

  console.log('[CONTINUE] Not an intro page, proceeding normally');
  return false;
}

// Handle user agreement/consent screens
async function handleUserAgreementScreen() {
  console.log('[AGREEMENT] Checking for user agreement screen...');

  // IMPORTANT: First check if there are actual survey questions on the page
  // If there are questions, this is NOT an agreement screen (even if it has "continue" button)
  const questionsOnPage = document.querySelectorAll('input[type="radio"], input[type="checkbox"], select, textarea, input[type="text"], input[type="number"]');

  if (questionsOnPage.length > 0) {
    console.log(`[AGREEMENT] Found ${questionsOnPage.length} form inputs - NOT an agreement screen, proceeding to fill questions`);
    return false;
  }

  // Keywords that indicate this is an agreement screen
  const agreementKeywords = [
    'consent',
    'privacy policy',
    'terms and conditions',
    'data collection',
    'you are opting into this survey',
    'i agree below',
    'by selecting',
    'participation in this survey'
  ];

  const pageText = document.body.innerText.toLowerCase();

  // Check if page contains agreement keywords
  const isAgreementScreen = agreementKeywords.some(keyword => pageText.includes(keyword));

  if (!isAgreementScreen) {
    console.log('[AGREEMENT] Not an agreement screen, proceeding normally');
    return false;
  }

  console.log('[AGREEMENT] ✓ Agreement screen detected (no questions found, has agreement keywords)!');

  // Look for agreement buttons
  const agreementButtonTexts = [
    'i agree',
    'agree',
    'accept',
    'consent',
    'yes',
    'continue',
    'proceed',
    'start survey',
    'begin'
  ];

  const allButtons = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('a'),
    ...document.querySelectorAll('[role="button"]'),
    ...document.querySelectorAll('input[type="button"]'),
    ...document.querySelectorAll('input[type="submit"]')
  ];

  console.log(`[AGREEMENT] Found ${allButtons.length} potential buttons`);

  for (const button of allButtons) {
    const buttonText = (button.textContent || button.value || '').toLowerCase().trim();
    const buttonId = (button.id || '').toLowerCase();
    const buttonClass = (button.className || '').toLowerCase();
    const testId = (button.getAttribute('data-testid') || '').toLowerCase();

    // Check if button matches agreement patterns
    for (const pattern of agreementButtonTexts) {
      if (buttonText.includes(pattern) ||
          buttonId.includes(pattern) ||
          buttonClass.includes(pattern) ||
          testId.includes(pattern)) {

        // Check if visible and enabled
        const isVisible = button.offsetParent !== null || window.getComputedStyle(button).display !== 'none';
        const isEnabled = !button.disabled && !button.hasAttribute('disabled');

        if (isVisible && isEnabled) {
          console.log(`[AGREEMENT] ✓ Found agreement button: "${buttonText}" - CLICKING!`);

          // Click the button
          button.click();
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

          return true; // Agreement button clicked
        }
      }
    }
  }

  console.log('[AGREEMENT] No clickable agreement button found');
  return false;
}


// Expose export function globally for console access
window.exportDB = exportQuestionDatabase;
window.viewDB = async function() {
  const storageKey = "wildpoptart_question_db";
  const result = await chrome.storage.local.get([storageKey]);
  const database = result[storageKey] || [];
  console.log(`📊 Question Database (${database.length} questions):`);
  console.table(database.slice(-20)); // Show last 20
  return database;
};

// V5.1.1: Expose self-healing debug functions
window.viewHealings = async function() {
  if (!window.selfHeal) {
    console.error('❌ Self-healing module not loaded');
    return;
  }
  const stats = await window.selfHeal.getHealStats();
  console.log('🧬 Self-Healing Statistics:');
  console.table(stats);
  return stats;
};

window.clearHealings = async function() {
  if (!window.selfHeal) {
    console.error('❌ Self-healing module not loaded');
    return;
  }
  await window.selfHeal.clearHealDB();
  console.log('🧬 All healing policies cleared');
};

