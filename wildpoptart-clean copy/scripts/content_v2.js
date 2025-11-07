// Wildpoptart V2 Content Script
// Simplified approach: Extract raw inputs, let Claude understand structure

console.log('Wildpoptart Survey Bot V2 loaded');
console.log('📊 V2: Claude-powered structure detection');

// Global state
let currentPersona = null;
let isProcessing = false;

// Create floating Fill Survey button
function createFloatingButton() {
  // Only create button in main frame, not iframes
  if (window.self !== window.top) {
    console.log('[V2 BUTTON] Skipping button in iframe');
    return;
  }

  // Don't create duplicate buttons
  if (document.getElementById('wildpoptart-btn-v2')) return;

  const button = document.createElement('button');
  button.id = 'wildpoptart-btn-v2';
  button.className = 'wildpoptart-floating-btn';
  button.innerHTML = '🍰 Fill Survey (V2)';
  button.title = 'Click to auto-fill survey with AI (V2 - Claude-powered)';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    padding: 12px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 25px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    transition: all 0.3s ease;
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.05)';
    button.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
  });

  button.addEventListener('click', () => {
    console.log('[V2] Button clicked - starting fill...');
    detectAndFillSurvey();
  });

  document.body.appendChild(button);
  console.log('[V2] Floating button created');
}

// Create button when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFloatingButton);
} else {
  createFloatingButton();
}

// Detect if extension is active and auto-fill is enabled
chrome.storage.local.get(['isActive', 'autoFill'], (result) => {
  const isActive = result.isActive !== undefined ? result.isActive : true;
  const autoFill = result.autoFill || false;

  console.log(`[V2 AUTO-FILL] isActive: ${isActive}, autoFill: ${autoFill}`);

  if (isActive && autoFill) {
    console.log('[V2 AUTO-FILL] ✅ ENABLED - will auto-fill on page load');
    setTimeout(() => {
      console.log('[V2 AUTO-FILL] Starting automatic fill...');
      detectAndFillSurvey();
    }, 2000);
  } else {
    console.log('[V2 AUTO-FILL] ❌ DISABLED - you must click button manually');
  }
});

// Listen for fill survey command from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fillSurvey') {
    console.log('[V2] Received fillSurvey command');
    detectAndFillSurvey();
    sendResponse({ success: true });
  }
});

// Main detection and filling function
async function detectAndFillSurvey() {
  if (isProcessing) {
    console.log('[V2] Already processing, skipping...');
    return;
  }

  isProcessing = true;

  try {
    showNotification('🔍 V2: Detecting survey questions...', 'info');

    // Step 1: Extract all form inputs with context
    const formInputs = extractFormInputs();

    if (formInputs.length === 0) {
      showNotification('❌ No form inputs detected', 'error');
      isProcessing = false;
      return;
    }

    console.log(`[V2 DETECT] Found ${formInputs.length} form inputs`);

    // Step 2: Send to Claude for structure understanding + answering
    showNotification(`🤖 Sending ${formInputs.length} inputs to Claude...`, 'info');

    const response = await sendToClaudeV2(formInputs);

    if (!response || !response.questions) {
      showNotification('❌ Failed to get response from Claude', 'error');
      isProcessing = false;
      return;
    }

    console.log(`[V2 CLAUDE] Received ${response.questions.length} questions`);

    // Show debug info
    let debugMsg = `Claude detected ${response.questions.length} questions:\n`;
    response.questions.forEach((q, idx) => {
      const answerPreview = q.answer
        ? String(q.answer).substring(0, 30)
        : q.row_answers
          ? `${q.row_answers.length} rows`
          : q.answers
            ? `${q.answers.length} items`
            : 'no answer';
      debugMsg += `${idx + 1}. [${q.question_type}] ${answerPreview}\n`;
    });
    showNotification(debugMsg, 'info');

    // Step 3: Fill the survey based on Claude's response
    showNotification('✍️ Filling survey...', 'info');

    currentPersona = response.persona;
    await chrome.storage.local.set({ currentPersona });

    let filledCount = 0;
    for (const question of response.questions) {
      const filled = await fillQuestionV2(question);
      if (filled) filledCount++;
      await sleep(300); // Small delay between questions
    }

    showNotification(`✅ Filled ${filledCount}/${response.questions.length} questions`, 'success');

    // Step 4: Try to click Next button
    setTimeout(() => {
      clickNextButton();
    }, 1000);

  } catch (error) {
    console.error('[V2] Error:', error);
    showNotification(`❌ Error: ${error.message}`, 'error');
  } finally {
    isProcessing = false;
  }
}

// Extract all form inputs with surrounding context
function extractFormInputs() {
  const inputs = [];
  const allInputs = document.querySelectorAll('input, textarea, select');

  console.log(`[V2 EXTRACT] Found ${allInputs.length} total form elements`);

  // First pass: collect all inputs
  const collectedInputs = [];
  allInputs.forEach((input, idx) => {
    const type = input.type || input.tagName.toLowerCase();

    // Skip hidden, submit, button inputs
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') {
      return;
    }

    // Skip if visibly hidden
    if (input.offsetParent === null && type !== 'radio' && type !== 'checkbox') {
      return;
    }

    // Build input data
    const inputData = {
      id: input.id || `input_${idx}`,
      name: input.name || '',
      type: type,
      value: input.value || '',
      required: input.required || input.hasAttribute('required'),
      element: input // Keep reference
    };

    // Extract nearby text (labels, headings)
    inputData.nearbyText = extractNearbyText(input);

    // Extract options for select/radio/checkbox
    if (type === 'select-one' || type === 'select') {
      inputData.options = Array.from(input.options).map(opt => ({
        label: opt.textContent.trim(),
        value: opt.value
      }));
    } else if (type === 'radio' || type === 'checkbox') {
      // For radio/checkbox, find all options with same name
      if (input.name) {
        const groupInputs = document.querySelectorAll(`input[name="${input.name}"]`);
        inputData.options = Array.from(groupInputs).map(radio => ({
          label: getOptionLabel(radio),
          value: radio.value,
          id: radio.id
        }));
      }
    }

    // Constraints
    if (input.min) inputData.min = input.min;
    if (input.max) inputData.max = input.max;
    if (input.maxLength && input.maxLength > 0) inputData.maxLength = input.maxLength;

    collectedInputs.push(inputData);
  });

  // Second pass: Deduplicate radio/checkbox groups
  // Only include ONE representative per group (by name)
  const seenNames = new Set();

  collectedInputs.forEach(input => {
    if (input.type === 'radio' || input.type === 'checkbox') {
      // For radio/checkbox, only include first of each name
      if (input.name && seenNames.has(input.name)) {
        return; // Skip duplicates
      }
      if (input.name) {
        seenNames.add(input.name);
      }
    }

    inputs.push(input);
  });

  console.log(`[V2 EXTRACT] After deduplication: ${inputs.length} inputs`);

  return inputs;
}

// Extract nearby text for an input (labels, headers, instructions)
function extractNearbyText(input) {
  let text = '';

  // 1. Check for <label> with for attribute
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) {
      text = label.textContent.trim();
      return text;
    }
  }

  // 2. Check for parent <label>
  const parentLabel = input.closest('label');
  if (parentLabel) {
    text = parentLabel.textContent.trim();
    return text;
  }

  // 3. Check for aria-label or aria-labelledby
  if (input.getAttribute('aria-label')) {
    return input.getAttribute('aria-label');
  }

  if (input.getAttribute('aria-labelledby')) {
    const labelId = input.getAttribute('aria-labelledby');
    const labelElement = document.getElementById(labelId);
    if (labelElement) {
      return labelElement.textContent.trim();
    }
  }

  // 4. Look for nearby text in parent container
  const container = input.closest('div, td, li, fieldset');
  if (container) {
    const containerText = container.textContent.trim();
    text = containerText.substring(0, 200);
  }

  // 5. Check for question in table header
  const cell = input.closest('td, th');
  if (cell) {
    const row = cell.closest('tr');
    if (row) {
      const headerCell = row.querySelector('th, td:first-child');
      if (headerCell && headerCell !== cell) {
        const headerText = headerCell.textContent.trim();
        if (headerText) {
          text = headerText + (text ? ' | ' + text : '');
        }
      }
    }

    const table = cell.closest('table');
    if (table) {
      const caption = table.querySelector('caption');
      if (caption) {
        const captionText = caption.textContent.trim();
        text = captionText + (text ? ' | ' + text : '');
      }
    }
  }

  // 6. Look for preceding heading
  let sibling = input.parentElement;
  let attempts = 0;
  while (sibling && attempts < 5) {
    const heading = sibling.querySelector('h1, h2, h3, h4, h5, h6, .question, .survey-question');
    if (heading) {
      const headingText = heading.textContent.trim();
      text = headingText + (text ? ' | ' + text : '');
      break;
    }
    sibling = sibling.previousElementSibling;
    attempts++;
  }

  return text;
}

// Get label for a radio/checkbox option
function getOptionLabel(input) {
  // Try label[for=id]
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent.trim();
  }

  // Try parent label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    return parentLabel.textContent.trim();
  }

  // Try next sibling text
  if (input.nextSibling && input.nextSibling.nodeType === Node.TEXT_NODE) {
    const text = input.nextSibling.textContent.trim();
    if (text) return text;
  }

  // Try aria-label
  if (input.getAttribute('aria-label')) {
    return input.getAttribute('aria-label');
  }

  return input.value || 'Unknown';
}

// Send form data to Claude via background script
async function sendToClaudeV2(formInputs) {
  // Build form data (remove element references for JSON)
  const cleanInputs = formInputs.map(input => ({
    id: input.id,
    name: input.name,
    type: input.type,
    value: input.value,
    required: input.required,
    nearbyText: input.nearbyText,
    options: input.options,
    min: input.min,
    max: input.max,
    maxLength: input.maxLength
  }));

  const formData = {
    inputs: cleanInputs,
    pageContext: {
      url: window.location.href,
      title: document.title
    },
    previousPersona: currentPersona
  };

  // Send to background script
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'analyzeWithClaudeV2',
        data: formData
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      }
    );
  });
}

// Fill question based on Claude's response
async function fillQuestionV2(question) {
  console.log(`[V2 FILL] Filling question: ${question.question_id} (${question.question_type})`);
  console.log(`[V2 FILL] Structure: ${question.structure_notes || 'no explanation'}`);

  try {
    switch (question.question_type) {
      case 'matrix':
        return await fillMatrixQuestion(question);

      case 'date':
        return await fillDateQuestion(question);

      case 'checkbox':
        return await fillCheckboxQuestion(question);

      case 'radio':
        return await fillRadioQuestion(question);

      case 'select':
        return await fillSelectQuestion(question);

      case 'text':
      case 'textarea':
      case 'number':
        return await fillTextQuestion(question);

      default:
        console.warn(`[V2 FILL] Unknown question type: ${question.question_type}`);
        return false;
    }
  } catch (error) {
    console.error(`[V2 FILL] Error filling question ${question.question_id}:`, error);
    return false;
  }
}

// Fill matrix question (Likert scale grid)
async function fillMatrixQuestion(question) {
  if (!question.row_answers || question.row_answers.length === 0) {
    console.warn('[V2 FILL MATRIX] No row_answers provided');
    return false;
  }

  console.log(`[V2 FILL MATRIX] Filling ${question.row_answers.length} rows`);

  let filledCount = 0;

  for (const rowAnswer of question.row_answers) {
    // Find the input by row_id (which is the name attribute)
    const rowInputs = document.querySelectorAll(`input[name="${rowAnswer.row_id}"]`);

    if (rowInputs.length === 0) {
      console.warn(`[V2 FILL MATRIX] Could not find inputs for row: ${rowAnswer.row_id}`);
      continue;
    }

    // Find matching option
    let filled = false;
    for (const radio of rowInputs) {
      const label = getOptionLabel(radio).toLowerCase();
      const answer = rowAnswer.answer.toLowerCase();

      if (label.includes(answer) || answer.includes(label)) {
        console.log(`[V2 FILL MATRIX] ✓ Row "${rowAnswer.row_text.substring(0, 40)}" → "${rowAnswer.answer}"`);
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        radio.dispatchEvent(new Event('click', { bubbles: true }));
        filled = true;
        filledCount++;
        break;
      }
    }

    if (!filled) {
      console.warn(`[V2 FILL MATRIX] ❌ Could not match answer "${rowAnswer.answer}" for row "${rowAnswer.row_text.substring(0, 40)}"`);
    }

    await sleep(200);
  }

  console.log(`[V2 FILL MATRIX] Filled ${filledCount}/${question.row_answers.length} rows`);
  return filledCount > 0;
}

// Fill date question (multi-part dropdowns)
async function fillDateQuestion(question) {
  if (!question.answer_parts) {
    console.warn('[V2 FILL DATE] No answer_parts provided');
    return false;
  }

  const { month, day, year } = question.answer_parts;
  console.log(`[V2 FILL DATE] Filling date: ${month} ${day}, ${year}`);

  let filled = false;

  if (month) {
    const monthSelect = document.querySelector('select[name*="month" i], select[id*="month" i]');
    if (monthSelect) {
      const monthOptions = Array.from(monthSelect.options);
      const monthOption = monthOptions.find(opt =>
        opt.textContent.toLowerCase().includes(month.toLowerCase()) ||
        opt.value === month
      );
      if (monthOption) {
        monthSelect.value = monthOption.value;
        monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
        filled = true;
      }
    }
  }

  if (day) {
    const daySelect = document.querySelector('select[name*="day" i], select[id*="day" i], input[name*="day" i]');
    if (daySelect) {
      daySelect.value = day;
      daySelect.dispatchEvent(new Event('change', { bubbles: true }));
      filled = true;
    }
  }

  if (year) {
    const yearSelect = document.querySelector('select[name*="year" i], select[id*="year" i], input[name*="year" i]');
    if (yearSelect) {
      yearSelect.value = year;
      yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
      filled = true;
    }
  }

  return filled;
}

// Fill checkbox question (multi-select)
async function fillCheckboxQuestion(question) {
  if (!question.answers || question.answers.length === 0) {
    console.warn('[V2 FILL CHECKBOX] No answers array provided');
    return false;
  }

  console.log(`[V2 FILL CHECKBOX] Selecting ${question.answers.length} options`);

  // Find checkboxes by question_id or name
  let checkboxes = [];
  if (question.question_id) {
    checkboxes = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${question.question_id}"]`));
  }

  if (checkboxes.length === 0) {
    checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
  }

  let filledCount = 0;

  for (const answer of question.answers) {
    for (const checkbox of checkboxes) {
      const label = getOptionLabel(checkbox).toLowerCase();
      const answerLower = answer.toLowerCase();

      if (label.includes(answerLower) || answerLower.includes(label)) {
        console.log(`[V2 FILL CHECKBOX] ✓ Checking: "${answer}"`);
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount++;
        break;
      }
    }
  }

  return filledCount > 0;
}

// Fill radio question
async function fillRadioQuestion(question) {
  if (!question.answer) {
    console.warn('[V2 FILL RADIO] No answer provided');
    return false;
  }

  console.log(`[V2 FILL RADIO] Selecting: "${question.answer}"`);

  // Find radio group by question_id (name attribute)
  let radios = [];
  if (question.question_id) {
    radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${question.question_id}"]`));
  }

  // Fallback: search all radios
  if (radios.length === 0) {
    radios = Array.from(document.querySelectorAll('input[type="radio"]'));
  }

  // Find matching option
  for (const radio of radios) {
    const label = getOptionLabel(radio).toLowerCase();
    const answer = question.answer.toLowerCase();

    if (label.includes(answer) || answer.includes(label)) {
      console.log(`[V2 FILL RADIO] ✓ Selected: "${question.answer}"`);
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      radio.dispatchEvent(new Event('click', { bubbles: true }));
      return true;
    }
  }

  console.warn(`[V2 FILL RADIO] ❌ Could not match answer: "${question.answer}"`);
  return false;
}

// Fill select dropdown
async function fillSelectQuestion(question) {
  if (!question.answer) {
    console.warn('[V2 FILL SELECT] No answer provided');
    return false;
  }

  console.log(`[V2 FILL SELECT] Selecting: "${question.answer}"`);

  // Find select by question_id
  let select = document.querySelector(`select[name="${question.question_id}"], select[id="${question.question_id}"]`);

  if (!select) {
    // Fallback: find any select
    select = document.querySelector('select');
  }

  if (!select) {
    console.warn('[V2 FILL SELECT] Could not find select element');
    return false;
  }

  // Find matching option
  const options = Array.from(select.options);
  const matchingOption = options.find(opt => {
    const label = opt.textContent.toLowerCase();
    const answer = question.answer.toLowerCase();
    return label.includes(answer) || answer.includes(label);
  });

  if (matchingOption) {
    select.value = matchingOption.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(`[V2 FILL SELECT] ✓ Selected: "${question.answer}"`);
    return true;
  }

  console.warn(`[V2 FILL SELECT] ❌ Could not match answer: "${question.answer}"`);
  return false;
}

// Fill text/textarea/number input
async function fillTextQuestion(question) {
  if (!question.answer) {
    console.warn('[V2 FILL TEXT] No answer provided');
    return false;
  }

  console.log(`[V2 FILL TEXT] Filling: "${question.answer}"`);

  // Find input by question_id
  let input = document.querySelector(`input[name="${question.question_id}"], textarea[name="${question.question_id}"], input[id="${question.question_id}"], textarea[id="${question.question_id}"]`);

  if (!input) {
    // Fallback: find first text/textarea/number input
    input = document.querySelector('input[type="text"], textarea, input[type="number"]');
  }

  if (!input) {
    console.warn('[V2 FILL TEXT] Could not find input element');
    return false;
  }

  input.value = question.answer;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  console.log(`[V2 FILL TEXT] ✓ Filled with: "${question.answer}"`);
  return true;
}

// Click Next/Submit/Continue button
function clickNextButton() {
  console.log('[V2] Looking for Next button...');

  // Common button selectors
  const buttonSelectors = [
    'button:not([type="button"]):not([type="reset"])',
    'input[type="submit"]',
    'input[type="button"][value*="next" i]',
    'input[type="button"][value*="continue" i]',
    'button[type="submit"]',
    'a.button',
    '.btn-next',
    '.next-button',
    '#next',
    '[aria-label*="next" i]'
  ];

  const buttons = document.querySelectorAll(buttonSelectors.join(', '));

  for (const button of buttons) {
    const text = (button.textContent || button.value || '').toLowerCase();
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();

    if (text.includes('next') || text.includes('continue') || text.includes('submit') ||
        ariaLabel.includes('next') || ariaLabel.includes('continue')) {

      console.log(`[V2] Clicking button: "${button.textContent || button.value}"`);
      button.click();
      showNotification('➡️ Clicked Next button', 'success');
      return;
    }
  }

  console.log('[V2] No Next button found');
}

// Show notification
function showNotification(message, type = 'info') {
  console.log(`[V2 NOTIFY] ${type.toUpperCase()}: ${message}`);

  // Remove existing notifications
  const existing = document.querySelectorAll('.wildpoptart-v2-notification');
  existing.forEach(el => el.remove());

  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'wildpoptart-v2-notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4CAF50' : '#2196F3'};
    color: white;
    border-radius: 4px;
    z-index: 999999;
    font-family: Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    max-width: 400px;
    word-wrap: break-word;
    white-space: pre-line;
  `;

  document.body.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 5000);
}

// Sleep utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
