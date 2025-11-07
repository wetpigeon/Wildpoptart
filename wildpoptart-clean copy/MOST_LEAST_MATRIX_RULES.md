# System Rules for Most/Least Matrix Questions

## Rule: Shared Attribute List with Mutual Exclusivity

### Overview
Most/Least matrix questions present a dual-column layout where users must select one attribute as "most important/likely" and a different attribute as "least important/likely". The system must enforce that the same attribute cannot be selected for both columns.

### Detection
Most/Least matrices are identified by:
- Inputs with CSS classes `.most` and `.least`
- Question text containing "most likely" and "least likely" or "most important" and "least important"
- Dual-column table layout with shared input names (e.g., `name="f1"`)

### Attribute Derivation Rules

1. **Extract Shared Attribute List**: Derive a single list of attributes from the row/column text
   - Example attributes: "Fuel consumption", "Car Safety Features", "Cruise Control", "Price"
   - These represent the items being evaluated

2. **Ignore Numeric Headers**: Discard numeric column headers like 2, 4, 6, 8
   - These are often value labels in Likert scales, not attributes
   - Focus only on the semantic attribute names

3. **Use Attribute Labels in Answers**: Output answers by attribute label, not by numbers or positions
   - ✅ Correct: `"answer": "Fuel consumption"`
   - ❌ Incorrect: `"answer": "1"` or `"answer": "2"`

### Mutual Exclusivity Enforcement

**Critical Rule**: Never select the same attribute for both "Most" and "Least" rows.

**If a conflict would occur:**
1. Keep the "Most" selection unchanged
2. Change the "Least" selection to a different attribute
3. Select the least preferred alternative that differs from "Most"

**Example Conflict Resolution:**
```
Initial (INVALID):
- Most likely: "Fuel consumption"
- Least likely: "Fuel consumption"  ❌ CONFLICT!

Corrected (VALID):
- Most likely: "Fuel consumption"
- Least likely: "Price"  ✅ Different attribute
```

### Required JSON Response Format

```json
{
  "question_id": "f1_matrix",
  "question_type": "matrix",
  "row_answers": [
    {
      "row_id": "f1_most",
      "answer": "Fuel consumption"
    },
    {
      "row_id": "f1_least",
      "answer": "Price"
    }
  ],
  "notes": "Used shared attribute list; enforced mutual exclusivity."
}
```

### Key Points

1. **`row_id` Values**: Use the synthetic sub-group IDs created by the dual-column split logic
   - `f1_most` for the "Most" column
   - `f1_least` for the "Least" column

2. **`answer` Values**: Must be attribute labels from the shared list
   - Not numeric values
   - Not position indices
   - Exact text match with detected column labels

3. **`question_type`**: Always use `"matrix"` for dual-column matrices

4. **`notes` Field**: Include explanation of rule application for debugging

### Validation Checks

Before accepting a response, verify:
1. ✅ Both `f1_most` and `f1_least` have answers
2. ✅ Answers are different (mutual exclusivity)
3. ✅ Answers match attribute labels (not numbers)
4. ✅ Answers exist in the shared attribute list

### Example Scenarios

#### Scenario 1: Car Features
**Question**: "Which features would be most/least likely to make you choose your next car?"

**Attributes**: Fuel consumption, Car Safety Features, Cruise Control, Price

**Valid Response**:
```json
{
  "row_answers": [
    {"row_id": "f1_most", "answer": "Car Safety Features"},
    {"row_id": "f1_least", "answer": "Cruise Control"}
  ]
}
```

#### Scenario 2: Brand Preferences
**Question**: "Which brands do you most/least prefer?"

**Attributes**: Nike, Adidas, Puma, Reebok

**Valid Response**:
```json
{
  "row_answers": [
    {"row_id": "brand_most", "answer": "Nike"},
    {"row_id": "brand_least", "answer": "Puma"}
  ]
}
```

#### Scenario 3: Conflict Resolution
**Persona Preference**: "I care most about price and least about price" (contradiction)

**Corrected Response**:
```json
{
  "row_answers": [
    {"row_id": "f1_most", "answer": "Price"},
    {"row_id": "f1_least", "answer": "Cruise Control"}
  ],
  "notes": "Persona had contradictory preference. Selected Price for most, changed least to Cruise Control to enforce mutual exclusivity."
}
```

### Implementation Notes

1. **Detection**: Implemented in `extractGroupedQuestionData()` (content.js:3490-3598)
2. **Column Splitting**: X-coordinate based split creates synthetic `_most` and `_least` sub-groups
3. **Validation**: Checked in `fillQuestionsWithPersona()` (content.js:5918-5938)
4. **Self-Healing**: Pattern recorded in healing database as `dualColumnMerge`

### Error Handling

If the same attribute is selected for both columns:
```
❌ VALIDATION FAILED: Same answer selected for Most and Least likely!
Most likely: "Fuel consumption"
Least likely: "Fuel consumption"
ERROR: Most/Least validation failed - same answer selected for both. Stopping.
```

### Testing Checklist

- [ ] Extracts correct attribute list from matrix
- [ ] Ignores numeric column headers
- [ ] Returns answers by attribute label, not numbers
- [ ] Enforces mutual exclusivity (different attributes)
- [ ] Handles conflict resolution correctly
- [ ] Produces valid JSON format
- [ ] Passes validation checks before filling
