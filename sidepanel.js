/**
 * Meet Wingman AI - Side Panel Controller
 * Clean, lightweight, real-time meeting assistant.
 */

(function () {
  // Configure PDF.js worker URL
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.js");
  }

  // DOM Elements
  const statusBanner = document.getElementById("status-banner");
  const statusText = document.getElementById("status-text");
  const btnFixCaptions = document.getElementById("btn-fix-captions");
  const apiKeyAlert = document.getElementById("api-key-alert");
  const btnAlertSetup = document.getElementById("btn-alert-setup");

  const btnOpenSettings = document.getElementById("btn-open-settings");
  const btnCloseSettings = document.getElementById("btn-close-settings");
  const settingsModal = document.getElementById("settings-modal");
  const btnSaveSettings = document.getElementById("btn-save-settings");
  const btnTestApi = document.getElementById("btn-test-api");

  const settingApiKey = document.getElementById("setting-api-key");
  const settingModel = document.getElementById("setting-model");
  const settingCustomModel = document.getElementById("setting-custom-model");
  const settingBufferSize = document.getElementById("setting-buffer-size");
  const settingCustomPrompt = document.getElementById("setting-custom-prompt");

  const btnGenerateQuestions = document.getElementById("btn-generate-questions");
  const generateBtnText = document.getElementById("generate-btn-text");
  const generateSpinner = document.getElementById("generate-spinner");
  const toggleAutopilot = document.getElementById("toggle-autopilot");

  const dropZone = document.getElementById("drop-zone");
  const dropZoneContent = document.getElementById("drop-zone-content");
  const loadedFileBar = document.getElementById("loaded-file-bar");
  const loadedFileName = document.getElementById("loaded-file-name");
  const loadedFileInfo = document.getElementById("loaded-file-info");
  const btnRemoveFile = document.getElementById("btn-remove-file");
  const btnToggleNotes = document.getElementById("btn-toggle-notes");
  const notesToggleText = document.getElementById("notes-toggle-text");
  const contextWordsBadge = document.getElementById("context-words-badge");
  const contextFileInput = document.getElementById("context-file-input");
  const contextTextarea = document.getElementById("context-textarea");
  const personaSelect = document.getElementById("persona-select");
  const btnClearContext = document.getElementById("btn-clear-context");

  const bufferBadge = document.getElementById("buffer-badge");
  const transcriptFeed = document.getElementById("transcript-feed");
  const emptyTranscript = document.getElementById("empty-transcript");
  const interimBubble = document.getElementById("interim-bubble");
  const interimSpeakerName = document.getElementById("interim-speaker-name");
  const interimText = document.getElementById("interim-text");
  const btnClearTranscript = document.getElementById("btn-clear-transcript");
  const btnExportTranscript = document.getElementById("btn-export-transcript");

  const suggestionsList = document.getElementById("suggestions-list");
  const emptySuggestions = document.getElementById("empty-suggestions");
  const toast = document.getElementById("toast");

  // State
  let config = {
    apiKey: "",
    model: "gemini-3.8-flash",
    bufferSize: 25,
    customPrompt: "",
    persona: "product-manager",
    autopilot: false,
    contextText: "",
    docFileName: "",
  };

  let transcript = []; // Array of { id, speaker, text, timestamp }
  let turnsSinceLastGen = 0;
  let isGenerating = false;

  // Toast notification
  function showToast(message) {
    toast.textContent = message;
    toast.style.display = "block";
    setTimeout(() => {
      toast.style.display = "none";
    }, 2200);
  }

  // Format timestamp (e.g. 10:42 AM)
  function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Set document context and update UI
  function setDocumentContext(fileName, text) {
    config.docFileName = fileName || "";
    config.contextText = text || "";
    contextTextarea.value = text || "";

    const wordCount = (text || "").split(/\s+/).filter(Boolean).length;
    contextWordsBadge.textContent = `${wordCount.toLocaleString()} words loaded`;

    if (fileName) {
      loadedFileName.textContent = fileName;
      loadedFileInfo.textContent = `(~${wordCount.toLocaleString()} words)`;
      loadedFileBar.style.display = "flex";
      dropZoneContent.style.display = "none";
    } else {
      loadedFileBar.style.display = "none";
      dropZoneContent.style.display = "flex";
    }

    chrome.storage.local.set({
      docFileName: config.docFileName,
      contextText: config.contextText,
    });
  }

  // Clear document context
  function clearDocumentContext() {
    config.docFileName = "";
    config.contextText = "";
    contextTextarea.value = "";
    contextWordsBadge.textContent = "0 words loaded";
    contextFileInput.value = "";

    loadedFileBar.style.display = "none";
    dropZoneContent.style.display = "flex";

    chrome.storage.local.remove(["docFileName", "contextText"]);
    showToast("Document context cleared");
  }

  // Parse uploaded PDF, DOCX, TXT, MD, CSV, or JSON client-side
  async function parseUploadedFile(file) {
    if (!file) return;

    showToast(`Reading ${file.name}...`);
    let extractedText = "";

    try {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith(".doc") && !lowerName.endsWith(".docx")) {
        throw new Error("Legacy .doc format is not supported. Please save or convert as .docx or .pdf.");
      }

      if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
        if (window.pdfjsLib) {
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          let fullText = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map((it) => it.str).join(" ");
            fullText += `[Page ${i}]\n${pageText}\n\n`;
          }
          extractedText = fullText.trim();
        } else {
          throw new Error("PDF parser library not loaded");
        }
      } else if (lowerName.endsWith(".docx") || file.type.includes("wordprocessingml")) {
        if (window.mammoth) {
          const arrayBuffer = await file.arrayBuffer();
          const res = await window.mammoth.extractRawText({ arrayBuffer });
          extractedText = (res.value || "").trim();
        } else {
          throw new Error("Word doc parser library not loaded");
        }
      } else {
        // Text based (.txt, .md, .json, .csv)
        extractedText = (await file.text()).trim();
      }

      if (!extractedText) {
        showToast("No readable text found in document");
        return;
      }

      setDocumentContext(file.name, extractedText);
      showToast(`Loaded ${file.name}`);
    } catch (err) {
      console.error("[Meet Wingman AI] File error:", err);
      showToast(`Error reading file: ${err.message}`);
    }
  }

  // Initialize and load saved state from chrome.storage
  async function loadState() {
    try {
      const data = await chrome.storage.local.get([
        "apiKey",
        "model",
        "bufferSize",
        "customPrompt",
        "persona",
        "autopilot",
        "contextText",
        "docFileName",
        "savedTranscript"
      ]);

      if (data.apiKey) config.apiKey = data.apiKey;
      if (data.model) config.model = data.model;
      if (data.bufferSize) config.bufferSize = parseInt(data.bufferSize, 10);
      if (data.customPrompt) config.customPrompt = data.customPrompt;
      if (data.persona) config.persona = data.persona;
      if (data.autopilot !== undefined) config.autopilot = data.autopilot;

      // Restore document context if previously saved
      if (data.docFileName && data.contextText) {
        setDocumentContext(data.docFileName, data.contextText);
      } else if (data.contextText) {
        setDocumentContext("", data.contextText);
        contextTextarea.style.display = "block";
        notesToggleText.textContent = "− Hide manual notes";
      }

      // Populate UI fields
      settingApiKey.value = config.apiKey || "";
      const knownModelValues = ["gemini-3.8-flash", "gemini-3.8-pro", "gemini-3-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
      const currentModel = config.model || "gemini-3.8-flash";
      if (knownModelValues.includes(currentModel)) {
        settingModel.value = currentModel;
        settingCustomModel.style.display = "none";
      } else {
        settingModel.value = "custom";
        settingCustomModel.value = currentModel;
        settingCustomModel.style.display = "block";
      }

      settingBufferSize.value = config.bufferSize.toString();
      settingCustomPrompt.value = config.customPrompt || "";
      personaSelect.value = config.persona || "product-manager";
      toggleAutopilot.checked = config.autopilot || false;

      // Show API key alert if not configured
      if (!config.apiKey) {
        apiKeyAlert.style.display = "flex";
      } else {
        apiKeyAlert.style.display = "none";
      }

      // Restore saved transcript, purging any old demo data
      if (Array.isArray(data.savedTranscript)) {
        const isDemo = data.savedTranscript.some(t => t.speaker && t.speaker.includes("(Product)"));
        if (!isDemo) {
          transcript = data.savedTranscript;
          renderTranscript();
        } else {
          transcript = [];
          chrome.storage.local.remove("savedTranscript");
          renderTranscript();
        }
      }
    } catch (e) {
      console.warn("[Meet Wingman AI] Error loading storage:", e);
    }
  }

  // Save current settings to chrome.storage
  async function saveSettings() {
    config.apiKey = settingApiKey.value.trim();
    if (settingModel.value === "custom") {
      config.model = settingCustomModel.value.trim() || "gemini-3.8-flash";
    } else {
      config.model = settingModel.value;
    }
    config.bufferSize = parseInt(settingBufferSize.value, 10) || 25;
    config.customPrompt = settingCustomPrompt.value.trim();

    await chrome.storage.local.set({
      apiKey: config.apiKey,
      model: config.model,
      bufferSize: config.bufferSize,
      customPrompt: config.customPrompt,
    });

    if (config.apiKey) {
      apiKeyAlert.style.display = "none";
    }

    settingsModal.style.display = "none";
    showToast("Settings saved");
  }

  // Render live captions transcript feed
  function renderTranscript() {
    if (transcript.length > config.bufferSize) {
      transcript = transcript.slice(transcript.length - config.bufferSize);
    }

    bufferBadge.textContent = `${transcript.length} lines`;

    if (transcript.length === 0) {
      emptyTranscript.style.display = "block";
      Array.from(transcriptFeed.children).forEach((child) => {
        if (child.id !== "empty-transcript") child.remove();
      });
      return;
    }

    emptyTranscript.style.display = "none";

    const fragment = document.createDocumentFragment();
    transcript.forEach((item) => {
      const div = document.createElement("div");
      div.className = "t-item";
      div.innerHTML = `
        <span class="t-speaker">${escapeHtml(item.speaker)}:</span> 
        <span class="t-text">${escapeHtml(item.text)}</span>
        <span class="t-time">${formatTime(item.timestamp)}</span>
      `;
      fragment.appendChild(div);
    });

    Array.from(transcriptFeed.children).forEach((child) => {
      if (child.id !== "empty-transcript") child.remove();
    });
    transcriptFeed.appendChild(fragment);

    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
    chrome.storage.local.set({ savedTranscript: transcript });
  }

  // Handle incoming caption turn from content.js
  function handleCaptionTurn(turn) {
    if (!turn || !turn.text) return;

    // We are actively receiving captions from Meet! Ensure status reflects connected
    updateMeetStatus({ inCall: true, captionsEnabled: true });

    if (!turn.isFinal) {
      interimSpeakerName.textContent = turn.speaker || "Speaking...";
      interimText.textContent = turn.text;
      interimBubble.style.display = "block";
    } else {
      interimBubble.style.display = "none";

      const last = transcript[transcript.length - 1];
      if (last && last.speaker.toLowerCase() === turn.speaker.toLowerCase()) {
        const lastLower = last.text.toLowerCase().trim();
        const turnLower = turn.text.toLowerCase().trim();

        // Exact duplicate -> skip
        if (lastLower === turnLower) {
          return;
        }

        // If new turn expands on the previous sentence (e.g. continuous speaking) -> update in place
        if (turnLower.startsWith(lastLower) || turnLower.includes(lastLower)) {
          last.text = turn.text;
          last.timestamp = turn.timestamp || Date.now();
          renderTranscript();
          return;
        }

        // If last turn already has this text -> skip
        if (lastLower.startsWith(turnLower)) {
          return;
        }
      }

      transcript.push({
        id: "t_" + Date.now(),
        speaker: turn.speaker || "You",
        text: turn.text,
        timestamp: turn.timestamp || Date.now(),
      });

      renderTranscript();
      turnsSinceLastGen++;

      if (config.autopilot && turnsSinceLastGen >= 5 && !isGenerating && config.apiKey) {
        generateStrategicQuestions();
      }
    }
  }

  // Helper to find Google Meet tab across active window or any open window
  function findMeetTab(callback) {
    // 1. Check if active tab in current window is Meet
    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      const activeTab = activeTabs && activeTabs[0];
      if (activeTab && activeTab.url && activeTab.url.includes("meet.google.com")) {
        callback(activeTab);
        return;
      }

      // 2. Search all open Google Meet tabs across any window
      chrome.tabs.query({ url: "*://meet.google.com/*" }, (meetTabs) => {
        if (meetTabs && meetTabs.length > 0) {
          // Prefer one with an active meeting code (e.g. abc-defg-hij)
          const inCallTab = meetTabs.find((t) => t.url && /[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(t.url)) || meetTabs[0];
          callback(inCallTab);
        } else {
          callback(null);
        }
      });
    });
  }

  // Update Status Banner UI
  function updateMeetStatus(data) {
    if (!data) return;

    if (!data.inCall) {
      statusBanner.className = "status-bar status-waiting";
      statusText.textContent = "Google Meet not active (Click to refresh)";
      btnFixCaptions.style.display = "none";
    } else if (!data.captionsEnabled) {
      statusBanner.className = "status-bar status-captions-off";
      statusText.textContent = "Captions are OFF in Meet";
      btnFixCaptions.style.display = "inline-block";
    } else {
      statusBanner.className = "status-bar status-connected";
      statusText.textContent = "Listening to Meet captions";
      btnFixCaptions.style.display = "none";
    }
  }

  // Prompt Google Meet to toggle captions
  async function toggleMeetCaptions() {
    findMeetTab((tab) => {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_MEET_CAPTIONS" }, (response) => {
          if (chrome.runtime.lastError) return;
          if (response && response.captionsEnabled) {
            updateMeetStatus({ inCall: true, captionsEnabled: true });
            showToast("Captions turned ON");
          }
        });
      } else {
        showToast("Open Google Meet call first");
      }
    });
  }

  // Insert question directly into Google Meet's chat
  async function insertIntoMeetChat(questionText) {
    findMeetTab((tab) => {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "INSERT_MEET_CHAT", text: questionText }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            navigator.clipboard.writeText(questionText);
            showToast("Copied to clipboard (Open Meet chat to paste)");
            return;
          }
          showToast("Sent to Meet chat");
        });
      } else {
        navigator.clipboard.writeText(questionText);
        showToast("Copied to clipboard");
      }
    });
  }

  /**
   * Gemini API: Blends User Notes + Live Captions into 3 Strategic Questions
   */
  async function generateStrategicQuestions() {
    if (isGenerating) return;

    if (!config.apiKey) {
      apiKeyAlert.style.display = "flex";
      settingsModal.style.display = "flex";
      showToast("Please enter Gemini API key");
      return;
    }

    const notesText = contextTextarea.value.trim();
    if (transcript.length === 0 && !notesText) {
      showToast("Add some meeting notes or wait for captions first");
      return;
    }

    isGenerating = true;
    generateBtnText.textContent = "Analyzing...";
    generateSpinner.style.display = "inline-block";
    btnGenerateQuestions.disabled = true;

    try {
      const personaTitles = {
        "product-manager": "Senior Product Manager focused on user value, scope, and deadlines.",
        "tech-lead": "Principal Tech Lead focused on architecture, scalability, and technical risks.",
        "engineering-manager": "Engineering Manager focused on team execution and blocker removal.",
        "sales-executive": "Client Lead focused on uncovering customer needs and criteria.",
        "executive": "VP/Executive focused on high-level ROI, budget, and business milestones."
      };

      const personaDesc = personaTitles[config.persona] || personaTitles["product-manager"];
      const referenceNotes = notesText || "No written agenda provided. Focus on steering spoken discussion effectively.";

      const recentTurns = transcript.slice(-config.bufferSize);
      const dialogueText = recentTurns.length > 0
        ? recentTurns.map(t => `${t.speaker}: ${t.text}`).join("\n")
        : "(No live captions captured yet. Provide kickoff questions based on the notes).";

      const systemInstruction = `You are a real-time conversational wingman in a live meeting.
Your Role: ${personaDesc}
${config.customPrompt ? `User Guidance: ${config.customPrompt}` : ""}

Task:
Compare what is being discussed in the call against the meeting notes/goals.
Generate exactly 3 sharp, natural questions the user can immediately ask out loud:
1. Category "steer": Re-anchors the discussion to key goals or unblocks a decision.
2. Category "gap": Points out an unaddressed requirement, contradiction, or risk between the notes and what was said.
3. Category "deepen": A clarifying question that forces concrete technical depth or execution clarity.

Respond ONLY with valid JSON in this structure:
{
  "questions": [
    {
      "category": "steer",
      "title": "Short title (2-4 words)",
      "question": "The exact sentence to ask",
      "rationale": "Brief 1-sentence reason why to ask this now"
    },
    {
      "category": "gap",
      "title": "Short title (2-4 words)",
      "question": "The exact sentence to ask",
      "rationale": "Brief 1-sentence reason why to ask this now"
    },
    {
      "category": "deepen",
      "title": "Short title (2-4 words)",
      "question": "The exact sentence to ask",
      "rationale": "Brief 1-sentence reason why to ask this now"
    }
  ]
}`;

      const docHeader = config.docFileName
        ? `### REFERENCE DOCUMENT (${config.docFileName}):`
        : `### REFERENCE NOTES / GOALS:`;

      const userContent = `${docHeader}
${referenceNotes}

### LIVE MEETING DIALOGUE:
${dialogueText}`;

      const model = config.model || "gemini-3.8-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: systemInstruction + "\n\n" + userContent }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.35,
          maxOutputTokens: 1024,
        }
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const responseData = await response.json();
      const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("Empty response from model");

      let parsed = parseJsonSafely(rawText);
      if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        throw new Error("Could not parse question JSON");
      }

      renderSuggestions(parsed.questions);
      turnsSinceLastGen = 0;
      showToast("3 questions ready");
    } catch (err) {
      console.error("[Meet Wingman AI]", err);
      showToast(`Error: ${err.message}`);
    } finally {
      isGenerating = false;
      generateBtnText.textContent = "Generate Questions";
      generateSpinner.style.display = "none";
      btnGenerateQuestions.disabled = false;
    }
  }

  // Safe JSON extraction from LLM response
  function parseJsonSafely(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      try {
        return JSON.parse(clean);
      } catch (e2) {
        const match = clean.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
      }
    }
    return null;
  }

  // Render suggestion boxes
  function renderSuggestions(questions) {
    emptySuggestions.style.display = "none";

    Array.from(suggestionsList.children).forEach((child) => {
      if (child.id !== "empty-suggestions") child.remove();
    });

    const categoryLabels = {
      steer: { label: "Steer", class: "tag-steer" },
      gap: { label: "Blindspot", class: "tag-gap" },
      deepen: { label: "Deepen", class: "tag-deepen" },
    };

    const fragment = document.createDocumentFragment();

    questions.forEach((q) => {
      const meta = categoryLabels[q.category] || categoryLabels.steer;
      const box = document.createElement("div");
      box.className = "question-box";

      box.innerHTML = `
        <div class="question-box-top">
          <span class="q-tag ${meta.class}">${meta.label}: ${escapeHtml(q.title || "")}</span>
        </div>
        <div class="q-text">"${escapeHtml(q.question)}"</div>
        <div class="q-rationale">${escapeHtml(q.rationale || "")}</div>
        <div class="q-actions">
          <button class="btn-q-action btn-copy-q" data-question="${escapeHtml(q.question)}">Copy</button>
          <button class="btn-q-action btn-chat-q" data-question="${escapeHtml(q.question)}">Send to Chat</button>
        </div>
      `;

      fragment.appendChild(box);
    });

    suggestionsList.appendChild(fragment);

    suggestionsList.querySelectorAll(".btn-copy-q").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-question");
        navigator.clipboard.writeText(text);
        btn.classList.add("copied");
        btn.textContent = "Copied!";
        showToast("Copied to clipboard");
        setTimeout(() => {
          btn.classList.remove("copied");
          btn.textContent = "Copy";
        }, 2000);
      });
    });

    suggestionsList.querySelectorAll(".btn-chat-q").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-question");
        insertIntoMeetChat(text);
      });
    });
  }

  // Export Transcript & Notes to Markdown file
  function exportTranscript() {
    if (transcript.length === 0) {
      showToast("Transcript is empty");
      return;
    }

    const persona = personaSelect.options[personaSelect.selectedIndex].text;
    const dateStr = new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");

    let md = `# Meeting Notes - ${dateStr}\n\n`;
    md += `**Persona:** ${persona}\n\n`;

    if (contextTextarea.value.trim()) {
      md += `## Meeting Context\n\n${contextTextarea.value.trim()}\n\n`;
    }

    md += `## Transcript\n\n`;
    transcript.forEach((t) => {
      md += `* **[${formatTime(t.timestamp)}] ${t.speaker}:** ${t.text}\n`;
    });

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-transcript-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Downloaded transcript markdown");
  }

  // Test Gemini API Key
  async function testApiKey() {
    const key = settingApiKey.value.trim();
    if (!key) {
      showToast("Enter an API key to test");
      return;
    }

    btnTestApi.textContent = "Testing...";
    btnTestApi.disabled = true;

    try {
      const model = settingModel.value === "custom"
        ? (settingCustomModel.value.trim() || "gemini-3.8-flash")
        : (settingModel.value || "gemini-3.8-flash");

      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const res = await fetch(testUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Respond with SUCCESS" }] }]
        }),
      });

      if (res.ok) {
        showToast("Connected successfully!");
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Error: ${err.error?.message || res.statusText}`);
      }
    } catch (e) {
      showToast(`Network Error: ${e.message}`);
    } finally {
      btnTestApi.textContent = "Test Connection";
      btnTestApi.disabled = false;
    }
  }

  // Event Listeners setup
  function setupEventListeners() {
    // Drop zone click triggers file picker
    dropZone.addEventListener("click", (e) => {
      if (e.target.closest("#btn-remove-file")) return;
      contextFileInput.click();
    });

    // Drag and drop handlers
    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove("dragover");
      });
    });

    dropZone.addEventListener("drop", (e) => {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        parseUploadedFile(files[0]);
      }
    });

    // File input selection
    contextFileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        parseUploadedFile(file);
      }
    });

    // Remove document button
    btnRemoveFile.addEventListener("click", (e) => {
      e.stopPropagation();
      clearDocumentContext();
    });

    // Toggle manual notes
    btnToggleNotes.addEventListener("click", () => {
      const isHidden = contextTextarea.style.display === "none";
      if (isHidden) {
        contextTextarea.style.display = "block";
        notesToggleText.textContent = "− Hide manual notes";
        contextTextarea.focus();
      } else {
        contextTextarea.style.display = "none";
        notesToggleText.textContent = "+ Type or paste manual notes";
      }
    });

    // Manual notes input
    contextTextarea.addEventListener("input", () => {
      config.contextText = contextTextarea.value;
      const wordCount = (contextTextarea.value || "").split(/\s+/).filter(Boolean).length;
      contextWordsBadge.textContent = `${wordCount.toLocaleString()} words loaded`;
      chrome.storage.local.set({ contextText: config.contextText });
    });

    // Clear context button
    btnClearContext.addEventListener("click", () => {
      clearDocumentContext();
    });

    personaSelect.addEventListener("change", (e) => {
      config.persona = e.target.value;
      chrome.storage.local.set({ persona: config.persona });
    });

    toggleAutopilot.addEventListener("change", (e) => {
      config.autopilot = e.target.checked;
      chrome.storage.local.set({ autopilot: config.autopilot });
      showToast(config.autopilot ? "Auto-suggest enabled" : "Auto-suggest disabled");
    });

    btnClearTranscript.addEventListener("click", () => {
      transcript = [];
      chrome.storage.local.remove("savedTranscript");
      renderTranscript();
      showToast("Transcript cleared");
    });

    btnExportTranscript.addEventListener("click", exportTranscript);
    btnGenerateQuestions.addEventListener("click", generateStrategicQuestions);

    btnOpenSettings.addEventListener("click", () => {
      settingsModal.style.display = "flex";
    });

    btnCloseSettings.addEventListener("click", () => {
      settingsModal.style.display = "none";
    });

    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = "none";
      }
    });

    btnAlertSetup.addEventListener("click", () => {
      settingsModal.style.display = "flex";
    });

    btnSaveSettings.addEventListener("click", saveSettings);
    btnTestApi.addEventListener("click", testApiKey);

    settingModel.addEventListener("change", (e) => {
      if (e.target.value === "custom") {
        settingCustomModel.style.display = "block";
        settingCustomModel.focus();
      } else {
        settingCustomModel.style.display = "none";
      }
    });

    btnFixCaptions.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMeetCaptions();
    });

    statusBanner.addEventListener("click", () => {
      showToast("Checking Google Meet status...");
      checkCurrentTabStatus();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "CAPTION_TURN") {
        handleCaptionTurn(message.data);
      } else if (message.type === "MEET_STATUS") {
        updateMeetStatus(message.data);
      }
    });

    function checkCurrentTabStatus() {
      findMeetTab((tab) => {
        if (!tab || !tab.id) {
          updateMeetStatus({ inCall: false, captionsEnabled: false });
          return;
        }

        chrome.tabs.sendMessage(tab.id, { type: "GET_MEET_STATUS" }, (response) => {
          if (chrome.runtime.lastError || !response) {
            // Content script was not active on this tab (e.g. page was loaded before extension reload)
            // Programmatically inject content.js!
            if (chrome.scripting) {
              chrome.scripting.executeScript(
                {
                  target: { tabId: tab.id },
                  files: ["content.js"],
                },
                () => {
                  setTimeout(() => {
                    chrome.tabs.sendMessage(tab.id, { type: "GET_MEET_STATUS" }, (res2) => {
                      if (res2) {
                        updateMeetStatus(res2);
                      } else {
                        updateMeetStatus({ inCall: false, captionsEnabled: false });
                      }
                    });
                  }, 350);
                }
              );
            } else {
              updateMeetStatus({ inCall: false, captionsEnabled: false });
            }
            return;
          }

          updateMeetStatus(response);
        });
      });
    }

    checkCurrentTabStatus();

    // Periodic check every 3 seconds so status updates as soon as call begins
    setInterval(checkCurrentTabStatus, 3000);

    if (chrome.tabs && chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(checkCurrentTabStatus);
    }
    if (chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === "complete") {
          checkCurrentTabStatus();
        }
      });
    }
  }

  // Init
  loadState().then(setupEventListeners);
})();
