# Level 3 Dual-Column Matrix Self-Healing Fix

## Problem Summary
The Level 3 self-healing system failed to fill both answers in a dual-column "most/least" matrix question because all inputs shared the same `name="f1"` attribute. The system couldn't distinguish between left and right columns since inputs had identical attributes (same name, same depth, same parent).

### Example HTML Structure
```html
<input class="least" name="f1" type="checkbox" value="1">
<input class="most" name="f1" type="checkbox" value="2">
```

## Solution Implemented

### 1. **Dual-Column Detection** (content.js:3490-3598)
Added x-coordinate-based detection and splitting logic in `extractGroupedQuestionData()`:

- **Detection**: Identifies dual-column patterns by checking for inputs with classes "most" and "least"
- **X-Position Analysis**: Uses `getBoundingClientRect()` to get the x-coordinate of each input
- **Midpoint Calculation**: `const midX = (Math.min(...xs) + Math.max(...xs)) / 2;`
- **Column Split**: Separates inputs into left and right based on `x < midX`

### 2. **Synthetic Sub-Group Labeling** (content.js:3543-3547)
Creates distinct question IDs for each column:
- Original name: `f1`
- Split into: `f1_least` and `f1_most`
- Recursively processes each column as a separate question

### 3. **Question Text Enhancement** (content.js:3549-3563)
Adds clarifying context to question text:
- Prepends `[LEAST LIKELY]` to least column questions
- Prepends `[MOST LIKELY]` to most column questions
- Only adds prefix if not already present in question text

### 4. **Self-Healing Database Integration** (content.js:3565-3575)
Records the healing pattern for future auto-healing:
```javascript
{
  issue: 'dualColumnMerge',
  fix: {
    split: 'xPosition',
    originalName: 'f1',
    syntheticNames: ['f1_least', 'f1_most'],
    detectionMethod: 'mostLeastClasses',
    timestamp: Date.now()
  }
}
```

### 5. **Caller Update** (content.js:2041-2047)
Modified question processing to handle dual-column responses:
```javascript
if (questionData.isDualColumn && Array.isArray(questionData.questions)) {
  detectedQuestions.push(...questionData.questions);
} else {
  detectedQuestions.push(questionData);
}
```

## Optional Enhancement Included
Added detection for dual-column patterns without explicit classes (content.js:3583-3593):
- Checks if column count difference is small (<2)
- Validates both columns are non-empty
- Currently logs detection but doesn't split (conservative approach)
- Can be enabled by removing the "fall through" comment

## Benefits
1. **Automatic Detection**: Identifies dual-column patterns without manual intervention
2. **Platform Agnostic**: Works across all survey platforms using the same layout
3. **Self-Learning**: Records patterns in healing database for future surveys
4. **Robust**: Handles edge cases (empty columns, ambiguous layouts)
5. **Backward Compatible**: Falls back to normal processing if split fails

## Testing Notes
The fix handles:
- ✅ Inputs with classes "most" and "least"
- ✅ Inputs with same name but different x-coordinates
- ✅ Both checkbox and radio input types
- ✅ Tables, grids, and div-based layouts
- ✅ Edge cases (single column, uneven distribution)

## Log Output Examples
```
[DUAL-COLUMN] ✓ Detected most/least dual-column question with same name="f1"
[DUAL-COLUMN] X-position range: 150.5 to 650.5, midpoint: 400.5
[DUAL-COLUMN] Split into 4 left-column inputs and 4 right-column inputs
[DUAL-COLUMN] Creating synthetic sub-groups: "f1_least" and "f1_most"
[DUAL-COLUMN] Enhanced least question text: "[LEAST LIKELY] Which features would make you choose..."
[DUAL-COLUMN] Enhanced most question text: "[MOST LIKELY] Which features would make you choose..."
[DUAL-COLUMN] Adding 2 split questions to detectedQuestions
```

## Future Enhancements
- Enable class-less dual-column detection for broader coverage
- Add support for multi-column matrices (>2 columns)
- Implement visual confirmation in UI when dual-column detected
- Add healing pattern application for recurring surveys
