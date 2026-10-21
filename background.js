/**
 * Meet Wingman AI - Background Service Worker
 * Handles Side Panel behavior and extension lifecycle events.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Meet Wingman AI] Extension installed/updated.");
  // Automatically open the side panel when the extension toolbar icon is clicked
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error("[Meet Wingman AI] Error setting panel behavior:", error));
  }

  // Inject content script into any already-opened Meet, Teams, or Zoom tabs
  if (chrome.scripting && chrome.tabs) {
    const meetingPatterns = [
      "*://meet.google.com/*",
      "*://teams.microsoft.com/*",
      "*://teams.live.com/*",
      "*://*.zoom.us/*",
    ];

    meetingPatterns.forEach((pattern) => {
      chrome.tabs.query({ url: pattern }, (tabs) => {
        if (tabs && tabs.length > 0) {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.scripting
                .executeScript({
                  target: { tabId: tab.id },
                  files: ["content.js"],
                })
                .catch(() => {});
            }
          });
        }
      });
    });
  }
});

// Fallback action click handler if setPanelBehavior is not supported in older Chrome versions
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open && tab.id) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (err) {
      console.warn("[Meet Wingman AI] Could not open side panel via action click:", err);
    }
  }
});

// Relay and message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING_BACKGROUND") {
    sendResponse({ status: "OK", timestamp: Date.now() });
    return true;
  }
  // Let other listeners handle other messages
  return false;
});
