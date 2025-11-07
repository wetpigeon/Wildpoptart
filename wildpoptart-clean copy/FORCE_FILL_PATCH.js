// ============================================================================
// WILDPOPTART FORCE-FILL PATCH v5.1.2
// Tampermonkey/UserScript compatible
// ============================================================================

/**
 * FORCE-FILL OVERRIDE SYSTEM
 *
 * Problem: Script skips questions with pre-existing values and auto-fill may be disabled
 * Solution: Add force-fill mode that bypasses all checks and clears stale inputs
 *
 * Features:
 * - Clears all stale input values before filling
 * - Bypasses "already has value" checks
 * - Works even when auto-fill is disabled
 * - Provides detailed logging for debugging
 * - Can be triggered manually via console or button
 */

// ============================================================================
// PART 1: GLOBAL FORCE-FILL STATE
// ============================================================================

// Add to content.js global scope (after existing state management)
let forceFillMode = false; // When true, bypass all pre-fill checks
let forceFillStats = {
  cleared: 0,
  filled: 0,
  failed: 0
};

// ============================================================================
// PART 2: CLEAR STALE INPUTS FUNCTION
// ============================================================================

/**
 * Clears all stale input values on the page
 * Targets: text inputs, number inputs, textareas, selects, radios, checkboxes
 */
function clearStaleInputs() {
  console.log('[FORCE-FILL] 🧹 Clearing all stale inputs...');

  let cleared = 0;

  // Clear text inputs, number inputs, textareas
  const textInputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="email"], input[type="tel"], textarea');
  textInputs.forEach(input => {
    if (input.value && input.value.trim() !== '') {
      console.log(`[FORCE-FILL] Clearing input ${input.id || input.name}: "${input.value}"`);
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      cleared++;
    }
  });

  // Uncheck all checkboxes and radios
  const checks = document.querySelectorAll('input[type="checkbox"], input[type="radio"]');
  checks.forEach(input => {
    if (input.checked) {
      console.log(`[FORCE-FILL] Unchecking ${input.type} ${input.id || input.name}`);
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      cleared++;
    }
  });

  // Reset selects to first option
  const selects = document.querySelectorAll('select');
  selects.forEach(select => {
    if (select.selectedIndex > 0) {
      console.log(`[FORCE-FILL] Resetting select ${select.id || select.name}`);
      select.selectedIndex = 0;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      cleared++;
    }
  });

  // Clear Material UI inputs (if present)
  const muiInputs = document.querySelectorAll('.MuiInputBase-input, .MuiInput-input');
  muiInputs.forEach(input => {
    if (input.value && input.value.trim() !== '') {
      console.log(`[FORCE-FILL] Clearing Material UI input: "${input.value}"`);
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      cleared++;
    }
  });

  console.log(`[FORCE-FILL] ✓ Cleared ${cleared} stale inputs`);
  forceFillStats.cleared = cleared;
  return cleared;
}

// ============================================================================
// PART 3: FORCE-FILL SINGLE QUESTION
// ============================================================================

/**
 * Force-fills a single question, selecting first valid option
 * Works with: radio, checkbox, select, text, number
 */
async function forceFillQuestion(question) {
  console.log(`[FORCE-FILL] Attempting to fill question: ${question.question_id}`);
  console.log(`[FORCE-FILL] Question type: ${question.question_type}`);
  console.log(`[FORCE-FILL] Question text: "${question.question_text.substring(0, 60)}..."`);

  try {
    const type = question.question_type;
    const element = question.element;
    const elements = question.elements || [];

    // RADIO or CHECKBOX groups
    if ((type === 'radio' || type === 'checkbox') && elements.length > 0) {
      console.log(`[FORCE-FILL] Found ${elements.length} ${type} options`);

      // Find first non-"None" option
      let targetInput = null;
      for (const input of elements) {
        const label = getOptionLabel(input);
        const isNone = /none|n\/a|not applicable|prefer not|skip/i.test(label);

        if (!isNone) {
          targetInput = input;
          console.log(`[FORCE-FILL] Selected option: "${label}"`);
          break;
        }
      }

      // Fallback to first option if all are "None"
      if (!targetInput && elements.length > 0) {
        targetInput = elements[0];
        console.log(`[FORCE-FILL] Fallback to first option`);
      }

      if (targetInput) {
        targetInput.checked = true;
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        targetInput.dispatchEvent(new Event('click', { bubbles: true }));

        // jQuery trigger if available
        if (typeof $ !== 'undefined' && $(targetInput).length) {
          $(targetInput).trigger('change');
        }

        console.log(`[FORCE-FILL] ✓ Answered question ${question.question_id} successfully`);
        forceFillStats.filled++;
        return true;
      }
    }

    // SELECT dropdown
    else if (type === 'select' && element && element.tagName === 'SELECT') {
      const options = Array.from(element.options);
      console.log(`[FORCE-FILL] Found ${options.length} select options`);

      // Select first non-empty option
      for (let i = 1; i < options.length; i++) {
        if (options[i].value && options[i].value !== '') {
          element.selectedIndex = i;
          element.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`[FORCE-FILL] ✓ Selected option: "${options[i].textContent}"`);
          forceFillStats.filled++;
          return true;
        }
      }
    }

    // TEXT or NUMBER input
    else if ((type === 'text' || type === 'number') && element) {
      const sampleValue = type === 'number' ? '1' : 'Sample answer';
      element.value = sampleValue;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[FORCE-FILL] ✓ Filled text/number input with: "${sampleValue}"`);
      forceFillStats.filled++;
      return true;
    }

    // MATRIX questions
    else if (question.isMatrix && question.rows && question.columns) {
      console.log(`[FORCE-FILL] Matrix question with ${question.rows.length} rows`);

      // Fill each row with first column option
      for (const row of question.rows) {
        const rowElements = row.elements || [];
        if (rowElements.length > 0) {
          const firstOption = rowElements[0];
          firstOption.checked = true;
          firstOption.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`[FORCE-FILL] ✓ Filled matrix row: "${row.label}"`);
        }
      }
      forceFillStats.filled++;
      return true;
    }

    console.warn(`[FORCE-FILL] ⚠️ Unsupported question type: ${type}`);
    forceFillStats.failed++;
    return false;

  } catch (error) {
    console.error(`[FORCE-FILL] ❌ Error filling question ${question.question_id}:`, error);
    forceFillStats.failed++;
    return false;
  }
}

// ============================================================================
// PART 4: MAIN FORCE-FILL FUNCTION
// ============================================================================

/**
 * Main force-fill function that processes all detected questions
 * Can be called manually from console: forceFill()
 */
async function forceFill() {
  console.log('');
  console.log('='.repeat(80));
  console.log('[FORCE-FILL] 🚀 FORCE-FILL MODE ACTIVATED');
  console.log('='.repeat(80));

  // Reset stats
  forceFillStats = { cleared: 0, filled: 0, failed: 0 };

  // Step 1: Clear all stale inputs
  clearStaleInputs();

  // Step 2: Detect questions
  console.log('[FORCE-FILL] Detecting questions...');
  const questions = await detectQuestions();

  if (questions.length === 0) {
    console.warn('[FORCE-FILL] ⚠️ No questions detected on page');
    alert('No questions detected on this page.');
    return;
  }

  console.log(`[FORCE-FILL] Found ${questions.length} question(s)`);

  // Step 3: Fill each question
  for (const question of questions) {
    await forceFillQuestion(question);

    // Small delay between questions
    await sleep(500);
  }

  // Step 4: Report results
  console.log('');
  console.log('='.repeat(80));
  console.log('[FORCE-FILL] 📊 FORCE-FILL COMPLETE');
  console.log(`  Inputs cleared: ${forceFillStats.cleared}`);
  console.log(`  Questions filled: ${forceFillStats.filled}`);
  console.log(`  Questions failed: ${forceFillStats.failed}`);
  console.log('='.repeat(80));
  console.log('');

  // Show notification
  showNotification(`Force-fill complete! Filled ${forceFillStats.filled}/${questions.length} questions`, 'success');

  // Auto-click continue if in auto-fill mode
  if (autoFillEnabled) {
    console.log('[FORCE-FILL] Auto-fill mode enabled, attempting to click continue...');
    await sleep(1000);
    await handleContinuePage(true);
  }
}

// ============================================================================
// PART 5: PATCH EXISTING FUNCTIONS
// ============================================================================

/**
 * Override the detectQuestions function to skip "already has value" warnings
 * when in force-fill mode
 */

// Save original detectQuestions
const _originalDetectQuestions = window.detectQuestions;

// Override detectQuestions
window.detectQuestions = async function() {
  const questions = await _originalDetectQuestions.apply(this, arguments);

  // If in force-fill mode, clear value checks
  if (forceFillMode) {
    console.log('[FORCE-FILL] Force-fill mode active - bypassing pre-filled value checks');
    questions.forEach(q => {
      if (q.element && q.element.value) {
        console.log(`[FORCE-FILL] Clearing pre-filled value from ${q.question_id}: "${q.element.value}"`);
        q.element.value = '';
      }
    });
  }

  return questions;
};

// ============================================================================
// PART 6: ADD FORCE-FILL BUTTON
// ============================================================================

/**
 * Adds a force-fill button next to the regular fill button
 */
function addForceFillButton() {
  // Remove existing button if present
  const existingBtn = document.getElementById('wildpoptart-force-btn');
  if (existingBtn) existingBtn.remove();

  const button = document.createElement('button');
  button.id = 'wildpoptart-force-btn';
  button.className = 'wildpoptart-floating-btn';
  button.innerHTML = '⚡ Force Fill';
  button.title = 'Force-fill questions (clears existing values)';
  button.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    z-index: 999999;
    padding: 12px 20px;
    background: #ff4444;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: all 0.2s;
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.05)';
    button.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  });

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.innerHTML = '⏳ Forcing...';

    try {
      forceFillMode = true;
      await forceFill();
    } finally {
      forceFillMode = false;
      button.disabled = false;
      button.innerHTML = '⚡ Force Fill';
    }
  });

  document.body.appendChild(button);
  console.log('[FORCE-FILL] Force-fill button added');
}

// ============================================================================
// PART 7: INITIALIZATION
// ============================================================================

// Add force-fill button when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addForceFillButton);
} else {
  addForceFillButton();
}

// Make forceFill available globally for console access
window.forceFill = forceFill;
window.clearStaleInputs = clearStaleInputs;
window.forceFillQuestion = forceFillQuestion;

console.log('');
console.log('='.repeat(80));
console.log('[FORCE-FILL] 🎯 Force-Fill Patch Loaded Successfully!');
console.log('[FORCE-FILL] Usage:');
console.log('  - Click "⚡ Force Fill" button (bottom-right)');
console.log('  - Or run: forceFill() in console');
console.log('  - To clear inputs only: clearStaleInputs()');
console.log('='.repeat(80));
console.log('');

// ============================================================================
// PART 8: TAMPERMONKEY WRAPPER (Optional)
// ============================================================================

/*
// To use as Tampermonkey script, wrap the above code with:

// ==UserScript==
// @name         Wildpoptart Force-Fill Patch
// @namespace    http://tampermonkey.net/
// @version      5.1.2
// @description  Force-fill survey questions even with pre-existing values
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Wait for Wildpoptart to load
    const waitForWildpoptart = setInterval(() => {
        if (typeof detectQuestions !== 'undefined' && typeof showNotification !== 'undefined') {
            clearInterval(waitForWildpoptart);

            // Inject all force-fill code here
            // (Copy PART 1-7 above)

            console.log('[TAMPERMONKEY] Wildpoptart Force-Fill Patch Injected!');
        }
    }, 500);
})();
*/
