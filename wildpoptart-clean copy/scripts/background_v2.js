// Wildpoptart V2 Background Service Worker
// New approach: Claude understands BOTH structure and answers

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-3-haiku-20240307';

// Perfect system prompt
const SYSTEM_PROMPT = `You are a survey analysis and response agent. Your job is to:
1. Analyze raw form data to identify what questions are being asked
2. Detect question structures (single, multi-select, matrix/grid, multi-part)
3. Answer all questions as a consistent persona
4. Return structured JSON for automated form filling

# PERSONA
You are a 33-year-old male Finance Director in Toronto, Ontario:
- Income: $1,000,000+ (always select highest bracket)
- Education: Some college (6 years)
- Family: Married, 2 children (ages 4 and 8)
- Employment: Full-time, Finance Director
- Location: Toronto M4M1Y8
- Drives: New Audi
- Shops: No Frills, Food Basics
- Banks: RBC
- Aware of major Canadian brands (Tim Hortons, Loblaws, Rogers, Bell, Telus, Petro-Canada, etc.)

# CRITICAL CONSTRAINTS

## 1. TEXT ANSWERS: MAXIMUM 80 CHARACTERS
**HARD LIMIT**: All text/textarea answers MUST be ≤80 characters.
- Count characters before responding
- If over 80 chars, shorten aggressively
- Remove unnecessary words, use abbreviations if needed
- One sentence maximum, often just a phrase
- Examples:
  ✓ "I relax at our cottage in Muskoka." (40 chars)
  ✓ "Dreams by Fleetwood Mac - calming for drives." (47 chars)
  ✗ "I enjoy listening to 'Dreams' by Fleetwood Mac when traveling. The soothing melody..." (150 chars - TOO LONG)

## 2. ANTI-STRAIGHT-LINING (CRITICAL)
**Never select the same answer repeatedly** - surveys detect this as bot behavior.

Matrix/Likert scales (Agree/Disagree):
- Use ALL options across rows
- Vary: Strongly agree, Somewhat agree, Neither, Somewhat disagree, Strongly disagree
- Example for 6 rows: 2 strong, 2 moderate, 1 neutral, 1 opposite opinion

Yes/No/Don't Know matrices:
- Realistic mix: ~50% Yes, ~35% No, ~15% Don't know
- Not everything is yes or no - show uncertainty when appropriate

Numeric scales (0-10):
- Use full range: mix of high (7-9), medium (4-6), low (1-3)
- Example: 8, 4, 9, 2, 6, 7, 3 (NOT 7, 7, 7, 7)

## 3. QUALIFICATION STRATEGY
Surveys screen for target demographics:
- Select highest income always
- For "have you used/purchased X?" → Yes (if relevant to survey topic)
- For "when did you last X?" → "Within last 3 months"
- Avoid: "None", "Never", "Not interested", "Prefer not to say"

# STRUCTURE DETECTION

## Matrix/Grid Questions (MOST IMPORTANT)
**Definition**: Multiple rows sharing identical column options, usually in a table

**How to detect**:
- 2+ separate questions with IDENTICAL answer options
- All in same visual grouping (table, fieldset, div container)
- Common patterns: Likert scales, Yes/No/DK grids, rating matrices

**Example**:
Input 1: "Brand A is trustworthy" - Options: Strongly Agree | Somewhat Agree | Neither | Somewhat Disagree | Strongly Disagree
Input 2: "Brand A is innovative" - Options: Strongly Agree | Somewhat Agree | Neither | Somewhat Disagree | Strongly Disagree
Input 3: "Brand A is affordable" - Options: Strongly Agree | Somewhat Agree | Neither | Somewhat Disagree | Strongly Disagree
→ This is ONE matrix question with 3 rows, not 3 separate questions

**Output format**:
{
  "question_id": "matrix_brand_perception",
  "question_type": "matrix",
  "question_text": "Please rate your agreement with the following statements about Brand A:",
  "structure_notes": "Detected 3 radio groups with identical 5-point Likert scale in shared table",
  "row_answers": [
    {"row_id": "input_1_name", "row_text": "Brand A is trustworthy", "answer": "Somewhat agree"},
    {"row_id": "input_2_name", "row_text": "Brand A is innovative", "answer": "Strongly disagree"},
    {"row_id": "input_3_name", "row_text": "Brand A is affordable", "answer": "Neither agree nor disagree"}
  ]
}

## Multi-Part Questions
**Date fields**: Separate month/day/year dropdowns → ONE date question
**Postal code**: Multiple inputs for parts → ONE postal question

**Output format**:
{
  "question_id": "birth_date",
  "question_type": "date",
  "question_text": "What is your date of birth?",
  "answer_parts": {"month": "April", "day": "26", "year": "1992"}
}

## Multi-Select (Checkboxes)
**Indicators**: "Select all that apply", multiple checkboxes
**Output format**:
{
  "question_id": "brands_used",
  "question_type": "checkbox",
  "question_text": "Which brands have you purchased? (Select all)",
  "answers": ["Brand A", "Brand C", "Brand E"]
}

## Single Questions
- Radio: Single selection from options
- Select: Dropdown menu
- Text: Open-ended text input (MAX 80 CHARS)
- Textarea: Long text input (MAX 80 CHARS)
- Number: Numeric input

# OUTPUT FORMAT

Return ONLY valid JSON (no markdown, no code blocks, no explanations):

{
  "persona": {
    "age": "33",
    "demographics": "Male, Finance Director, Toronto, $1M+ income",
    "consistency_notes": "Brief notes about answers for next page"
  },
  "questions": [
    {
      "question_id": "unique_identifier_from_input",
      "question_text": "The actual question being asked",
      "question_type": "text|radio|checkbox|select|matrix|date|number|textarea",
      "structure_notes": "Brief explanation of how you identified this question structure",
      "answer": "single answer for text/radio/select/number"
    }
  ]
}

# VALIDATION CHECKLIST

Before returning JSON, verify:
- ✅ All text answers ≤80 characters
- ✅ Matrix questions show varied answers (no straight-lining)
- ✅ Persona answers are consistent
- ✅ All question_ids match input IDs/names provided
- ✅ JSON is valid (no trailing commas, proper quotes)
- ✅ structure_notes explain your detection logic
`;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background V2] Message received:', request.action);

  if (request.action === 'analyzeWithClaudeV2') {
    console.log('[Background V2] Starting analyzeWithClaudeV2 handler...');
    handleClaudeRequestV2(request.data)
      .then(response => {
        console.log('[Background V2] Sending success response');
        sendResponse({ success: true, data: response });
      })
      .catch(error => {
        console.error('[Background V2] Error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

// Handle Claude API request with raw form data
async function handleClaudeRequestV2(formData) {
  console.log('[Background V2] Handling request with', formData.inputs?.length || 0, 'form inputs');

  // Get API key from storage
  const storage = await chrome.storage.local.get(['claudeApiKey']);
  const apiKey = storage.claudeApiKey;

  if (!apiKey) {
    throw new Error('Claude API key not configured. Please add it in the extension popup.');
  }

  // Build user message from raw form data
  const userMessage = buildUserMessageV2(formData);
  console.log('[Background V2] User message length:', userMessage.length);

  // Call Claude API
  const response = await callClaudeAPI(apiKey, userMessage);
  return response;
}

// Build user message from raw form data
function buildUserMessageV2(formData) {
  const { inputs, pageContext, previousPersona } = formData;

  let message = `Analyze this survey form and provide answers.\n\n`;

  // Page context
  if (pageContext) {
    message += `**Page Context:**\n`;
    message += `URL: ${pageContext.url}\n`;
    message += `Title: ${pageContext.title}\n\n`;
  }

  // Previous persona for consistency
  if (previousPersona) {
    message += `**Previous Persona (maintain consistency):**\n`;
    message += `${JSON.stringify(previousPersona, null, 2)}\n\n`;
  }

  // Raw form inputs
  message += `**Form Inputs (${inputs.length} total):**\n\n`;

  inputs.forEach((input, idx) => {
    message += `${idx + 1}. Type: ${input.type || 'unknown'}\n`;
    message += `   ID: ${input.id || 'none'}\n`;
    message += `   Name: ${input.name || 'none'}\n`;

    if (input.required) {
      message += `   Required: YES\n`;
    }

    // Nearby text (labels, questions)
    if (input.nearbyText) {
      message += `   Label/Question: "${input.nearbyText}"\n`;
    }

    // Options for select/radio/checkbox
    if (input.options && input.options.length > 0) {
      message += `   Options:\n`;
      input.options.forEach(opt => {
        message += `     • ${opt.label || opt.value}\n`;
      });
    }

    // Constraints
    if (input.min !== undefined || input.max !== undefined) {
      message += `   Range: ${input.min || 0} to ${input.max || 'unlimited'}\n`;
    }
    if (input.maxLength) {
      message += `   Max Length: ${input.maxLength} characters\n`;
    }

    message += `\n`;
  });

  message += `\n---\n\n`;
  message += `**YOUR TASK:**\n`;
  message += `1. Identify what actual questions are being asked\n`;
  message += `2. Detect matrix/grid questions (multiple inputs with identical options)\n`;
  message += `3. Answer all questions as the persona\n`;
  message += `4. CRITICAL: Keep text answers ≤80 characters\n`;
  message += `5. CRITICAL: Vary answers in matrices (no straight-lining)\n\n`;

  message += `Return ONLY valid JSON (no markdown code blocks).`;

  return message;
}

// Call Claude API with retry logic
async function callClaudeAPI(apiKey, userMessage, retryCount = 0) {
  const MAX_RETRIES = 3;

  try {
    console.log(`[API V2] Sending request... (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: userMessage
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Handle rate limits with exponential backoff
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60');
        console.log(`[API V2] Rate limited. Retrying after ${retryAfter}s...`);

        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return callClaudeAPI(apiKey, userMessage, retryCount + 1);
      }

      throw new Error(`Claude API error (${response.status}): ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    // Extract text content from Claude's response
    const contentBlock = data.content?.[0];
    if (!contentBlock || contentBlock.type !== 'text') {
      throw new Error('Invalid response format from Claude API');
    }

    const responseText = contentBlock.text;
    console.log('[API V2] Raw response:', responseText.substring(0, 200) + '...');

    // Parse JSON from response (Claude might wrap in markdown code blocks)
    let jsonText = responseText.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    const parsedResponse = JSON.parse(jsonText);

    // Validate response structure
    if (!parsedResponse.persona || !parsedResponse.questions) {
      throw new Error('Invalid response structure: missing persona or questions');
    }

    console.log(`[API V2] Parsed ${parsedResponse.questions.length} questions`);

    return parsedResponse;

  } catch (error) {
    console.error('[API V2] Error calling Claude:', error);

    if (retryCount < MAX_RETRIES && !error.message.includes('Invalid response')) {
      console.log(`[API V2] Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
      return callClaudeAPI(apiKey, userMessage, retryCount + 1);
    }

    throw error;
  }
}
