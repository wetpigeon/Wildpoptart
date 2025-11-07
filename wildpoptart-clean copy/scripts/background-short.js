// Wildpoptart Background Service Worker - Claude API Integration

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-3-haiku-20240307';

// SHORT System Prompt (optimized for rate limits)
const SYSTEM_PROMPT = `You are answering surveys as a 33-year-old male Finance Director in Toronto with $1M income, married with 2 kids.

CRITICAL RULES:
1. Age questions → Answer "33"
2. Gender → "Male"
3. Industry → "Finance" (ONLY ONE, never multiple)
4. Income → Select HIGHEST option (ideally $1M+, $200k+, or $150k+)
5. Location → Toronto, Ontario, M4M 1Y8
6. Children → "Yes, 2" (ages 4 and 8)
7. Employment → "Full-time" + "I am a decision maker"

SCREENING AVOIDANCE:
- NEVER select: "None", "Never", "Not interested", "No", "Not a decision maker"
- ALWAYS select: "Yes", "Recently", "Within last 3 months", "I make decisions"
- Brand surveys: If asking about specific brand/product, answer as a customer/user
- Radio buttons = ONE answer (string), Checkboxes = MULTIPLE answers (array)

OUTPUT FORMAT (JSON only):
{
  "persona": {"age_range": "30-34", "demographics": "33yr Finance Director Toronto", "consistency_notes": "High-income decision-maker"},
  "answers": [
    {"question_id": "q1", "question_text": "What is your age?", "question_type": "text", "answer": "33", "reasoning": "Persona age"},
    {"question_id": "q2", "question_text": "Gender?", "question_type": "radio", "answer": "Male", "reasoning": "Persona gender"}
  ]
}

Match question_id from input exactly. Use "answer": "value" for radio/text, "answer": ["val1","val2"] for checkboxes.`;


// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Message received:', request.action);

  if (request.action === 'analyzeWithClaude') {
    console.log('[Background] Starting analyzeWithClaude handler...');
    handleClaudeRequest(request.data)
      .then(response => {
        console.log('[Background] Sending success response to content script');
        sendResponse({ success: true, data: response });
      })
      .catch(error => {
        console.error('[Background] Error in handleClaudeRequest:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

// Handle Claude API request
async function handleClaudeRequest(surveyData) {
  console.log('[Background] Handling Claude request for', surveyData.questions.length, 'questions');

  // Get API key from storage
  const storage = await chrome.storage.local.get(['claudeApiKey']);
  const apiKey = storage.claudeApiKey;

  if (!apiKey) {
    console.error('[Background] No API key found');
    throw new Error('Claude API key not configured. Please add it in the extension popup.');
  }

  console.log('[Background] API key found, building user message...');

  // Build user message
  const userMessage = buildUserMessage(surveyData);
  console.log('[Background] User message length:', userMessage.length);

  // Call Claude API
  console.log('[Background] Calling Claude API...');
  const response = await callClaudeAPI(apiKey, userMessage);
  console.log('[Background] Claude API response received:', response);

  return response;
}

// Build user message from survey data
function buildUserMessage(surveyData) {
  const { questions, previousPersona, pageContext } = surveyData;

  let message = `Please analyze this survey and provide answers.\n\n`;

  if (pageContext) {
    message += `**Page Context:**\n`;
    message += `URL: ${pageContext.url}\n`;
    message += `Title: ${pageContext.title}\n\n`;
  }

  if (previousPersona) {
    message += `**Previous Persona (maintain consistency):**\n`;
    message += `Age Range: ${previousPersona.age_range}\n`;
    message += `Demographics: ${previousPersona.demographics}\n`;
    message += `Notes: ${previousPersona.consistency_notes}\n\n`;
  }

  message += `**Questions to Answer:**\n\n`;

  questions.forEach((q, index) => {
    message += `${index + 1}. ${q.question_text}\n`;
    message += `   - ID: ${q.question_id}\n`;
    message += `   - Type: ${q.question_type}\n`;
    message += `   - Required: ${q.required ? 'Yes' : 'No'}\n`;

    if (q.options && q.options.length > 0) {
      message += `   - Options: ${q.options.map(opt => opt.label || opt.value).join(', ')}\n`;
    }

    if (q.min !== undefined && q.max !== undefined) {
      message += `   - Range: ${q.min} to ${q.max}\n`;
    }

    message += `\n`;
  });

  message += `\nProvide your response as a JSON object with persona and answers array. Use the exact question_id values provided above.`;

  return message;
}

// Call Claude API
async function callClaudeAPI(apiKey, userMessage) {
  try {
    console.log('[API] Sending request to Claude API...');

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
        messages: [
          {
            role: 'user',
            content: userMessage
          }
        ]
      })
    });

    console.log('[API] Response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[API] Error response:', errorData);
      throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('[API] Response data received');

    const assistantMessage = data.content[0].text;
    console.log('[API] Assistant message:', assistantMessage.substring(0, 200) + '...');

    // Parse JSON response
    const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[API] Could not find JSON in response:', assistantMessage);
      throw new Error('Could not parse JSON from Claude response');
    }

    console.log('[API] Found JSON, parsing...');
    const parsedResponse = JSON.parse(jsonMatch[0]);
    console.log('[API] Parsed response with', parsedResponse.answers?.length, 'answers');

    return parsedResponse;

  } catch (error) {
    console.error('[API] Claude API Error:', error);
    throw error;
  }
}

// Extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Wildpoptart Survey Bot installed');

  // Set default settings
  chrome.storage.local.set({
    isActive: false,
    currentPersona: null
  });
});
