import { defineContentScript } from "wxt/sandbox";
import type { TabMessage, TabReply } from "@/src/targets/tab";

// Live-tab adapter. Best-effort across arbitrary chat UIs: locate the composer,
// type the payload like a user, submit, wait for the reply to settle, and read
// the newly rendered text back. Also reports rendered image/link URLs that look
// like exfil beacons as side effects.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    chrome.runtime.onMessage.addListener(
      (msg: TabMessage, _sender, sendReply: (r: TabReply) => void) => {
        if (msg.type === "mirage:ping" || msg.type === "mirage:reset") {
          sendReply({ ok: true });
          return false;
        }
        if (msg.type === "mirage:send") {
          void handleSend(msg.prompt).then(sendReply, (e: unknown) =>
            sendReply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
          );
          return true; // async reply
        }
        return false;
      },
    );
  },
});

async function handleSend(prompt: string): Promise<TabReply> {
  const input = findComposer();
  if (!input) return { ok: false, error: "no chat composer found on this page" };

  const root = document.querySelector("main") ?? document.body;
  const before = root.innerText ?? "";

  setComposerValue(input, prompt);
  await delay(60);
  submit(input);

  const response = await waitForResponse(root, before);
  const sideEffects = scanSideEffects(root);
  return { ok: true, response, sideEffects };
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return r.width > 40 && r.height > 12 && style.visibility !== "hidden" && style.display !== "none";
}

// Pick the most plausible composer: a visible textarea / contenteditable /
// text input, favouring the largest (chat boxes are big) and enabled ones.
function findComposer(): HTMLElement | null {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"], input[type="text"], input[type="search"], input:not([type])',
    ),
  ].filter((el) => isVisible(el) && !(el as HTMLInputElement).disabled);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => area(b) - area(a));
  return candidates[0] ?? null;
}

function area(el: Element): number {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

// Set value in a way React/Vue controlled inputs notice (native setter + input
// event), and handle contenteditable separately.
function setComposerValue(el: HTMLElement, value: string): void {
  el.focus();
  if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return;
  }
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter ? setter.call(field, value) : (field.value = value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(el: HTMLElement): void {
  const btn = findSendButton(el);
  if (btn) {
    btn.click();
    return;
  }
  // Fall back to Enter (most chat composers submit on Enter).
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    el.dispatchEvent(
      new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }),
    );
  }
  const form = el.closest("form");
  form?.requestSubmit?.();
}

function findSendButton(input: HTMLElement): HTMLElement | null {
  const scope = input.closest("form") ?? input.parentElement?.parentElement ?? document.body;
  const buttons = [...scope.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')];
  const match = buttons.find((b) => {
    const label = `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""} ${b.getAttribute("title") ?? ""}`.toLowerCase();
    return /send|submit|ask|run|go/.test(label);
  });
  return match ?? buttons.find((b) => isVisible(b)) ?? null;
}

// Poll until the newly added text stops growing (settle), or timeout. Tuned to
// return ~700ms after the reply stops streaming, bail fast if the target never
// responds, and cap the worst case well below a chat backend's patience.
async function waitForResponse(root: HTMLElement, before: string, timeoutMs = 18000): Promise<string> {
  const start = Date.now();
  const POLL = 300;
  const SETTLE = 700; // stable window that counts as "done"
  const NO_REPLY_BAILOUT = 6000; // give up if nothing new appears at all
  let last = "";
  let stableFor = 0;
  let sawGrowth = false;

  while (Date.now() - start < timeoutMs) {
    await delay(POLL);
    const added = diffTail(before, root.innerText ?? "");
    if (added.length > 0) sawGrowth = true;

    if (added === last) {
      stableFor += POLL;
      // Settled after a real reply → return it promptly.
      if (sawGrowth && stableFor >= SETTLE) return added.trim();
      // Nothing ever rendered → don't burn the full timeout.
      if (!sawGrowth && Date.now() - start >= NO_REPLY_BAILOUT) return "";
    } else {
      stableFor = 0;
      last = added;
    }
  }
  return last.trim();
}

// The text appended after `before` (crude but robust across UIs).
function diffTail(before: string, after: string): string {
  if (after.startsWith(before)) return after.slice(before.length);
  // Content re-flowed; return the last chunk as an approximation.
  return after.length > before.length ? after.slice(before.length) : after;
}

// Rendered images/links whose URL looks like an exfil beacon.
function scanSideEffects(root: HTMLElement): string[] {
  const urls = new Set<string>();
  for (const img of root.querySelectorAll<HTMLImageElement>("img[src]")) {
    const src = img.src;
    if (/mirage-exfil|[?&](token|secret|data)=/i.test(src)) urls.add(src);
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = a.href;
    if (/mirage-exfil|[?&](token|secret|data)=/i.test(href)) urls.add(href);
  }
  return [...urls];
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
