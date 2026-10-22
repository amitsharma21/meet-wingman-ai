/**
 * Meet Wingman AI - Content Script
 * Scrapes Google Meet closed captions in real time using MutationObserver.
 * Supports modern semantic attributes, text classes, and debounced turns.
 */

(function () {
  console.log("[Meet Wingman AI] Content script loaded on:", window.location.href);

  let observer = null;
  let finalizeTimer = null;
  let statusCheckInterval = null;

  let currentTurn = {
    speaker: "",
    text: "",
    lastSeen: 0,
    isFinal: false,
  };

  let lastFinalizedPrefix = "";
  let activeTurnStartTime = 0;
  const FINALIZE_DELAY_MS = 1500;
  const MAX_CONTINUOUS_SPEECH_MS = 10000; // 10s continuous speech before sentence chunking
  const MIN_SENTENCE_CHUNK_LEN = 90; // ~15 words minimum before sentence boundary split

  // System notification phrases to ignore
  const SYSTEM_ANNOUNCEMENTS = [
    /camera is (on|off)/i,
    /microphone is (on|off)/i,
    /captions (are|turned) (on|off)/i,
    /live captions are (on|off)/i,
    /joined the meeting/i,
    /left the meeting/i,
    /you're presenting/i,
    /to avoid echo/i,
  ];

  function isSystemAnnouncement(text) {
    if (!text) return true;
    const clean = text.trim();
    if (clean.length < 2) return true;
    return SYSTEM_ANNOUNCEMENTS.some((rx) => rx.test(clean));
  }

  /**
   * Checks if element is part of UI controls (buttons, menus, dialogs)
   */
  function isExcludedElement(el) {
    if (!el) return true;
    if (
      el.closest(
        "button, [role='dialog'], [role='menu'], [role='menubar'], [role='toolbar'], [data-tooltip], [data-panel-id]"
      )
    ) {
      return true;
    }

    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return true;
      // Google Meet closed captions are displayed in the lower portion of the viewport
      if (rect.bottom < window.innerHeight * 0.25) return true;
    } catch (e) {
      // ignore
    }
    return false;
  }

  /**
   * Detect current meeting platform (Google Meet, Microsoft Teams, or Zoom)
   */
  function detectPlatform() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes("teams.microsoft.com") || host.includes("teams.live.com")) {
      return "teams";
    }
    if (host.includes("zoom.us")) {
      return "zoom";
    }
    return "meet";
  }

  const PLATFORM = detectPlatform();

  /**
   * Checks if user is inside an active meeting call or in pre-join screen
   */
  function checkCallStatus() {
    const pathname = window.location.pathname.toLowerCase();
    const href = window.location.href.toLowerCase();

    if (PLATFORM === "teams") {
      const hasTeamsCallUI = !!(
        document.querySelector("button[id*='hangup' i]") ||
        document.querySelector("button[aria-label*='leave' i]") ||
        document.querySelector("button[aria-label*='hang up' i]") ||
        document.querySelector("div[data-tid='call-control-bar']") ||
        document.querySelector("div[data-tid='closed-captions-renderer']") ||
        document.querySelector("button[id*='microphone-button']") ||
        document.querySelector("div[id*='calling-container']") ||
        document.querySelector(".calling-call-screen")
      );
      return {
        inCall: hasTeamsCallUI || pathname.includes("calling") || pathname.includes("meetup-join"),
        inPreJoin: false,
      };
    }

    if (PLATFORM === "zoom") {
      const hasZoomCallUI = !!(
        document.querySelector("button.footer__leave-btn") ||
        document.querySelector("button[aria-label*='leave' i]") ||
        document.querySelector("button[aria-label*='end' i]") ||
        document.querySelector(".meeting-app") ||
        document.querySelector(".closed-caption-container") ||
        document.querySelector("button[aria-label*='mute' i]")
      );
      return {
        inCall: hasZoomCallUI || pathname.includes("/wc/") || pathname.includes("/j/"),
        inPreJoin: false,
      };
    }

    // Google Meet
    const hasMeetingCode =
      /[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(pathname) ||
      /[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(href) ||
      pathname.includes("/call/") ||
      pathname.includes("/lookup/") ||
      pathname.includes("/_meet/");

    if (!hasMeetingCode) {
      return { inCall: false, inPreJoin: false };
    }

    // In-call UI controls (if any of these exist, user is actively inside the meeting)
    const hasInCallControls = !!(
      document.querySelector("button[jsname='CQyBDb']") ||
      document.querySelector("button[aria-label*='leave' i]") ||
      document.querySelector("button[aria-label*='end call' i]") ||
      document.querySelector("button[data-tooltip*='leave' i]") ||
      document.querySelector("button[aria-label*='chat' i]") ||
      document.querySelector("button[aria-label*='people' i]") ||
      document.querySelector("button[aria-label*='participants' i]") ||
      document.querySelector("div[data-allocation-index]") ||
      document.querySelector("div[data-meeting-code]") ||
      document.querySelector("div[jscontroller='kAPstf']") ||
      document.querySelector(".VbkSUe") ||
      document.querySelector(".iTTPOb") ||
      getCaptionsButton()
    );

    // Check if in pre-join room ("Ready to join?" screen)
    const joinBtn = document.querySelector(
      "button[jsname='Qx7uuf'], button[aria-label*='Join' i], button[aria-label*='Ask to join' i]"
    );
    const hasJoinButton = joinBtn && joinBtn.offsetParent !== null && !joinBtn.disabled;
    const bodyText = document.body ? (document.body.innerText || "") : "";
    const isReadyToJoin = bodyText.includes("Ready to join?") || bodyText.includes("Ask to join");

    if (hasJoinButton && isReadyToJoin && !hasInCallControls) {
      return { inCall: false, inPreJoin: true };
    }

    return { inCall: hasInCallControls || hasMeetingCode, inPreJoin: false };
  }

  function isInCall() {
    return checkCallStatus().inCall;
  }

  /**
   * Finds the closed captions button across Google Meet, Teams, or Zoom
   */
  function getCaptionsButton() {
    const btn = document.querySelector(
      "button[jsname='r8qRAd'], button[id*='closed-captions' i], button[data-tid*='closed-captions' i], button.closed-caption-button, button[aria-label*='caption' i], button[data-tooltip*='caption' i], button[aria-label*='sous-titre' i], button[aria-label*='subtítulo' i], button[aria-label*='untertitel' i]"
    );
    if (btn) return btn;

    const allButtons = document.querySelectorAll("button");
    for (const b of allButtons) {
      const label = (b.getAttribute("aria-label") || b.getAttribute("data-tooltip") || "").toLowerCase();
      if (label.includes("caption") || label.includes("closed caption") || label.includes("sous-titre") || label.includes("subtítulo")) {
        return b;
      }
      if ((b.innerText || "").trim().toLowerCase() === "cc") {
        return b;
      }
    }
    return null;
  }

  /**
   * Checks if closed captions are currently enabled
   */
  function areCaptionsEnabled() {
    const activeCaption = document.querySelector(
      ".ygicle.VbkSUe, .VbkSUe, .iTTPOb, span.ygZ0De, span.jT30ne, span.CNusmb, [role='region'][aria-label*='caption' i], [role='region'][aria-label*='subtitle' i], div[data-tid='closed-caption-text'], span[data-tid='closed-caption-text'], div[data-tid='closed-captions-renderer'], div.closed-caption-container, span.closed-caption-item, div.closed-caption-item"
    );
    if (activeCaption && activeCaption.offsetParent !== null) {
      return true;
    }

    const btn = getCaptionsButton();
    if (btn) {
      const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (btn.getAttribute("data-tooltip") || "").toLowerCase();
      const ariaPressed = btn.getAttribute("aria-pressed");
      const dataIsActive = btn.getAttribute("data-is-active");

      if (ariaPressed === "true" || dataIsActive === "true") return true;
      if (
        ariaLabel.includes("turn off") ||
        ariaLabel.includes("desactivar") ||
        ariaLabel.includes("désactiver") ||
        tooltip.includes("turn off")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Toggles captions on or off
   */
  function toggleCaptions() {
    const btn = getCaptionsButton();
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  /**
   * Safely sends a message to the Chrome extension sidepanel
   */
  function sendRuntimeMessage(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => {
        if (chrome.runtime.lastError) {
          // Normal when side panel is closed
        }
      });
    } catch (e) {
      // Context invalidated
    }
  }

  /**
   * Emits finalized turn and resets the active turn buffer
   */
  function finalizeCurrentTurn() {
    if (finalizeTimer) {
      clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }

    if (currentTurn.speaker && currentTurn.text && currentTurn.text.trim().length > 0) {
      console.log(`[Meet Wingman AI] Finalized: [${currentTurn.speaker}] ${currentTurn.text}`);
      sendRuntimeMessage({
        type: "CAPTION_TURN",
        data: {
          speaker: currentTurn.speaker,
          text: currentTurn.text.trim(),
          isFinal: true,
          timestamp: Date.now(),
        },
      });

      currentTurn = {
        speaker: "",
        text: "",
        lastSeen: Date.now(),
        isFinal: true,
      };
      activeTurnStartTime = 0;
    }
  }

  /**
   * Processes new incoming speaker and text, debouncing, detecting speaker changes,
   * and chunking long continuous speeches into natural sentence turns.
   */
  function processExtractedText(speaker, text) {
    const cleanSpeaker = speaker.trim() || "You";
    let cleanText = text.trim();

    // Strip leading speaker name if duplicated (e.g. "Amit: Hello" -> "Hello")
    if (cleanText.toLowerCase().startsWith(cleanSpeaker.toLowerCase())) {
      cleanText = cleanText.slice(cleanSpeaker.length).replace(/^[:\s-]+/, "").trim();
    }

    if (!cleanText || cleanText.length < 2) return;
    if (isSystemAnnouncement(cleanText)) return;

    // If speaker changed and we had an active utterance from previous speaker, finalize it
    if (currentTurn.speaker && currentTurn.speaker !== cleanSpeaker && currentTurn.text) {
      finalizeCurrentTurn();
      lastFinalizedPrefix = "";
      activeTurnStartTime = 0;
    }

    // If Google Meet keeps previously finalized text inside the same element, strip what was already finalized
    if (lastFinalizedPrefix && cleanText.startsWith(lastFinalizedPrefix)) {
      cleanText = cleanText.slice(lastFinalizedPrefix.length).trim();
      if (!cleanText || cleanText.length < 2) return;
    } else if (lastFinalizedPrefix && !cleanText.includes(lastFinalizedPrefix)) {
      // DOM node reset or scrolled past old prefix
      lastFinalizedPrefix = "";
    }

    // Skip if unchanged
    if (currentTurn.speaker === cleanSpeaker && currentTurn.text === cleanText) {
      return;
    }

    currentTurn.speaker = cleanSpeaker;
    currentTurn.text = cleanText;
    currentTurn.lastSeen = Date.now();
    currentTurn.isFinal = false;
    if (!activeTurnStartTime) activeTurnStartTime = Date.now();

    // Handle large, continuous speech:
    // If text exceeds MIN_SENTENCE_CHUNK_LEN (90 chars) and contains a sentence ending (. ? ! \n),
    // or if the person has spoken continuously for > 10 seconds:
    const speechDuration = Date.now() - activeTurnStartTime;
    const sentenceSplitMatch = cleanText.match(/^([\s\S]*?[.!?\n]+)\s+([A-Z0-9].*)$/);

    if (
      (cleanText.length >= MIN_SENTENCE_CHUNK_LEN && sentenceSplitMatch) ||
      (speechDuration > MAX_CONTINUOUS_SPEECH_MS && sentenceSplitMatch)
    ) {
      const completedSentence = sentenceSplitMatch[1].trim();
      const remainingSpeech = sentenceSplitMatch[2].trim();

      if (completedSentence.length >= 15) {
        // Finalize the completed sentence chunk into the transcript feed
        currentTurn.text = completedSentence;
        finalizeCurrentTurn();

        // Update prefix tracker so mutations don't duplicate the completed sentence
        lastFinalizedPrefix = lastFinalizedPrefix
          ? `${lastFinalizedPrefix} ${completedSentence}`.trim()
          : completedSentence;

        // Start the remaining speech as the active interim turn
        currentTurn.speaker = cleanSpeaker;
        currentTurn.text = remainingSpeech;
        currentTurn.lastSeen = Date.now();
        currentTurn.isFinal = false;
        activeTurnStartTime = Date.now();
        cleanText = remainingSpeech;
      }
    }

    // Emit live interim update
    sendRuntimeMessage({
      type: "CAPTION_TURN",
      data: {
        speaker: cleanSpeaker,
        text: cleanText,
        isFinal: false,
        timestamp: Date.now(),
      },
    });

    if (finalizeTimer) {
      clearTimeout(finalizeTimer);
    }
    finalizeTimer = setTimeout(() => {
      finalizeCurrentTurn();
      lastFinalizedPrefix = "";
      activeTurnStartTime = 0;
    }, FINALIZE_DELAY_MS);
  }

  /**
   * Extracts name from a DOM node or its immediate children (Meet, Teams, Zoom)
   */
  function extractNameFromNode(node) {
    if (!node) return null;
    const speakerSelectors =
      ".NWpY1d, .zs75Ib, .NWkf0d, .Fzkgdf, [jsname='W297wb'], .M6CLbe, span[data-tid='author-name'], .ui-chat__item__author, span[class*='author' i], span.closed-caption-speaker, .closed-caption-item strong";

    if (node.matches && node.matches(speakerSelectors)) {
      const txt = (node.innerText || node.textContent || "").trim();
      if (txt && !isSystemAnnouncement(txt)) return txt;
    }

    const child = node.querySelector && node.querySelector(speakerSelectors);
    if (child) {
      const txt = (child.innerText || child.textContent || "").trim();
      if (txt && !isSystemAnnouncement(txt)) return txt;
    }

    // Check avatar image
    const img = node.tagName === "IMG" ? node : (node.querySelector && node.querySelector("img[alt]"));
    if (img && img.alt && !isSystemAnnouncement(img.alt)) {
      const alt = img.alt.trim();
      if (alt.length > 0 && !alt.toLowerCase().includes("logo") && !alt.toLowerCase().includes("icon")) {
        return alt;
      }
    }

    return null;
  }

  /**
   * Searches locally around a speech element to find its specific speaker
   */
  function findSpeakerForElement(el) {
    if (!el) return "You";

    // 1. Check previous siblings of el
    let sib = el.previousElementSibling;
    while (sib) {
      const name = extractNameFromNode(sib);
      if (name) return name;
      sib = sib.previousElementSibling;
    }

    // 2. Check local parent/ancestor turn card (stops BEFORE [role="region"])
    let curr = el.parentElement;
    for (let depth = 0; depth < 4; depth++) {
      if (!curr || curr === document.body || curr.getAttribute("role") === "region") {
        break;
      }

      // Check siblings of this ancestor
      let pSib = curr.previousElementSibling;
      while (pSib) {
        const name = extractNameFromNode(pSib);
        if (name) return name;
        pSib = pSib.previousElementSibling;
      }

      // Check inside this ancestor
      const speakerSelectors =
        ".NWpY1d, .zs75Ib, .NWkf0d, .Fzkgdf, [jsname='W297wb'], .M6CLbe, span[data-tid='author-name'], .ui-chat__item__author, span[class*='author' i], span.closed-caption-speaker";
      const found = curr.querySelectorAll(speakerSelectors);
      for (const node of found) {
        if (node !== el && !el.contains(node)) {
          const txt = (node.innerText || node.textContent || "").trim();
          if (txt && !isSystemAnnouncement(txt)) return txt;
        }
      }

      const imgs = curr.querySelectorAll("img[alt]");
      for (const img of imgs) {
        if (img !== el && !el.contains(img)) {
          const alt = (img.alt || "").trim();
          if (alt && !isSystemAnnouncement(alt) && !alt.toLowerCase().includes("logo") && !alt.toLowerCase().includes("icon")) {
            return alt;
          }
        }
      }

      curr = curr.parentElement;
    }

    // 3. Check for text prefix like "Alex: ..."
    const raw = (el.innerText || el.textContent || "").trim();
    const prefixMatch = raw.match(/^([A-Z][a-zA-Z0-9_\s]{1,25}):\s+(.+)$/);
    if (prefixMatch && !isSystemAnnouncement(prefixMatch[1])) {
      return prefixMatch[1].trim();
    }

    return "You";
  }

  /**
   * Scrapes captions using multi-selector detection across Google Meet, Teams, and Zoom
   */
  function handleCaptionMutations() {
    // Strategy 1: Google Meet speech text elements (.ygicle.VbkSUe, .VbkSUe, span.ygZ0De)
    const meetElements = document.querySelectorAll(
      ".ygicle.VbkSUe, .VbkSUe, span.ygZ0De, span.jT30ne, .iTTPOb, span.CNusmb"
    );

    if (meetElements && meetElements.length > 0) {
      for (let i = meetElements.length - 1; i >= 0; i--) {
        const el = meetElements[i];
        if (isExcludedElement(el)) continue;

        const rawText = (el.innerText || el.textContent || "").trim();
        if (!rawText || rawText.length < 2 || isSystemAnnouncement(rawText)) continue;

        const speaker = findSpeakerForElement(el);
        processExtractedText(speaker, rawText);
        return;
      }
    }

    // Strategy 2: Microsoft Teams Web closed-caption elements
    const teamsElements = document.querySelectorAll(
      "div[data-tid='closed-caption-text'], span[data-tid='closed-caption-text'], div[data-tid='closed-captions-renderer'] p, div[class*='ui-chat__item__message'], span[class*='caption-text']"
    );

    if (teamsElements && teamsElements.length > 0) {
      for (let i = teamsElements.length - 1; i >= 0; i--) {
        const el = teamsElements[i];
        const rawText = (el.innerText || el.textContent || "").trim();
        if (!rawText || rawText.length < 2 || isSystemAnnouncement(rawText)) continue;

        const speaker = findSpeakerForElement(el);
        processExtractedText(speaker, rawText);
        return;
      }
    }

    // Strategy 3: Zoom Web closed-caption elements
    const zoomElements = document.querySelectorAll(
      "span.closed-caption-content, div.closed-caption-item, span.closed-caption-item, div.closed-caption-window p, div[class*='closed-caption'] span"
    );

    if (zoomElements && zoomElements.length > 0) {
      for (let i = zoomElements.length - 1; i >= 0; i--) {
        const el = zoomElements[i];
        const rawText = (el.innerText || el.textContent || "").trim();
        if (!rawText || rawText.length < 2 || isSystemAnnouncement(rawText)) continue;

        const speaker = findSpeakerForElement(el);
        processExtractedText(speaker, rawText);
        return;
      }
    }

    // Strategy 4: Fallback semantic region containers across platforms
    const containerSelectors = [
      '[role="region"][aria-label*="caption" i]',
      '[role="region"][aria-label*="subtitle" i]',
      'div[data-tid="closed-captions-renderer"]',
      'div.closed-caption-container',
      '[jsname="dsyhDe"]',
      'div[jsname="YS77vf"]',
      'div[jsname="tgaKEf"]',
    ];

    for (const sel of containerSelectors) {
      const container = document.querySelector(sel);
      if (container && !isExcludedElement(container)) {
        let text = (container.innerText || container.textContent || "").trim();

        if (text && text.length >= 2 && !isSystemAnnouncement(text)) {
          const speaker = findSpeakerForElement(container);
          processExtractedText(speaker, text);
          return;
        }
      }
    }
  }

  /**
   * Sets up a persistent MutationObserver on document.body
   */
  function setupCaptionObserver() {
    if (observer) return;

    observer = new MutationObserver(() => {
      handleCaptionMutations();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    console.log("[Meet Wingman AI] Observer active on document.body");
  }

  /**
   * Periodic status check broadcast to side panel
   */
  function broadcastStatus() {
    const status = checkCallStatus();
    const inCall = status.inCall;
    const captionsOn = areCaptionsEnabled();

    sendRuntimeMessage({
      type: "MEET_STATUS",
      data: {
        platform: PLATFORM,
        hasTab: true,
        inCall,
        inPreJoin: status.inPreJoin,
        captionsEnabled: captionsOn,
        url: window.location.href,
        timestamp: Date.now(),
      },
    });

    if (inCall && !observer) {
      setupCaptionObserver();
    }
  }

  /**
   * Insert text into in-call chat across Google Meet, Teams, or Zoom
   */
  function insertIntoMeetChat(text) {
    const chatInput =
      document.querySelector("textarea[aria-label*='Send a message' i]") ||
      document.querySelector("textarea[aria-label*='Chat' i]") ||
      document.querySelector("div[contenteditable='true'][aria-label*='message' i]") ||
      document.querySelector("div[data-tid='ckeditor-replyConversation']") ||
      document.querySelector("div[role='textbox'][aria-label*='message' i]") ||
      document.querySelector("textarea.chat-box__chat-textarea");

    if (chatInput) {
      chatInput.focus();
      if (chatInput.tagName.toLowerCase() === "textarea") {
        chatInput.value = text;
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        chatInput.innerText = text;
        chatInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
      return true;
    }
    return false;
  }

  // Listen for messages from side panel or background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "GET_MEET_STATUS": {
        const status = checkCallStatus();
        sendResponse({
          platform: PLATFORM,
          hasTab: true,
          inCall: status.inCall,
          inPreJoin: status.inPreJoin,
          captionsEnabled: areCaptionsEnabled(),
          url: window.location.href,
        });
        break;
      }

      case "TOGGLE_MEET_CAPTIONS":
        const toggled = toggleCaptions();
        sendResponse({ success: toggled, captionsEnabled: areCaptionsEnabled() });
        break;

      case "INSERT_MEET_CHAT":
        const inserted = insertIntoMeetChat(message.text);
        sendResponse({ success: inserted });
        break;

      default:
        break;
    }
    return false;
  });

  // Start observation and status loop
  setupCaptionObserver();
  statusCheckInterval = setInterval(broadcastStatus, 2000);
  broadcastStatus();
})();
