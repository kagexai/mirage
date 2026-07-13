import type { Target, TargetResponse } from "./types";

// Messages exchanged with the content script (entrypoints/content.ts).
export interface TabSendMessage {
  type: "mirage:send";
  prompt: string;
}
export interface TabResetMessage {
  type: "mirage:reset";
}
export interface TabPingMessage {
  type: "mirage:ping";
}
export type TabMessage = TabSendMessage | TabResetMessage | TabPingMessage;
export interface TabReply {
  ok: boolean;
  response?: string;
  sideEffects?: string[];
  error?: string;
}

// Path of the built content script (WXT emits it here in both dev and build).
const CONTENT_SCRIPT = "content-scripts/content.js";

// Live-tab target: drive whatever AI chat UI is open in the tab. The content
// script types the prompt into the page's composer and reads the reply back,
// exactly as a human attacker sitting at the page would.
export function createTabTarget(tabId: number): Target {
  let ready = false;

  // Content scripts only auto-inject on pages loaded AFTER the extension is
  // installed. A pre-existing tab has no listener → "Receiving end does not
  // exist". So ping first; if nobody answers, inject the content script
  // programmatically (once), then proceed.
  async function ensureReady(): Promise<void> {
    if (ready) return;
    if (await ping(tabId)) {
      ready = true;
      return;
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `could not inject into the tab (${msg}). Open a normal http/https page — Chrome blocks ` +
          `injection on chrome:// pages, the Web Store, and PDFs.`,
      );
    }
    ready = true;
  }

  return {
    kind: "tab",
    label: `Tab · #${tabId}`,
    async send(prompt: string): Promise<TargetResponse> {
      await ensureReady();
      const reply = await sendToTab(tabId, { type: "mirage:send", prompt });
      if (!reply.ok) throw new Error(reply.error || "tab target failed to respond");
      return { response: reply.response ?? "", sideEffects: reply.sideEffects };
    },
    reset() {
      void ensureReady()
        .then(() => sendToTab(tabId, { type: "mirage:reset" }))
        .catch(() => undefined);
    },
  };
}

// Returns true if a content-script listener answered.
function ping(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: "mirage:ping" }, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

function sendToTab(tabId: number, message: TabMessage): Promise<TabReply> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (reply: TabReply | undefined) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "content script unreachable — reload the tab"));
        return;
      }
      resolve(reply ?? { ok: false, error: "no reply from content script" });
    });
  });
}
