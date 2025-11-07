// Wildpoptart Content Script - Page Observer and Question Detector

console.log('Wildpoptart Survey Bot loaded');
console.log('📊 To export question database, type: exportDB()');
console.log('🤖 AUTO-FILL MODE: The bot will automatically progress through surveys without button clicks');

// State management
let isActive = false;
let autoFillEnabled = false; // Auto-fill mode - automatically process surveys without button clicks
let currentPersona = null;
let detectedQuestions = [];

// Question database tracking
let currentSurveySession = {
  survey_id: null,
  url: window.location.href,
  start_time: Date.now(),
  questions: []
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle') {
    isActive = request.enabled;
    if (isActive) {
      startSurveyDetection();
    } else {
      stopSurveyDetection();
    }
    sendResponse({ success: true });
  } else if (request.action === 'fillSurvey') {
    // Call processSurvey in this frame
    processSurvey();

    // IMPORTANT: Forward message to all child frames (for frameset pages)
    // This ensures that if the popup sends to the main frame, child frames also receive it
    if (window.frames && window.frames.length > 0) {
      console.log(`[FRAMES] Forwarding fillSurvey to ${window.frames.length} child frames`);
      for (let i = 0; i < window.frames.length; i++) {
        try {
          window.frames[i].postMessage({ action: 'fillSurvey', source: 'wildpoptart' }, '*');
        } catch (e) {
          console.log(`[FRAMES] Could not forward to frame ${i}:`, e.message);
        }
      }
    }

    sendResponse({ success: true });
  } else if (request.action === 'rateLimitNotification') {
    // Show rate limit notification to user
    const { waitTime, retryCount, maxRetries } = request;
    showNotification(
      `⏳ RATE LIMIT EXCEEDED!\n\nClaude API rate limit hit. Waiting ${waitTime} seconds before retry ${retryCount}/${maxRetries}.\n\nTip: Slow down survey submissions to avoid this.`,
      'warning'
    );
    sendResponse({ success: true });
  } else if (request.action === 'exportDatabase') {
    exportQuestionDatabase();
    sendResponse({ success: true });
  } else if (request.action === 'getStatus') {
    sendResponse({
      isActive,
      questionsDetected: detectedQuestions.length
    });
  }
  return true;
});

// Listen for postMessage from parent frame (for frameset pages)
window.addEventListener('message', (event) => {
  // Only accept messages from our extension
  if (event.data && event.data.source === 'wildpoptart' && event.data.action === 'fillSurvey') {
    console.log('[FRAMES] Received fillSurvey message from parent frame');
    processSurvey();
  }
});

// Start survey detection
function startSurveyDetection() {
  console.log('Starting survey detection...');
  addWildpoptartButton();
  detectQuestions();
}

// Stop survey detection
function stopSurveyDetection() {
  console.log('Stopping survey detection...');
  removeWildpoptartButton();
}

// Add floating button to page
function addWildpoptartButton() {
  // IMPORTANT: Only add button in top-level frame, not in iframes (ads, embeds, etc.)
  // This prevents duplicate buttons when "all_frames": true is enabled
  if (window.self !== window.top) {
    console.log('[BUTTON] Skipping button in iframe/child frame');
    return;
  }

  if (document.getElementById('wildpoptart-btn')) return;

  const button = document.createElement('button');
  button.id = 'wildpoptart-btn';
  button.className = 'wildpoptart-floating-btn';
  button.innerHTML = '🍰 Fill Survey';
  button.title = 'Click to auto-fill survey with AI';

  button.addEventListener('click', () => {
    // Process survey in this frame
    processSurvey();

    // ALSO forward to all child frames (for frameset pages)
    if (window.frames && window.frames.length > 0) {
      console.log(`[BUTTON] Forwarding to ${window.frames.length} child frames`);
      for (let i = 0; i < window.frames.length; i++) {
        try {
          window.frames[i].postMessage({ action: 'fillSurvey', source: 'wildpoptart' }, '*');
        } catch (e) {
          console.log(`[BUTTON] Could not forward to frame ${i}:`, e.message);
        }
      }
    }
  });

  document.body.appendChild(button);
}

// Remove floating button
function removeWildpoptartButton() {
  const button = document.getElementById('wildpoptart-btn');
  if (button) button.remove();
}

// Helper function to check if two strings have significant word overlap
function hasSignificantOverlap(str1, str2) {
  const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 3); // Only words > 3 chars
  const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  if (words1.length === 0 || words2.length === 0) return false;

  const commonWords = words1.filter(w => words2.includes(w));
  const overlapRatio = commonWords.length / Math.min(words1.length, words2.length);

  // If >50% of the shorter string's words appear in the longer string
  return overlapRatio > 0.5;
}

// Detect Quest Mindshare custom div-based questions
function detectQuestMindshareQuestions() {
  const questions = [];

  // Look for message containers with question text
  const messageContainers = document.querySelectorAll('[data-testid="message-text"]');

  messageContainers.forEach((messageEl, index) => {
    const questionText = messageEl.textContent.trim();

    // Skip if this looks like a welcome message or doesn't seem like a question
    if (questionText.length === 0 || questionText.toLowerCase().includes('welcome') || questionText.toLowerCase().includes('thank')) {
      return;
    }

    // Find the parent container
    const container = messageEl.closest('[data-testid="message-container"]');
    if (!container) return;

    // Look for option buttons in the same parent or nearby
    const parentSection = container.parentElement?.parentElement;
    if (!parentSection) return;

    // Find all option divs with data-testid="option-*"
    const options = parentSection.querySelectorAll('[data-testid^="option-"]');

    if (options.length > 0) {
      // Check if this question is already answered by looking for instructions
      const instructions = parentSection.querySelector('[data-testid="instructions"]');
      if (!instructions || instructions.textContent.trim() === '') {
        console.log(`[QUEST] Skipping already-answered question: "${questionText}"`);
        return;
      }

      console.log(`[QUEST] Found unanswered question "${questionText}" with ${options.length} options`);

      // Extract option data
      const optionData = Array.from(options).map((opt, idx) => {
        const label = opt.textContent.trim();
        console.log(`[QUEST] Option ${idx}: "${label}"`);
        return {
          label: label,
          value: label,
          index: idx,
          element: opt
        };
      });

      // Determine if this is multi-select or single-select (reuse instructions variable)
      const instructionsText = instructions ? instructions.textContent.toLowerCase() : '';
      const isMultiSelect = instructionsText.includes('select all') || instructionsText.includes('all that apply');

      console.log(`[QUEST] Question type: ${isMultiSelect ? 'MULTI-SELECT (checkbox)' : 'SINGLE-SELECT (radio)'}`);
      console.log(`[QUEST] Instructions: "${instructions ? instructions.textContent.trim() : 'none'}"`);

      // Create question data
      const questionId = `quest_question_${index}`;
      questions.push({
        question_id: questionId,
        question_text: questionText,
        question_type: isMultiSelect ? 'checkbox' : 'radio',
        required: true,
        options: optionData,
        elements: Array.from(options), // Store the option elements for clicking
        isQuestMindshare: true, // Flag to identify this custom format
        parentSection: parentSection // Store parent for confirmation button
      });
    }
  });

  return questions;
}

// Detect generic div-based survey questions (role="button")
function detectDivBasedQuestions() {
  const questions = [];

  console.log('[DIV-SURVEY] Checking for div-based survey questions...');

  // FIRST: Check for generic role="button" answer patterns (prescreeners, modern surveys)
  const genericQuestions = [];

  // Look for h1 question prompts with answer buttons
  const h1Questions = document.querySelectorAll('h1[class*="question"], h1[id*="question"], h1.question-prompt');

  h1Questions.forEach((h1, index) => {
    const questionText = h1.textContent.trim();
    if (!questionText || questionText.length === 0) return;

    console.log(`[DIV-SURVEY] Found h1 question: "${questionText.substring(0, 60)}"`);

    // Find the question container (parent that contains both question and answers)
    const questionContainer = h1.closest('[class*="question-container"], [class*="question-card"], .question, [id*="question"]') || h1.parentElement;

    // Look for answer buttons with role="button" near this question
    const answerButtons = questionContainer.querySelectorAll('[role="button"].choice-option, [role="button"][class*="answer"], [role="button"][class*="choice"]');

    if (answerButtons.length > 0) {
      console.log(`[DIV-SURVEY] Found ${answerButtons.length} role="button" answers for question`);

      // Extract answer text
      const optionData = Array.from(answerButtons).map((btn, idx) => {
        // Try multiple selectors for answer text
        const answerTextEl = btn.querySelector('.cr-ct, [class*="answer-choice"], .choice-text, .answer-text') || btn;
        const label = answerTextEl.textContent.trim();
        console.log(`[DIV-SURVEY] Option ${idx + 1}: "${label}"`);

        return {
          label: label,
          value: label,
          index: idx,
          element: btn
        };
      });

      // Determine if single or multi-select
      const isMultiSelect = questionText.toLowerCase().includes('select all') ||
                           questionText.toLowerCase().includes('all that apply') ||
                           answerButtons[0]?.querySelector('[type="checkbox"]');

      const questionId = h1.id || questionContainer.id || `div_question_${index}`;

      genericQuestions.push({
        question_id: questionId,
        question_text: questionText,
        question_type: isMultiSelect ? 'checkbox' : 'radio',
        required: true,
        options: optionData,
        elements: Array.from(answerButtons),
        isDivBased: true,
        container: questionContainer
      });
    }
  });

  if (genericQuestions.length > 0) {
    console.log(`[DIV-SURVEY] Found ${genericQuestions.length} generic div-based questions`);
    return genericQuestions;
  }

  // SECOND: Look for Quest Mindshare style containers
  const questionContainers = document.querySelectorAll('.js-question, [data-question-display-same-page]');

  questionContainers.forEach((container, index) => {
    // Find question text - might be in the same container OR in a sibling .question element
    let questionTextEl = container.querySelector('[data-testid="question-text"], .question__text');

    // If not found in container, check for sibling .question element
    if (!questionTextEl) {
      const questionWrapper = document.querySelector('.question-wrapper .question');
      if (questionWrapper) {
        questionTextEl = questionWrapper.querySelector('[data-testid="question-text"], .question__text');
      }
    }

    if (!questionTextEl) {
      console.log('[DIV-SURVEY] No question text found in container or siblings');
      return;
    }

    const questionText = questionTextEl.textContent.trim();
    if (!questionText || questionText.length === 0) {
      console.log('[DIV-SURVEY] Empty question text');
      return;
    }

    // Find answer options
    const answersContainer = container.querySelector('.answers');
    if (!answersContainer) {
      console.log('[DIV-SURVEY] No answers container found');
      return;
    }

    const answerDivs = answersContainer.querySelectorAll('[role="button"].answer, .answer[role="button"]');
    if (answerDivs.length === 0) {
      console.log('[DIV-SURVEY] No answer buttons found');
      return;
    }

    console.log(`[DIV-SURVEY] Found question: "${questionText}" with ${answerDivs.length} options`);

    // Determine question type (single-choice or multiple-choice)
    const firstAnswer = answerDivs[0];
    const isSingleChoice = firstAnswer.classList.contains('answer--single-choice');
    const isMultipleChoice = firstAnswer.classList.contains('answer--multiple-choice');

    // Also check the prompt text
    const promptEl = container.querySelector('[data-testid="question-prompt"], .question__prompt');
    const promptText = promptEl ? promptEl.textContent.toLowerCase() : '';
    const isMultiSelect = isMultipleChoice || promptText.includes('select all') || promptText.includes('all that apply');

    console.log(`[DIV-SURVEY] Question type: ${isMultiSelect ? 'MULTI-SELECT (checkbox)' : 'SINGLE-SELECT (radio)'}`);

    // Extract option data
    const optionData = Array.from(answerDivs).map((div, idx) => {
      const label = div.textContent.trim();
      const value = div.id || label;
      console.log(`[DIV-SURVEY] Option ${idx + 1}: id="${div.id}", label="${label}"`);
      return {
        label: label,
        value: value,
        index: idx,
        element: div
      };
    });

    // Create question data
    const questionId = container.id || `div_question_${index}`;
    questions.push({
      question_id: questionId,
      question_text: questionText,
      question_type: isMultiSelect ? 'checkbox' : 'radio',
      required: true,
      options: optionData,
      elements: Array.from(answerDivs),
      isDivBased: true, // Flag to identify this custom format
      container: container
    });
  });

  return questions;
}

// Detect all questions on the page
function detectQuestions() {
  detectedQuestions = [];

  console.log('[DETECTION] Starting fresh question detection...');

  // FIRST: Check for Quest Mindshare custom div-based questions
  const customQuestions = detectQuestMindshareQuestions();
  if (customQuestions.length > 0) {
    console.log(`[DETECTION] Found ${customQuestions.length} Quest Mindshare custom questions`);
    detectedQuestions.push(...customQuestions);
    return detectedQuestions;
  }

  // SECOND: Check for generic div-based survey questions (role="button")
  const divBasedQuestions = detectDivBasedQuestions();
  if (divBasedQuestions.length > 0) {
    console.log(`[DETECTION] Found ${divBasedQuestions.length} div-based custom questions`);
    detectedQuestions.push(...divBasedQuestions);
    return detectedQuestions;
  }

  // Find all form elements
  const allInputs = document.querySelectorAll('input, textarea, select');

  // Group radio and checkbox inputs by name
  const groupedInputs = new Map();
  const individualInputs = [];

  allInputs.forEach((input) => {
    const type = input.type || input.tagName.toLowerCase();

    // Skip hidden, submit, button, and image buttons (image buttons are for navigation)
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') {
      return;
    }

    // Skip captcha fields (reCAPTCHA, hCaptcha)
    if (input.id && (input.id.includes('captcha') || input.id.includes('recaptcha'))) {
      return;
    }

    // Skip Ipsos phantom test fields (the_answer_1, the_answer_2, etc.)
    // These are hidden backup fields that cause DOMExceptions when we try to fill them
    if (input.id && input.id.match(/^the_answer_\d+$/)) {
      console.log(`[DETECTION] Skipping phantom test field: ID="${input.id}"`);
      return;
    }

    // Skip visually hidden inputs - ONLY check inline styles on parent row
    // (Don't use offsetParent or getComputedStyle as CSS may hide cells while rows are visible)
    const parentRow = input.closest('tr');
    const isParentRowHidden = parentRow && parentRow.style.display === 'none';

    if (isParentRowHidden) {
      console.log(`[DETECTION] Skipping hidden input in hidden row: ID="${input.id}" name="${input.name}"`);
      return;
    }

    // Group radio and checkbox by name
    if ((type === 'radio' || type === 'checkbox') && input.name) {
      if (!groupedInputs.has(input.name)) {
        groupedInputs.set(input.name, []);
      }
      groupedInputs.get(input.name).push(input);
    } else {
      // Individual inputs (text, textarea, select, etc.)
      individualInputs.push(input);
    }
  });

  // ADDITIONAL: Group radio buttons that don't have a name but are part of the same question
  const ungroupedRadios = individualInputs.filter(inp => inp.type === 'radio');

  if (ungroupedRadios.length > 1) {
    console.log(`[GROUPING] Processing ${ungroupedRadios.length} ungrouped radio buttons`);

    // Deduplicate by ID or name (some UIs have multiple radio buttons per option)
    // NOTE: Can't use .value because all unchecked radios have value="on"
    const uniqueRadios = [];
    const seenIdentifiers = new Set();
    ungroupedRadios.forEach(radio => {
      const identifier = radio.id || radio.name || radio.value;
      if (!seenIdentifiers.has(identifier)) {
        seenIdentifiers.add(identifier);
        uniqueRadios.push(radio);
      }
    });

    if (uniqueRadios.length !== ungroupedRadios.length) {
      console.log(`[GROUPING] Deduplicated ${ungroupedRadios.length} radios to ${uniqueRadios.length} unique options by value`);
    }

    // If we have multiple unique radios, group them together
    if (uniqueRadios.length >= 2) {
      console.log(`[GROUPING] Grouping ${uniqueRadios.length} ungrouped radio buttons as one question`);
      const groupName = 'ungrouped_radios_' + (uniqueRadios[0].id || 'group');
      groupedInputs.set(groupName, uniqueRadios);

      // Remove ALL radios (including duplicates) from individualInputs
      ungroupedRadios.forEach(radio => {
        const idx = individualInputs.indexOf(radio);
        if (idx > -1) individualInputs.splice(idx, 1);
      });
    }
  }

  // ADDITIONAL: Group checkboxes that don't have a name but share an ID prefix
  // Example: ans3413.0.0, ans3413.0.1, ans3413.0.2 -> group by "ans3413.0"
  // Example: QR~QID1218157215~21, QR~QID1218157215~16 -> group by "QR~QID1218157215"
  const ungroupedCheckboxes = individualInputs.filter(inp => inp.type === 'checkbox' && inp.id);

  if (ungroupedCheckboxes.length > 1) {
    // Find checkboxes with common ID prefixes
    const prefixGroups = new Map();

    ungroupedCheckboxes.forEach(checkbox => {
      // Extract prefix (everything before last delimiter and number)
      // ans3413.0.7 -> ans3413.0
      // QR~QID1218157215~21 -> QR~QID1218157215
      // flexRadioDefault0 -> flexRadioDefault
      const match = checkbox.id.match(/^(.+)[.~](\d+)$/) ||
                   checkbox.id.match(/^(.+\.\d+)\.\d+$/) ||
                   checkbox.id.match(/^([a-zA-Z_-]+)(\d+)$/);  // NEW: Match letters followed by numbers
      if (match) {
        const prefix = match[1];
        if (!prefixGroups.has(prefix)) {
          prefixGroups.set(prefix, []);
        }
        prefixGroups.get(prefix).push(checkbox);
      }
    });

    // Add groups with 2+ checkboxes to groupedInputs
    prefixGroups.forEach((checkboxes, prefix) => {
      if (checkboxes.length >= 2) {
        console.log(`[GROUPING] Found ${checkboxes.length} checkboxes with prefix "${prefix}"`);
        groupedInputs.set(prefix, checkboxes);
        // Remove these from individualInputs
        checkboxes.forEach(cb => {
          const idx = individualInputs.indexOf(cb);
          if (idx > -1) individualInputs.splice(idx, 1);
        });
      }
    });
  }

  // ADDITIONAL: Group number inputs that share an ID prefix (matrix-style questions)
  // Example: ans1057186.0.2, ans1057186.0.4, ans1057186.0.1 -> group by "ans1057186.0"
  const ungroupedNumberInputs = individualInputs.filter(inp => inp.type === 'number' && inp.id);

  if (ungroupedNumberInputs.length > 1) {
    // Find number inputs with common ID prefixes
    const numberPrefixGroups = new Map();

    ungroupedNumberInputs.forEach(numberInput => {
      // Extract prefix (everything before last delimiter and number)
      // ans1057186.0.2 -> ans1057186.0
      const match = numberInput.id.match(/^(.+)[.~](\d+)$/) ||
                   numberInput.id.match(/^(.+\.\d+)\.\d+$/);
      if (match) {
        const prefix = match[1];
        if (!numberPrefixGroups.has(prefix)) {
          numberPrefixGroups.set(prefix, []);
        }
        numberPrefixGroups.get(prefix).push(numberInput);
      }
    });

    // Add groups with 2+ number inputs to groupedInputs
    numberPrefixGroups.forEach((numberInputs, prefix) => {
      if (numberInputs.length >= 2) {
        console.log(`[GROUPING] Found ${numberInputs.length} number inputs with prefix "${prefix}" - treating as matrix question`);
        groupedInputs.set(prefix, numberInputs);
        // Remove these from individualInputs
        numberInputs.forEach(ni => {
          const idx = individualInputs.indexOf(ni);
          if (idx > -1) individualInputs.splice(idx, 1);
        });
      }
    });
  }

  // MERGE single-checkbox groups with common prefixes
  // Find groups with only 1 checkbox that share a common prefix
  const singleCheckboxGroups = [];
  groupedInputs.forEach((inputs, name) => {
    if (inputs.length === 1 && inputs[0].type === 'checkbox') {
      singleCheckboxGroups.push({ name, inputs });
    }
  });

  if (singleCheckboxGroups.length > 1) {
    // Try to merge by common prefix
    const prefixMergeMap = new Map();

    singleCheckboxGroups.forEach(({ name, inputs }) => {
      // Extract prefix: ans94071.0.0 -> ans94071.0
      // Extract prefix: QR~QID1218157215~21 -> QR~QID1218157215
      // Extract prefix: flexRadioDefault0 -> flexRadioDefault
      const match = name.match(/^(.+)[.~](\d+)$/) ||
                   name.match(/^(.+\.\d+)\.\d+$/) ||
                   name.match(/^([a-zA-Z_-]+)(\d+)$/);  // NEW: Match letters followed by numbers
      if (match) {
        const prefix = match[1];
        if (!prefixMergeMap.has(prefix)) {
          prefixMergeMap.set(prefix, []);
        }
        prefixMergeMap.get(prefix).push({ name, inputs });
      }
    });

    // Merge groups with same prefix
    prefixMergeMap.forEach((groups, prefix) => {
      if (groups.length >= 2) {
        console.log(`[MERGE] Merging ${groups.length} single-checkbox groups with prefix "${prefix}"`);

        // Combine all inputs
        const allInputs = groups.flatMap(g => g.inputs);

        // Remove original groups
        groups.forEach(g => groupedInputs.delete(g.name));

        // Add merged group
        groupedInputs.set(prefix, allInputs);
      }
    });
  }

  // Process grouped radio/checkbox questions
  groupedInputs.forEach((inputs, name) => {
    if (inputs.length > 0) {
      const questionData = extractGroupedQuestionData(inputs, name);
      if (questionData) {
        detectedQuestions.push(questionData);
      }
    }
  });

  // SPECIAL: Detect and group radio button matrices (e.g., Likert scale grids)
  // Check if multiple radio groups share the same table and have the same options
  const radioQuestions = detectedQuestions.filter(q => q.question_type === 'radio');

  if (radioQuestions.length >= 2) {
    console.log(`[MATRIX] Checking ${radioQuestions.length} radio questions for matrix grouping...`);

    // Group radio questions by their parent table
    // Use WeakMap to group by actual table element (not ID)
    const tableElementGroups = new Map();
    const tableToId = new WeakMap();
    let tableCounter = 0;

    radioQuestions.forEach(question => {
      const firstInput = question.element || question.elements?.[0];
      if (!firstInput) return;

      const table = firstInput.closest('table, [role="grid"]');
      if (table) {
        // Get or create a stable ID for this table element
        if (!tableToId.has(table)) {
          tableToId.set(table, `table_${tableCounter++}`);
        }
        const tableId = tableToId.get(table);

        if (!tableElementGroups.has(tableId)) {
          tableElementGroups.set(tableId, []);
        }
        tableElementGroups.get(tableId).push(question);
      }
    });

    const tableGroups = tableElementGroups;

    // Check each table group for matrix patterns
    tableGroups.forEach((questions, tableId) => {
      if (questions.length < 2) return; // Need at least 2 rows for a matrix

      // Check if all questions have the same number of options
      const firstOptions = questions[0].options;
      const allSameOptions = questions.every(q =>
        q.options &&
        q.options.length === firstOptions.length
      );

      if (!allSameOptions) {
        console.log(`[MATRIX] Table has ${questions.length} radio groups but different option counts - not a matrix`);
        return;
      }

      // Extract clean option labels (remove row text prefixes)
      const cleanOptions = firstOptions.map((opt, idx) => {
        // Try to extract just the scale text (e.g., "Strongly agree" from "Mark Carney... Strongly agree")
        const label = opt.label;

        // Common pattern: "Row text Scale text" -> extract "Scale text"
        // Look for common scale keywords
        const scaleKeywords = ['strongly', 'somewhat', 'neither', 'agree', 'disagree', 'likely', 'important', 'satisfied', 'approve', 'disapprove'];
        const words = label.toLowerCase().split(' ');

        let scaleText = label;
        for (let i = 0; i < words.length; i++) {
          if (scaleKeywords.some(keyword => words[i].includes(keyword))) {
            // Found scale keyword, extract from here to end
            scaleText = label.split(' ').slice(i).join(' ');
            break;
          }
        }

        return {
          label: scaleText.trim(),
          value: opt.value || scaleText.trim()
        };
      });

      console.log(`[MATRIX] Found matrix with ${questions.length} rows and ${cleanOptions.length} columns`);
      console.log(`[MATRIX] Options:`, cleanOptions.map(o => o.label));

      // Extract row labels (sub-questions) - remove the option text
      const rows = questions.map(q => {
        const rowText = q.question_text;
        // Remove scale text from row labels if present
        let cleanRowText = rowText;
        cleanOptions.forEach(opt => {
          if (rowText.endsWith(opt.label)) {
            cleanRowText = rowText.substring(0, rowText.length - opt.label.length).trim();
          }
        });
        return {
          label: cleanRowText,
          question_id: q.question_id,
          elements: q.elements
        };
      });

      // Find the main question text (look outside the table)
      const table = questions[0].element.closest('table, [role="grid"]');
      let mainQuestionText = 'Matrix question';

      if (table) {
        // Look for heading before the table
        let sibling = table.previousElementSibling;
        for (let i = 0; i < 5 && sibling; i++) {
          const text = sibling.textContent.trim();
          if (text.includes('?') && text.length < 500 && text.length > 10) {
            mainQuestionText = text;
            console.log(`[MATRIX] Found main question: "${mainQuestionText.substring(0, 80)}"`);
            break;
          }
          sibling = sibling.previousElementSibling;
        }

        // Also check table caption or thead
        if (mainQuestionText === 'Matrix question') {
          const caption = table.querySelector('caption');
          const legend = table.closest('fieldset')?.querySelector('legend');
          if (caption && caption.textContent.trim()) {
            mainQuestionText = caption.textContent.trim();
          } else if (legend && legend.textContent.trim()) {
            mainQuestionText = legend.textContent.trim();
          }
        }
      }

      // Create matrix question
      const matrixQuestion = {
        question_id: `matrix_${questions[0].question_id}`,
        question_text: mainQuestionText,
        question_type: 'matrix',
        isMatrix: true,
        rows: rows,
        columns: cleanOptions,
        required: questions.some(q => q.required),
        elements: questions.flatMap(q => q.elements || [])
      };

      // Remove individual row questions from detectedQuestions
      questions.forEach(q => {
        const index = detectedQuestions.indexOf(q);
        if (index > -1) {
          detectedQuestions.splice(index, 1);
        }
      });

      // Add matrix question
      detectedQuestions.push(matrixQuestion);
      console.log(`[MATRIX] Created matrix question with ${rows.length} rows x ${cleanOptions.length} columns`);
    });
  }

  // SPECIAL: Group multi-part postal/zip code fields (e.g., part16b, part26c with maxlength="3")
  const postalCodeFields = individualInputs.filter(input => {
    const type = input.type || input.tagName.toLowerCase();
    if (type !== 'text' || input.maxLength !== 3) return false;

    // Check if field ID/name suggests it's part of a postal code
    const inputId = (input.id || '').toLowerCase();
    const inputName = (input.name || '').toLowerCase();
    const isPartField = inputId.includes('part') || inputName.includes('part');
    const isPostalField = inputId.includes('postal') || inputName.includes('postal') ||
                         inputId.includes('zip') || inputName.includes('zip');

    // Also check parent containers for postal/zip keywords
    let hasPostalParent = false;
    let container = input.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!container) break;
      const containerText = (container.id || '').toLowerCase() + (container.className || '').toLowerCase();
      if (containerText.includes('postal') || containerText.includes('zip')) {
        hasPostalParent = true;
        break;
      }
      container = container.parentElement;
    }

    return isPartField || isPostalField || hasPostalParent;
  });

  if (postalCodeFields.length >= 2) {
    console.log(`[GROUPING] Found ${postalCodeFields.length} postal code fields, checking if they should be grouped...`);

    // Check if they share a common question container
    const postalGroups = new Map();

    postalCodeFields.forEach(field => {
      // Find the parent question container (go up multiple levels)
      let container = field;
      for (let i = 0; i < 6; i++) {
        container = container.parentElement;
        if (!container) break;

        // Look for postal/zip keywords in container
        const containerText = container.textContent.toLowerCase();
        if ((containerText.includes('postal') || containerText.includes('zip')) &&
            containerText.includes('code')) {
          // Found a postal code container
          const containerId = container.id || `postal_container_${Date.now()}`;
          if (!postalGroups.has(containerId)) {
            postalGroups.set(containerId, []);
          }
          postalGroups.get(containerId).push(field);
          break;
        }
      }
    });

    // Group postal code fields that share a container
    postalGroups.forEach((fields, containerId) => {
      if (fields.length >= 2) {
        console.log(`[GROUPING] Grouping ${fields.length} postal code fields together`);

        // Find the shared question text
        const firstField = fields[0];
        let questionText = findQuestionText(firstField);

        // If question text is generic, look harder for postal code question
        if (questionText.includes('Question') || questionText.includes('Please answer')) {
          let container = firstField;
          for (let i = 0; i < 8; i++) {
            container = container.parentElement;
            if (!container) break;

            const containerText = container.textContent;
            const lines = containerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            for (const line of lines) {
              if ((line.toLowerCase().includes('postal') || line.toLowerCase().includes('zip')) &&
                  line.includes('?') && line.length < 200) {
                questionText = line;
                console.log(`[GROUPING] Found postal code question: "${questionText}"`);
                break;
              }
            }
            if (!questionText.includes('Question')) break;
          }
        }

        // Create a grouped question for the postal code fields
        const groupName = `postal_code_group_${containerId}`;
        const groupedQuestion = {
          question_id: groupName,
          element: firstField,
          elements: fields,
          question_text: questionText,
          question_type: 'text',
          required: fields.some(f => f.required),
          options: [],
          isPostalCodeGroup: true, // Flag for special handling
          postalCodeFields: fields.map(f => ({
            id: f.id,
            maxLength: f.maxLength,
            element: f
          }))
        };

        detectedQuestions.push(groupedQuestion);

        // Remove these fields from individualInputs
        fields.forEach(field => {
          const idx = individualInputs.indexOf(field);
          if (idx > -1) individualInputs.splice(idx, 1);
        });
      }
    });
  }

  // SPECIAL: Group multi-part date fields (Month/Day/Year dropdowns)
  const selectElements = individualInputs.filter(input => {
    const tagName = input.tagName.toLowerCase();
    return tagName === 'select';
  });

  if (selectElements.length >= 2) {
    console.log(`[GROUPING] Found ${selectElements.length} select dropdowns, checking for multi-part date questions...`);

    // Group select elements by their common parent container
    const containerGroups = new Map();

    selectElements.forEach(select => {
      // Find nearest common container (row, div with class="row", form-group, etc.)
      const container = select.closest('.row, .form-row, .form-group, [class*="date"], [class*="birth"]');
      if (container) {
        const containerId = container.id || container.className || 'container';
        if (!containerGroups.has(containerId)) {
          containerGroups.set(containerId, []);
        }
        containerGroups.get(containerId).push(select);
      }
    });

    // Check each group for date questions
    containerGroups.forEach((selects, containerId) => {
      if (selects.length >= 2 && selects.length <= 3) {
        // Look for date-related question text in nearby labels or parent elements
        let questionText = '';

        // Try finding label
        const firstSelect = selects[0];
        const labelFor = firstSelect.getAttribute('id');
        if (labelFor) {
          const label = document.querySelector(`label[for="${labelFor}"]`);
          if (label) {
            questionText = label.textContent.trim();
          }
        }

        // Try finding question text from container
        if (!questionText) {
          const container = firstSelect.closest('.row, .form-row, .form-group, [class*="date"], [class*="birth"]');
          if (container) {
            const parentLabel = container.previousElementSibling;
            if (parentLabel && (parentLabel.tagName === 'LABEL' || parentLabel.classList.contains('form-label'))) {
              questionText = parentLabel.textContent.trim();
            }
          }
        }

        // Check if this looks like a date question
        const lowerText = questionText.toLowerCase();
        const isDateQuestion = lowerText.includes('birth') ||
                              lowerText.includes('date of birth') ||
                              lowerText.includes('dob') ||
                              lowerText.includes('when were you born') ||
                              (lowerText.includes('date') && (lowerText.includes('your') || lowerText.includes('what')));

        if (isDateQuestion) {
          console.log(`[GROUPING] Found multi-part date question: "${questionText}" with ${selects.length} dropdowns`);

          // Create a grouped date question
          const groupName = `date_group_${containerId}_${Date.now()}`;
          const groupedDateQuestion = {
            question_id: groupName,
            element: selects[0],
            elements: selects,
            question_text: questionText,
            question_type: 'date',
            required: selects.some(s => s.required),
            options: [],
            isDateGroup: true, // Flag for special handling
            dateFields: selects.map((s, idx) => {
              // Determine field type by options
              const firstOption = s.options[1]; // Skip default "Month"/"Day"/"Year" option
              const optionText = firstOption ? firstOption.textContent.toLowerCase() : '';

              let fieldType = 'unknown';
              if (optionText.includes('january') || optionText.includes('february') || s.options.length <= 13) {
                fieldType = 'month';
              } else if (s.options.length <= 32) {
                fieldType = 'day';
              } else if (s.options.length > 32) {
                fieldType = 'year';
              }

              return {
                element: s,
                type: fieldType,
                index: idx
              };
            })
          };

          detectedQuestions.push(groupedDateQuestion);

          // Remove these selects from individualInputs
          selects.forEach(select => {
            const idx = individualInputs.indexOf(select);
            if (idx > -1) individualInputs.splice(idx, 1);
          });
        }
      }
    });
  }

  // Process individual inputs
  individualInputs.forEach((input) => {
    const questionData = extractQuestionData(input);
    if (questionData) {
      // Only add if not already added by ID
      if (!detectedQuestions.find(q => q.question_id === questionData.question_id)) {
        detectedQuestions.push(questionData);
      }
    }
  });

  // DEDUPLICATION: Remove duplicate questions based on question text similarity
  // This handles cases where the same question is detected multiple times with different IDs
  // (common in Ipsos surveys where framework creates multiple radio groups for same question)
  const uniqueQuestions = [];
  const seenQuestionTexts = new Set();

  detectedQuestions.forEach((q) => {
    // Normalize question text for comparison (lowercase, remove extra whitespace, punctuation)
    const normalizedText = q.question_text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')         // Normalize whitespace
      .trim();

    // Check if we've seen a very similar question
    let isDuplicate = false;
    for (const seenText of seenQuestionTexts) {
      // If texts are identical or one contains the other (and they're similar length)
      const lengthRatio = Math.min(normalizedText.length, seenText.length) / Math.max(normalizedText.length, seenText.length);
      if ((normalizedText === seenText || normalizedText.includes(seenText) || seenText.includes(normalizedText)) && lengthRatio > 0.7) {
        console.log(`[DEDUP] Skipping duplicate question: "${q.question_text.substring(0, 50)}" (similar to existing question)`);
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      uniqueQuestions.push(q);
      seenQuestionTexts.add(normalizedText);
    }
  });

  // Replace detectedQuestions with deduplicated list
  detectedQuestions = uniqueQuestions;

  console.log(`[DETECTION] Detected ${detectedQuestions.length} questions (after deduplication):`);

  // Log each question for debugging
  let debugInfo = `Detected ${detectedQuestions.length} questions:\n`;
  detectedQuestions.forEach((q, idx) => {
    const logLine = `  ${idx + 1}. [${q.question_type}] ID:"${q.question_id}" TEXT:"${q.question_text.substring(0, 50)}..." (${q.options?.length || 0} options)`;
    console.log(logLine);
    debugInfo += `${idx + 1}. ID:${q.question_id} - ${q.question_text.substring(0, 60)}\n`;

    // Check if input already has a value (leftover from previous fill)
    if (q.element && q.element.value) {
      console.warn(`  ⚠️ Question ${q.question_id} input already has value: "${q.element.value}"`);
    }
  });

  // Don't show debug notification here - too early and gets replaced

  return detectedQuestions;
}

// Extract grouped question data (for radio/checkbox/number matrix groups)
function extractGroupedQuestionData(inputs, name) {
  if (!inputs || inputs.length === 0) return null;

  const firstInput = inputs[0];
  const type = firstInput.type;

  // Skip radio/checkbox groups that already have a checked option (already answered)
  // EXCEPTION: Don't skip radio groups in tables - they might be part of a matrix
  if (type === 'radio' || type === 'checkbox') {
    const hasChecked = inputs.some(input => input.checked);
    if (hasChecked) {
      // Check if this radio group is inside a table (potential matrix)
      const isInTable = firstInput.closest('table, [role="grid"]');

      if (!isInTable || type === 'checkbox') {
        // Skip standalone already-answered questions, but NOT radio groups in tables
        console.log(`[DETECTION] Skipping already-answered ${type} group: name="${name}"`);
        return null;
      } else {
        console.log(`[DETECTION] Including already-answered radio group in table for matrix detection: name="${name}"`);
      }
    }
  }

  // For grouped inputs, find question text from the container, not individual inputs
  const questionText = findQuestionTextForGroup(inputs);

  const isRequired = inputs.some(input =>
    input.required || input.hasAttribute('required') || input.hasAttribute('aria-required')
  );

  // For number input matrices, extract row labels as sub-questions
  // For radio/checkbox groups, extract options
  const isNumberMatrix = type === 'number';
  const options = inputs.map(input => {
    // For options, get the label text specifically for this input
    const optionLabel = getOptionLabel(input);
    console.log(`[EXTRACT_OPTION] For input ID="${input.id}", extracted label: "${optionLabel}"`);
    return {
      label: optionLabel,
      value: input.value || optionLabel,
      id: input.id
    };
  });

  // Use name as question_id, but make sure it's a string
  const questionId = String(name);

  // Detect constraints from the question container (instructions, errors, etc.)
  const questionData = {
    question_id: questionId,
    element: firstInput, // Reference to first element (for name attribute)
    elements: inputs, // All elements in the group
    question_text: questionText,
    question_type: isNumberMatrix ? 'number_matrix' : type, // 'number_matrix', 'radio' or 'checkbox'
    required: isRequired,
    options: options, // For number matrices, these are row labels; for radio/checkbox, these are selectable options
    isNumberMatrix: isNumberMatrix // Flag to identify matrix questions
  };

  // Find the question container to look for constraints
  const container = firstInput.closest('.question, [role="radiogroup"], [role="group"], [class*="question"], .mx-stage');
  if (container) {
    // Look for instruction text
    const instructionEl = container.querySelector('.instruction-text, .comment, [class*="instruction"], [class*="comment"]');
    const instructionText = instructionEl ? instructionEl.textContent : '';

    // Look for error text (often contains constraint info)
    const errorEl = container.querySelector('.question-error-text, .question-error, .error-text, [class*="error"]');
    const errorText = errorEl ? errorEl.textContent : '';

    const combinedText = (instructionText + ' ' + errorText).toLowerCase();

    console.log(`[CONSTRAINT_DETECT] Checking constraints for "${questionText.substring(0, 50)}"`);
    console.log(`[CONSTRAINT_DETECT] Instruction: "${instructionText.substring(0, 100)}"`);
    console.log(`[CONSTRAINT_DETECT] Error: "${errorText.substring(0, 100)}"`);

    // Parse "at most N", "top N", "maximum N", "select N"
    const maxMatch = combinedText.match(/(?:at most|top|maximum of?|select)\s+(\d+)/i);
    if (maxMatch) {
      questionData.maxAllowed = parseInt(maxMatch[1]);
      console.log(`[CONSTRAINT_DETECT] ✓ Found maxAllowed: ${questionData.maxAllowed}`);
    }

    // Parse "at least N", "minimum N"
    const minMatch = combinedText.match(/(?:at least|minimum of?)\s+(\d+)/i);
    if (minMatch) {
      questionData.minRequired = parseInt(minMatch[1]);
      console.log(`[CONSTRAINT_DETECT] ✓ Found minRequired: ${questionData.minRequired}`);
    }

    // Detect ranking questions
    if (/rank|ranking|strongest|weakest|most.*least|order.*preference/i.test(combinedText)) {
      questionData.isRanking = true;
      console.log(`[CONSTRAINT_DETECT] ✓ Detected ranking question`);
    }

    // For ranking questions, if we found maxAllowed, that's also the ranking depth
    if (questionData.isRanking && questionData.maxAllowed) {
      console.log(`[CONSTRAINT_DETECT] ✓ Ranking depth: ${questionData.maxAllowed}`);
    }
  }

  return questionData;
}

// Find question text for a group of radio/checkbox inputs
function findQuestionTextForGroup(inputs) {
  if (!inputs || inputs.length === 0) return 'Question';

  console.log(`[FIND_GROUP_TEXT] Looking for question text for ${inputs.length} inputs`);

  // Find common parent container
  let commonParent = inputs[0].parentElement;

  // Go up more levels to find the full question container (increased from 3 to 6)
  for (let i = 0; i < 6; i++) {
    if (!commonParent) break;

    // Look for legend (fieldset label)
    const legend = commonParent.querySelector('legend');
    if (legend) {
      const text = legend.textContent.trim();
      if (text.length > 0 && text.length < 500) {
        console.log(`[FIND_GROUP_TEXT] Found via legend: "${text.substring(0, 80)}"`);
        return text;
      }
    }

    // FIRST: Look for specific question text elements (higher priority)
    // These are more likely to be the actual question than generic divs/labels
    const specificQuestionSelectors = [
      '.zappi-header-text',
      '.question-description-container .zappi-header-text',
      '[class*="question-text"]',
      '[class*="question-label"]',  // Consent/profiler questions
      '[class*="question-description"]',  // Consent/profiler descriptions
      '[id^="question_text_"]',
      'h1.question-text',
      '.survey-question-text',
      '[role="radiogroup"] > [class*="header"]',
      '[role="group"] > [class*="header"]'
    ];

    for (const selector of specificQuestionSelectors) {
      const questionElement = commonParent.querySelector(selector);
      if (questionElement) {
        // Make sure this element doesn't contain any of our inputs (it's not an option label)
        const containsInput = inputs.some(inp => questionElement.contains(inp));
        // Also make sure it's not a label FOR one of our inputs
        const isLabelFor = inputs.some(inp => questionElement.getAttribute('for') === inp.id);

        if (!containsInput && !isLabelFor) {
          const text = questionElement.textContent.trim();
          const lowerText = text.toLowerCase();

          // Always accept consent/privacy/data collection questions regardless of length/keywords
          const isConsentQuestion = lowerText.includes('consent') ||
                                   lowerText.includes('privacy') ||
                                   lowerText.includes('data') ||
                                   lowerText.includes('allow') ||
                                   lowerText.includes('agree') ||
                                   lowerText.includes('profile') ||
                                   lowerText.includes('collection');

          if (text.length > 10 && text.length < 500 && (isConsentQuestion || text.includes('?'))) {
            console.log(`[FIND_GROUP_TEXT] Found via specific selector "${selector}": "${text.substring(0, 80)}"`);
            return text;
          }
        }
      }
    }

    // SECOND: Look for any heading or label before the inputs (fallback)
    const headings = commonParent.querySelectorAll('h1, h2, h3, h4, h5, h6, .question, [class*="question"], p');
    for (const heading of headings) {
      // Make sure this heading is not a label FOR a specific radio/checkbox (those are option labels)
      // Also check if it's a sibling of any input (likely an option label)
      const isOptionLabel = inputs.some(input =>
        heading.getAttribute('for') === input.id ||
        heading.contains(input) ||
        (heading.parentElement && heading.parentElement.contains(input) && heading.nextElementSibling === input)
      );

      if (!isOptionLabel) {
        const text = heading.textContent.trim();
        // Look for text that contains question-like content or "select" instructions
        if (text.length > 10 && text.length < 500 &&
            !text.toLowerCase().includes('male') &&
            !text.toLowerCase().includes('female')) {
          // Check if it looks like a question or instruction
          const lowerText = text.toLowerCase();
          if (text.includes('?') ||
              lowerText.includes('select') ||
              lowerText.includes('choose') ||
              lowerText.includes('check') ||
              lowerText.includes('which of') ||
              lowerText.includes('have you') ||
              lowerText.includes('best describes')) {
            console.log(`[FIND_GROUP_TEXT] Found via heading: "${text.substring(0, 80)}"`);
            return text;
          }
        }
      }
    }

    commonParent = commonParent.parentElement;
  }

  // CHECK FOR GRID/MATRIX QUESTIONS: Look for row or column headers in table
  const firstInput = inputs[0];
  console.log(`[FIND_GROUP_TEXT] Checking matrix - first input:`, firstInput.id || firstInput.name, `inputs count: ${inputs.length}`);

  const tableCell = firstInput.closest('td');
  console.log(`[FIND_GROUP_TEXT] Table cell found:`, !!tableCell);

  if (tableCell) {
    const table = tableCell.closest('table');
    console.log(`[FIND_GROUP_TEXT] Table found:`, !!table);

    if (table) {
      // Determine if this is a ROW-based matrix or COLUMN-based matrix
      // Check input ID or name pattern: ans[groupID].[column].[row] (3 parts)
      // IMPORTANT: Use ID first (more reliable for matrix questions), fall back to name
      const inputIdentifier = firstInput.id || firstInput.name || '';
      const nameParts = inputIdentifier.match(/^[a-z]+(\d+)\.(\d+)\.(\d+)$/);

      console.log(`[FIND_GROUP_TEXT] Matrix check - identifier: "${inputIdentifier}", nameParts:`, nameParts);

      if (nameParts && nameParts.length === 4) {
        // Parse all input IDs/names to determine if row-based or column-based
        const columnIndices = new Set();
        const rowIndices = new Set();

        inputs.forEach(inp => {
          const identifier = inp.id || inp.name || '';
          const parts = identifier.match(/^[a-z]+(\d+)\.(\d+)\.(\d+)$/);
          if (parts && parts.length === 4) {
            columnIndices.add(parts[2]);  // Column index
            rowIndices.add(parts[3]);     // Row index
          }
        });

        console.log(`[FIND_GROUP_TEXT] Matrix analysis - columns: ${columnIndices.size} (${[...columnIndices]}), rows: ${rowIndices.size} (${[...rowIndices]})`);

        const isRowBased = rowIndices.size === 1 && columnIndices.size > 1;  // Same row, different columns
        const isColumnBased = columnIndices.size === 1 && rowIndices.size > 1;  // Same column, different rows

        console.log(`[FIND_GROUP_TEXT] isRowBased: ${isRowBased}, isColumnBased: ${isColumnBased}`);

        if (isColumnBased) {
          // COLUMN-BASED MATRIX (e.g., Most/Least likely)
          // All inputs have same column index, different row indices
          // We need the COLUMN header (e.g., "Most likely" or "Least likely")
          const columnIndex = parseInt(nameParts[2]);
          console.log(`[FIND_GROUP_TEXT] Detected column-based matrix, looking for column ${columnIndex} header`);

          // Find header row
          const headerRow = table.querySelector('tr.row-col-legends, tr:has(th[scope="col"])');
          if (headerRow) {
            const headers = Array.from(headerRow.querySelectorAll('th'));
            console.log(`[FIND_GROUP_TEXT] Found ${headers.length} column headers`);

            // Try to match column index to header position
            // Headers might include row labels, so we need to find the right offset
            // Try multiple strategies to find the correct header

            // Strategy 1: Direct index match (works if no row label column)
            if (headers[columnIndex]) {
              const headerText = headers[columnIndex].textContent.trim();
              if (headerText && headerText.length > 0 && headerText.length < 200 && !headerText.match(/^(option|item|row)/i)) {
                console.log(`[FIND_GROUP_TEXT] Found via direct column index ${columnIndex}: "${headerText.substring(0, 80)}"`);
                return headerText;
              }
            }

            // Strategy 2: Skip first header if it looks like a row label (e.g., "Options", "Items")
            const offset = headers[0] && headers[0].textContent.trim().match(/^(option|item|row|statement)/i) ? 1 : 0;
            const adjustedIndex = columnIndex + offset;
            if (headers[adjustedIndex]) {
              const headerText = headers[adjustedIndex].textContent.trim();
              if (headerText && headerText.length > 0 && headerText.length < 200) {
                console.log(`[FIND_GROUP_TEXT] Found via adjusted column index ${adjustedIndex} (offset: ${offset}): "${headerText.substring(0, 80)}"`);
                return headerText;
              }
            }

            // Strategy 3: Find headers with scope="col" and match by position
            const columnHeaders = Array.from(headerRow.querySelectorAll('th[scope="col"]'));
            if (columnHeaders[columnIndex]) {
              const headerText = columnHeaders[columnIndex].textContent.trim();
              if (headerText && headerText.length > 0 && headerText.length < 200) {
                console.log(`[FIND_GROUP_TEXT] Found via scope=col headers at index ${columnIndex}: "${headerText.substring(0, 80)}"`);
                return headerText;
              }
            }
          }
        } else if (isRowBased) {
          // ROW-BASED MATRIX (e.g., importance ratings)
          // All inputs have same row index, different column indices
          // We need the ROW header (the statement text)
          const rowIndex = parseInt(nameParts[3]);
          console.log(`[FIND_GROUP_TEXT] Detected row-based matrix, looking for row ${rowIndex} header`);

          // Find all rows in the table
          const allRows = Array.from(table.querySelectorAll('tr'));

          // Look for the row header (th with scope="row") at the matching row
          for (const tr of allRows) {
            const rowHeader = tr.querySelector('th[scope="row"]');
            if (rowHeader) {
              // Check if this row contains our input by looking for the row index in any input ID/name
              const rowInputs = Array.from(tr.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
              if (rowInputs.length > 0) {
                const firstRowInput = rowInputs[0];
                const rowInputIdentifier = firstRowInput.id || firstRowInput.name || '';
                const rowInputParts = rowInputIdentifier.match(/^[a-z]+(\d+)\.(\d+)\.(\d+)$/);
                if (rowInputParts && parseInt(rowInputParts[3]) === rowIndex) {
                  const headerText = rowHeader.textContent.trim();
                  if (headerText && headerText.length > 0 && headerText.length < 500) {
                    console.log(`[FIND_GROUP_TEXT] Found via table ROW header: "${headerText.substring(0, 80)}"`);

                    // Check if this looks like a row label (not a full question)
                    const looksLikeLabel = !headerText.includes('?') && headerText.length < 100;

                    if (looksLikeLabel) {
                      // Try to find the actual question heading outside the table
                      console.log(`[FIND_GROUP_TEXT] Row header looks like a label, searching for question heading outside table`);
                      const tableContainer = table.closest('.question, [class*="question"], .survey-section, .page-content, .mx-stage');
                      if (tableContainer) {
                        const questionElements = tableContainer.querySelectorAll('h1, h2, h3, h4, h5, legend, .question-text, [class*="question-text"], [id*="question_text"], [class*="question-heading"]');
                        for (const el of questionElements) {
                          // Make sure this element is NOT inside the table
                          if (!table.contains(el)) {
                            const text = el.textContent.trim();
                            // Good question headings usually have "?" or are reasonably long
                            if (text.length > 20 && text.length < 500) {
                              console.log(`[FIND_GROUP_TEXT] ✓ Found question heading outside table: "${text.substring(0, 80)}"`);
                              return text;
                            }
                          }
                        }
                      }
                      console.log(`[FIND_GROUP_TEXT] No question heading found outside table, using row header`);
                    }

                    return headerText;
                  }
                }
              }
            }
          }
        }
      } else {
        // COLUMN-BASED MATRIX (items in columns, like stores) - legacy format without 3-part names
        // Use the existing column header detection
        const row = tableCell.parentElement;
        const cells = Array.from(row.children);
        const columnIndex = cells.indexOf(tableCell);

        const headerRow = table.querySelector('tr.row-col-legends, tr:has(th[scope="col"])');
        if (headerRow) {
          const headers = Array.from(headerRow.querySelectorAll('th'));
          if (headers[columnIndex]) {
            const headerText = headers[columnIndex].textContent.trim();
            if (headerText && headerText.length > 0 && headerText.length < 200) {
              console.log(`[FIND_GROUP_TEXT] Found via table COLUMN header: "${headerText.substring(0, 80)}"`);

              // Check if this looks like a column label (brand name, not a full question)
              const looksLikeLabel = !headerText.includes('?') && headerText.length < 100;

              if (looksLikeLabel) {
                // Try to find the actual question heading outside the table
                console.log(`[FIND_GROUP_TEXT] Column header looks like a label, searching for question heading outside table`);
                const tableContainer = table.closest('.question, [class*="question"], .survey-section, .page-content, .mx-stage');
                if (tableContainer) {
                  const questionElements = tableContainer.querySelectorAll('h1, h2, h3, h4, h5, legend, .question-text, [class*="question-text"], [id*="question_text"], [class*="question-heading"]');
                  for (const el of questionElements) {
                    // Make sure this element is NOT inside the table
                    if (!table.contains(el)) {
                      const text = el.textContent.trim();
                      // Good question headings usually have "?" or are reasonably long
                      if (text.length > 20 && text.length < 500) {
                        console.log(`[FIND_GROUP_TEXT] ✓ Found question heading outside table: "${text.substring(0, 80)}"`);
                        return text;
                      }
                    }
                  }
                }
                console.log(`[FIND_GROUP_TEXT] No question heading found outside table, using column header`);
              }

              return headerText;
            }
          }
        }
      }
    }
  }

  // Fallback: use the generic findQuestionText on first input
  console.log(`[FIND_GROUP_TEXT] Using fallback`);
  const inputLabel = findQuestionText(firstInput);

  // For number inputs or if the label looks like a row label (not a question),
  // try to find the actual question heading outside the table
  const isNumberInput = firstInput.type === 'number';
  const looksLikeRowLabel = inputLabel && !inputLabel.includes('?') && inputLabel.length < 150;

  if ((isNumberInput || looksLikeRowLabel) && tableCell) {
    console.log(`[FIND_GROUP_TEXT] Number matrix detected - searching for question heading outside table`);
    const table = tableCell.closest('table');
    if (table) {
      const tableContainer = table.closest('.question, [class*="question"], .survey-section, .page-content');
      if (tableContainer) {
        const questionElements = tableContainer.querySelectorAll('h1, h2, h3, h4, h5, legend, .question-text, [class*="question-text"], [id*="question_text"]');
        for (const el of questionElements) {
          // Make sure this element is NOT inside the table (we want the heading above/outside the table)
          if (!table.contains(el)) {
            const text = el.textContent.trim();
            // Good question headings usually have "?" or are reasonably long
            if (text.length > 10 && text.length < 500) {
              console.log(`[FIND_GROUP_TEXT] ✓ Found question heading outside table: "${text.substring(0, 80)}"`);
              return text;
            }
          }
        }
      }
    }
  }

  // Also check for bilingual option labels
  if (inputLabel && inputLabel.includes(' / ')) {
    // This looks like a bilingual option label (e.g., "English / Anglais")
    console.log(`[FIND_GROUP_TEXT] Input label looks like bilingual option ("${inputLabel}"), using generic text`);
    return 'Please select an option';
  }

  console.log(`[FIND_GROUP_TEXT] Returning fallback input label: "${inputLabel?.substring(0, 50)}"`);
  return inputLabel;
}

// Get the label text specifically for a single radio/checkbox option
function getOptionLabel(input) {
  // FIRST: Try aria-label or aria-labelledby (most reliable, modern accessibility standard)
  if (input.hasAttribute('aria-label')) {
    const text = input.getAttribute('aria-label').trim();
    if (text.length > 0) return text;
  }

  // Try aria-labelledby - handles paired comparisons and standard labels
  if (input.hasAttribute('aria-labelledby')) {
    const labelIds = input.getAttribute('aria-labelledby').trim().split(/\s+/);

    // Check if this is a paired comparison question (has _left and _right IDs)
    const leftId = labelIds.find(id => id.includes('_left'));
    const rightId = labelIds.find(id => id.includes('_right'));

    if (leftId && rightId) {
      // Paired comparison: determine which statement this radio represents
      // Usually value="0" is left, value="1" is right
      const isLeftOption = input.value === "0" || input.id.includes('.0.');
      const targetId = isLeftOption ? leftId : rightId;

      const labelEl = document.getElementById(targetId);
      if (labelEl) {
        const text = labelEl.textContent.trim();
        console.log(`[PAIRED_COMPARISON] Extracted ${isLeftOption ? 'LEFT' : 'RIGHT'} statement: "${text.substring(0, 50)}"`);
        if (text.length > 0) return text;
      }
    } else {
      // Standard aria-labelledby: try all IDs and concatenate
      const texts = labelIds.map(id => {
        const el = document.getElementById(id);
        return el ? el.textContent.trim() : '';
      }).filter(t => t.length > 0);

      if (texts.length > 0) {
        const combinedText = texts.join(' ');
        if (combinedText.length > 0) return combinedText;
      }
    }
  }

  // Try label with for attribute
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) {
      let text = label.textContent.trim();

      // Clean up image URL tags (e.g., {@imageURL::https://...@})
      text = text.replace(/\{@imageURL::[^@}]+@\}/g, '').trim();

      // Clean up other survey tags (e.g., {@globalExclusive::true@})
      text = text.replace(/\{@[^@}]+::[^@}]+@\}/g, '').trim();

      // If label has format "Short: Long description", extract just the short part
      if (text.includes(':') && text.indexOf(':') < text.length * 0.3) {
        text = text.split(':')[0].trim() + ':';
      }
      if (text.length > 0) return text;
    }
  }

  // Try parent label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll('input, textarea, select');
    inputs.forEach(inp => inp.remove());
    let text = clone.textContent.trim();

    text = text.replace(/\{@imageURL::[^@}]+@\}/g, '').trim();
    text = text.replace(/\{@[^@}]+::[^@}]+@\}/g, '').trim();

    if (text.includes(':') && text.indexOf(':') < text.length * 0.3) {
      text = text.split(':')[0].trim() + ':';
    }
    if (text.length > 0) return text;
  }

  // Try next sibling (Qualtrics pattern: input followed by label text)
  // BUT: Skip SVG elements that just say "radio" or "checkbox"
  let nextSibling = input.nextElementSibling;
  while (nextSibling) {
    // Skip SVG/icon elements
    if (nextSibling.tagName === 'svg' || nextSibling.tagName === 'SVG' ||
        nextSibling.classList.contains('fir-icon') ||
        nextSibling.classList.contains('icon')) {
      nextSibling = nextSibling.nextElementSibling;
      continue;
    }

    const text = nextSibling.textContent.trim();
    if (text.length > 0 && text.length < 200 && text !== 'radio' && text !== 'checkbox') {
      return text;
    }
    nextSibling = nextSibling.nextElementSibling;
    if (!nextSibling || nextSibling.tagName === 'INPUT') break;
  }

  // Try parent's next sibling (another Qualtrics pattern)
  const parent = input.parentElement;
  if (parent) {
    let parentNext = parent.nextElementSibling;
    while (parentNext) {
      const text = parentNext.textContent.trim();
      if (text.length > 0 && text.length < 200 && !text.includes('?')) {
        return text;
      }
      parentNext = parentNext.nextElementSibling;
      if (!parentNext) break;
    }
  }

  // Try nearby text in parent container (Qualtrics fieldset pattern)
  const container = input.closest('li, div, td');
  if (container) {
    const clone = container.cloneNode(true);
    const inputs = clone.querySelectorAll('input, textarea, select, button, svg');
    inputs.forEach(inp => inp.remove());
    let text = clone.textContent.trim();

    text = text.replace(/\{@imageURL::[^@}]+@\}/g, '').trim();
    text = text.replace(/\{@[^@}]+::[^@}]+@\}/g, '').trim();

    if (text.length > 0 && text.length < 200) {
      return text;
    }
  }

  console.warn(`[getOptionLabel] Could not find label for input ID="${input.id}"`);
  return input.value || input.id || 'Option';
}

// Extract question data from an input element
function extractQuestionData(element) {
  const type = element.type || element.tagName.toLowerCase();

  // Skip hidden, submit, button, and image buttons (image buttons are for navigation)
  if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') {
    return null;
  }

  const questionText = findQuestionText(element);

  // Skip "Prefer not to answer" checkboxes - they're optional fields, not actual questions
  const lowerText = questionText.toLowerCase();
  const elementId = (element.id || '').toLowerCase();
  const elementName = (element.name || '').toLowerCase();

  if (type === 'checkbox' &&
      (lowerText.includes('prefer not to') ||
       elementId.includes('prefernotto') ||
       elementName.includes('prefernotto'))) {
    console.log(`[SKIP] Skipping "Prefer not to answer" checkbox: "${questionText}"`);
    return null;
  }

  // Skip "Other (please specify)" type fields - they're conditional and shouldn't be auto-filled
  if ((type === 'text' || type === 'textarea') &&
      (lowerText.includes('other') && (lowerText.includes('specify') || lowerText.includes('please')))) {
    console.log(`[SKIP] Skipping conditional "Other" field: "${questionText}"`);
    return null;
  }

  // Skip search/filter boxes - they're just helpers, not actual questions
  if (type === 'text' || type === 'search') {
    const elementClass = (element.className || '').toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();

    const searchKeywords = ['search', 'filter', 'type to', 'find', 'lookup'];
    const isSearchBox = searchKeywords.some(keyword =>
      lowerText.includes(keyword) ||
      elementId.includes(keyword) ||
      elementName.includes(keyword) ||
      elementClass.includes(keyword) ||
      placeholder.includes(keyword) ||
      ariaLabel.includes(keyword)
    );

    if (isSearchBox) {
      console.log(`[SKIP] Skipping search/filter box: "${questionText.substring(0, 50)}"`);
      return null;
    }
  }

  // Skip questions where the question heading is hidden (data nodes for ranking UI)
  const questionContainer = element.closest('.question');
  if (questionContainer) {
    const questionHeading = questionContainer.querySelector('.question-text, [id^="question_text_"]');
    if (questionHeading) {
      const headingStyle = window.getComputedStyle(questionHeading);
      if (headingStyle.display === 'none' || headingStyle.visibility === 'hidden') {
        console.log(`[SKIP] Skipping hidden question (data node): "${questionText.substring(0, 50)}"`);
        return null;
      }
    }
  }

  const isRequired = element.required || element.hasAttribute('required') ||
                     element.hasAttribute('aria-required');

  // Use element ID as priority, then name, then generate a deterministic one
  let questionId = element.id || element.name;
  if (!questionId) {
    // Generate a deterministic ID based on question text hash (so same question = same ID)
    const hash = simpleHash(questionText);
    questionId = `q_${element.type}_${hash}`;
  }

  const questionData = {
    question_id: String(questionId),
    element: element,
    question_text: questionText,
    question_type: normalizeQuestionType(type),
    required: isRequired,
    options: []
  };

  // Extract options for different input types
  if (type === 'radio' || type === 'checkbox') {
    questionData.options = extractRadioCheckboxOptions(element);
  } else if (type === 'select' || element.tagName.toLowerCase() === 'select') {
    questionData.options = extractSelectOptions(element);
  } else if (type === 'range') {
    questionData.min = element.min || 0;
    questionData.max = element.max || 100;
    questionData.step = element.step || 1;
  } else if (type === 'text' || type === 'textarea') {
    // Capture character limits for text inputs
    console.log(`[TEXT_INPUT] Checking element: type="${element.type}" tagName="${element.tagName}" maxLength="${element.maxLength}" hasMaxLength=${element.hasAttribute('maxlength')}`);

    // Check both maxLength property and maxlength attribute
    let maxLen = element.maxLength;
    if (!maxLen || maxLen === -1 || maxLen >= 999999) {
      // Try getting from attribute directly
      const maxLengthAttr = element.getAttribute('maxlength');
      if (maxLengthAttr) {
        maxLen = parseInt(maxLengthAttr);
      }
    }

    // If no HTML maxLength, search for validation text on the page (like "100 characters maximum")
    if (!maxLen || maxLen === -1 || maxLen >= 999999) {
      console.log(`[TEXT_INPUT] No HTML maxLength, searching for validation text near input...`);

      // Search in parent containers for character limit hints
      let container = element.parentElement;
      for (let i = 0; i < 5 && container; i++) { // Search up to 5 levels up
        const containerText = container.textContent || '';

        // Match patterns like "100 characters", "max 100", "100 char limit", etc.
        const charLimitMatch = containerText.match(/(\d+)\s*character/i) ||
                               containerText.match(/max(?:imum)?[:\s]*(\d+)/i) ||
                               containerText.match(/(\d+)\s*char/i);

        if (charLimitMatch && charLimitMatch[1]) {
          const foundLimit = parseInt(charLimitMatch[1]);
          if (foundLimit > 0 && foundLimit <= 1000) { // Reasonable text input limit
            maxLen = foundLimit;
            console.log(`[TEXT_INPUT] Found validation text with limit: ${foundLimit} chars in container text: "${containerText.substring(0, 100)}"`);
            break;
          }
        }

        container = container.parentElement;
      }
    }

    if (maxLen && maxLen > 0 && maxLen < 999999) {
      questionData.maxLength = maxLen;
      console.log(`[TEXT_INPUT] ✓ Detected maxLength=${maxLen} for question: "${questionText.substring(0, 50)}"`);
    } else {
      console.log(`[TEXT_INPUT] No character limit detected (maxLength=${maxLen})`);
    }
  }

  return questionData;
}

// Find associated question text for an input
function findQuestionText(element) {
  console.log(`[FIND_QUESTION_TEXT] Looking for question text for element:`, element.id || element.name);

  // IMPORTANT: Never use element.value as question text!
  // Make sure we're not accidentally picking up filled-in answers

  // Try label with for attribute (most reliable)
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) {
      const text = label.textContent.trim();
      // Only use if it's reasonable question length (not entire paragraphs)
      if (text.length > 0 && text.length < 200) {
        console.log(`[FIND_QUESTION_TEXT] Found via label[for]: "${text.substring(0, 50)}"`);
        return text;
      }
    }
  }

  // Try aria-label
  if (element.getAttribute('aria-label')) {
    return element.getAttribute('aria-label').trim();
  }

  // Try aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElement = document.getElementById(labelledBy);
    if (labelElement) {
      return labelElement.textContent.trim();
    }
  }

  // Try parent label
  const parentLabel = element.closest('label');
  if (parentLabel) {
    // Get only the label text, not the input value
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll('input, textarea, select');
    inputs.forEach(inp => inp.remove());
    const text = clone.textContent.trim();
    if (text.length > 0 && text.length < 200) {
      return text;
    }
  }

  // Try looking for nearby label in parent container (for Angular forms with mismatched for/id)
  const container = element.closest('.form-group, .question-container, [class*="question"]');
  if (container) {
    const nearbyLabel = container.querySelector('label.form-control-label, label[class*="label"]');
    if (nearbyLabel) {
      const text = nearbyLabel.textContent.trim().replace(/\*$/, '').trim(); // Remove trailing *
      if (text.length > 0 && text.length < 200) {
        console.log(`[FIND_QUESTION_TEXT] Found via nearby label in container: "${text.substring(0, 50)}"`);
        return text;
      }
    }
  }

  // Look for question text by searching up the DOM tree (INCREASED FROM 5 TO 8 LEVELS)
  let currentElement = element;
  for (let level = 0; level < 8; level++) {
    const parent = currentElement.parentElement;
    if (!parent) break;

    // Look for text directly before the input (common pattern)
    let previousElement = currentElement.previousElementSibling;
    while (previousElement) {
      const text = previousElement.textContent.trim();
      // Check if it looks like a question (has question mark, colon, or starts with capital)
      if (text.length > 0 && text.length < 200 &&
          (text.includes('?') || text.endsWith(':') || /^[A-Z]/.test(text))) {
        // Make sure it's not just a number or code-like text
        // Also exclude option labels like "Prefer not to answer", "Don't know any"
        const lowerText = text.toLowerCase();
        const isOptionLabel = lowerText.includes('prefer not to') ||
                             lowerText.includes("don't know") ||
                             lowerText.includes("dont know");

        if (!/^[a-z0-9._-]+$/i.test(text) && !isOptionLabel) {
          console.log(`[FIND_QUESTION_TEXT] Found via previousSibling: "${text.substring(0, 50)}"`);
          return text;
        }
      }
      previousElement = previousElement.previousElementSibling;
    }

    // Look for headings or strong text in parent
    const heading = parent.querySelector('h1, h2, h3, h4, h5, h6, legend, strong, b, .question, .question-text');
    if (heading) {
      const text = heading.textContent.trim();
      const lowerText = text.toLowerCase();
      // Exclude option labels
      const isOptionLabel = lowerText.includes('prefer not to') ||
                           lowerText.includes("don't know") ||
                           lowerText.includes("dont know");

      if (text.length > 0 && text.length < 200 && !/^[a-z0-9._-]+$/i.test(text) && !isOptionLabel) {
        console.log(`[FIND_QUESTION_TEXT] Found via heading: "${text.substring(0, 50)}"`);
        return text;
      }
    }

    // Look for divs with class names that suggest question text
    const questionDiv = parent.querySelector('[class*="question"], [class*="title"], [class*="label"]');
    if (questionDiv && questionDiv !== element) {
      const text = questionDiv.textContent.trim();
      const lowerText = text.toLowerCase();
      // Exclude option labels
      const isOptionLabel = lowerText.includes('prefer not to') ||
                           lowerText.includes("don't know") ||
                           lowerText.includes("dont know");

      if (text.length > 0 && text.length < 200 && !/^[a-z0-9._-]+$/i.test(text) && !isOptionLabel) {
        console.log(`[FIND_QUESTION_TEXT] Found via questionDiv: "${text.substring(0, 50)}"`);
        return text;
      }
    }

    // Look for any text in parent that looks like a question
    const allText = parent.textContent.trim();
    // Extract first sentence/line that looks like a question
    const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      if (line.length > 3 && line.length < 200 &&
          (line.includes('?') || /^(What|How|Where|When|Why|Which|Who|Do|Does|Did|Is|Are|Can|Could|Would|Should|Enter|Select|Choose|Please)/i.test(line))) {
        // Make sure it's not field name, code, or option labels
        const lowerLine = line.toLowerCase();
        const isOptionLabel = lowerLine.includes('prefer not to') ||
                             lowerLine.includes("don't know") ||
                             lowerLine.includes("dont know");

        if (!/^[a-z0-9._-]+$/i.test(line) && !line.includes('function') && !line.includes('{') && !isOptionLabel) {
          console.log(`[FIND_QUESTION_TEXT] Found via parent text: "${line.substring(0, 50)}"`);
          return line;
        }
      }
    }

    currentElement = parent;
  }

  // Try placeholder as last resort
  if (element.placeholder && element.placeholder.length < 100 && element.placeholder.length > 2) {
    // Make sure placeholder isn't just "Enter" or similar
    if (!/^(enter|type|input|click)/i.test(element.placeholder)) {
      return element.placeholder;
    }
  }

  // Use field name/id only if it doesn't look like a technical identifier
  if (element.name && element.name.length < 50 && !/[0-9._-]{3,}/.test(element.name)) {
    return element.name;
  }

  if (element.id && element.id.length < 50 && !/[0-9._-]{3,}/.test(element.id)) {
    return element.id;
  }

  // Last resort: generic
  return 'Question (please provide answer based on context)';
}

// Normalize question type for Claude API
// Simple hash function for generating deterministic IDs from question text
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

function normalizeQuestionType(type) {
  const typeMap = {
    'text': 'text',
    'email': 'text',
    'tel': 'text',
    'url': 'text',
    'number': 'number',
    'date': 'date',
    'textarea': 'textarea',
    'radio': 'radio',
    'checkbox': 'checkbox',
    'select': 'select',
    'select-one': 'select',
    'select-multiple': 'select',  // FIX: Keep as select, not checkbox
    'range': 'range'
  };

  return typeMap[type] || 'text';
}

// Extract options for radio/checkbox groups
function extractRadioCheckboxOptions(element) {
  const name = element.name;
  if (!name) return [];

  const group = document.querySelectorAll(`input[name="${name}"]`);
  const options = [];

  group.forEach(input => {
    const label = findQuestionText(input);
    const value = input.value || label;

    if (!options.find(opt => opt.value === value)) {
      options.push({
        label: label,
        value: value
      });
    }
  });

  return options;
}

// Extract options from select element
function extractSelectOptions(element) {
  const options = [];
  const optionElements = element.querySelectorAll('option');

  optionElements.forEach(opt => {
    if (opt.value && opt.value !== '') {
      options.push({
        label: opt.textContent.trim(),
        value: opt.value
      });
    }
  });

  return options;
}

// Process survey and send to Claude API
async function processSurvey() {
  showLoading('Scanning page for questions...');

  // Detect questions
  const questions = detectQuestions();

  if (questions.length > 0) {
    showLoading(`Found ${questions.length} question(s). Sending to Claude AI...`);
  }

  if (questions.length === 0) {
    // Before showing error, check if this is a continue/intro page
    console.log('[SURVEY] No questions detected, checking for continue page...');
    const continueClicked = await handleContinuePage();

    if (continueClicked) {
      showNotification('Continue button clicked! Waiting for next page...', 'success');
      // Wait for page to load, then auto-process if in auto-fill mode
      await sleep(2000);
      if (autoFillEnabled) {
        await processSurvey();
      }
      return;
    }

    showNotification('No survey questions detected on this page.', 'warning');
    return;
  }

  // Load previous persona if exists
  const storage = await chrome.storage.local.get(['currentPersona', 'lastSurveyUrl']);
  currentPersona = storage.currentPersona || null;
  const lastUrl = storage.lastSurveyUrl || '';

  // Only use previous persona if we're on the same survey (multi-page survey)
  // If URL changed completely, this is a new survey - start fresh
  const currentUrl = window.location.href;
  const isSameSurvey = currentUrl.includes(lastUrl.split('?')[0]) || lastUrl.includes(currentUrl.split('?')[0]);

  if (!isSameSurvey) {
    console.log('[SURVEY] New survey detected - clearing previous persona');
    currentPersona = null;
  }

  // Prepare data for Claude API
  const surveyData = {
    questions: questions.map(q => ({
      question_id: q.question_id,
      question_text: q.question_text,
      question_type: q.question_type,
      required: q.required,
      options: q.options,
      min: q.min,
      max: q.max,
      maxLength: q.maxLength,  // Character limit for text inputs
      maxAllowed: q.maxAllowed,  // Maximum number of selections allowed
      minRequired: q.minRequired,  // Minimum number of selections required
      isRanking: q.isRanking,  // Whether this is a ranking question
      isNumberMatrix: q.isNumberMatrix,  // Whether this is a number matrix question
      isMatrix: q.isMatrix,  // Whether this is a radio/checkbox matrix (Likert scale grid)
      rows: q.rows,  // For matrix questions: array of {label, question_id, elements}
      columns: q.columns  // For matrix questions: array of {label, value}
    })),
    previousPersona: currentPersona,
    pageContext: {
      url: currentUrl,
      title: document.title,
      pageText: extractPageContext()
    }
  };

  console.log('[SURVEY] Sending to Claude:', {
    questionCount: surveyData.questions.length,
    questionIds: surveyData.questions.map(q => q.question_id),
    hasPreviousPersona: !!currentPersona,
    url: currentUrl
  });

  // Debug: Log options for each question
  surveyData.questions.forEach((q, idx) => {
    console.log(`[SURVEY] Q${idx + 1} "${q.question_id}" - ${q.options?.length || 0} options:`, q.options?.map(o => o.label) || []);
  });

  console.log('Sending survey data to Claude API...');
  console.log('Survey data:', surveyData);

  // Send to background script for Claude API call
  try {
    // Add timeout to detect if background script doesn't respond
    let responseReceived = false;
    let timeoutWarningShown = false;
    // Show progress updates during long waits
    const timeout60 = setTimeout(() => {
      if (!responseReceived) {
        timeoutWarningShown = true;
        console.warn('[SURVEY] Still waiting for Claude API response after 60 seconds...');
        showLoading(
          '⏳ Still processing (60+ seconds)... Complex survey, Claude AI is thinking deeply. Request is still running.'
        );
      }
    }, 60000); // 60 second timeout

    const timeout120 = setTimeout(() => {
      if (!responseReceived) {
        console.warn('[SURVEY] Still waiting for Claude API response after 120 seconds...');
        showLoading(
          '⏳⏳ Still processing (2+ minutes)... Very complex survey with many questions. Request is still running - please be patient.'
        );
      }
    }, 120000); // 120 second timeout

    chrome.runtime.sendMessage(
      { action: 'analyzeWithClaude', data: surveyData },
      (response) => {
        responseReceived = true;
        clearTimeout(timeout60);
        clearTimeout(timeout120);

        // If timeout warning was shown, let user know it completed
        if (timeoutWarningShown) {
          console.log('[SURVEY] ✓ Response received after timeout warning!');
          showLoading('Response received! Processing answers...');
        }

        // Check for extension context errors
        if (chrome.runtime.lastError) {
          console.error('Runtime error:', chrome.runtime.lastError);
          showNotification(
            'Extension was reloaded. Please refresh this page and try again.',
            'error'
          );
          return;
        }

        if (!response) {
          console.error('No response from background script');
          showNotification('No response from extension. Please refresh the page.', 'error');
          return;
        }

        console.log('Received response from background:', response);

        if (response.error) {
          console.error('API error:', response.error);
          showNotification(`Error: ${response.error}`, 'error');
        } else if (response.success && response.data) {
          console.log('Successfully received answers, starting to fill...');
          fillSurveyWithAnswers(response.data);
        } else {
          console.error('Invalid response format:', response);
          showNotification('Invalid response from AI. Please try again.', 'error');
        }
      }
    );
  } catch (error) {
    console.error('Error sending message:', error);
    showNotification(
      'Extension error. Please refresh this page and try again.',
      'error'
    );
  }
}

// Extract page context for better understanding
function extractPageContext() {
  // Get main text content (reduced to 500 chars to save tokens)
  const bodyText = document.body.innerText || '';
  return bodyText.substring(0, 500);
}

// Find and click Continue/Next/Submit button
function clickContinueButton() {
  console.log('Looking for Continue/Next/Submit button...');

  // Common button text patterns (case-insensitive)
  const buttonTexts = [
    'continue',
    'next',
    'submit',
    'proceed',
    'accept', // Accept privacy policy / consent buttons
    'confirm', // Confirm selections / answers
    'go',
    'forward',
    'start survey',
    'begin',
    'siguiente', // Spanish
    'continuar', // Spanish
    'suivant', // French
    'weiter', // German
    'nextpage', // Common in forms
    'vorwärts', // German forward
    '→', // Arrow symbols (Unicode)
    '➜',
    '⇒',
    '➔',
    '➞',
    '➡',
    '»',
    '>>'
  ];

  // Find all clickable elements (including divs/spans that might be buttons)
  const allButtons = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('input[type="button"]'),
    ...document.querySelectorAll('input[type="submit"]'),
    ...document.querySelectorAll('input[type="image"]'), // Image buttons!
    ...document.querySelectorAll('a'),
    ...document.querySelectorAll('[role="button"]'),
    ...document.querySelectorAll('[onclick]'),
    ...document.querySelectorAll('.btn'),
    ...document.querySelectorAll('.button'),
    // Clickable divs/spans (common in React apps)
    ...document.querySelectorAll('div[onclick]'),
    ...document.querySelectorAll('span[onclick]'),
    // Elements with cursor:pointer (often clickable buttons)
    ...Array.from(document.querySelectorAll('div, span')).filter(el => {
      const style = window.getComputedStyle(el);
      const hasCursorPointer = style.cursor === 'pointer';
      const hasFontAwesome = style.fontFamily && style.fontFamily.toLowerCase().includes('fontawesome');
      const isShort = el.textContent.trim().length <= 50;
      // Include if: cursor pointer + short text, OR FontAwesome font (icon buttons)
      return (hasCursorPointer && isShort) || hasFontAwesome;
    })
  ];

  console.log(`Found ${allButtons.length} potential buttons`);

  let candidateButtons = [];

  // Look for button with matching text
  for (const button of allButtons) {
    // Log ALL buttons first (before skipping)
    const buttonText = (button.textContent || button.value || button.title || '').toLowerCase().trim();
    const buttonId = (button.id || '').toLowerCase();
    const buttonClass = (button.className || '').toLowerCase();
    const buttonName = (button.name || '').toLowerCase();
    const buttonSrc = (button.src || '').toLowerCase(); // For image buttons
    const buttonAlt = (button.alt || '').toLowerCase(); // Alt text for images

    console.log(`[BTN] Found: text="${buttonText.substring(0, 50)}" id="${buttonId}" class="${buttonClass.substring(0, 80)}"`);

    // Skip our own wildpoptart button!
    if (button.id === 'wildpoptart-btn' || button.classList.contains('wildpoptart-floating-btn')) {
      console.log(`[BTN] ↳ Skipping wildpoptart button`);
      continue;
    }

    // Check if button text/attributes match
    for (const pattern of buttonTexts) {
      if (buttonText.includes(pattern) ||
          buttonId.includes(pattern) ||
          buttonClass.includes(pattern) ||
          buttonName.includes(pattern) ||
          buttonSrc.includes(pattern) ||    // Check src attribute (for image buttons)
          buttonAlt.includes(pattern)) {     // Check alt text

        console.log(`✓ Potential Continue button: "${buttonText}" (matched pattern: "${pattern}")`);

        candidateButtons.push({
          element: button,
          text: buttonText || buttonAlt || 'image button',
          score: calculateButtonScore(button, buttonText, pattern)
        });
      }
    }
  }

  // FALLBACK: Check for icon-only navigation buttons (FontAwesome, arrow icons)
  // These might not have matched the text patterns if they're pure icons
  if (candidateButtons.length === 0) {
    console.log('[CONTINUE] No text-based buttons found, checking for icon-only navigation buttons...');

    for (const button of allButtons) {
      // Skip our own wildpoptart button!
      if (button.id === 'wildpoptart-btn' || button.classList.contains('wildpoptart-floating-btn')) {
        continue;
      }

      const buttonText = (button.textContent || '').trim();
      const buttonClass = (button.className || '').toLowerCase();
      const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();

      // Check inline style for FontAwesome
      const inlineStyle = button.getAttribute('style') || '';
      const hasFontAwesomeStyle = inlineStyle.toLowerCase().includes('fontawesome');

      // Check if element is visible and positioned like a next button (right side of page)
      const rect = button.getBoundingClientRect();
      const isOnRightSide = rect.right > window.innerWidth * 0.6; // Right 40% of screen
      const isVisible = rect.width > 0 && rect.height > 0;

      console.log(`[ICON_CHECK] text="${buttonText}" class="${buttonClass.substring(0, 50)}" FA_style=${hasFontAwesomeStyle} rightSide=${isOnRightSide} visible=${isVisible}`);

      // Check if it's likely a navigation button:
      // 1. FontAwesome class OR inline FontAwesome style
      // 2. Very short text (just an icon character) or empty
      // 3. aria-label suggests navigation
      // 4. Positioned on right side (typical for next buttons)
      const isFontAwesome = buttonClass.includes('fontawesome') || buttonClass.includes('fa-') || buttonClass.includes('icon') || hasFontAwesomeStyle;
      const isShortIcon = buttonText.length <= 2; // Icons are typically 0-2 chars
      const hasNavLabel = ariaLabel.includes('next') || ariaLabel.includes('continue') ||
                          ariaLabel.includes('forward') || ariaLabel.includes('proceed');

      // Be more aggressive: if it's on the right side, short text, and visible, it's probably a next button
      if (isVisible && ((isFontAwesome && isShortIcon) || hasNavLabel || (isShortIcon && isOnRightSide))) {
        console.log(`[CONTINUE] ✓ Found icon-only nav button: text="${buttonText}" class="${buttonClass.substring(0, 50)}" aria="${ariaLabel}" FA=${isFontAwesome} rightSide=${isOnRightSide}`);

        // For FontAwesome icons, try clicking the parent element (it might be the actual clickable area)
        const elementToClick = (isFontAwesome && button.parentElement) ? button.parentElement : button;

        candidateButtons.push({
          element: elementToClick,
          text: buttonText || ariaLabel || 'icon button',
          score: hasNavLabel ? 90 : (isOnRightSide && isShortIcon ? 85 : (isFontAwesome ? 80 : 70))
        });
      }
    }
  }

  // Sort by score (higher is better)
  candidateButtons.sort((a, b) => b.score - a.score);

  // Try to click the best candidate
  for (const candidate of candidateButtons) {
    const button = candidate.element;

    console.log(`Trying to click: "${candidate.text}" (score: ${candidate.score})`);

    // Check if button is visible and enabled
    const computedStyle = window.getComputedStyle(button);
    const isVisible = button.offsetParent !== null || computedStyle.display !== 'none';
    const isEnabled = !button.disabled && !button.hasAttribute('disabled');

    console.log(`  Visible: ${isVisible}, Enabled: ${isEnabled}`);

    // For high-priority buttons (score > 80), try clicking even if not visible
    // Some surveys hide buttons with CSS but they're still functional
    const isHighPriority = candidate.score > 80;

    if ((isVisible || isHighPriority) && isEnabled) {
      if (!isVisible && isHighPriority) {
        console.log('  ⚠️ Button not visible but high priority - attempting click anyway');
      } else {
        console.log('✓ Clicking button!');
      }

      // Try multiple click methods
      button.click();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Also try triggering submit if it's in a form
      const form = button.closest('form');
      if (form) {
        console.log('  Also dispatching submit event on form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }

      return true;
    } else {
      console.log('  Skipping (not clickable)');
    }
  }

  // FALLBACK: If no button found, try to find ANY visible button on the right side of the page
  // This is common for survey Next buttons that might not match our text patterns
  console.log('[FALLBACK] No standard Continue button found, checking for right-aligned buttons...');

  const allVisibleButtons = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('input[type="button"]'),
    ...document.querySelectorAll('input[type="submit"]'),
    ...document.querySelectorAll('input[type="image"]')
  ];

  for (const button of allVisibleButtons) {
    // Skip our wildpoptart button
    if (button.id === 'wildpoptart-btn' || button.classList.contains('wildpoptart-floating-btn')) {
      continue;
    }

    const rect = button.getBoundingClientRect();
    const isOnRightSide = rect.right > window.innerWidth * 0.5; // Right half of screen
    const isVisible = rect.width > 0 && rect.height > 0 && button.offsetParent !== null;
    const isEnabled = !button.disabled && !button.hasAttribute('disabled');

    if (isVisible && isEnabled && isOnRightSide) {
      const buttonText = (button.textContent || button.value || button.alt || '').trim();
      console.log(`[FALLBACK] Found right-aligned button: "${buttonText}" - attempting click`);

      button.click();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Also try form submit
      const form = button.closest('form');
      if (form) {
        console.log('[FALLBACK] Also dispatching submit event on form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }

      return true;
    }
  }

  console.log('No clickable Continue button found');
  return false;
}

// Calculate button relevance score
function calculateButtonScore(button, text, pattern) {
  let score = 0;

  // Exact match = highest score
  if (text === pattern) score += 100;

  // Text starts with pattern = high score
  if (text.startsWith(pattern)) score += 50;

  // Text contains pattern = medium score
  if (text.includes(pattern)) score += 25;

  // Button is a submit type = bonus
  if (button.type === 'submit') score += 20;

  // Button is in a form = bonus
  if (button.closest('form')) score += 10;

  // Button has primary/action class = bonus
  const classes = button.className.toLowerCase();
  if (classes.includes('primary') || classes.includes('action') || classes.includes('submit')) {
    score += 15;
  }

  // Penalize if text is very long (probably not a submit button)
  if (text.length > 30) score -= 20;

  return score;
}

// Fill survey with Claude's answers
async function fillSurveyWithAnswers(response) {
  showLoading('Filling survey...');

  console.log('Claude response:', response);

  const { persona, answers } = response;

  console.log('Full answers array:', JSON.stringify(answers, null, 2));

  // Show what Claude answered for debugging
  let answersDebug = `Claude's Answers:\n`;
  answers.forEach((a, idx) => {
    let answerText;
    if (a.row_answers) {
      // Matrix question - show count of rows
      answerText = `${a.row_answers.length} rows filled`;
    } else {
      answerText = typeof a.answer === 'string' ? a.answer : JSON.stringify(a.answer);
    }
    // Safety: ensure answerText is always a string
    answerText = String(answerText || 'no answer');
    answersDebug += `${idx + 1}. Q: "${a.question_text?.substring(0, 40) || 'unknown'}"\n   A: "${answerText.substring(0, 40)}"\n`;
  });
  showNotification(answersDebug, 'info');

  // Store persona for consistency
  currentPersona = persona;
  await chrome.storage.local.set({
    currentPersona: persona,
    lastSurveyUrl: window.location.href
  });

  console.log(`Attempting to fill ${answers.length} answers`);
  console.log('Detected questions IDs:', detectedQuestions.map(q => q.question_id));
  console.log('Answer IDs from Claude:', answers.map(a => a.question_id));

  // Log first answer as example
  if (answers.length > 0) {
    console.log('Example answer structure:', answers[0]);
  }

  // VALIDATE MOST/LEAST QUESTIONS: Ensure same option isn't selected for both
  const mostLeastQuestions = answers.filter(a =>
    a.question_text && (a.question_text.toLowerCase().includes('most likely') ||
                       a.question_text.toLowerCase().includes('least likely'))
  );

  if (mostLeastQuestions.length === 2) {
    const mostQ = mostLeastQuestions.find(q => q.question_text.toLowerCase().includes('most likely'));
    const leastQ = mostLeastQuestions.find(q => q.question_text.toLowerCase().includes('least likely'));

    if (mostQ && leastQ && mostQ.answer === leastQ.answer) {
      console.error('❌ VALIDATION FAILED: Same answer selected for Most and Least likely!');
      console.error(`Most likely: "${mostQ.answer}"`);
      console.error(`Least likely: "${leastQ.answer}"`);
      showNotification('ERROR: Most/Least validation failed - same answer selected for both. Stopping.', 'error');
      hideLoading();
      return;
    } else if (mostQ && leastQ) {
      console.log('✓ Most/Least validation passed - different answers selected');
    }
  }

  let filledCount = 0;

  // Fill each answer
  for (const answer of answers) {
    const question = detectedQuestions.find(q => q.question_id === answer.question_id);

    if (!question) {
      console.warn(`❌ Question ${answer.question_id} not found in detectedQuestions`);
      console.warn('Available question IDs:', detectedQuestions.map(q => q.question_id));
      console.warn('Claude tried to answer:', answer);
      continue;
    }

    console.log(`✓ Filling question "${answer.question_id}" (${question.question_type}): "${question.question_text.substring(0, 40)}" with answer:`, answer.answer);
    await fillQuestion(question, answer);
    filledCount++;

    // Add random delay between questions (but not after the last one)
    const isLastQuestion = filledCount === answers.length;
    if (!isLastQuestion) {
      const delay = 3000 + Math.random() * 1000; // Random between 3000-4000ms
      console.log(`[DELAY] Waiting ${Math.round(delay)}ms before next question...`);
      await sleep(delay);
    }
  }

  console.log(`Successfully filled ${filledCount} out of ${answers.length} answers`);

  // Check if this was a Quest Mindshare survey (one question at a time)
  const isQuestMindshare = detectedQuestions.some(q => q.isQuestMindshare);

  if (isQuestMindshare) {
    console.log('[QUEST] Checking for next question...');
    await sleep(1000); // Wait for next question to appear

    // Check if there's a continue button to click
    const continueClicked = await handleContinuePage();
    if (continueClicked) {
      console.log('[QUEST] Continue button clicked, waiting for next page...');
      await sleep(2000); // Wait for next page to load
      await processSurvey(); // Continue processing
      return;
    }

    // Re-detect questions to see if a new one appeared
    const newQuestions = detectQuestions();
    if (newQuestions.length > 0) {
      // Check if we just failed to answer this same question (infinite loop prevention)
      const newQuestionText = newQuestions[0].question_text;
      const lastQuestionText = detectedQuestions[0]?.question_text;

      if (newQuestionText === lastQuestionText && filledCount === 0) {
        console.error('[QUEST] Failed to answer question, stopping retry loop');
        showNotification(`Could not answer question: "${newQuestionText}". Please answer manually.`, 'error');
        return;
      }

      console.log(`[QUEST] Found ${newQuestions.length} new question(s), continuing auto-fill...`);
      // Automatically process the new question
      await processSurvey();
      return; // Don't show completion message yet
    } else {
      console.log('[QUEST] No more questions detected, survey complete');
    }
  }

  // Auto-click continue/submit button
  await sleep(500); // Wait a bit before clicking
  console.log('[NEXT_BTN] Attempting to click Next button after filling...');
  const clicked = clickContinueButton();

  if (clicked) {
    console.log('[NEXT_BTN] ✓ Successfully clicked Next button');
    showNotification(`Survey filled with ${filledCount} answers! Continuing...`, 'success');

    // If auto-fill is enabled, wait for next page and continue automatically
    if (autoFillEnabled) {
      console.log('[AUTO-FILL] Continue clicked, waiting for next page...');
      await sleep(3000); // Wait for page transition
      await autoFillSurvey(); // Process next page
    }
  } else {
    console.log('[NEXT_BTN] ❌ Failed to find/click Next button');
    showNotification(`Survey filled with ${filledCount} answers! Click Continue to proceed.`, 'success');
  }
}

// Save question to database
async function saveQuestionToDatabase(question, answer) {
  try {
    // Create lightweight question record
    const questionRecord = {
      timestamp: Date.now(),
      question_text: question.question_text,
      question_type: question.question_type,
      options: question.options ? question.options.map(o => o.label || o.value) : [],
      answer_given: Array.isArray(answer.answer) ? answer.answer : [answer.answer],
      url: window.location.href
    };

    // Add to current session
    currentSurveySession.questions.push(questionRecord);

    // Save to Chrome storage
    const storageKey = 'wildpoptart_question_db';
    const result = await chrome.storage.local.get([storageKey]);
    const database = result[storageKey] || [];

    // Add question to database
    database.push(questionRecord);

    // Keep only last 500 questions (prevent storage overflow)
    const trimmedDb = database.slice(-500);

    await chrome.storage.local.set({ [storageKey]: trimmedDb });

    console.log(`[DB] Question saved. Total questions in DB: ${trimmedDb.length}`);
  } catch (error) {
    console.error('[DB] Error saving question:', error);
  }
}

// Export database as JSON
async function exportQuestionDatabase() {
  const storageKey = 'wildpoptart_question_db';
  const result = await chrome.storage.local.get([storageKey]);
  const database = result[storageKey] || [];

  const dataStr = JSON.stringify(database, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `wildpoptart_questions_${Date.now()}.json`;
  a.click();

  console.log(`[DB] Exported ${database.length} questions`);
}

// Fill individual question
async function fillQuestion(question, answer) {
  const element = question.element;
  const type = question.question_type;

  console.log(`fillQuestion called for ${question.question_id}, type: ${type}`);

  // Handle matrix questions (Likert scale grids)
  if (question.isMatrix && answer.row_answers) {
    console.log(`[MATRIX] Filling matrix question with ${answer.row_answers.length} rows`);

    for (const rowAnswer of answer.row_answers) {
      const row = question.rows.find(r => r.question_id === rowAnswer.row_id);
      if (!row) {
        console.warn(`[MATRIX] Row ${rowAnswer.row_id} not found in matrix`);
        continue;
      }

      // Check if this row is already filled (has a checked radio)
      const radioElements = row.elements || [];
      const alreadyFilled = radioElements.some(radio => radio.checked);

      if (alreadyFilled) {
        console.log(`[MATRIX] ⏭️  Skipping already-filled row "${row.label}"`);
        continue;
      }

      console.log(`[MATRIX] Filling row "${row.label}" with "${rowAnswer.answer}"`);

      // Find the radio button for this row that matches the answer
      let filled = false;

      for (const radio of radioElements) {
        // Get the label for this radio button
        const label = getOptionLabel(radio);

        // Check if this option matches the answer (using the cleaned column label)
        const matchesAnswer = question.columns.some(col => {
          const answerLower = rowAnswer.answer.toLowerCase();
          const colLabelLower = col.label.toLowerCase();
          const labelLower = label.toLowerCase();

          // Match if the answer matches the column label OR the full label contains the answer
          return answerLower === colLabelLower || labelLower.includes(answerLower);
        });

        if (matchesAnswer) {
          console.log(`[MATRIX] ✓ Matched radio: "${label}" for row "${row.label}"`);
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          radio.dispatchEvent(new Event('input', { bubbles: true }));
          radio.dispatchEvent(new Event('click', { bubbles: true }));

          // Also trigger jQuery change event if available
          if (typeof $ !== 'undefined' && $(radio).length) {
            $(radio).trigger('change');
          }

          highlightElement(radio);
          filled = true;
          break;
        }
      }

      if (!filled) {
        console.warn(`[MATRIX] ❌ Could not find matching radio for row "${row.label}" with answer "${rowAnswer.answer}"`);
      }

      await sleep(300); // Small delay between rows
    }

    // Save matrix question to database
    await saveQuestionToDatabase(question, answer);
    return;
  }

  // Handle grouped postal code fields
  if (question.isPostalCodeGroup) {
    console.log(`[POSTAL] Filling grouped postal code fields`);

    const postalCode = String(answer.answer).replace(/\s+/g, '').toUpperCase(); // Remove spaces, uppercase
    console.log(`[POSTAL] Postal code: "${postalCode}"`);

    // Split postal code into parts based on field count
    const fields = question.postalCodeFields || [];

    if (fields.length === 2) {
      // Canadian postal code format: 2 parts of 3 characters each (e.g., M4M 1Y8)
      const part1 = postalCode.substring(0, 3);
      const part2 = postalCode.substring(3, 6);

      console.log(`[POSTAL] Filling field 1 (${fields[0].id}) with: "${part1}"`);
      console.log(`[POSTAL] Filling field 2 (${fields[1].id}) with: "${part2}"`);

      fields[0].element.value = part1;
      fields[0].element.dispatchEvent(new Event('input', { bubbles: true }));
      fields[0].element.dispatchEvent(new Event('change', { bubbles: true }));
      highlightElement(fields[0].element);

      await sleep(500); // Small delay between fields

      fields[1].element.value = part2;
      fields[1].element.dispatchEvent(new Event('input', { bubbles: true }));
      fields[1].element.dispatchEvent(new Event('change', { bubbles: true }));
      highlightElement(fields[1].element);
    } else {
      // Distribute characters across fields based on maxLength
      let currentPos = 0;
      for (const field of fields) {
        const maxLen = field.maxLength || 3;
        const part = postalCode.substring(currentPos, currentPos + maxLen);
        console.log(`[POSTAL] Filling field (${field.id}) with: "${part}"`);

        field.element.value = part;
        field.element.dispatchEvent(new Event('input', { bubbles: true }));
        field.element.dispatchEvent(new Event('change', { bubbles: true }));
        highlightElement(field.element);

        currentPos += maxLen;
        await sleep(200);
      }
    }

    // Save question to database
    await saveQuestionToDatabase(question, answer);
    return;
  }

  // Handle grouped date fields (Month/Day/Year dropdowns)
  if (question.isDateGroup) {
    console.log(`[DATE] Filling grouped date fields`);

    const dateAnswer = String(answer.answer);
    console.log(`[DATE] Date answer: "${dateAnswer}"`);

    // Parse the date answer to extract month, day, year
    let month = null, day = null, year = null;

    // Try to parse different date formats
    if (dateAnswer.includes('/')) {
      // MM/DD/YYYY or DD/MM/YYYY format
      const parts = dateAnswer.split('/');
      if (parts.length === 3) {
        month = parts[0];
        day = parts[1];
        year = parts[2];
      }
    } else if (dateAnswer.includes('-')) {
      // YYYY-MM-DD format
      const parts = dateAnswer.split('-');
      if (parts.length === 3) {
        year = parts[0];
        month = parts[1];
        day = parts[2];
      }
    } else if (dateAnswer.match(/^[A-Za-z]+\s+\d+,?\s+\d{4}$/)) {
      // "April 26, 1992" or "April 26 1992" format
      const match = dateAnswer.match(/^([A-Za-z]+)\s+(\d+),?\s+(\d{4})$/);
      if (match) {
        const monthName = match[1];
        day = match[2];
        year = match[3];

        // Convert month name to number
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                           'july', 'august', 'september', 'october', 'november', 'december'];
        const monthIndex = monthNames.indexOf(monthName.toLowerCase());
        if (monthIndex >= 0) {
          month = String(monthIndex + 1);
        }
      }
    }

    // If we couldn't parse from answer, use persona defaults (33 years old, born April 26, 1992)
    if (!month || !day || !year) {
      console.log(`[DATE] Could not parse date from answer, using persona defaults`);
      month = '4';  // April
      day = '26';
      year = '1992';
    }

    console.log(`[DATE] Parsed: Month=${month}, Day=${day}, Year=${year}`);

    // Fill each date field
    const fields = question.dateFields || [];
    for (const field of fields) {
      const select = field.element;
      let value = null;

      if (field.type === 'month') {
        value = month;
        console.log(`[DATE] Filling MONTH dropdown with: ${value}`);
      } else if (field.type === 'day') {
        value = day;
        console.log(`[DATE] Filling DAY dropdown with: ${value}`);
      } else if (field.type === 'year') {
        value = year;
        console.log(`[DATE] Filling YEAR dropdown with: ${value}`);
      }

      if (value) {
        // Find and select the option with matching value
        let matched = false;
        for (const option of select.options) {
          if (option.value === value || option.value === String(value)) {
            option.selected = true;
            matched = true;
            console.log(`[DATE] ✓ Selected option: "${option.text}" (value: ${option.value})`);
            break;
          }
        }

        if (!matched) {
          console.warn(`[DATE] ⚠️ Could not find option with value "${value}" in ${field.type} dropdown`);
        }

        // Trigger change events
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
        highlightElement(select);

        await sleep(300); // Small delay between fields
      }
    }

    // Save question to database
    await saveQuestionToDatabase(question, answer);
    return;
  }

  // Handle generic div-based survey questions
  if (question.isDivBased) {
    console.log(`[DIV-SURVEY] Filling div-based question (type: ${type})`);

    const options = question.options || [];
    let answersArray = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
    let matchedCount = 0;

    // Handle both single-select (radio) and multi-select (checkbox)
    if (type === 'checkbox') {
      console.log(`[DIV-SURVEY] Multi-select question, looking for ${answersArray.length} options:`, answersArray);
    } else {
      console.log(`[DIV-SURVEY] Single-select question, looking for: "${answersArray[0]}"`);
      answersArray = [answersArray[0]]; // Only use first for single-select
    }

    // Match and click options
    for (const selectedAnswer of answersArray) {
      let matched = false;

      // First try exact match
      for (const opt of options) {
        if (opt.label === selectedAnswer || opt.value === selectedAnswer) {
          console.log(`[DIV-SURVEY] ✓ Exact match - Clicking option: "${opt.label}"`);
          const optElement = opt.element;
          if (optElement) {
            optElement.click();
            optElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            matched = true;
            matchedCount++;
            await sleep(200); // Small delay between clicks
            break;
          }
        }
      }

      // If no exact match, try partial match
      if (!matched) {
        console.log(`[DIV-SURVEY] No exact match, trying partial match for: "${selectedAnswer}"`);
        for (const opt of options) {
          const optLower = opt.label.toLowerCase();
          const ansLower = selectedAnswer.toLowerCase();

          if (optLower.includes(ansLower) || ansLower.includes(optLower) ||
              hasSignificantOverlap(optLower, ansLower)) {
            console.log(`[DIV-SURVEY] ✓ Partial match - Clicking option: "${opt.label}"`);
            const optElement = opt.element;
            if (optElement) {
              optElement.click();
              optElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              matched = true;
              matchedCount++;
              await sleep(200);
              break;
            }
          }
        }
      }

      if (!matched) {
        console.warn(`[DIV-SURVEY] No option matched answer: "${selectedAnswer}"`);
      }
    }

    console.log(`[DIV-SURVEY] Matched ${matchedCount} out of ${answersArray.length} answers`);
    return;
  }

  // Handle Quest Mindshare custom div-based questions
  if (question.isQuestMindshare) {
    console.log(`[QUEST] Filling custom Quest Mindshare question (type: ${type})`);

    const options = question.options || [];
    let answersArray = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
    let matchedCount = 0;

    // Handle both single-select (radio) and multi-select (checkbox)
    if (type === 'checkbox') {
      console.log(`[QUEST] Multi-select question, looking for ${answersArray.length} options:`, answersArray);
    } else {
      console.log(`[QUEST] Single-select question, looking for: "${answersArray[0]}"`);
      answersArray = [answersArray[0]]; // Only use first for single-select
    }

    // Match and click options
    for (const selectedAnswer of answersArray) {
      let matched = false;

      // First try exact match
      for (const opt of options) {
        if (opt.label === selectedAnswer || opt.value === selectedAnswer) {
          console.log(`[QUEST] ✓ Exact match - Clicking option: "${opt.label}"`);
          const optElement = opt.element;
          if (optElement) {
            optElement.click();
            optElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            matched = true;
            matchedCount++;
            await sleep(200); // Small delay between clicks
            break;
          }
        }
      }

      // If no exact match, try partial match
      if (!matched) {
        console.log(`[QUEST] No exact match, trying partial match for: "${selectedAnswer}"`);
        for (const opt of options) {
          const optLower = opt.label.toLowerCase();
          const ansLower = selectedAnswer.toLowerCase();

          if (optLower.includes(ansLower) || ansLower.includes(optLower) ||
              hasSignificantOverlap(optLower, ansLower)) {
            console.log(`[QUEST] ✓ Partial match - Clicking option: "${opt.label}"`);
            const optElement = opt.element;
            if (optElement) {
              optElement.click();
              optElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              matched = true;
              matchedCount++;
              await sleep(200);
              break;
            }
          }
        }
      }

      if (!matched) {
        console.warn(`[QUEST] No option matched answer: "${selectedAnswer}"`);
      }
    }

    console.log(`[QUEST] Matched ${matchedCount} out of ${answersArray.length} answers`);

    // Look for and click "Confirm my selections" button
    await sleep(500);
    const confirmButton = question.parentSection?.querySelector('[data-testid="confirm-selection"]');
    if (confirmButton) {
      console.log(`[QUEST] ✓ Clicking "Confirm my selections" button`);
      confirmButton.click();
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } else {
      console.log(`[QUEST] No confirmation button found (may not be needed for single-select)`);
    }

    return;
  }

  if (!element) {
    console.error(`Element not found for question ${question.question_id}`);
    return;
  }

  try {
    switch (type) {
      case 'number_matrix':
        console.log(`[NUMBER_MATRIX] Filling matrix question with multiple number inputs`);
        const matrixAnswers = Array.isArray(answer.answer) ? answer.answer : [];
        console.log(`[NUMBER_MATRIX] Processing ${matrixAnswers.length} row answers:`, matrixAnswers);

        for (const rowAnswer of matrixAnswers) {
          const rowId = rowAnswer.id;
          const rowValue = rowAnswer.value;

          // Find the input element for this row
          const rowInput = document.getElementById(rowId);
          if (rowInput) {
            console.log(`[NUMBER_MATRIX] ✓ Filling ${rowId} with value: ${rowValue}`);
            rowInput.value = rowValue;
            rowInput.dispatchEvent(new Event('input', { bubbles: true }));
            rowInput.dispatchEvent(new Event('change', { bubbles: true }));
            highlightElement(rowInput);
            await sleep(300); // Small delay between rows
          } else {
            console.warn(`[NUMBER_MATRIX] ⚠️ Could not find input element with ID: ${rowId}`);
          }
        }

        console.log(`[NUMBER_MATRIX] ✓ Filled ${matrixAnswers.length} rows`);
        break;

      case 'text':
      case 'textarea':
      case 'number':
      case 'date':
        let valueToSet = answer.answer;

        // HARD LIMIT: Truncate text answers to 100 characters max
        // Don't trust Claude to follow length guidelines - enforce it in code
        if ((type === 'text' || type === 'textarea') && typeof valueToSet === 'string') {
          const MAX_CHARS = 100;
          if (valueToSet.length > MAX_CHARS) {
            console.warn(`[TEXT_LIMIT] Answer too long (${valueToSet.length} chars), truncating to ${MAX_CHARS}`);
            // Truncate at last complete sentence or word before limit
            valueToSet = valueToSet.substring(0, MAX_CHARS);
            // Trim to last complete word
            const lastSpace = valueToSet.lastIndexOf(' ');
            if (lastSpace > MAX_CHARS * 0.8) { // Only trim if we're not losing too much
              valueToSet = valueToSet.substring(0, lastSpace);
            }
            // Add period if it doesn't end with punctuation
            if (!/[.!?]$/.test(valueToSet)) {
              valueToSet += '.';
            }
            console.log(`[TEXT_LIMIT] Truncated to: "${valueToSet}" (${valueToSet.length} chars)`);
          }
        }

        console.log(`Setting ${type} value to:`, valueToSet);
        element.value = valueToSet;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`Value set. Current value:`, element.value);

        // Check for validation errors after filling (for JS-enforced character limits)
        if (type === 'text' || type === 'textarea') {
          await sleep(800); // Wait longer for validation to run

          // Look for error messages on the page
          const errorMessages = [
            ...document.querySelectorAll('[class*="error"]'),
            ...document.querySelectorAll('[class*="Error"]'),
            ...document.querySelectorAll('[class*="invalid"]'),
            ...document.querySelectorAll('[class*="warning"]'),
            ...document.querySelectorAll('[role="alert"]')
          ];

          console.log(`[VALIDATION] Found ${errorMessages.length} potential error elements`);

          for (const errorEl of errorMessages) {
            // Only check visible error messages with actual text content
            const computedStyle = window.getComputedStyle(errorEl);
            const isVisible = computedStyle.display !== 'none' &&
                            computedStyle.visibility !== 'hidden' &&
                            computedStyle.opacity !== '0' &&
                            errorEl.offsetParent !== null;

            const errorText = (errorEl.textContent || '').trim();

            // Skip empty or hidden error messages
            if (!errorText || !isVisible) {
              continue;
            }

            console.log(`[VALIDATION] Checking visible error: "${errorText}"`);

            // Check if it's a character limit error
            const charLimitMatch = errorText.match(/(\d+)\s*character/i) ||
                                   errorText.match(/over\s*(\d+)/i) ||
                                   errorText.match(/max(?:imum)?[:\s]*(\d+)/i);

            if (charLimitMatch && charLimitMatch[1]) {
              const limit = parseInt(charLimitMatch[1]);
              const currentLength = (answer.answer || '').length;

              console.log(`[VALIDATION] ⚠️ Character limit error detected! Limit: ${limit}, Current: ${currentLength}`);

              if (currentLength > limit) {
                // Truncate the answer to fit the limit
                let truncated = answer.answer.substring(0, limit - 3) + '...'; // Leave room for ellipsis

                // Try to truncate at a word boundary for cleaner text
                const lastSpace = truncated.lastIndexOf(' ');
                if (lastSpace > limit * 0.7) { // If we can find a space in the last 30%, use it
                  truncated = truncated.substring(0, lastSpace) + '...';
                }

                console.log(`[VALIDATION] ✂️ Truncating to ${truncated.length} characters: "${truncated}"`);

                // Re-fill with truncated answer
                element.value = truncated;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));

                await sleep(300); // Wait to see if error clears
                console.log(`[VALIDATION] ✓ Value updated to truncated version`);
                break;
              }
            }
          }
        }
        break;

      case 'radio':
        console.log(`Radio group answer:`, answer.answer);

        // DEFENSIVE: Radio buttons should ONLY have ONE selection
        // If answer is an array, only use the first item
        let radioAnswer = answer.answer;
        if (Array.isArray(radioAnswer)) {
          console.warn(`⚠️ Radio button received array answer (should be string). Using first item only.`);
          radioAnswer = radioAnswer[0];
        }

        const radioElements = question.elements || document.querySelectorAll(`input[name="${element.name}"]`);
        console.log(`Found ${radioElements.length} radio buttons in group`);
        console.log(`Looking for single answer: "${radioAnswer}"`);

        // Check if this is a carousel question (MX Framework)
        const carouselContainer = element.closest('.mx-stage') || document.querySelector('.mx-carousel');
        if (carouselContainer) {
          console.log(`[CAROUSEL] Detected MX carousel question, using carousel card click method`);

          // Find which radio button matches the answer
          let matchedRadio = null;
          for (const radio of radioElements) {
            const label = getOptionLabel(radio);
            const value = radio.value;

            if (label === radioAnswer ||
                value === radioAnswer ||
                radio.id === radioAnswer ||
                label.toLowerCase() === radioAnswer.toLowerCase() ||
                value.toLowerCase() === radioAnswer.toLowerCase()) {
              matchedRadio = radio;
              console.log(`[CAROUSEL] Matched radio input: ${radio.id}`);
              break;
            }
          }

          if (matchedRadio) {
            // Extract the column/scale code from the radio ID (e.g., "ans1033640.5.8" -> column "5")
            const idParts = matchedRadio.id.match(/\.(\d+)\.\d+$/);
            if (idParts && idParts[1]) {
              const columnCode = 'c' + idParts[1];
              console.log(`[CAROUSEL] Looking for carousel scale card with data-code="${columnCode}"`);

              // Find and click the carousel scale card
              const scaleCard = document.querySelector(`.mx-carouselapp-scale[data-code="${columnCode}"]`);
              if (scaleCard) {
                console.log(`[CAROUSEL] ✓ Found carousel scale card, clicking...`);
                scaleCard.click();
                scaleCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

                // Also click the inner card element
                const innerCard = scaleCard.querySelector('.mx-card');
                if (innerCard) {
                  innerCard.click();
                  innerCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }

                // Wait for carousel animation
                await sleep(800);
                break;
              } else {
                console.warn(`[CAROUSEL] ⚠️ Could not find carousel scale card for code: ${columnCode}`);
              }
            } else {
              console.warn(`[CAROUSEL] ⚠️ Could not extract column code from radio ID: ${matchedRadio.id}`);
            }
          }

          // If carousel method didn't work, fall through to regular radio handling
          console.log(`[CAROUSEL] Falling back to regular radio button click`);
        }

        let radioMatched = false;
        radioElements.forEach(radio => {
          const label = getOptionLabel(radio);  // FIX: Use getOptionLabel to get the option text, not the question text
          const value = radio.value;

          console.log(`Radio option: id="${radio.id}", label="${label}", value="${value}"`);

          // Uncheck all first
          radio.checked = false;

          // ONLY check if this radio matches AND we haven't matched yet
          // Try exact match first, then case-insensitive match
          const isMatch = label === radioAnswer ||
                         value === radioAnswer ||
                         radio.id === radioAnswer ||
                         label.toLowerCase() === radioAnswer.toLowerCase() ||
                         value.toLowerCase() === radioAnswer.toLowerCase();

          if (!radioMatched && isMatch) {
            console.log(`✓ Matched radio: "${label}" (value: ${value})`);
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radio.dispatchEvent(new Event('click', { bubbles: true }));

            // For hidden radio inputs with custom visual UI (like country selector cards),
            // also click the associated label element
            const computedStyle = window.getComputedStyle(radio);
            const isHidden = computedStyle.display === 'none' ||
                           radio.classList.contains('d-none') ||
                           radio.classList.contains('hidden');

            if (isHidden && radio.id) {
              const associatedLabel = document.querySelector(`label[for="${radio.id}"]`);
              if (associatedLabel) {
                console.log(`  ↳ Radio is hidden, clicking associated label`);
                associatedLabel.click();
                associatedLabel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              }
            }

            radioMatched = true;
          }
        });

        if (!radioMatched) {
          console.warn(`No radio button matched answer: "${radioAnswer}"`);
        }
        break;

      case 'checkbox':
        console.log(`Checkbox group answer:`, answer.answer);
        const checkboxElements = question.elements || document.querySelectorAll(`input[name="${element.name}"]`);
        let answersArray = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
        console.log(`Found ${checkboxElements.length} checkboxes, looking for:`, answersArray);

        // ⚠️ ENFORCE maxAllowed constraint
        if (question.maxAllowed !== undefined && answersArray.length > question.maxAllowed) {
          console.warn(`[CONSTRAINT] ⚠️ Claude provided ${answersArray.length} answers but maxAllowed is ${question.maxAllowed}`);
          console.warn(`[CONSTRAINT] Trimming to first ${question.maxAllowed} answers:`, answersArray.slice(0, question.maxAllowed));
          answersArray = answersArray.slice(0, question.maxAllowed);
        }

        let checkboxMatchCount = 0;

        checkboxElements.forEach(checkbox => {
          const label = getOptionLabel(checkbox);  // FIX: Use getOptionLabel instead of findQuestionText
          const value = checkbox.value;
          const id = checkbox.id;

          // Check if this checkbox should be checked
          const shouldCheck = answersArray.some(ans =>
            ans === label || ans === value || ans === id ||
            String(ans).toLowerCase() === label.toLowerCase() ||
            String(ans).toLowerCase() === value.toLowerCase()
          );

          console.log(`Checkbox "${id}" - label: "${label}", value: "${value}", shouldCheck: ${shouldCheck}`);

          // Additional check: Don't check more than maxAllowed
          if (shouldCheck && question.maxAllowed !== undefined && checkboxMatchCount >= question.maxAllowed) {
            console.log(`[CONSTRAINT] ⚠️ Already checked ${checkboxMatchCount} items (maxAllowed: ${question.maxAllowed}), skipping "${label}"`);
            checkbox.checked = false;
          } else if (shouldCheck) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            checkbox.dispatchEvent(new Event('click', { bubbles: true }));
            checkboxMatchCount++;
            console.log(`✓ Checked checkbox: ${id}`);
          } else {
            checkbox.checked = false; // Uncheck if not in answer array
          }
        });

        console.log(`Checked ${checkboxMatchCount} out of ${answersArray.length} requested checkboxes`);
        if (question.maxAllowed !== undefined) {
          console.log(`[CONSTRAINT] ✓ Respected maxAllowed constraint: ${question.maxAllowed}`);
        }
        break;

      case 'select':
        console.log(`Select/dropdown answer:`, answer.answer);

        // Check if this is a multi-select dropdown
        const isMultiSelect = element.hasAttribute('multiple');
        console.log(`isMultiSelect: ${isMultiSelect}`);

        const options = element.querySelectorAll('option');

        if (isMultiSelect) {
          // Multi-select: Handle array of answers
          let answersArray = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
          console.log(`Multi-select dropdown: selecting ${answersArray.length} options`);

          let matchCount = 0;

          options.forEach(opt => {
            const optText = opt.textContent.trim();
            const optValue = opt.value;

            // Check if this option matches any answer
            const isMatch = answersArray.some(ans =>
              optText === ans || optValue === ans ||
              optText.toLowerCase() === ans.toLowerCase() ||
              optValue.toLowerCase() === ans.toLowerCase()
            );

            if (isMatch) {
              console.log(`✓ Selecting option: "${optText}" (value: ${optValue})`);
              opt.selected = true;
              matchCount++;
            } else {
              opt.selected = false;
            }
          });

          // Trigger change event
          element.dispatchEvent(new Event('change', { bubbles: true }));

          // CRITICAL: For Bootstrap selectpicker, also trigger manual refresh
          if (element.classList.contains('selectpicker')) {
            console.log('[BOOTSTRAP] Triggering selectpicker refresh');
            // Try to refresh the Bootstrap selectpicker UI
            try {
              if (typeof $ !== 'undefined' && $.fn.selectpicker) {
                $(element).selectpicker('refresh');
              }
            } catch (e) {
              console.warn('[BOOTSTRAP] Could not refresh selectpicker:', e);
            }
          }

          console.log(`Selected ${matchCount} out of ${answersArray.length} requested options`);

        } else {
          // Single-select: Use first answer only
          let selectAnswer = Array.isArray(answer.answer) ? answer.answer[0] : answer.answer;
          console.log(`Single-select dropdown: "${selectAnswer}"`);

          let selectMatched = false;

          options.forEach(opt => {
            const optText = opt.textContent.trim();
            const optValue = opt.value;

            if (!selectMatched && (optText === selectAnswer || optValue === selectAnswer ||
                optText.toLowerCase() === selectAnswer.toLowerCase() ||
                optValue.toLowerCase() === selectAnswer.toLowerCase())) {
              console.log(`✓ Matched option: "${optText}" (value: ${optValue})`);
              element.value = opt.value;
              opt.selected = true;

              // Trigger multiple events for compatibility with different survey platforms
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.dispatchEvent(new Event('blur', { bubbles: true }));

              // Also trigger jQuery change event if jQuery is available (Ipsos uses jQuery)
              if (typeof $ !== 'undefined' && $(element).length) {
                $(element).trigger('change');
              }

              // Highlight the element to show it was filled
              highlightElement(element);

              selectMatched = true;
            }
          });

          if (!selectMatched) {
            console.warn(`No option matched answer: "${selectAnswer}"`);
          }
        }
        break;

      case 'range':
        element.value = answer.answer;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        break;
    }

    // Highlight filled element
    highlightElement(element);

  } catch (error) {
    console.error(`Error filling question ${question.question_id}:`, error);
  }

  // Save question to database (after successful fill)
  await saveQuestionToDatabase(question, answer);
}

// Visual feedback helpers
function highlightElement(element) {
  element.style.transition = 'all 0.3s ease';
  element.style.backgroundColor = '#d4edda';

  setTimeout(() => {
    element.style.backgroundColor = '';
  }, 1000);
}

function showLoading(message) {
  removeNotification();

  const loading = document.createElement('div');
  loading.id = 'wildpoptart-loading';
  loading.className = 'wildpoptart-notification wildpoptart-loading';
  loading.innerHTML = `
    <div class="spinner"></div>
    <span>${message}</span>
  `;

  document.body.appendChild(loading);
}

function showNotification(message, type = 'info') {
  removeNotification();

  const notification = document.createElement('div');
  notification.id = 'wildpoptart-notification';
  notification.className = `wildpoptart-notification wildpoptart-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    removeNotification();
  }, 5000);
}

function removeNotification() {
  const existing = document.querySelectorAll('#wildpoptart-notification, #wildpoptart-loading');
  existing.forEach(el => el.remove());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['isActive', 'autoFill'], (result) => {
      // Enable autoFill by default if not set
      const autoFillSetting = result.autoFill !== undefined ? result.autoFill : true;

      console.log('[AUTO-FILL] Storage check - isActive:', result.isActive, 'autoFill:', autoFillSetting);

      if (result.isActive) {
        isActive = true;
        autoFillEnabled = autoFillSetting;
        startSurveyDetection();

        // AUTO-FILL: Automatically fill survey after page loads
        if (autoFillSetting) {
          console.log('[AUTO-FILL] ✅ ENABLED - will auto-fill in 2 seconds...');
          setTimeout(() => {
            console.log('[AUTO-FILL] Timeout triggered, calling autoFillSurvey()...');
            autoFillSurvey();
          }, 2000); // Wait 2 seconds for page to fully load
        } else {
          console.log('[AUTO-FILL] ❌ DISABLED - you must click 🍰 button manually');
        }
      } else {
        console.log('[AUTO-FILL] Extension is not active - click Activate in popup first');
      }

      // Set autoFill to true by default if it's not already set
      if (result.autoFill === undefined) {
        chrome.storage.local.set({ autoFill: true });
        console.log('[AUTO-FILL] Enabled by default');
      }
    });
  });
} else {
  chrome.storage.local.get(['isActive', 'autoFill'], (result) => {
    // Enable autoFill by default if not set
    const autoFillSetting = result.autoFill !== undefined ? result.autoFill : true;

    console.log('[AUTO-FILL] Storage check (else) - isActive:', result.isActive, 'autoFill:', autoFillSetting);

    if (result.isActive) {
      isActive = true;
      autoFillEnabled = autoFillSetting;
      startSurveyDetection();

      // AUTO-FILL: Automatically fill survey after page loads
      if (autoFillSetting) {
        console.log('[AUTO-FILL] ✅ ENABLED - will auto-fill in 2 seconds...');
        setTimeout(() => {
          console.log('[AUTO-FILL] Timeout triggered, calling autoFillSurvey()...');
          autoFillSurvey();
        }, 2000); // Wait 2 seconds for page to fully load
      } else {
        console.log('[AUTO-FILL] ❌ DISABLED - you must click 🍰 button manually');
      }
    } else {
      console.log('[AUTO-FILL] Extension is not active - click Activate in popup first');
    }

    // Set autoFill to true by default if it's not already set
    if (result.autoFill === undefined) {
      chrome.storage.local.set({ autoFill: true });
      console.log('[AUTO-FILL] Enabled by default');
    }
  });
}

// Auto-fill function - fills survey automatically without button click
async function autoFillSurvey() {
  // FIRST: Check if this is a user agreement/consent screen
  const agreementClicked = await handleUserAgreementScreen();
  if (agreementClicked) {
    console.log('[AUTO-FILL] User agreement screen handled, waiting for next page...');
    return; // Wait for next page to load
  }

  // SECOND: Check if this is an intro/welcome page with just a Continue button
  const continueClicked = await handleContinuePage();
  if (continueClicked) {
    console.log('[AUTO-FILL] Continue page handled, waiting for next page...');
    return; // Wait for next page to load
  }

  // Check if there are questions on the page
  const questions = detectQuestions();

  if (questions.length === 0) {
    console.log('[AUTO-FILL] No questions detected, skipping auto-fill');
    return;
  }

  console.log(`[AUTO-FILL] Detected ${questions.length} questions, auto-filling...`);
  await processSurvey();
}

// Handle intro/welcome/continue pages
async function handleContinuePage() {
  console.log('[CONTINUE] Checking for intro/welcome page...');

  // Keywords that indicate this is an intro/welcome page
  const introKeywords = [
    'thank you in advance',
    'thank you for participating',
    'welcome to',
    'before we begin',
    'let\'s get started',
    'first stage of the survey',
    'this survey will take',
    'we appreciate your',
    'introduction',
    'please read'
  ];

  const pageText = document.body.innerText.toLowerCase();

  // Check if page contains intro keywords
  const isIntroPage = introKeywords.some(keyword => pageText.includes(keyword));

  // Also check if there are very few or no input fields (no questions to answer)
  const inputCount = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select').length;

  if (isIntroPage || inputCount === 0) {
    console.log('[CONTINUE] ✓ Intro/welcome page detected (or no inputs found)');

    // Look for Continue buttons
    const continueButtonSelectors = [
      'input[type="submit"][value*="Continue"]',
      'input[type="submit"][value*="continue"]',
      'input[type="submit"][name="continue"]',
      'input[type="submit"][id*="continue"]',
      'button[type="submit"]',
      'input[type="submit"].continue',
      'button.continue',
      'button', // All buttons (will filter by text content below)
      'input[value*="Next"]',
      'input[type="submit"]'
    ];

    for (const selector of continueButtonSelectors) {
      const buttons = document.querySelectorAll(selector);

      for (const button of buttons) {
        const buttonText = (button.value || button.textContent || '').toLowerCase();
        const buttonId = (button.id || '').toLowerCase();
        const buttonClass = (button.className || '').toLowerCase();

        // Check if this looks like a continue/next/start button
        if (buttonText.includes('continue') || buttonText.includes('next') ||
            buttonText.includes('start') || buttonText.includes('begin') ||
            buttonId.includes('continue') || buttonClass.includes('continue')) {

          // Check if visible and enabled
          const isVisible = button.offsetParent !== null || window.getComputedStyle(button).display !== 'none';
          const isEnabled = !button.disabled && !button.hasAttribute('disabled');

          if (isVisible && isEnabled) {
            console.log(`[CONTINUE] ✓ Found continue button: "${buttonText}" - CLICKING!`);
            button.click();
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            // If auto-fill enabled, schedule next auto-fill for SPAs that don't reload
            if (autoFillEnabled) {
              setTimeout(async () => {
                console.log('[AUTO-FILL] Checking for questions after continue click...');
                await autoFillSurvey();
              }, 3000); // Wait 3 seconds for page transition
            }

            return true; // Continue button clicked
          }
        }
      }
    }

    console.log('[CONTINUE] No clickable continue button found');
    return false;
  }

  console.log('[CONTINUE] Not an intro page, proceeding normally');
  return false;
}

// Handle user agreement/consent screens
async function handleUserAgreementScreen() {
  console.log('[AGREEMENT] Checking for user agreement screen...');

  // IMPORTANT: First check if there are actual survey questions on the page
  // If there are questions, this is NOT an agreement screen (even if it has "continue" button)
  const questionsOnPage = document.querySelectorAll('input[type="radio"], input[type="checkbox"], select, textarea, input[type="text"], input[type="number"]');

  if (questionsOnPage.length > 0) {
    console.log(`[AGREEMENT] Found ${questionsOnPage.length} form inputs - NOT an agreement screen, proceeding to fill questions`);
    return false;
  }

  // Keywords that indicate this is an agreement screen
  const agreementKeywords = [
    'consent',
    'privacy policy',
    'terms and conditions',
    'data collection',
    'you are opting into this survey',
    'i agree below',
    'by selecting',
    'participation in this survey'
  ];

  const pageText = document.body.innerText.toLowerCase();

  // Check if page contains agreement keywords
  const isAgreementScreen = agreementKeywords.some(keyword => pageText.includes(keyword));

  if (!isAgreementScreen) {
    console.log('[AGREEMENT] Not an agreement screen, proceeding normally');
    return false;
  }

  console.log('[AGREEMENT] ✓ Agreement screen detected (no questions found, has agreement keywords)!');

  // Look for agreement buttons
  const agreementButtonTexts = [
    'i agree',
    'agree',
    'accept',
    'consent',
    'yes',
    'continue',
    'proceed',
    'start survey',
    'begin'
  ];

  const allButtons = [
    ...document.querySelectorAll('button'),
    ...document.querySelectorAll('a'),
    ...document.querySelectorAll('[role="button"]'),
    ...document.querySelectorAll('input[type="button"]'),
    ...document.querySelectorAll('input[type="submit"]')
  ];

  console.log(`[AGREEMENT] Found ${allButtons.length} potential buttons`);

  for (const button of allButtons) {
    const buttonText = (button.textContent || button.value || '').toLowerCase().trim();
    const buttonId = (button.id || '').toLowerCase();
    const buttonClass = (button.className || '').toLowerCase();
    const testId = (button.getAttribute('data-testid') || '').toLowerCase();

    // Check if button matches agreement patterns
    for (const pattern of agreementButtonTexts) {
      if (buttonText.includes(pattern) ||
          buttonId.includes(pattern) ||
          buttonClass.includes(pattern) ||
          testId.includes(pattern)) {

        // Check if visible and enabled
        const isVisible = button.offsetParent !== null || window.getComputedStyle(button).display !== 'none';
        const isEnabled = !button.disabled && !button.hasAttribute('disabled');

        if (isVisible && isEnabled) {
          console.log(`[AGREEMENT] ✓ Found agreement button: "${buttonText}" - CLICKING!`);

          // Click the button
          button.click();
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

          return true; // Agreement button clicked
        }
      }
    }
  }

  console.log('[AGREEMENT] No clickable agreement button found');
  return false;
}


// Expose export function globally for console access
window.exportDB = exportQuestionDatabase;
window.viewDB = async function() {
  const storageKey = "wildpoptart_question_db";
  const result = await chrome.storage.local.get([storageKey]);
  const database = result[storageKey] || [];
  console.log(`📊 Question Database (${database.length} questions):`);
  console.table(database.slice(-20)); // Show last 20
  return database;
};

