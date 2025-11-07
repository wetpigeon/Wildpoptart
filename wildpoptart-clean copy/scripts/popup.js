// Wildpoptart Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  const apiKeyInput = document.getElementById('apiKey');
  const saveApiKeyBtn = document.getElementById('saveApiKey');
  const toggleApiKeyBtn = document.getElementById('toggleApiKey');
  const toggleExtensionBtn = document.getElementById('toggleExtension');
  const fillSurveyBtn = document.getElementById('fillSurvey');
  const resetPersonaBtn = document.getElementById('resetPersona');
  const exportDatabaseBtn = document.getElementById('exportDatabase');
  const debugSnapshotBtn = document.getElementById('debugSnapshot');
  const autoFillCheckbox = document.getElementById('autoFill');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const toggleIcon = document.getElementById('toggleIcon');
  const toggleText = document.getElementById('toggleText');
  const feedbackMessage = document.getElementById('feedbackMessage');
  const infoSection = document.getElementById('infoSection');
  const questionsCount = document.getElementById('questionsCount');
  const personaInfo = document.getElementById('personaInfo');

  let isActive = false;
  let hasApiKey = false;
  let autoFill = false;

  // Load saved settings
  await loadSettings();

  // Event listeners
  saveApiKeyBtn.addEventListener('click', saveApiKey);
  toggleApiKeyBtn.addEventListener('click', toggleApiKeyVisibility);
  toggleExtensionBtn.addEventListener('click', toggleExtension);
  fillSurveyBtn.addEventListener('click', fillSurvey);
  resetPersonaBtn.addEventListener('click', resetPersona);
  exportDatabaseBtn.addEventListener('click', exportDatabase);
  debugSnapshotBtn.addEventListener('click', captureDebugSnapshot);
  autoFillCheckbox.addEventListener('change', toggleAutoFill);

  // Load settings from storage
  async function loadSettings() {
    console.log('[POPUP] Loading settings...');
    const storage = await chrome.storage.local.get(['claudeApiKey', 'isActive', 'currentPersona', 'autoFill']);
    console.log('[POPUP] Storage contents:', storage);

    if (storage.claudeApiKey) {
      apiKeyInput.value = storage.claudeApiKey;
      hasApiKey = true;
      console.log('[POPUP] ✓ API key loaded, hasApiKey =', hasApiKey);
      showFeedback('API key loaded', 'success');
    } else {
      console.log('[POPUP] ✗ No API key in storage');
    }

    if (storage.isActive) {
      isActive = true;
      updateStatus(true);
      await loadSurveyInfo();
    }

    if (storage.currentPersona) {
      personaInfo.textContent = `${storage.currentPersona.age_range} - ${storage.currentPersona.demographics}`;
    }

    // Load auto-fill setting (enabled by default)
    autoFill = storage.autoFill !== undefined ? storage.autoFill : true;
    if (autoFillCheckbox) {
      autoFillCheckbox.checked = autoFill;
    }

    // Set autoFill to true by default if it's not already set
    if (storage.autoFill === undefined) {
      await chrome.storage.local.set({ autoFill: true });
    }
  }

  // Save API key
  async function saveApiKey() {
    const apiKey = apiKeyInput.value.trim();
    console.log('[POPUP] Saving API key, length:', apiKey.length);

    if (!apiKey) {
      showFeedback('Please enter an API key', 'error');
      console.error('[POPUP] Empty API key');
      return;
    }

    if (!apiKey.startsWith('sk-ant-')) {
      showFeedback('Invalid API key format', 'error');
      console.error('[POPUP] Invalid API key format, starts with:', apiKey.substring(0, 10));
      return;
    }

    await chrome.storage.local.set({ claudeApiKey: apiKey });
    hasApiKey = true;
    console.log('[POPUP] ✓ API key saved, hasApiKey =', hasApiKey);
    showFeedback('API key saved successfully!', 'success');
  }

  // Toggle API key visibility
  function toggleApiKeyVisibility() {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleApiKeyBtn.textContent = '🙈';
    } else {
      apiKeyInput.type = 'password';
      toggleApiKeyBtn.textContent = '👁️';
    }
  }

  // Toggle extension on/off
  async function toggleExtension() {
    console.log('[POPUP] toggleExtension called, hasApiKey:', hasApiKey);

    if (!hasApiKey) {
      showFeedback('Please save your API key first', 'error');
      console.error('[POPUP] No API key found!');
      return;
    }

    isActive = !isActive;
    console.log('[POPUP] Toggling to:', isActive);

    await chrome.storage.local.set({ isActive });

    // Send message to content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('[POPUP] Current tab:', tab?.url);

    if (!tab) {
      showFeedback('No active tab found', 'error');
      return;
    }

    if (tab) {
      console.log('[POPUP] Sending toggle message to tab:', tab.id);
      chrome.tabs.sendMessage(tab.id, { action: 'toggle', enabled: isActive }, (response) => {
        console.log('[POPUP] Response from content script:', response);
        console.log('[POPUP] Last error:', chrome.runtime.lastError);

        if (chrome.runtime.lastError) {
          showFeedback('Please refresh the page to use Wildpoptart', 'warning');
          console.error('[POPUP] Content script error:', chrome.runtime.lastError.message);
        } else {
          updateStatus(isActive);
          if (isActive) {
            loadSurveyInfo();
          }
        }
      });
    }
  }

  // Update status UI
  function updateStatus(active) {
    if (active) {
      statusDot.classList.add('active');
      statusText.textContent = 'Active';
      toggleIcon.textContent = '⏸️';
      toggleText.textContent = 'Deactivate';
      toggleExtensionBtn.classList.add('active');
      fillSurveyBtn.disabled = false;
      infoSection.style.display = 'block';
      showFeedback('Wildpoptart is now active on this page', 'success');
    } else {
      statusDot.classList.remove('active');
      statusText.textContent = 'Inactive';
      toggleIcon.textContent = '▶️';
      toggleText.textContent = 'Activate';
      toggleExtensionBtn.classList.remove('active');
      fillSurveyBtn.disabled = true;
      infoSection.style.display = 'none';
      showFeedback('Wildpoptart is now inactive', 'info');
    }
  }

  // Load survey info from content script
  async function loadSurveyInfo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
        if (response && response.questionsDetected !== undefined) {
          questionsCount.textContent = response.questionsDetected;
        }
      });
    }
  }

  // Fill survey
  async function fillSurvey() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      showFeedback('Filling survey...', 'info');

      chrome.tabs.sendMessage(tab.id, { action: 'fillSurvey' }, (response) => {
        if (chrome.runtime.lastError) {
          showFeedback('Error: ' + chrome.runtime.lastError.message, 'error');
        } else {
          showFeedback('Survey filling started!', 'success');
          setTimeout(loadSurveyInfo, 2000);
        }
      });
    }
  }

  // Reset persona
  async function resetPersona() {
    await chrome.storage.local.set({ currentPersona: null });
    personaInfo.textContent = 'None';
    showFeedback('Persona reset. Next survey will create a new persona.', 'success');
  }

  // Export database
  async function exportDatabase() {
    showFeedback('Exporting database...', 'info');

    const result = await chrome.storage.local.get(['wildpoptart_question_db']);
    const database = result.wildpoptart_question_db || [];

    if (database.length === 0) {
      showFeedback('Database is empty. Complete some surveys first!', 'warning');
      return;
    }

    const dataStr = JSON.stringify(database, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `wildpoptart_questions_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showFeedback(`✓ Exported ${database.length} questions!`, 'success');
  }

  // Capture debug snapshot
  async function captureDebugSnapshot() {
    try {
      showFeedback('Capturing debug snapshot...', 'info', 10000);

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        showFeedback('Error: No active tab found', 'error', 10000);
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'captureDebugSnapshot' }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message;
          console.error('[DEBUG SNAPSHOT] Error:', errorMsg);
          showFeedback('Error: ' + errorMsg + ' (Try refreshing the page)', 'error', 10000);
        } else if (response && response.success) {
          showFeedback('✓ Debug snapshot saved! Check your downloads.', 'success', 5000);
        } else if (response && response.error) {
          showFeedback('Error: ' + response.error, 'error', 10000);
        } else {
          showFeedback('Error: Unknown response from content script', 'error', 10000);
        }
      });
    } catch (error) {
      console.error('[DEBUG SNAPSHOT] Exception:', error);
      showFeedback('Exception: ' + error.message, 'error', 10000);
    }
  }

  // Toggle auto-fill
  async function toggleAutoFill() {
    autoFill = autoFillCheckbox.checked;
    await chrome.storage.local.set({ autoFill });

    // Send message to content script to update autoFillEnabled variable in real-time
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'updateAutoFill', enabled: autoFill }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('[AUTO-FILL] Could not update content script (page may need refresh)');
        }
      });
    }

    if (autoFill) {
      showFeedback('✨ AUTO-FILL ENABLED! Bot will automatically fill every page.', 'success');
    } else {
      showFeedback('Auto-fill disabled. Use 🍰 button to fill manually.', 'info');
    }
  }

  // Show feedback message
  function showFeedback(message, type = 'info', duration = 4000) {
    feedbackMessage.textContent = message;
    feedbackMessage.className = `feedback-message ${type}`;
    feedbackMessage.style.display = 'block';

    setTimeout(() => {
      feedbackMessage.style.display = 'none';
    }, duration);
  }
});
