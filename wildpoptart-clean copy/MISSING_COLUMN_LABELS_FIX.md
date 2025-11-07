# Level 5.1.2 Missing Column Labels Self-Healing Fix

## Problem Summary
The Level 5.1.2 self-healing system detected dual-column "most/least" questions correctly but filled nothing. Logs showed `[MATRIX] Extracted 0 unique columns: []`, meaning `buildCheckboxMatrix()` failed to populate column labels because the itrafficcenter DOM has no `data-column-label` or `<th>` elements.

### Root Cause
The matrix extraction logic relied exclusively on:
1. `aria-labelledby` attributes pointing to column label elements
2. `data-column-label` attributes on inputs
3. `<th>` elements in table headers

When these were missing, `cleanOptions` remained empty, causing the filling logic to fail even though the matrix structure was correctly detected.

## Solution Implemented

### 1. **Fallback Column Extraction** (content.js:2587-2626)
Added fallback logic that extracts column labels from input labels using `getOptionLabel()`:

```javascript
if (cleanOptions.length === 0) {
  console.log(`[MATRIX] ⚠️ No column labels found via aria-labelledby. Falling back to getOptionLabel() extraction...`);

  // Extract unique labels from first row
  const uniqueLabels = [];
  const seenLabels = new Set();

  if (questions.length > 0 && questions[0].elements) {
    questions[0].elements.forEach(input => {
      const label = getOptionLabel(input);
      if (label && !seenLabels.has(label)) {
        uniqueLabels.push(label);
        seenLabels.add(label);
      }
    });
  }

  cleanOptions = uniqueLabels.map(label => ({
    label: label,
    value: label
  }));
}
```

**Key Features:**
- Extracts labels from the first row's inputs (all columns should be present)
- Deduplicates labels using a Set
- Maintains insertion order for positional mapping
- Logs the extracted columns for debugging

### 2. **Positional Mapping for Claude Responses** (content.js:6899-6911, 6963-6980)
Added positional mapping logic to handle "Option A/B/C/D" responses:

**For Checkbox Matrices:**
```javascript
const optionMatch = answerLower.match(/^option\s+([a-z])$/i);
if (optionMatch) {
  const optionLetter = optionMatch[1].toLowerCase();
  const optionIndex = optionLetter.charCodeAt(0) - 'a'.charCodeAt(0);
  console.log(`[MATRIX] Detected positional option: "${ans}" → index ${optionIndex}`);

  if (checkboxIndex === optionIndex) {
    console.log(`[MATRIX] ✓ Positional match! Checkbox index ${checkboxIndex} matches "${ans}"`);
    return true;
  }
}
```

**For Radio Matrices:**
```javascript
const optionMatch = answerLower.match(/^option\s+([a-z])$/i);
if (optionMatch) {
  const optionLetter = optionMatch[1].toLowerCase();
  const optionIndex = optionLetter.charCodeAt(0) - 'a'.charCodeAt(0);
  console.log(`[MATRIX] Detected positional option: "${rowAnswer.answer}" → index ${optionIndex}`);

  if (radioIndex === optionIndex) {
    console.log(`[MATRIX] ✓ Positional match! Radio index ${radioIndex} matches "${rowAnswer.answer}"`);
    matchesAnswer = true;
  }
}
```

**Mapping:**
- `Option A` → column index 0
- `Option B` → column index 1
- `Option C` → column index 2
- `Option D` → column index 3
- ...and so on for E, F, etc.

### 3. **Self-Healing Database Integration** (content.js:2615-2625)
Records the healing pattern for future auto-healing:
```javascript
window.selfHeal.recordHealing(platform, 'missingColumnLabels', {
  type: 'positionalMap',
  extractionMethod: 'getOptionLabel',
  columnCount: cleanOptions.length,
  columns: cleanOptions.map(c => c.label),
  timestamp: Date.now()
});
```

## Benefits

1. **Robust Column Detection**: No longer relies solely on semantic markup
2. **Positional Mapping**: Handles generic "Option A/B/C/D" responses from Claude
3. **Self-Learning**: Records pattern in healing database for future surveys
4. **Backward Compatible**: Standard label matching still works as fallback
5. **Platform Agnostic**: Works across all survey systems with unlabeled matrices

## Expected Log Output

### During Extraction:
```
[MATRIX] Extracted 0 unique columns: []
[MATRIX] ⚠️ No column labels found via aria-labelledby. Falling back to getOptionLabel() extraction...
[MATRIX] ✓ Fallback extracted 4 columns from input labels: ["Fuel consumption", "Car Safety Features", "Cruise Control", "Price"]
```

### During Filling:
```
[MATRIX] Filling row "Which feature is most important?" with 1 answer(s): ["Option A"]
[MATRIX] Checking checkbox [0] ID="f1_1" label="Fuel consumption"
[MATRIX] Detected positional option: "Option A" → index 0
[MATRIX] ✓ Positional match! Checkbox index 0 matches "Option A"
[MATRIX] ✓ Checking checkbox: "Fuel consumption" for row "Which feature is most important?"
[MATRIX] ✓ Checked 1 checkbox(es) for row "Which feature is most important?"
```

## Edge Cases Handled

1. **Empty Elements Array**: Checks `questions.length > 0` and `questions[0].elements` before extraction
2. **Duplicate Labels**: Uses Set to deduplicate while maintaining order
3. **Mixed Responses**: Falls back to label matching if not "Option X" format
4. **Radio vs Checkbox**: Handles both matrix types with same logic
5. **Case Insensitivity**: Uses `.toLowerCase()` for matching

## Testing Notes

The fix handles:
- ✅ Matrices without `aria-labelledby` attributes
- ✅ Matrices without `data-column-label` attributes
- ✅ Matrices without `<th>` elements
- ✅ Claude responses in "Option A/B/C/D" format
- ✅ Claude responses with actual label text (fallback)
- ✅ Both checkbox and radio matrix types
- ✅ Dual-column most/least questions

## Future Enhancements

- Support for multi-letter options (Option AA, AB, etc.)
- Support for numeric positional responses (Option 1, Option 2, etc.)
- Cache column extraction per survey to improve performance
- Add visual feedback when positional mapping is used
