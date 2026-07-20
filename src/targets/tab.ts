import type { BrowserTools, PageSnapshot, Target, TargetResponse } from "./types";

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
export interface TabScrollMessage {
  type: "mirage:scroll";
  direction: "up" | "down" | "top" | "bottom";
}
export interface TabReadMessage {
  type: "mirage:read";
}
export interface TabClickMessage {
  type: "mirage:click";
  selector?: string;
  text?: string;
}
export type TabMessage =
  | TabSendMessage
  | TabResetMessage
  | TabPingMessage
  | TabScrollMessage
  | TabReadMessage
  | TabClickMessage;
export interface TabReply {
  ok: boolean;
  response?: string;
  sideEffects?: string[];
  error?: string;
  snapshot?: PageSnapshot;
  clicked?: boolean;
  clickedLabel?: string;
}

// Path of the built content script (WXT emits it here in both dev and build).
const CONTENT_SCRIPT = "content-scripts/content.js";

// Live-tab target: drive whatever AI chat UI is open in the tab. The content
// script types the prompt into the page's composer and reads the reply back,
// exactly as a human attacker sitting at the page would.
export function createTabTarget(tabId: number): Target {
  let ready = false;

  async function ensureReady(): Promise<void> {
    if (ready) {
      // Re-ping: navigations drop the content-script listener.
      if (await ping(tabId)) return;
      ready = false;
    }
    if (await ping(tabId)) {
      ready = true;
      return;
    }

    // Blocked schemes — fail with a clear message (no inject attempt).
    const url = await tabUrl(tabId);
    if (url && isBlockedUrl(url)) {
      throw new Error(
        `cannot inject into this page (${url}). Chrome blocks chrome://, the Web Store, ` +
          `extension pages, and PDFs. Open a normal http(s) site with the AI chat UI.`,
      );
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(formatInjectError(msg, url));
    }

    // Brief settle so the message listener is registered.
    await delay(50);
    if (!(await ping(tabId))) {
      throw new Error(
        `content script injected but not responding on ${url || `tab #${tabId}`}. ` +
          `Reload the page, then Launch again.`,
      );
    }
    ready = true;
  }

  return {
    kind: "tab",
    label: `Tab · #${tabId}`,
    async send(prompt: string): Promise<TargetResponse> {
      await ensureReady();
      try {
        const reply = await sendToTab(tabId, { type: "mirage:send", prompt });
        if (!reply.ok) throw new Error(reply.error || "tab target failed to respond");
        return { response: reply.response ?? "", sideEffects: reply.sideEffects };
      } catch (e) {
        // One re-inject if the page navigated mid-run.
        const msg = e instanceof Error ? e.message : String(e);
        if (/Receiving end does not exist|message port closed|unreachable/i.test(msg)) {
          ready = false;
          await ensureReady();
          const reply = await sendToTab(tabId, { type: "mirage:send", prompt });
          if (!reply.ok) throw new Error(reply.error || "tab target failed to respond");
          return { response: reply.response ?? "", sideEffects: reply.sideEffects };
        }
        throw e;
      }
    },
    reset() {
      void ensureReady()
        .then(() => sendToTab(tabId, { type: "mirage:reset" }))
        .catch(() => undefined);
    },
    browser: makeBrowserTools(tabId, ensureReady),
  };
}

// Live-page controls the agent can drive. Screenshot is captured from this
// (extension-page) context via chrome.tabs.captureVisibleTab; scroll/read/click
// go through the injected content script.
function makeBrowserTools(tabId: number, ensureReady: () => Promise<void>): BrowserTools {
  return {
    async screenshot(): Promise<string> {
      const tab = await chrome.tabs.get(tabId);
      // captureVisibleTab grabs the active tab of the window; jpeg keeps the
      // data URL small enough to embed in findings/reports.
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 55 });
    },
    async scroll(direction): Promise<void> {
      await ensureReady();
      await sendToTab(tabId, { type: "mirage:scroll", direction });
    },
    async readPage(): Promise<PageSnapshot> {
      await ensureReady();
      const reply = await sendToTab(tabId, { type: "mirage:read" });
      if (!reply.ok || !reply.snapshot) {
        throw new Error(reply.error || "could not read the page");
      }
      return reply.snapshot;
    },
    async click(target): Promise<{ clicked: boolean; label?: string }> {
      await ensureReady();
      const reply = await sendToTab(tabId, {
        type: "mirage:click",
        selector: target.selector,
        text: target.text,
      });
      if (!reply.ok) throw new Error(reply.error || "click failed");
      return { clicked: !!reply.clicked, label: reply.clickedLabel };
    },
  };
}

function isBlockedUrl(url: string): boolean {
  return /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url) ||
    /chrome\.google\.com\/webstore/i.test(url) ||
    /\.pdf($|\?)/i.test(url);
}

function formatInjectError(msg: string, url: string | undefined): string {
  const host = url ? safeHost(url) : "this page";
  if (/must request permission to access this host|Cannot access contents of url/i.test(msg)) {
    return (
      `no host permission for ${host}. ` +
      `Reload Mirage after rebuild (chrome://extensions → Mirage → Reload), ` +
      `accept any new permissions prompt, then open the target tab and Launch again. ` +
      `Detail: ${msg}`
    );
  }
  if (/Cannot access a chrome:|extension gallery|Cannot access contents/i.test(msg)) {
    return (
      `cannot inject into ${host} (${msg}). ` +
      `Use a normal http(s) page — not chrome://, Web Store, or PDFs.`
    );
  }
  return (
    `could not inject into ${host} (${msg}). ` +
    `Reload the tab, confirm Mirage has site access, then Launch again.`
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url;
  } catch {
    return undefined;
  }
}

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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** True for hard failures where retrying more probes is useless. */
export function isFatalTabError(message: string): boolean {
  return /no host permission|must request permission|cannot inject into this page|Cannot access contents of url|chrome:\/\/|blocked/i.test(
    message,
  );
}
