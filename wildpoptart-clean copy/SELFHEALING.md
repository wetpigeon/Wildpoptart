# Self-Healing Architecture - v2.0.0 (Level 3: Context-Aware)

## Overview

The Wildpoptart extension features a **Level 3 context-aware self-healing system** that learns from successful fallback strategies and adapts based on full context including platform, DOM structure, question type, and survey phase.

## Evolution Timeline

- **v1.0.0 (Level 2)**: Platform-aware healing
- **v2.0.0 (Level 3)**: Context-aware healing with question type awareness

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Detection Layer                         │
│  (content.js - Question Detection)                      │
│                                                          │
│  1. Rule-based detection                                │
│  2. LLM fallback discovery                              │
│  3. ✨ Context-aware self-healing fallbacks ✨          │
└──────────────┬──────────────────────────────────────────┘
               │
               │ Records successes with full context
               ▼
┌─────────────────────────────────────────────────────────┐
│         Context-Aware Self-Healing Layer                 │
│            (selfHealPolicy.js v2.0)                     │
│                                                          │
│  • Platform detection (IPSOS, Qualtrics, etc.)         │
│  • DOM fingerprinting (structural hashing)             │
│  • Question type detection (radio, checkbox, etc.)     │
│  • Phase tracking (detection, filling, submitting)     │
│  • Context matching with similarity scoring            │
│  • Success/failure tracking (adaptive learning)        │
│  • Healing database (chrome.storage.local)             │
└─────────────────────────────────────────────────────────┘
```

## Context Model (Level 3)

Each heal is stored with a rich context that includes:

```javascript
{
  platform: 'ipsos',              // Survey platform
  domHash: 'abc123xyz',           // DOM structure fingerprint
  questionType: 'radio',          // Detected question type
  phase: 'detection',             // Survey phase
  dialogCount: 1,                 // Number of dialogs on page
  timestamp: 1699564821000        // When captured
}
```

## What It Learns

### 1. Dialog Search Patterns
**Trigger:** When broadening scope to dialog containers finds elements

**Context Captured:**
- Platform
- Question type (radio, checkbox, text, etc.)
- DOM structure fingerprint
- Survey phase

**Example:**
```javascript
// First survey encounter - dialog search succeeds
[HEAL-CTX] Captured: ipsos | radio | detection | DOM:abc123 | Dialogs:1
[LLM-APPLY] Found dialog container, re-extracting...
[HEAL] ✓ Learned new fix for ipsos: dialogSearch

// Second survey on same platform with similar context
[HEAL-CTX] Captured: ipsos | radio | detection | DOM:abc456 | Dialogs:1
[HEAL] Found 3/5 context-matching heals for ipsos
[HEAL] Applied 3 selectors from 3 heals: [
  { issue: 'dialogSearch', score: '0.95', successRate: '100%' }
]
```

### 2. Zero-Width Space Handling
**Trigger:** When stripping invisible characters reveals valid text

**Records:** Selectors with context (question type, DOM hash, platform)

### 3. Material UI Checkbox Patterns
**Trigger:** When Material UI checkbox interaction succeeds

**Context:** Captured during filling phase for checkbox questions

### 4. Detection Timing
**Trigger:** After each successful detection cycle

**Learns:** Optimal delay per platform+question type combination
```javascript
[HEAL] Applied delay override: 420ms (match score: 0.87)
```

## Context Matching Algorithm

Heals are selected based on similarity score (0-1 scale):

### Matching Weights:
- **Platform**: 25% - Exact platform match
- **DOM Hash**: 30% - Structural similarity
- **Question Type**: 25% - Question type match
- **Phase**: 20% - Survey phase match

### Threshold:
- Minimum score: **0.6** (60% similarity required)

### Selection Strategy:
- Score heals by: context match (60%) + success rate (40%)
- Apply top-scoring heals above threshold
- Track success/failure for adaptive optimization

## Question Type Detection

The system automatically detects question types:

- **text**: Text inputs, textareas
- **radio**: Single-choice radio buttons
- **checkbox**: Multiple-choice checkboxes
- **select**: Dropdown menus
- **slider**: Range inputs and sliders
- **matrix-radio**: Matrix with radio buttons
- **matrix-checkbox**: Matrix with checkboxes
- **custom-button**: Role-based custom surveys

## Adaptive Learning

### In-Session Learning Loop:
1. Apply context-matched heals
2. Track success/failure in real-time
3. Update success/failure counters
4. Adjust heal priority based on performance

### Storage Optimization:
- Max 50 heals per platform (increased from 25)
- Heals sorted by: success rate (70%) + recency (30%)
- Automatic pruning of low-performing heals

## Integration Points

### manifest.json
```json
"content_scripts": [{
  "js": ["scripts/selfHealPolicy.js", "scripts/content.js"]
}]
```
⚠️ Order matters! `selfHealPolicy.js` must load first.

### content.js Integration

**1. Platform Detection & Context Capture (Start of Detection)**
```javascript
const platform = window.selfHeal?.detectPlatform() || 'unknown';
surveyPhase = 'detection';

// Capture context for context-aware healing
currentContext = window.selfHeal.captureContext(platform, 'unknown', surveyPhase);
```

**2. Apply Context-Matched Heals**
```javascript
// Apply context-aware heals
learnedEnv = await window.selfHeal.applyHeals(platform, {}, currentContext);

// Store learned selectors
learnedDialogSelectors = learnedEnv.candidateSelectors || [];

// Apply learned delay
if (learnedEnv.delay > 0) {
  await sleep(learnedEnv.delay);
}
```

**3. Recording Heals with Context (When Fallbacks Succeed)**
```javascript
// Dialog search succeeded
const questionType = window.selfHeal.detectQuestionType(dialog);
const context = window.selfHeal.captureContext(platform, questionType, surveyPhase, dialog);
window.selfHeal.recordHealing(platform, 'dialogSearch', {
  type: 'selector',
  selectors: ['[role="dialog"]', '.MuiDialog-root']
}, context);
```

**4. Learning Delays with Context (End of Detection)**
```javascript
if (window.selfHeal && detectedQuestions.length > 0) {
  const detectionTime = performance.now() - detectionStartTime;
  const context = window.selfHeal.captureContext(
    platform,
    detectedQuestions[0].question_type,
    surveyPhase
  );
  window.selfHeal.learnDelay(platform, Math.round(detectionTime), context);
}
```

## Debug Functions

### View Healing Statistics (Enhanced for Level 3)
```javascript
viewHealings()
```

**Output:**
```
🧬 Self-Healing Statistics (Level 3 - Context-Aware):

📍 Platform: IPSOS
   Total Heals: 12
   Success Rate: 92%
   Learned Delay: 420ms

   Issues Detected:
   ┌────────────────┬───────┐
   │     Issue      │ Count │
   ├────────────────┼───────┤
   │ dialogSearch   │   5   │
   │ zeroWidthSpace │   4   │
   │ renderDelay    │   3   │
   └────────────────┴───────┘

   Question Types:
   ┌──────────────┬───────┐
   │     Type     │ Count │
   ├──────────────┼───────┤
   │ radio        │   6   │
   │ checkbox     │   4   │
   │ text         │   2   │
   └──────────────┴───────┘

   Top Performing Heals:
   ┌──────────────┬──────────────┬─────────────┬──────┐
   │    Issue     │ Question Type│ Success Rate│ Uses │
   ├──────────────┼──────────────┼─────────────┼──────┤
   │ dialogSearch │ radio        │    100%     │  15  │
   │ zeroWidthSpace│ text        │     95%     │  12  │
   └──────────────┴──────────────┴─────────────┴──────┘
```

### View In-Session Performance
```javascript
viewSessionStats()
```

**Output:**
```
📈 In-Session Healing Performance:
┌──────────────────────────┬─────────┬─────────┬──────────────┐
│    Platform:Issue        │ Success │ Failure │ Success Rate │
├──────────────────────────┼─────────┼─────────┼──────────────┤
│ ipsos:dialogSearch       │    8    │    0    │     100%     │
│ material-ui:renderDelay  │    5    │    1    │      83%     │
└──────────────────────────┴─────────┴─────────┴──────────────┘
```

### Clear All Healings
```javascript
clearHealings()
```

## Storage Format

**Key:** `selfHealPolicies_v2`

**Structure:**
```json
{
  "ipsos": [
    {
      "issue": "dialogSearch",
      "fix": {
        "type": "selector",
        "selectors": ["[role=\"dialog\"]", ".MuiDialog-root"]
      },
      "timestamp": 1699564821000,
      "url": "ipsos.com",
      "context": {
        "platform": "ipsos",
        "domHash": "abc123xyz",
        "questionType": "radio",
        "phase": "detection",
        "dialogCount": 1,
        "timestamp": 1699564821000
      },
      "lastUsed": 1699564825000,
      "successCount": 15,
      "failureCount": 0
    }
  ]
}
```

## Migration from v1.0

The system automatically migrates v1 data to v2 format:

```javascript
[HEAL] Migrating v1 data to v2 format...
[HEAL] Migrated 3 platforms to v2 format
```

Old heals get default context values:
- `domHash`: 'unknown'
- `questionType`: 'unknown'
- `phase`: 'detection'
- `successCount`: 1
- `failureCount`: 0

## Platform Detection

Auto-detects platforms based on:

### URL Patterns
- `ipsos` → IPSOS
- `qualtrics` → Qualtrics
- `surveymonkey` → SurveyMonkey
- `typeform` → Typeform
- `google.com/forms` → Google Forms
- `confirmit` → Confirmit
- `decipher` → Decipher

### DOM Signatures
- `.MuiDialog-root` → Material UI
- `[ng-app]` → Angular
- `.cm-sliders-container` → Confirmit
- `form[data-quest-mindshare]` → Quest Mindshare

## Benefits

### 1. Context-Aware Adaptation (Level 3)
Applies the most relevant heals based on full context, not just platform.

### 2. Question Type Awareness (Level 2.5)
Different heals for different question types (radio vs checkbox vs text).

### 3. Adaptive Learning
Real-time success/failure tracking optimizes heal selection automatically.

### 4. Phase-Specific Healing
Different strategies for detection, filling, and submission phases.

### 5. DOM Fingerprinting
Matches heals based on structural similarity, even on new survey pages.

### 6. Backward Compatible
Automatically migrates and works with v1.0 data.

## Example Flow

### First Encounter (Learning Phase)
```
[DETECTION] Platform detected: ipsos
[HEAL-CTX] Captured: ipsos | unknown | detection | DOM:abc123 | Dialogs:1
[HEAL] Found 0/0 context-matching heals for ipsos
[LLM-APPLY] No elements found at anchor, broadening scope...
[LLM-APPLY] Still no elements, searching entire dialog...
[LLM-APPLY] Found dialog container, re-extracting...
[HEAL-CTX] Captured: ipsos | radio | detection | DOM:abc123 | Dialogs:1
[HEAL] ✓ Learned new fix for ipsos: dialogSearch
[EXTRACT] clickable=5 text=0 slider=0 matrix=null
```

### Second Encounter (Auto-Healing Phase)
```
[DETECTION] Platform detected: ipsos
[HEAL-CTX] Captured: ipsos | unknown | detection | DOM:abc456 | Dialogs:1
[HEAL] Found 3/5 context-matching heals for ipsos
[HEAL] Applied 3 selectors from 3 heals: [
  { issue: 'dialogSearch', score: '0.87', successRate: '100%' }
]
[HEAL] Applied delay override: 420ms (match score: 0.87)
[HEAL] Waiting 420ms for DOM stabilization (learned delay)
[LLM-APPLY] ✓ Extracted question (used learned selectors)
[EXTRACT] clickable=5 text=0 slider=0 matrix=null
```

## Limits

- **Max heals per platform:** 50 (up from 25 in v1.0)
- **Context match threshold:** 0.6 (60% similarity)
- **Storage:** Uses `chrome.storage.local` (no quota issues)
- **Debouncing:** Saves delayed by 300ms to avoid thrashing

## Version History

### v2.0.0 (2025-11-07) - Level 3: Context-Aware
- **Context model**: Platform + DOM hash + question type + phase
- **Question type detection**: Auto-detect question types from DOM
- **Context matching**: Similarity scoring algorithm
- **Adaptive learning**: Success/failure tracking
- **In-session stats**: Real-time performance monitoring
- **DOM fingerprinting**: Structural hashing for matching
- **Enhanced debugging**: Rich statistics with context breakdown
- **Backward compatible**: Auto-migration from v1.0

### v1.0.0 (2025-11-06) - Level 2: Platform-Aware
- Initial release
- Dialog search healing
- Zero-width space healing
- Render delay learning
- Platform detection
- Chrome Extension Manifest V3 compatible

## Future Enhancements

Potential additions:
- **Machine learning**: Neural network for heal selection
- **Cross-platform pattern sharing**: Learn from similar platforms
- **Visual dashboard**: Real-time healing visualization
- **Export/import**: Share healing policies between instances
- **Confidence intervals**: Statistical confidence in heal success rates
- **Auto-purge**: Remove stale healings (older than X days)
- **A/B testing**: Compare heal strategies automatically
