// Service worker: opens the side panel and forwards keyboard commands.
// The AI runs in the side panel, a window context where Chrome exposes Gemini Nano (LanguageModel).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'describe-focused' && tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'glance:describe-focused' }).catch(() => {});
  }
});
