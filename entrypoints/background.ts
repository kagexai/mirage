import { defineBackground } from "wxt/sandbox";

// Thin service worker: side-panel chrome only.
// The adaptive agent loop runs in the side panel (extension page) so LLM fetch
// is reliable — MV3 service workers are ephemeral and commonly surface bare
// "Failed to fetch" on long runs. Tab/API targeting still works from the panel
// via chrome.tabs / chrome.scripting + activeTab.
export default defineBackground(() => {
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn("[mirage] sidePanel behavior:", e));
});
