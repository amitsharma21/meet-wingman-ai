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

  const FINALIZE_DELAY_MS = 1500;

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
   * Checks if user is inside an active Google Meet call
   */
  function isInCall() {
    const pathname = window.location.pathname.toLowerCase();
    const href = window.location.href.toLowerCase();

    // 1. Any Google Meet meeting code URL (e.g. /abc-defg-hij or meet.google.com/abc-defg-hij)
    const hasMeetingCode =
      /[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(pathname) ||
      /[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(href) ||
      pathname.includes("/call/") ||
      pathname.includes("/_meet/");

    if (!hasMeetingCode) {
      return false;
    }

    // 2. Check if user is still in the green room / pre-join screen ("Ready to join?")
    const joinBtn = document.querySelector(
      "button[jsname='Qx7uuf'], button[aria-label*='Join' i], button[aria-label*='Ask to join' i]"
    );
    const hasJoinButton = joinBtn && joinBtn.offsetParent !== null && !joinBtn.disabled;
    const bodyText = document.body ? (document.body.innerText || "") : "";
    const isReadyToJoin = bodyText.includes("Ready to join?") || bodyText.includes("Ask to join");

    if (hasJoinButton && isReadyToJoin) {
      return false; // Still in greenroom waiting to click Join
    }

    // 3. In-call indicators (call buttons, captions, mic/cam bar, or active meeting code URL)
    return true;
  }

  /**
   * Finds the Google Meet closed captions button
   */
  function getCaptionsButton() {
    // 1. Query common known button selectors & attributes
    const btn = document.querySelector(
      "button[jsname='r8qRAd'], button[aria-label*='caption' i], button[data-tooltip*='caption' i], button[aria-label*='sous-titre' i], button[aria-label*='subtítulo' i], button[aria-label*='untertitel' i]"
    );
    if (btn) return btn;

    // 2. Search all buttons for CC text or caption labels
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
   * Checks if closed captions are currently enabled in Google Meet
   */
  function areCaptionsEnabled() {
    // 1. Check if any active caption elements or containers exist with text
    const activeCaption = document.querySelector(
      ".ygicle.VbkSUe, .VbkSUe, .iTTPOb, span.ygZ0De, span.jT30ne, span.CNusmb, [role='region'][aria-label*='caption' i], [role='region'][aria-label*='subtitle' i]"
    );
    if (activeCaption && activeCaption.offsetParent !== null) {
      return true;
    }

    // 2. Check caption toggle button state
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
   * Toggles Google Meet captions on or off
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
    }
  }

  /**
   * Processes new incoming speaker and text, debouncing and detecting speaker changes
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

    // Skip if unchanged
    if (currentTurn.speaker === cleanSpeaker && currentTurn.text === cleanText) {
      return;
    }

    // If speaker changed and we had an active utterance from previous speaker, finalize it
    if (currentTurn.speaker && currentTurn.speaker !== cleanSpeaker && currentTurn.text) {
      finalizeCurrentTurn();
    }

    currentTurn.speaker = cleanSpeaker;
    currentTurn.text = cleanText;
    currentTurn.lastSeen = Date.now();
    currentTurn.isFinal = false;

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
    }, FINALIZE_DELAY_MS);
  }

  /**
   * Extracts name from a DOM node or its immediate children
   */
  function extractNameFromNode(node) {
    if (!node) return null;
    const speakerSelectors = ".NWpY1d, .zs75Ib, .NWkf0d, .Fzkgdf, [jsname='W297wb'], .M6CLbe";

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
      const speakerSelectors = ".NWpY1d, .zs75Ib, .NWkf0d, .Fzkgdf, [jsname='W297wb'], .M6CLbe";
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

    // 3. Check for text prefix like "Harsh: ..."
    const raw = (el.innerText || el.textContent || "").trim();
    const prefixMatch = raw.match(/^([A-Z][a-zA-Z0-9_\s]{1,25}):\s+(.+)$/);
    if (prefixMatch && !isSystemAnnouncement(prefixMatch[1])) {
      return prefixMatch[1].trim();
    }

    return "You";
  }

  /**
   * Scrapes captions using multi-selector detection (works on all Meet versions)
   */
  function handleCaptionMutations() {
    // Strategy 1: Look for modern Meet speech text elements (.ygicle.VbkSUe, .VbkSUe, .iTTPOb, span.ygZ0De)
    const textElements = document.querySelectorAll(
      ".ygicle.VbkSUe, .VbkSUe, span.ygZ0De, span.jT30ne, .iTTPOb, span.CNusmb"
    );

    if (textElements && textElements.length > 0) {
      // Pick the latest active text element
      for (let i = textElements.length - 1; i >= 0; i--) {
        const el = textElements[i];
        if (isExcludedElement(el)) continue;

        const rawText = (el.innerText || el.textContent || "").trim();
        if (!rawText || rawText.length < 2 || isSystemAnnouncement(rawText)) continue;

        const speaker = findSpeakerForElement(el);
        processExtractedText(speaker, rawText);
        return;
      }
    }

    // Strategy 2: Look for semantic region containers (e.g. [role="region"][aria-label*="caption" i])
    const containerSelectors = [
      '[role="region"][aria-label*="caption" i]',
      '[role="region"][aria-label*="subtitle" i]',
      '[jsname="dsyhDe"]',
      'div[jsname="YS77vf"]',
      'div[jsname="tgaKEf"]'
    ];

    for (const sel of containerSelectors) {
      const container = document.querySelector(sel);
      if (container && !isExcludedElement(container)) {
        const speaker = findSpeakerName(container);
        let text = (container.innerText || container.textContent || "").trim();

        if (text && text.length >= 2 && !isSystemAnnouncement(text)) {
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
    const inCall = isInCall();
    const captionsOn = areCaptionsEnabled();

    sendRuntimeMessage({
      type: "MEET_STATUS",
      data: {
        inCall,
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
   * Insert text into Meet chat if open
   */
  function insertIntoMeetChat(text) {
    const chatInput =
      document.querySelector("textarea[aria-label*='Send a message' i]") ||
      document.querySelector("textarea[aria-label*='Chat' i]") ||
      document.querySelector("div[contenteditable='true'][aria-label*='message' i]");

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
      case "GET_MEET_STATUS":
        sendResponse({
          inCall: isInCall(),
          captionsEnabled: areCaptionsEnabled(),
          url: window.location.href,
        });
        break;

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
