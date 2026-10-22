/**
 * Meet Wingman AI - Side Panel Controller
 * Clean, lightweight, real-time meeting assistant.
 */

(function () {
  // Global safety error listeners to prevent uncaught runtime warnings
  window.addEventListener("unhandledrejection", (event) => {
    console.warn("[Meet Wingman AI] Handled promise rejection:", event.reason);
    if (event.preventDefault) event.preventDefault();
  });

  window.addEventListener("error", (event) => {
    console.warn("[Meet Wingman AI] Handled window error:", event.message);
  });

  // Configure PDF.js worker URL
  if (window.pdfjsLib && chrome.runtime && chrome.runtime.getURL) {
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.js");
    } catch (e) {}
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
  let lastCaptionReceivedTime = 0;

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

  // Helper to remove repeated boundary words when the same speaker continues talking
  function removeWordOverlap(prevText, nextText) {
    if (!prevText || !nextText) return nextText;
    const prevWords = prevText.trim().split(/\s+/);
    const nextWords = nextText.trim().split(/\s+/);
    const maxLen = Math.min(prevWords.length, nextWords.length, 4);

    for (let len = maxLen; len >= 1; len--) {
      const prevTail = prevWords.slice(-len).join(" ").toLowerCase().replace(/[.,!?;:]/g, "");
      const nextHead = nextWords.slice(0, len).join(" ").toLowerCase().replace(/[.,!?;:]/g, "");
      if (prevTail && prevTail === nextHead) {
        return nextWords.slice(len).join(" ");
      }
    }
    return nextText;
  }

  // Handle incoming caption turn from content.js
  function handleCaptionTurn(turn) {
    if (!turn || !turn.text) return;

    lastCaptionReceivedTime = Date.now();
    // We are actively receiving captions from Meet! Ensure status reflects connected
    updateMeetStatus({ hasTab: true, inCall: true, captionsEnabled: true });

    if (!turn.isFinal) {
      interimSpeakerName.textContent = turn.speaker || "Speaking...";
      interimText.textContent = turn.text;
      interimBubble.style.display = "flex";
      interimBubble.scrollTop = interimBubble.scrollHeight;
    } else {
      interimBubble.style.display = "none";
      interimText.textContent = "";

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

        // Clean any minor overlapping transition words
        const trimmed = removeWordOverlap(last.text, turn.text);
        if (trimmed && trimmed.length > 0) {
          turn.text = trimmed;
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

  // Meeting URL detector across Google Meet, Microsoft Teams, and Zoom
  function isMeetingUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return (
      u.includes("meet.google.com") ||
      u.includes("teams.microsoft.com") ||
      u.includes("teams.live.com") ||
      u.includes("zoom.us")
    );
  }

  // Detects if URL is an actual meeting call room (not just the homepage/landing screen)
  function isLiveMeetingCallUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (u.includes("meet.google.com")) {
      return (
        /[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(u) ||
        u.includes("/call/") ||
        u.includes("/lookup/") ||
        u.includes("/_meet/")
      );
    }
    if (u.includes("teams.microsoft.com") || u.includes("teams.live.com")) {
      return u.includes("calling") || u.includes("meetup-join");
    }
    if (u.includes("zoom.us")) {
      return u.includes("/wc/") || u.includes("/j/");
    }
    return false;
  }

  const MEETING_PATTERNS = [
    "*://meet.google.com/*",
    "*://teams.microsoft.com/*",
    "*://teams.live.com/*",
    "*://*.zoom.us/*",
  ];

  // Helper to find active call tab across Google Meet, Teams, or Zoom in any window
  function findMeetTab(callback) {
    if (!chrome.tabs || !chrome.tabs.query) {
      callback(null);
      return;
    }

    try {
      chrome.tabs.query({ url: MEETING_PATTERNS }, (matchedTabs) => {
        const _err = chrome.runtime.lastError;
        if (matchedTabs && matchedTabs.length > 0) {
          // Sort to prioritize:
          // 1. Live call room URLs that are active
          // 2. Live call room URLs (background tab or other window)
          // 3. Other meeting tabs that are active
          // 4. Other meeting tabs (e.g. landing page)
          matchedTabs.sort((a, b) => {
            const aCall = isLiveMeetingCallUrl(a.url);
            const bCall = isLiveMeetingCallUrl(b.url);
            if (aCall && !bCall) return -1;
            if (!aCall && bCall) return 1;
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            return 0;
          });
          callback(matchedTabs[0]);
          return;
        }

        // Fallback: search all open tabs across all windows
        chrome.tabs.query({}, (allTabs) => {
          const _err2 = chrome.runtime.lastError;
          const callTabs = (allTabs || []).filter((t) => t.url && isMeetingUrl(t.url));
          if (callTabs.length > 0) {
            callTabs.sort((a, b) => {
              const aCall = isLiveMeetingCallUrl(a.url);
              const bCall = isLiveMeetingCallUrl(b.url);
              if (aCall && !bCall) return -1;
              if (!aCall && bCall) return 1;
              if (a.active && !b.active) return -1;
              if (!a.active && b.active) return 1;
              return 0;
            });
            callback(callTabs[0]);
          } else {
            callback(null);
          }
        });
      });
    } catch (e) {
      callback(null);
    }
  }

  // Update Status Banner UI
  function updateMeetStatus(data) {
    if (!data) return;

    let pName = "Google Meet";
    if (data.platform === "teams" || (data.url && data.url.includes("teams"))) {
      pName = "Microsoft Teams";
    } else if (data.platform === "zoom" || (data.url && data.url.includes("zoom"))) {
      pName = "Zoom";
    }

    // Safety: If URL contains an active meeting code and not in pre-join, user is inside call
    if (data.url && isLiveMeetingCallUrl(data.url) && !data.inPreJoin) {
      data.inCall = true;
    }

    // If captions were received recently, they are definitely enabled
    if (lastCaptionReceivedTime && Date.now() - lastCaptionReceivedTime < 30000) {
      data.captionsEnabled = true;
    }

    // State 1: No meeting tab open in browser
    if (data.hasTab === false) {
      statusBanner.className = "status-bar status-idle";
      statusText.textContent = "Ready • Open Meet, Teams, or Zoom";
      btnFixCaptions.style.display = "none";
      return;
    }

    // State 2: Meeting tab open on pre-join screen ("Ready to join?")
    if (data.inPreJoin) {
      statusBanner.className = "status-bar status-waiting";
      statusText.textContent = `In ${pName} • Click 'Join' to start`;
      btnFixCaptions.style.display = "none";
      return;
    }

    // State 3: Meeting tab open on landing page or not inside call
    if (!data.inCall) {
      statusBanner.className = "status-bar status-waiting";
      statusText.textContent = `In ${pName} • Start or join a call`;
      btnFixCaptions.style.display = "none";
      return;
    }

    // State 4: In active call, but captions are OFF
    if (!data.captionsEnabled) {
      statusBanner.className = "status-bar status-captions-off";
      statusText.textContent = `Captions are OFF in ${pName}`;
      btnFixCaptions.style.display = "inline-block";
      return;
    }

    // State 5: In active call, captions are ON and streaming
    statusBanner.className = "status-bar status-connected";
    statusText.textContent = `Listening to ${pName} captions`;
    btnFixCaptions.style.display = "none";
  }

  // Prompt meeting to toggle captions
  async function toggleMeetCaptions() {
    findMeetTab((tab) => {
      if (tab && tab.id) {
        try {
          chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_MEET_CAPTIONS" }, (response) => {
            const _err = chrome.runtime.lastError;
            if (_err || !response) {
              showToast("Could not reach meeting tab");
              return;
            }
            if (response && response.captionsEnabled) {
              updateMeetStatus({ hasTab: true, inCall: true, captionsEnabled: true, platform: response.platform });
              showToast("Captions turned ON");
            }
          });
        } catch (e) {
          showToast("Could not reach meeting tab");
        }
      } else {
        showToast("Open your meeting call first (Meet, Teams, Zoom)");
      }
    });
  }

  // Insert question directly into in-call chat
  async function insertIntoMeetChat(questionText) {
    findMeetTab((tab) => {
      if (tab && tab.id) {
        try {
          chrome.tabs.sendMessage(tab.id, { type: "INSERT_MEET_CHAT", text: questionText }, (res) => {
            const _err = chrome.runtime.lastError;
            if (_err || !res || !res.success) {
              navigator.clipboard.writeText(questionText).catch(() => {});
              showToast("Copied to clipboard (Paste in chat)");
              return;
            }
            showToast("Pasted into meeting chat!");
          });
        } catch (e) {
          navigator.clipboard.writeText(questionText).catch(() => {});
          showToast("Copied to clipboard");
        }
      } else {
        navigator.clipboard.writeText(questionText).catch(() => {});
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
      let dialogueText = recentTurns.length > 0
        ? recentTurns.map((t) => `${t.speaker}: ${t.text}`).join("\n")
        : "";

      // Include active speech in progress if someone is talking right now
      if (interimBubble && interimBubble.style.display !== "none" && interimText.textContent.trim()) {
        const speakingNow = `${interimSpeakerName.textContent.trim() || "Speaking"}: ${interimText.textContent.trim()} [in progress]`;
        dialogueText = dialogueText ? `${dialogueText}\n${speakingNow}` : speakingNow;
      }

      if (!dialogueText) {
        dialogueText = "(No live captions captured yet. Provide kickoff questions based on the notes).";
      }

      const systemInstruction = `You are a real-time conversational wingman in a live meeting.
Your Role: ${personaDesc}
${config.customPrompt ? `User Guidance: ${config.customPrompt}` : ""}

Task:
Compare what is being discussed in the call against the meeting notes/goals.
Generate exactly 3 sharp, natural questions the user can immediately ask out loud:
1. Category "steer": Re-anchors the discussion to key goals or unblocks a decision.
2. Category "gap": Points out an unaddressed requirement, contradiction, or risk between the notes and what was said.
3. Category "deepen": A clarifying question that forces concrete technical depth or execution clarity.

Respond ONLY with valid JSON in this exact structure:
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
          maxOutputTokens: 4096,
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

      console.log("[Meet Wingman AI] Gemini raw output:", rawText);

      const questions = extractQuestionsSafely(rawText);
      if (!questions || questions.length === 0) {
        throw new Error("Could not parse question JSON");
      }

      renderSuggestions(questions);
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

  // Attempt to repair truncated JSON (unclosed quotes, braces, brackets) using a LIFO stack
  function tryRepairJson(str) {
    if (!str) return null;
    let s = str.trim();

    // Strip trailing commas before } or ]
    s = s.replace(/,\s*([\}\]])/g, "$1").replace(/,\s*([\}\]])/g, "$1");

    let inString = false;
    const stack = [];

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"' && (i === 0 || s[i - 1] !== '\\')) {
        inString = !inString;
      } else if (!inString) {
        if (ch === '{') {
          stack.push('}');
        } else if (ch === '[') {
          stack.push(']');
        } else if (ch === '}' || ch === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === ch) {
            stack.pop();
          }
        }
      }
    }

    if (inString) s += '"';

    // Strip trailing commas, colons, or incomplete properties before closing
    s = s.replace(/,\s*$/, "").replace(/:\s*$/, ':""');
    s = s.replace(/,\s*([\}\]])/g, "$1");

    // Close delimiters in exact reverse order (LIFO)
    while (stack.length > 0) {
      s += stack.pop();
    }

    s = s.replace(/,\s*([\}\]])/g, "$1");

    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  // Fallback regex extractor for questions in unstructured or cut-off responses
  function extractQuestionsRegex(text) {
    const list = [];
    if (!text) return list;

    // Pattern A: matches "question": "..."
    const qMatches = [...text.matchAll(/"question"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
    const tMatches = [...text.matchAll(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
    const cMatches = [...text.matchAll(/"category"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
    const rMatches = [...text.matchAll(/"rationale"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)];

    const defaultCats = ["steer", "gap", "deepen"];

    for (let i = 0; i < qMatches.length; i++) {
      const qText = qMatches[i][1].replace(/\\"/g, '"');
      const title = tMatches[i] ? tMatches[i][1].replace(/\\"/g, '"') : `Question ${i + 1}`;
      const cat = cMatches[i] ? cMatches[i][1].toLowerCase() : defaultCats[i % 3];
      const rationale = rMatches[i] ? rMatches[i][1].replace(/\\"/g, '"') : "Targets key conversation points.";

      list.push({
        category: cat,
        title: title,
        question: qText,
        rationale: rationale,
      });
    }

    return list;
  }

  // Resilient, multi-pass extractor for LLM question response
  function extractQuestionsSafely(rawText) {
    if (!rawText || typeof rawText !== "string") return null;

    // Helper: strip comments and trailing commas before } or ] which cause "Unexpected token }" or "]"
    const sanitizeJsonStr = (str) => {
      return str
        .replace(/,\s*([\}\]])/g, "$1")
        .replace(/,\s*([\}\]])/g, "$1")
        .replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "$1")
        .trim();
    };

    let parsed = null;

    // 1. Direct JSON parse (sanitized)
    try {
      parsed = JSON.parse(sanitizeJsonStr(rawText));
    } catch (e1) {
      // 2. Strip markdown fences (```json ... ```)
      const clean = sanitizeJsonStr(
        rawText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
      );

      try {
        parsed = JSON.parse(clean);
      } catch (e2) {
        // 3. Extract JSON object substring
        const objMatch = clean.match(/\{[\s\S]*\}/);
        if (objMatch) {
          const sObj = sanitizeJsonStr(objMatch[0]);
          try {
            parsed = JSON.parse(sObj);
          } catch (e3) {
            parsed = tryRepairJson(sObj);
          }
        }

        // 4. Extract JSON array substring if model returned [...] directly
        if (!parsed) {
          const arrMatch = clean.match(/\[[\s\S]*\]/);
          if (arrMatch) {
            const sArr = sanitizeJsonStr(arrMatch[0]);
            try {
              parsed = JSON.parse(sArr);
            } catch (e4) {
              parsed = tryRepairJson(sArr);
            }
          }
        }
      }
    }

    // Normalize parsed structure to a flat array of questions
    let list = null;
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.questions)) {
        list = parsed.questions;
      } else if (Array.isArray(parsed.suggestions)) {
        list = parsed.suggestions;
      } else if (Array.isArray(parsed.items)) {
        list = parsed.items;
      } else if (Array.isArray(parsed.data)) {
        list = parsed.data;
      } else {
        const vals = Object.values(parsed);
        if (vals.length > 0 && typeof vals[0] === "object" && (vals[0].question || vals[0].title)) {
          list = vals;
        }
      }
    }

    // 5. Fallback: If structured parsing failed, extract via Regex
    if (!list || list.length === 0) {
      list = extractQuestionsRegex(rawText);
    }

    if (!Array.isArray(list) || list.length === 0) {
      return null;
    }

    // Validate and clean each question item
    const validQuestions = list
      .filter((q) => q && (q.question || q.text || q.title))
      .map((q, idx) => {
        const defaultCats = ["steer", "gap", "deepen"];
        let cat = (q.category || defaultCats[idx % 3]).toLowerCase().trim();
        if (!["steer", "gap", "deepen"].includes(cat)) {
          if (cat.includes("steer") || cat.includes("goal") || cat.includes("re-anchor")) cat = "steer";
          else if (cat.includes("gap") || cat.includes("blind") || cat.includes("risk")) cat = "gap";
          else cat = "deepen";
        }

        return {
          category: cat,
          title: q.title || `Strategic Point ${idx + 1}`,
          question: q.question || q.text || q.title || "",
          rationale: q.rationale || q.reason || "Directly relevant to current live discussion.",
        };
      });

    return validQuestions.length > 0 ? validQuestions.slice(0, 3) : null;
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
        navigator.clipboard.writeText(text).catch(() => {});
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

    const persona = (personaSelect && personaSelect.selectedOptions && personaSelect.selectedOptions[0])
      ? personaSelect.selectedOptions[0].text
      : (config.persona || "Product Manager");
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
      showToast("Checking meeting status...");
      checkCurrentTabStatus();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "CAPTION_TURN") {
        handleCaptionTurn(message.data);
      } else if (message.type === "MEET_STATUS") {
        updateMeetStatus(message.data);
      }
    });

    let isInjectingScript = false;

    function checkCurrentTabStatus() {
      findMeetTab((tab) => {
        if (!tab || !tab.id) {
          updateMeetStatus({ hasTab: false, inCall: false, inPreJoin: false, captionsEnabled: false });
          return;
        }

        const isCallUrl = isLiveMeetingCallUrl(tab.url);

        try {
          chrome.tabs.sendMessage(tab.id, { type: "GET_MEET_STATUS" }, (response) => {
            const _err = chrome.runtime.lastError; // Read to suppress unchecked error!
            if (_err || !response) {
              // Reflect meeting status from tab URL immediately
              updateMeetStatus({
                hasTab: true,
                inCall: isCallUrl,
                inPreJoin: false,
                captionsEnabled: false,
                url: tab.url || "",
              });

              // Programmatically inject content.js once if tab was loaded before extension reload
              if (chrome.scripting && !isInjectingScript && tab.id) {
                isInjectingScript = true;
                chrome.scripting.executeScript(
                  {
                    target: { tabId: tab.id },
                    files: ["content.js"],
                  },
                  () => {
                    const _injErr = chrome.runtime.lastError; // Read to suppress unchecked error!
                    setTimeout(() => {
                      isInjectingScript = false;
                      chrome.tabs.sendMessage(tab.id, { type: "GET_MEET_STATUS" }, (res2) => {
                        const _msgErr = chrome.runtime.lastError; // Read to suppress unchecked error!
                        if (!_msgErr && res2) {
                          updateMeetStatus({ ...res2, hasTab: true });
                        }
                      });
                    }, 350);
                  }
                );
              }
              return;
            }

            updateMeetStatus({ ...response, hasTab: true });
          });
        } catch (err) {
          updateMeetStatus({
            hasTab: true,
            inCall: isCallUrl,
            inPreJoin: false,
            captionsEnabled: false,
            url: tab.url || "",
          });
        }
      });
    }

    checkCurrentTabStatus();

    // Periodic check every 3 seconds so status updates as soon as call begins
    setInterval(checkCurrentTabStatus, 3000);

    if (chrome.tabs && chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(() => {
        checkCurrentTabStatus();
      });
    }
    if (chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo && changeInfo.status === "complete") {
          checkCurrentTabStatus();
        }
      });
    }
    if (chrome.tabs && chrome.tabs.onRemoved) {
      chrome.tabs.onRemoved.addListener(() => {
        checkCurrentTabStatus();
      });
    }
  }

  // Init
  loadState()
    .then(() => {
      setupEventListeners();
    })
    .catch((err) => {
      console.warn("[Meet Wingman AI] Init error:", err);
    });
})();
