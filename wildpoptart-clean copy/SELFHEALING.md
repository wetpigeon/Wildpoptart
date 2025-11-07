# Self-Healing Architecture - v2.0.0

## Overview

The Wildpoptart extension includes an **adaptive question-aware self-healing memory system** that learns from successful fallback strategies per question pattern and applies them automatically on future surveys.

## Level 2: Question-Aware Learning

**v2.0.0** introduces **pattern-based learning**:
- Each question type gets its own healing signature
- Success/failure tracking per pattern
- Adaptive prioritization by success rate
- Question fingerprinting based on type, structure, and content

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Detection Layer                     │
│  (content.js - Question Detection)                  │
│                                                      │
│  1. Rule-based detection                            │
│  2. LLM fallback discovery                          │
│  3. ✨ Pattern signature computation ✨             │
│  4. ✨ Question-aware self-healing ✨               │
└──────────────┬──────────────────────────────────────┘
               │
               │ Records pattern + success/failure
               ▼
┌─────────────────────────────────────────────────────┐
│      Question-Aware Self-Healing Policy Layer       │
│         (selfHealPolicy.js v2.0.0)                  │
│                                                      │
│  • Platform detection (IPSOS, Qualtrics, etc.)     │
│  • Question type detection (radio, checkbox, etc.) │
│  • Pattern signature generation (hash-based)        │
│  • Per-pattern healing database                     │
│  • Success/failure rate tracking                    │
│  • Adaptive priority ranking                        │
│  • Auto-application on pattern match                │
└─────────────────────────────────────────────────────┘
```

## What It Learns

### 1. Question Pattern Signatures
**Trigger:** Every question detection
**Creates:** Unique fingerprint based on:
- Question type (radio, checkbox, text, select, slider, matrix, textarea)
- Option count (number of inputs/options)
- Text content hash (first 200 chars)

**Example Signature:**
```
radio_5_abc123      // Radio question with 5 options
checkbox_8_def456   // Checkbox question with 8 options
text_1_ghi789       // Text input question
```

### 2. Per-Pattern Healing
**Trigger:** When a fallback strategy succeeds for a specific question pattern

**Example:**
```javascript
// First encounter - learns pattern
[HEAL] ✓ Learned new pattern for ipsos/radio_5_abc123:
  { questionType: 'radio', selectors: [...], successCount: 1 }

// Second encounter - matches pattern and reuses
[HEAL] Applied 3 selectors for ipsos/radio_5_abc123: [...]
```

### 3. Success/Failure Tracking
**Records:**
- `successCount`: Times this fix worked
- `failureCount`: Times this fix failed
- `successRate`: Calculated percentage
- `lastUsed`: Most recent usage timestamp

**Adaptive Priority:**
```javascript
// Heals sorted by: successCount / (successCount + failureCount)
// Best performing fixes applied first
```

### 4. Dialog Search Patterns
**Trigger:** When broadening scope to dialog containers finds elements

**Example:**
```javascript
// Recorded per question pattern
const patternSig = computePatternSignature(dialog);
recordHealing(platform, patternSig, {
  questionType: 'radio',
  selectors: ['[role="dialog"]', '.MuiDialog-root'],
  success: true
});
```

### 5. Zero-Width Space Handling
**Trigger:** When stripping invisible characters reveals valid text
**Records:** Pattern-specific selectors that successfully found text

### 6. Detection Timing
**Learns:** Optimal delay per question pattern (running average)
```javascript
delay: Math.round(oldDelay * 0.7 + newDelay * 0.3)
```

## Integration Points

### manifest.json
```json
"content_scripts": [{
  "js": ["scripts/selfHealPolicy.js", "scripts/content.js"]
}]
```
⚠️ Order matters! `selfHealPolicy.js` must load first.

### content.js Integration (Level 2)

**1. Platform & Pattern Detection**
```javascript
const platform = window.selfHeal?.detectPlatform() || 'unknown';
const patternSig = window.selfHeal?.computePatternSignature(questionElement);
const questionType = window.selfHeal?.detectQuestionType(questionElement);
```

**2. Recording Heals (When Fallbacks Succeed)**
```javascript
// V5.2.0: Pattern-aware healing
if (facts.elements.length > 0 && window.selfHeal) {
  const platform = window.selfHeal.detectPlatform();
  const patternSig = window.selfHeal.computePatternSignature(dialog);
  const questionType = window.selfHeal.detectQuestionType(dialog);

  window.selfHeal.recordHealing(platform, patternSig, {
    questionType,
    selectors: ['[role="dialog"]', '.MuiDialog-root', '.dialog-question'],
    success: true
  });
}
```

**3. Applying Heals (Pattern-Specific)**
```javascript
// Apply heals for matching pattern signature
const env = await window.selfHeal.applyHeals(platform, patternSig, {
  candidateSelectors: []
});
// env.candidateSelectors now includes learned selectors
// env.delay includes learned delay
```

## Debug Functions

### View Healing Statistics (Level 2)
```javascript
viewHealings()
```

**Output:**
```
🧬 Self-Healing Statistics (Level 2: Question-Aware):
📊 Total learned patterns: 15

┌──────────┬─────────────────────┬──────────┬────────────────────┬───────┬──────────┬────────────┬────────────┬────────────┐
│ platform │ patternSignature    │ question │ selectors          │ delay │ successC │ failureC   │ successRate│ lastUsed   │
│          │                     │ Type     │                    │       │ ount     │ ount       │            │            │
├──────────┼─────────────────────┼──────────┼────────────────────┼───────┼──────────┼────────────┼────────────┼────────────┤
│ ipsos    │ radio_5_abc123...   │ radio    │ [role="dialog"],.. │ 420   │ 8        │ 0          │ 100.0%     │ 2025-11-07 │
│ ipsos    │ checkbox_8_def456.. │ checkbox │ .MuiCheckbox-root  │ 350   │ 5        │ 1          │ 83.3%      │ 2025-11-06 │
│ qualtrics│ text_1_ghi789...    │ text     │ input[type="text"] │ 200   │ 3        │ 0          │ 100.0%     │ 2025-11-05 │
└──────────┴─────────────────────┴──────────┴────────────────────┴───────┴──────────┴────────────┴────────────┴────────────┘

📈 Platform Summary:
┌──────────┬──────────┬──────────────┬──────────────┐
│ platform │ patterns │ totalSuccess │ totalFailure │
├──────────┼──────────┼──────────────┼──────────────┤
│ ipsos    │ 8        │ 35           │ 2            │
│ qualtrics│ 4        │ 18           │ 0            │
│ material │ 3        │ 12           │ 1            │
└──────────┴──────────┴──────────────┴──────────────┘
```

### Clear All Healings
```javascript
clearHealings()
```

## Storage Format (Level 2)

**Key:** `selfHealPolicies_v2`

**Structure:**
```json
{
  "ipsos": {
    "radio_5_abc123": [
      {
        "patternSignature": "radio_5_abc123",
        "questionType": "radio",
        "selectors": ["[role=\"dialog\"]", ".MuiDialog-root", ".dialog-question"],
        "delay": 420,
        "successCount": 8,
        "failureCount": 0,
        "timestamp": 1699564821000,
        "lastUsed": 1699567890000,
        "url": "ipsos.com"
      }
    ],
    "checkbox_8_def456": [
      {
        "patternSignature": "checkbox_8_def456",
        "questionType": "checkbox",
        "selectors": [".MuiCheckbox-root", "[role=\"checkbox\"]"],
        "delay": 350,
        "successCount": 5,
        "failureCount": 1,
        "timestamp": 1699564825000,
        "lastUsed": 1699566000000,
        "url": "ipsos.com"
      }
    ]
  },
  "qualtrics": {
    "text_1_ghi789": [
      {
        "patternSignature": "text_1_ghi789",
        "questionType": "text",
        "selectors": ["input[type=\"text\"]", ".text-input"],
        "delay": 200,
        "successCount": 3,
        "failureCount": 0,
        "timestamp": 1699565000000,
        "lastUsed": 1699565500000,
        "url": "qualtrics.com"
      }
    ]
  }
}
```

## Pattern Signature Generation

### Question Type Detection
```javascript
detectQuestionType(element) → 'radio' | 'checkbox' | 'select' |
                               'slider' | 'matrix' | 'textarea' |
                               'text' | 'unknown'
```

**Detection Logic:**
- `input[type="radio"]` → `radio`
- `input[type="checkbox"]` → `checkbox`
- `select` → `select`
- `input[type="range"], .slider, [role="slider"]` → `slider`
- `textarea` → `textarea`
- `input[type="text|number|email"]` → `text`
- Multiple `tr` or `.matrix-row` → `matrix`

### Signature Algorithm
```javascript
function computePatternSignature(questionEl) {
  const text = questionEl.innerText?.toLowerCase().replace(/\s+/g, ' ').trim();
  const textHash = hash(text.substring(0, 200));
  const type = detectQuestionType(questionEl);
  const optionCount = questionEl.querySelectorAll('input, option, textarea, select').length;

  return `${type}_${optionCount}_${textHash}`;
}
```

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

### 1. Question-Specific Learning (NEW in v2.0.0)
Each question type learns its own optimal fixes, avoiding cross-contamination.

### 2. Adaptive Prioritization (NEW in v2.0.0)
Fixes with higher success rates are applied first, improving reliability.

### 3. Success Tracking (NEW in v2.0.0)
System knows which fixes work best and can prune ineffective ones.

### 4. Platform-Specific Memory
Learns separately for each survey platform.

### 5. Graceful Degradation
If healing module fails to load, extension continues to work normally.

### 6. Automatic Recovery
Future surveys with matching question patterns start with pre-learned fixes applied.

## Example Flow

### First Encounter (Learning Phase - Level 2)
```
[DETECTION] Platform detected: ipsos
[HEAL] Computing pattern signature for question...
[HEAL] Pattern: radio_5_abc123 (radio question, 5 options)
[LLM-APPLY] No elements found at anchor, broadening scope...
[LLM-APPLY] Found dialog container, re-extracting...
[EXTRACT] clickable=5 text=0 slider=0 matrix=null
[HEAL] ✓ Learned new pattern for ipsos/radio_5_abc123:
       { questionType: 'radio', selectors: [...], successCount: 1 }
```

### Second Encounter (Auto-Healing Phase - Pattern Match)
```
[DETECTION] Platform detected: ipsos
[HEAL] Computing pattern signature for question...
[HEAL] Pattern: radio_5_abc123 (matches learned pattern!)
[HEAL] Applied 3 selectors for ipsos/radio_5_abc123: [...]
[HEAL] Applied learned delay for ipsos/radio_5_abc123: 420ms
[LLM-APPLY] ✓ Extracted question (used pattern-matched selectors)
[EXTRACT] clickable=5 text=0 slider=0 matrix=null
[HEAL] Updated ipsos/radio_5_abc123: success=2, failure=0
```

### Third Encounter (Different Pattern - No Match)
```
[DETECTION] Platform detected: ipsos
[HEAL] Computing pattern signature for question...
[HEAL] Pattern: checkbox_8_def456 (no match, new pattern)
[HEAL] Applied 5 fallback selectors for ipsos (from other patterns)
[LLM-APPLY] Trying Material UI checkbox fallback...
[HEAL] ✓ Learned new pattern for ipsos/checkbox_8_def456:
       { questionType: 'checkbox', selectors: [...], successCount: 1 }
```

## Limits

- **Max patterns per platform:** 50 (oldest removed when exceeded)
- **Max heals per pattern:** 10 (oldest removed when exceeded)
- **Storage:** Uses `chrome.storage.local` (efficient for pattern-based datasets)
- **Debouncing:** Saves delayed by 300ms to avoid thrashing
- **Pattern signature length:** Uses first 200 chars of text for hashing

## API Reference

### Core Functions

```javascript
// Pattern signature generation
window.selfHeal.computePatternSignature(element) → string

// Question type detection
window.selfHeal.detectQuestionType(element) → string

// Record healing (Level 2 signature)
window.selfHeal.recordHealing(platform, patternSignature, {
  questionType,
  selectors,
  delay,
  success
})

// Apply heals for pattern
window.selfHeal.applyHeals(platform, patternSignature, env) → env

// Get pattern statistics
window.selfHeal.getHealStats() → Array<{
  platform, patternSignature, questionType, selectors,
  delay, successCount, failureCount, successRate, lastUsed
}>

// Platform detection
window.selfHeal.detectPlatform() → string

// Clear all healings
window.selfHeal.clearHealDB() → Promise<void>
```

## Migration from v1.0.0

**Automatic Migration:** v2.0.0 automatically migrates v1 data on load.

**Old Format (v1):**
```json
{
  "ipsos": [
    { "issue": "dialogSearch", "fix": {...} }
  ]
}
```

**New Format (v2):**
```json
{
  "ipsos": {
    "legacy_pattern": [
      { "issue": "dialogSearch", "fix": {...} }
    ]
  }
}
```

## Version History

### v2.0.0 (2025-11-07)
- **🎯 Level 2: Question-Aware Learning**
- Added `computePatternSignature()` for question fingerprinting
- Added `detectQuestionType()` for type detection
- Changed storage schema to `heals[platform][patternSignature]`
- Added success/failure tracking per pattern
- Implemented adaptive priority by success rate
- Updated `recordHealing()` for pattern-aware learning
- Updated `applyHeals()` for pattern matching
- Enhanced `getHealStats()` with pattern details
- Added automatic v1→v2 migration
- Increased limits: 50 patterns/platform, 10 heals/pattern
- Updated debug interface with pattern statistics

### v1.0.0 (2025-11-06)
- Initial release (Platform-Aware)
- Dialog search healing
- Zero-width space healing
- Render delay learning
- Platform detection
- Chrome Extension Manifest V3 compatible

## Future Enhancements (Level 3+)

Potential additions:
- **Level 3:** Cross-survey pattern sharing
- Visual dashboard showing learned patterns in real-time
- Export/import healing policies
- Healing confidence scores with Bayesian updates
- Auto-purge stale patterns (older than X days, low success rate)
- Pattern similarity matching (fuzzy matching for near-duplicates)
- A/B testing of healing strategies
- Machine learning-based pattern prediction
