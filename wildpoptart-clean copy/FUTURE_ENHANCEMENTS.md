# Wildpoptart Survey Bot - Future Enhancements

This document tracks feature requests and enhancements for future development.

---

## High Priority

### ✅ 1. Image Recognition for Attention Checks (v1.9.33-v1.9.34)
**Status:** Completed
**Priority:** High
**Added:** 2025-11-03
**Completed:** 2025-11-03
**Updated:** v1.9.34 - Added IPSOS visible element clicking

**Problem:**
The bot cannot currently handle image-based attention check questions, such as:
- "Select the image you like more"
- "Are you able to see an image of a lion on this page?"
- "Select all images that contain a car"
- Image selection/preference questions

**Solution Implemented:**
✅ Detect image-based options in radio/checkbox questions
✅ Extract image URLs from `<img>` tags in labels
✅ Fetch images and convert to base64
✅ Send images to Claude's Vision API alongside question text
✅ Claude analyzes images and selects the appropriate option

**Technical Implementation:**
- Enhanced `getOptionLabel()` function to detect and return `{image, text}` objects (content.js:2469-2513)
- Modified option extraction to handle image data (content.js:1877-1911)
- Created `fetchImageAsBase64()` function to convert images (content.js:6050-6079)
- Added image fetching before API call (content.js:3289-3311)
- Updated Claude API call to support vision with content blocks (background.js:1963-2026)
- Added vision-specific instructions to prompt (background.js:1742-1756)

**How It Works:**
1. Bot detects `<img>` tags inside option labels
2. Fetches each image and converts to base64
3. Sends to Claude API with content array: `[{type: "text", text: "..."}   , {type: "image", source: {type: "base64", data: "..."}}]`
4. Claude visually analyzes images and answers based on visual content
5. Bot selects the option Claude chose

**Related Files:**
- `scripts/content.js` - Image detection, fetching, and option extraction
- `scripts/background.js` - Vision API integration

**v1.9.34 Update:**
- Fixed IPSOS survey compatibility: Bot now clicks visible `.mrsingletext` elements instead of just hidden radio inputs
- Added special handling for IPSOS image-based questions (content.js:5614-5634)
- Vision questions with pre-filled values are now re-answered instead of skipped (content.js:1856-1865)
- Fixed option matching to handle object labels `{image, text}` instead of strings (content.js:5135-5140, 5787-5792)

---

### 🔧 2. Current Date/Time Access (v1.9.31 - Partial)
**Status:** Partially Working - Needs Improvement
**Priority:** Medium
**Added:** 2025-11-03
**Updated:** 2025-11-03

**Problem:**
The bot cannot answer questions that require knowing the current date/time:
- "In the box below please type in the day of the week you are taking this survey."
- "What is today's date?"
- "What day of the week is it?"
- Calculating birth years from ages (e.g., "4 years old" → born in 2021)

**Solution Implemented (v1.9.31):**
Added current date/time information to Claude prompt in background.js:
```javascript
const now = new Date();
message += `**Current Date and Time Information:**\n`;
message += `- Today is: ${dayOfWeek}, ${fullDate}\n`;
message += `- Current time: ${time}\n`;
message += `- Current year: ${now.getFullYear()}\n`;
message += `- Use this information to calculate birth years from ages\n\n`;
```

**Current Status:**
- ✅ Claude receives current date/time information
- ❌ Still calculating wrong birth years (e.g., 2019 instead of 2021 for 4-year-old)
- **Likely Issue:** Persona stores birth dates that conflict with current ages, or Claude is using persona birth dates instead of calculating from ages

**Next Steps:**
- Review persona consistency logic - may need to calculate children's birth dates dynamically from ages
- Consider storing children's ages instead of birth dates in persona
- Add explicit instruction to prioritize current year calculation over stored persona dates

**Related Files:**
- `scripts/background.js` - buildUserMessage() function (line 1663-1677)

---

## Medium Priority

### 3. Enhanced Carousel Detection
**Status:** Deferred
**Priority:** Low
**Added:** Previous conversation

**Problem:**
Different survey platforms may use different carousel implementations beyond the current detection logic.

**Solution:**
Create more robust carousel detection that handles various frameworks and implementations.

**Status Note:**
User said "lets wait on that" - deferred for now until we encounter more carousel types in production.

---

## Low Priority

### 4. Improved Matrix Question Text Extraction
**Status:** Not Started
**Priority:** Low
**Added:** 2025-11-03 (from database analysis)

**Problem:**
15 matrix questions in the database have generic "Matrix question" text instead of descriptive question text.

**Solution:**
Enhance matrix question text extraction to capture:
- Row/column headers
- Question context from surrounding elements
- Table captions or labels

**Related Files:**
- `scripts/content.js` - findGroupQuestionText() function

---

## Completed Enhancements

### ✅ Grid/Matrix Question Text Extraction (v1.9.32)
Enhanced question text extraction for IPSOS grid/matrix questions where question text is in table `summary` attribute and row labels are in `td.mrGridCategoryText`. Now correctly extracts questions like "How many people 18 years old or older... - Age group: 18-34" instead of just showing the input ID.

Also added detection of pre-filled placeholder values (like "0") so Claude knows they should be replaced, not treated as already-answered questions.

### ✅ Automatic "None of the above" Fallback (v1.9.22)
When Claude's answer doesn't match any available option AND "None of the above" exists, automatically select it.

### ✅ Pre-filled Question Skip Logic (v1.9.15)
Skip pre-filled radio questions to avoid Qualtrics session conflicts.

### ✅ Document-wide Question Text Search (v1.9.17)
Added fallback search for question text in high-level sibling elements.

### ✅ Angular Form Support (v1.9.16-v1.9.22)
Proper ng-click and digest cycle handling for Angular-based surveys.

---

## Notes

- Enhancements are prioritized based on frequency of occurrence and impact on survey completion rate
- Image recognition and date/time access are high priority as they prevent survey completion
- Each enhancement should be versioned and tested thoroughly before deployment
