# Force-Fill Integration Guide

## Problem Summary

The Wildpoptart v5.1.2 script detects questions correctly but fails to fill them when:
1. Inputs already have values (logs: `⚠️ Question ans5676.0 input already has value: "1"`)
2. Auto-fill is disabled (logs: `[AUTO-FILL] ❌ DISABLED - you must click 🍰 button manually`)

The script detects questions but skips filling due to pre-existing values.

## Solution Overview

The **FORCE_FILL_PATCH.js** provides a complete force-fill system that:

1. **Clears all stale inputs** before filling (text, number, select, radio, checkbox)
2. **Bypasses "already has value" checks** by clearing values before detection
3. **Works independently of auto-fill mode** - can be triggered manually
4. **Provides detailed logging** for debugging
5. **Adds a dedicated Force Fill button** (⚡ Force Fill)

## Quick Start

### Option 1: Tampermonkey Script (Recommended)

1. Install Tampermonkey extension in your browser
2. Create a new script
3. Copy the entire contents of `FORCE_FILL_PATCH.js`
4. Wrap it with the Tampermonkey header (see Part 8 in the file)
5. Save and enable the script

### Option 2: Browser Console

1. Open browser DevTools (F12)
2. Copy the entire `FORCE_FILL_PATCH.js` file
3. Paste into console and press Enter
4. Click the "⚡ Force Fill" button or run `forceFill()` in console

### Option 3: Direct Integration

Add the following code to `content.js` after the existing state management section (around line 20):

```javascript
// ===== FORCE-FILL MODE =====
let forceFillMode = false;
let forceFillStats = { cleared: 0, filled: 0, failed: 0 };

// See FORCE_FILL_PATCH.js for complete implementation
```

Then add all functions from FORCE_FILL_PATCH.js before the final closing brace.

## Usage

### Manual Trigger via Button

1. Navigate to survey page
2. Look for the red "⚡ Force Fill" button in bottom-right corner
3. Click it to force-fill all detected questions
4. Watch console for detailed logs

### Manual Trigger via Console

```javascript
// Force-fill all questions (clears inputs first)
forceFill()

// Just clear all stale inputs
clearStaleInputs()

// Force-fill a specific question object
forceFillQuestion(questionObject)
```

### Automatic Mode

If `autoFillEnabled = true`, force-fill will automatically click the Continue button after filling questions.

## How It Works

### Step 1: Clear Stale Inputs (clearStaleInputs)

```javascript
clearStaleInputs()
```

Clears all pre-existing values:
- Text inputs → empty string
- Number inputs → empty string
- Checkboxes/radios → unchecked
- Select dropdowns → first option (empty)
- Material UI inputs → cleared

**Logs:**
```
[FORCE-FILL] 🧹 Clearing all stale inputs...
[FORCE-FILL] Clearing input ans5676.0: "1"
[FORCE-FILL] Unchecking checkbox ans1234.0
[FORCE-FILL] ✓ Cleared 5 stale inputs
```

### Step 2: Detect Questions (detectQuestions)

Re-runs question detection after clearing:
- Now all inputs appear "fresh" with no values
- No "already has value" warnings
- All questions eligible for filling

### Step 3: Fill Questions (forceFillQuestion)

For each detected question:

**Radio/Checkbox groups:**
- Selects first non-"None" option
- Avoids: "None", "N/A", "Not Applicable", "Prefer not", "Skip"
- Falls back to first option if all are "None"

**Select dropdowns:**
- Selects first non-empty option (skips placeholder)

**Text/Number inputs:**
- Fills with sample value ("Sample answer" or "1")

**Matrix questions:**
- Fills each row with first column option

**Logs:**
```
[FORCE-FILL] Attempting to fill question: ans5676.0
[FORCE-FILL] Question type: radio
[FORCE-FILL] Found 5 radio options
[FORCE-FILL] Selected option: "Yes"
[FORCE-FILL] ✓ Answered question ans5676.0 successfully
```

### Step 4: Report Results

Final statistics logged:
```
================================================================================
[FORCE-FILL] 📊 FORCE-FILL COMPLETE
  Inputs cleared: 5
  Questions filled: 3
  Questions failed: 0
================================================================================
```

## Force-Fill Button

**Appearance:**
- **Position:** Fixed bottom-right (20px from right, 80px from bottom)
- **Color:** Red background (#ff4444)
- **Icon:** ⚡ Force Fill
- **Hover:** Scales up slightly with enhanced shadow
- **Active:** Shows "⏳ Forcing..." while processing

**States:**
- Idle: `⚡ Force Fill`
- Processing: `⏳ Forcing...` (disabled)
- Complete: Returns to idle state

## Supported Question Types

✅ **Radio buttons** - Selects first non-"None" option
✅ **Checkboxes** - Checks first non-"None" option
✅ **Select dropdowns** - Selects first valid option
✅ **Text inputs** - Fills with "Sample answer"
✅ **Number inputs** - Fills with "1"
✅ **Matrix questions** (Likert grids) - Fills each row with first column
✅ **Material UI inputs** - Clears and fills MUI components

⚠️ **Partial Support:**
- Checkbox matrices - Fills but may need refinement
- Conditional questions - Fills input, may skip checkbox

❌ **Not Yet Supported:**
- Slider inputs (requires position calculation)
- Date pickers (requires date formatting)
- File uploads (cannot programmatically set files)

## Configuration Options

### Enable Force-Fill Mode Globally

```javascript
// Always use force-fill when detecting questions
forceFillMode = true;
```

### Customize Fill Values

Edit `forceFillQuestion()` function:

```javascript
// For text inputs
const sampleValue = type === 'number' ? '42' : 'Custom answer';

// For radio selection logic
const isNone = /none|skip|custom_pattern/i.test(label);
```

### Adjust Fill Delays

```javascript
// In forceFill() main loop
await sleep(1000); // Increase from 500ms to 1000ms
```

## Debugging

### Enable Verbose Logging

All logs are prefixed with `[FORCE-FILL]`:

```javascript
// View stats after running
console.log(forceFillStats);
// { cleared: 5, filled: 3, failed: 0 }
```

### Check Question Detection

```javascript
// Manually detect questions to see what's found
const questions = await detectQuestions();
console.log(questions);
```

### Test Individual Question Fill

```javascript
// Get first detected question
const q = detectedQuestions[0];

// Try force-filling it
await forceFillQuestion(q);
```

## Integration with Existing Code

### Disable Pre-Fill Value Warnings

The patch overrides `detectQuestions()` to bypass warnings:

```javascript
const _originalDetectQuestions = window.detectQuestions;

window.detectQuestions = async function() {
  const questions = await _originalDetectQuestions.apply(this, arguments);

  if (forceFillMode) {
    questions.forEach(q => {
      if (q.element && q.element.value) {
        q.element.value = ''; // Clear pre-filled values
      }
    });
  }

  return questions;
};
```

### Works with Auto-Fill Mode

```javascript
// After force-filling, auto-click continue if enabled
if (autoFillEnabled) {
  await handleContinuePage(true);
}
```

## Compatibility

- ✅ Chrome/Chromium (Tampermonkey)
- ✅ Firefox (Tampermonkey/Greasemonkey)
- ✅ Edge (Tampermonkey)
- ✅ Works with existing Wildpoptart v5.1.2
- ✅ No conflicts with self-healing system
- ✅ Compatible with Material UI fallback

## Troubleshooting

### Button Not Appearing

```javascript
// Manually add button
addForceFillButton();
```

### Questions Not Detected

```javascript
// Check if detectQuestions exists
console.log(typeof detectQuestions);
// Should log: "function"

// If undefined, Wildpoptart not loaded yet
```

### Fill Not Working

```javascript
// Check if elements are found
const q = detectedQuestions[0];
console.log(q.elements); // Should show array of inputs

// Check if elements are visible
console.log(q.element.offsetParent); // Should not be null
```

### Auto-Fill Disabled Error

Force-fill bypasses auto-fill checks entirely. The button works regardless of `autoFillEnabled` state.

## Example Usage Session

```
1. Open survey page
2. Open DevTools console (F12)
3. Paste FORCE_FILL_PATCH.js code
4. Press Enter
5. See: [FORCE-FILL] 🎯 Force-Fill Patch Loaded Successfully!
6. Click "⚡ Force Fill" button
7. Watch console logs:
   [FORCE-FILL] 🧹 Clearing all stale inputs...
   [FORCE-FILL] Clearing input ans5676.0: "1"
   [FORCE-FILL] ✓ Cleared 2 stale inputs
   [FORCE-FILL] Detecting questions...
   [FORCE-FILL] Found 3 question(s)
   [FORCE-FILL] ✓ Answered question ans5676.0 successfully
   [FORCE-FILL] ✓ Answered question ans1234.1 successfully
   [FORCE-FILL] ✓ Answered question ans9999.2 successfully
   [FORCE-FILL] 📊 FORCE-FILL COMPLETE
8. See notification: "Force-fill complete! Filled 3/3 questions"
9. Survey answers are filled, ready to submit
```

## Security Considerations

- ✅ No external API calls
- ✅ No data exfiltration
- ✅ Only modifies DOM on current page
- ✅ Respects existing Wildpoptart permissions
- ✅ No eval() or Function() usage
- ✅ CSP-compliant event dispatching

## Performance Notes

- Clears inputs: ~50ms per 10 inputs
- Detects questions: ~500-2000ms (existing function)
- Fills questions: ~500ms per question (includes delays)
- Total time: ~2-5 seconds for typical survey page

## Future Enhancements

- [ ] Support for slider inputs
- [ ] Support for date pickers
- [ ] Configurable fill values per question type
- [ ] Save/load fill presets
- [ ] Batch fill multiple pages
- [ ] Integration with persona system
- [ ] Export fill report
