# Self-Healing Architecture - v1.0.0

## Overview

The Wildpoptart extension now includes an **adaptive self-healing memory system** that learns from successful fallback strategies and applies them automatically on future surveys.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Detection Layer                     │
│  (content.js - Question Detection)                  │
│                                                      │
│  1. Rule-based detection                            │
│  2. LLM fallback discovery                          │
│  3. ✨ Self-healing fallbacks ✨                    │
└──────────────┬──────────────────────────────────────┘
               │
               │ Records successes
               ▼
┌─────────────────────────────────────────────────────┐
│            Self-Healing Policy Layer                 │
│         (selfHealPolicy.js)                         │
│                                                      │
│  • Platform detection (IPSOS, Qualtrics, etc.)     │
│  • Healing database (chrome.storage.local)         │
│  • Learned selectors & delays                       │
│  • Auto-application on next run                     │
└─────────────────────────────────────────────────────┘
```

## What It Learns

### 1. Dialog Search Patterns
**Trigger:** When broadening scope to dialog containers finds elements

**Example:**
```javascript
// First survey encounter - dialog search succeeds
[LLM-APPLY] Found dialog container, re-extracting...
[HEAL] ✓ Learned new fix for ipsos: dialogSearch →
  { type: 'selector', selectors: ['[role="dialog"]', '.MuiDialog-root'] }

// Second survey on same platform - applies automatically
[HEAL] Applied 3 extra selectors for ipsos
```

### 2. Zero-Width Space Handling
**Trigger:** When stripping invisible characters reveals valid text

**Records:** The selectors that successfully found text after cleaning

### 3. Detection Timing
**Trigger:** After each successful detection cycle

**Learns:** Optimal delay for DOM stabilization on that platform
```javascript
[HEAL] Applied delay override for material-ui: 450ms
```

## Integration Points

### manifest.json
```json
"content_scripts": [{
  "js": ["scripts/selfHealPolicy.js", "scripts/content.js"]
}]
```
⚠️ Order matters! `selfHealPolicy.js` must load first.

### content.js Integration

**1. Platform Detection (Start of Detection)**
```javascript
const platform = window.selfHeal?.detectPlatform() || 'unknown';
const detectionStartTime = performance.now();
```

**2. Recording Heals (When Fallbacks Succeed)**
```javascript
// Dialog search succeeded
if (facts.elements.length > 0 && window.selfHeal) {
  window.selfHeal.recordHealing(platform, 'dialogSearch', {
    type: 'selector',
    selectors: ['[role="dialog"]', '.MuiDialog-root']
  });
}
```

**3. Learning Delays (End of Detection)**
```javascript
if (window.selfHeal && detectedQuestions.length > 0) {
  const detectionTime = performance.now() - detectionStartTime;
  window.selfHeal.learnDelay(platform, Math.round(detectionTime));
}
```

## Debug Functions

### View Healing Statistics
```javascript
viewHealings()
```

**Output:**
```
🧬 Self-Healing Statistics:
┌───────────────┬────────────┬─────────────────────┬───────┐
│   Platform    │ totalHeals │       issues        │ delay │
├───────────────┼────────────┼─────────────────────┼───────┤
│ ipsos         │ 5          │ dialogSearch: 2     │ 420ms │
│               │            │ zeroWidthSpace: 3   │       │
├───────────────┼────────────┼─────────────────────┼───────┤
│ material-ui   │ 3          │ renderDelay: 1      │ 350ms │
│               │            │ dialogSearch: 2     │       │
└───────────────┴────────────┴─────────────────────┴───────┘
```

### Clear All Healings
```javascript
clearHealings()
```

## Storage Format

**Key:** `selfHealPolicies_v1`

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
      "url": "ipsos.com"
    },
    {
      "issue": "renderDelay",
      "fix": {
        "type": "delay",
        "ms": 420
      },
      "timestamp": 1699564825000,
      "url": "ipsos.com"
    }
  ]
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

### DOM Signatures
- `.MuiDialog-root` → Material UI
- `[ng-app]` → Angular
- `.cm-sliders-container` → Confirmit

## Benefits

### 1. Adaptive Learning
Each successful fallback makes future surveys faster and more reliable.

### 2. Platform-Specific Memory
Learns separately for each survey platform, avoiding cross-contamination.

### 3. Graceful Degradation
If healing module fails to load, extension continues to work normally.

### 4. Automatic Recovery
Future surveys on the same platform start with pre-learned fixes applied.

## Example Flow

### First Encounter (Learning Phase)
```
[DETECTION] Platform detected: ipsos
[LLM-APPLY] No elements found at anchor, broadening scope...
[LLM-APPLY] Still no elements, searching entire dialog...
[LLM-APPLY] Found dialog container, re-extracting...
[EXTRACT] clickable=5 text=0 slider=0 matrix=null
[HEAL] ✓ Learned new fix for ipsos: dialogSearch
```

### Second Encounter (Auto-Healing Phase)
```
[DETECTION] Platform detected: ipsos
[HEAL] Applied 3 extra selectors for ipsos
[HEAL] Applied delay override for ipsos: 420ms
[LLM-APPLY] ✓ Extracted question (used learned selectors)
[EXTRACT] clickable=5 text=0 slider=0 matrix=null
```

## Limits

- **Max heals per platform:** 25 (oldest removed when exceeded)
- **Storage:** Uses `chrome.storage.local` (no quota issues for small datasets)
- **Debouncing:** Saves delayed by 300ms to avoid thrashing

## Version History

### v1.0.0 (2025-11-06)
- Initial release
- Dialog search healing
- Zero-width space healing
- Render delay learning
- Platform detection
- Chrome Extension Manifest V3 compatible

## Future Enhancements

Potential additions:
- Visual dashboard showing learned patterns in real-time
- Export/import healing policies
- Healing confidence scores
- Auto-purge stale healings (older than X days)
- Cross-platform pattern sharing
