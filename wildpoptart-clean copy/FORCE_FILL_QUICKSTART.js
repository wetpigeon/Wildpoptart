// ============================================================================
// WILDPOPTART FORCE-FILL QUICKSTART
// Copy-paste this entire block into browser console (F12) for instant use
// ============================================================================

(async function() {
  console.log('🚀 Initializing Wildpoptart Force-Fill...');

  // Wait for Wildpoptart to load
  if (typeof detectQuestions === 'undefined') {
    console.error('❌ Wildpoptart not detected! Make sure the extension is active.');
    alert('Wildpoptart extension not found. Please activate it and refresh the page.');
    return;
  }

  // ===== CLEAR ALL STALE INPUTS =====
  function clearAll() {
    console.log('[FORCE] Clearing all stale inputs...');
    let cleared = 0;

    // Text/number inputs
    document.querySelectorAll('input[type="text"], input[type="number"], input[type="email"], textarea').forEach(inp => {
      if (inp.value && inp.value.trim()) {
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        cleared++;
      }
    });

    // Checkboxes/radios
    document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(inp => {
      if (inp.checked) {
        inp.checked = false;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        cleared++;
      }
    });

    // Selects
    document.querySelectorAll('select').forEach(sel => {
      if (sel.selectedIndex > 0) {
        sel.selectedIndex = 0;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        cleared++;
      }
    });

    console.log(`[FORCE] ✓ Cleared ${cleared} inputs`);
    return cleared;
  }

  // ===== FILL SINGLE QUESTION =====
  async function fillOne(q) {
    try {
      const type = q.question_type;
      const elements = q.elements || [];

      // Radio/Checkbox
      if ((type === 'radio' || type === 'checkbox') && elements.length > 0) {
        // Find first non-"None" option
        let target = elements.find(e => {
          const lbl = (e.nextElementSibling?.textContent || e.parentElement?.textContent || '').toLowerCase();
          return !/none|n\/a|skip|prefer not/i.test(lbl);
        }) || elements[0];

        target.checked = true;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.dispatchEvent(new Event('click', { bubbles: true }));
        console.log(`[FORCE] ✓ Filled ${q.question_id}`);
        return true;
      }

      // Select
      if (type === 'select' && q.element?.tagName === 'SELECT') {
        for (let i = 1; i < q.element.options.length; i++) {
          if (q.element.options[i].value) {
            q.element.selectedIndex = i;
            q.element.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`[FORCE] ✓ Filled ${q.question_id}`);
            return true;
          }
        }
      }

      // Text/Number
      if ((type === 'text' || type === 'number') && q.element) {
        q.element.value = type === 'number' ? '1' : 'Sample answer';
        q.element.dispatchEvent(new Event('input', { bubbles: true }));
        q.element.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[FORCE] ✓ Filled ${q.question_id}`);
        return true;
      }

      // Matrix
      if (q.isMatrix && q.rows?.length > 0) {
        q.rows.forEach(row => {
          if (row.elements?.[0]) {
            row.elements[0].checked = true;
            row.elements[0].dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        console.log(`[FORCE] ✓ Filled matrix ${q.question_id}`);
        return true;
      }

      return false;
    } catch (err) {
      console.error(`[FORCE] ❌ Error filling ${q.question_id}:`, err);
      return false;
    }
  }

  // ===== MAIN FORCE-FILL =====
  async function go() {
    console.log('\n' + '='.repeat(60));
    console.log('⚡ FORCE-FILL STARTING');
    console.log('='.repeat(60) + '\n');

    // Step 1: Clear
    const cleared = clearAll();

    // Step 2: Detect
    console.log('[FORCE] Detecting questions...');
    const questions = await detectQuestions();

    if (!questions || questions.length === 0) {
      console.warn('[FORCE] ⚠️ No questions found');
      alert('No questions detected');
      return;
    }

    console.log(`[FORCE] Found ${questions.length} question(s)\n`);

    // Step 3: Fill
    let filled = 0;
    for (const q of questions) {
      if (await fillOne(q)) filled++;
      await new Promise(r => setTimeout(r, 300)); // 300ms delay
    }

    // Step 4: Report
    console.log('\n' + '='.repeat(60));
    console.log(`✅ FORCE-FILL COMPLETE`);
    console.log(`   Cleared: ${cleared} inputs`);
    console.log(`   Filled: ${filled}/${questions.length} questions`);
    console.log('='.repeat(60) + '\n');

    alert(`Force-fill complete!\nFilled ${filled}/${questions.length} questions`);
  }

  // ===== ADD BUTTON =====
  function addBtn() {
    if (document.getElementById('force-btn-quick')) return;

    const btn = document.createElement('button');
    btn.id = 'force-btn-quick';
    btn.innerHTML = '⚡ Force Fill';
    btn.style.cssText = `
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
    `;

    btn.onclick = async () => {
      btn.disabled = true;
      btn.innerHTML = '⏳ Working...';
      await go();
      btn.disabled = false;
      btn.innerHTML = '⚡ Force Fill';
    };

    document.body.appendChild(btn);
    console.log('[FORCE] Button added (bottom-right corner)');
  }

  // Initialize
  addBtn();
  window.forceFill = go;
  window.clearAllInputs = clearAll;

  console.log('\n✅ Force-Fill Ready!');
  console.log('   • Click "⚡ Force Fill" button (bottom-right)');
  console.log('   • Or run: forceFill() in console\n');

})();
