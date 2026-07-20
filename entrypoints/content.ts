import { defineContentScript } from "wxt/sandbox";
import type { TabMessage, TabReply } from "@/src/targets/tab";
import {
  extractReplyFromTranscript,
  isLabelOnly,
  isTypingNoise,
  normalizeWs,
  stripEchoAndNoise,
  stripLeadingSpeaker,
} from "@/src/targets/reply";

// Live-tab adapter. Best-effort across arbitrary chat UIs: locate the composer,
// type the payload like a user, submit, wait for a REAL assistant reply (not the
// echoed user bubble / "is typing…" indicator), and return only that text.
export default defineContentScript({
  // Injected on demand via chrome.scripting.executeScript into the ACTIVE tab
  // under test. Matches must cover any authorized target site (host_permissions
  // mirror this in wxt.config.ts).
  matches: ["http://*/*", "https://*/*"],
  registration: "runtime",
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
        if (msg.type === "mirage:scroll") {
          doScroll(msg.direction);
          sendReply({ ok: true });
          return false;
        }
        if (msg.type === "mirage:read") {
          sendReply({ ok: true, snapshot: readSnapshot() });
          return false;
        }
        if (msg.type === "mirage:click") {
          const r = doClick(msg.selector, msg.text);
          sendReply({ ok: true, clicked: r.clicked, clickedLabel: r.label });
          return false;
        }
        return false;
      },
    );
  },
});

// ── Browser controls (scroll / read / click) ──────────────────────────────────

function doScroll(direction: "up" | "down" | "top" | "bottom"): void {
  const root = findChatRoot();
  const winStep = Math.round(window.innerHeight * 0.9);
  const rootStep = Math.round((root.clientHeight || winStep) * 0.9);
  switch (direction) {
    case "top":
      window.scrollTo({ top: 0 });
      root.scrollTop = 0;
      break;
    case "bottom":
      window.scrollTo({ top: document.body.scrollHeight });
      root.scrollTop = root.scrollHeight;
      break;
    case "up":
      window.scrollBy({ top: -winStep });
      root.scrollTop -= rootStep;
      break;
    case "down":
      window.scrollBy({ top: winStep });
      root.scrollTop += rootStep;
      break;
  }
}

function readSnapshot() {
  const root = findChatRoot();
  const buttons = [...document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')]
    .filter(isVisible)
    .map((b) => normalizeWs(b.getAttribute("aria-label") || b.textContent || (b as HTMLInputElement).value || ""))
    .filter((t) => t.length > 0 && t.length < 40);
  const headings = [...document.querySelectorAll<HTMLElement>("h1, h2, h3")]
    .map((h) => normalizeWs(h.textContent || ""))
    .filter(Boolean);
  const text = normalizeWs(root.innerText || document.body.innerText || "");
  return {
    url: location.href,
    title: document.title,
    composerFound: !!findComposer(),
    buttons: dedup(buttons).slice(0, 24),
    headings: dedup(headings).slice(0, 12),
    textPreview: text.slice(0, 1600),
    messageCount: messageCandidates(root).length,
  };
}

function doClick(selector?: string, text?: string): { clicked: boolean; label?: string } {
  let el: HTMLElement | null = null;
  if (selector) {
    try {
      el = document.querySelector<HTMLElement>(selector);
    } catch {
      el = null;
    }
  }
  if (!el && text) {
    const want = text.toLowerCase();
    const clickables = [
      ...document.querySelectorAll<HTMLElement>('button, a, [role="button"], input[type="submit"], [onclick]'),
    ].filter(isVisible);
    el =
      clickables.find((c) => {
        const label = `${c.getAttribute("aria-label") ?? ""} ${c.textContent ?? ""} ${c.getAttribute("title") ?? ""}`.toLowerCase();
        return label.includes(want);
      }) ?? null;
  }
  if (el && isVisible(el)) {
    const label = normalizeWs(el.getAttribute("aria-label") || el.textContent || "").slice(0, 60);
    el.click();
    return { clicked: true, label };
  }
  return { clicked: false };
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

async function handleSend(prompt: string): Promise<TabReply> {
  const input = findComposer();
  if (!input) return { ok: false, error: "no chat composer found on this page" };

  const root = findChatRoot();
  const beforeMsgs = snapshotAssistantTexts(root);
  const beforeBlob = root.innerText ?? "";

  setComposerValue(input, prompt);
  await delay(80);
  submit(input);

  // Give the UI a beat to render the user bubble / typing indicator so we don't
  // mistake those for the assistant reply.
  await delay(250);

  const response = await waitForAssistantReply(root, beforeMsgs, beforeBlob, prompt);
  const sideEffects = scanSideEffects(root);
  return { ok: true, response, sideEffects };
}

function findChatRoot(): HTMLElement {
  const candidates = [
    document.getElementById("chat-history"),
    document.getElementById("chat-box"),
    document.getElementById("messages"),
    document.querySelector<HTMLElement>("[data-chat], .chat-history, .messages, .conversation"),
    document.querySelector("main"),
    document.body,
  ];
  return candidates.find((el): el is HTMLElement => !!el) ?? document.body;
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return r.width > 40 && r.height > 12 && style.visibility !== "hidden" && style.display !== "none";
}

function findComposer(): HTMLElement | null {
  const preferIds = [
    "message-input",
    "prompt-input",
    "chat-input",
    "prompt",
    "query-input",
    "user-input",
  ];
  for (const id of preferIds) {
    const el = document.getElementById(id);
    if (el && isVisible(el)) return el as HTMLElement;
  }

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
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function submit(el: HTMLElement): void {
  const btn = findSendButton(el);
  if (btn) {
    btn.click();
    return;
  }
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
  const buttons = [
    ...scope.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]'),
  ];
  // Prefer known FreakLab / chat ids.
  for (const id of ["send-button", "send-btn", "execute-btn", "ask-btn"]) {
    const el = document.getElementById(id);
    if (el && isVisible(el)) return el;
  }
  const match = buttons.find((b) => {
    const label =
      `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""} ${b.getAttribute("title") ?? ""}`.toLowerCase();
    return /send|submit|ask|run|go/.test(label) && !/stop|cancel|clear|new chat/i.test(label);
  });
  return match ?? buttons.find((b) => isVisible(b)) ?? null;
}

// ── Assistant reply extraction ────────────────────────────────────────────────

interface MsgNode {
  role: "user" | "assistant" | "unknown";
  text: string;
  el: Element;
}

function classifyRole(el: Element): MsgNode["role"] {
  const attrs = [
    el.getAttribute("data-role"),
    el.getAttribute("data-message-author-role"),
    el.getAttribute("data-author"),
    el.getAttribute("data-sender"),
    el.className?.toString?.() ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(user|human|me|self|outbound)\b/.test(attrs)) return "user";
  if (/\b(assistant|bot|ai|system|model|agent|inbound|julia|gpt)\b/.test(attrs)) return "assistant";

  // Heuristic class names used by lab UIs.
  if (el.classList.contains("user") || el.classList.contains("message-user")) return "user";
  if (
    el.classList.contains("assistant") ||
    el.classList.contains("bot") ||
    el.classList.contains("system") ||
    el.classList.contains("message-assistant") ||
    el.classList.contains("ai")
  ) {
    return "assistant";
  }
  return "unknown";
}

function messageCandidates(root: HTMLElement): Element[] {
  const selectors = [
    "[data-role]",
    "[data-message-author-role]",
    "[data-author]",
    ".message",
    ".chat-message",
    ".msg",
    ".bubble",
    "#chat-history > *",
    "#chat-box > *",
    "#messages > *",
    "[class*='message']",
  ];
  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const sel of selectors) {
    for (const el of root.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      // Skip nested matches — prefer leaf-ish message nodes.
      if ([...seen].some((p) => p.contains(el) && p !== el)) continue;
      if (el.contains(document.activeElement) && el.matches("textarea, input, [contenteditable]")) {
        continue;
      }
      const text = (el as HTMLElement).innerText?.trim() ?? "";
      if (!text || text.length < 1) continue;
      // Skip the composer itself.
      if (el.matches("textarea, input, [contenteditable='true']")) continue;
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

function readMessages(root: HTMLElement): MsgNode[] {
  return messageCandidates(root).map((el) => ({
    role: classifyRole(el),
    text: ((el as HTMLElement).innerText ?? "").trim(),
    el,
  }));
}

function snapshotAssistantTexts(root: HTMLElement): string[] {
  return readMessages(root)
    .filter((m) => m.role === "assistant" || m.role === "unknown")
    .map((m) => normalizeWs(m.text))
    .filter((t) => t && !isTypingNoise(t));
}

/**
 * Wait until a new assistant reply appears that is not the user prompt echo
 * and not a typing indicator. Prefer structured message nodes; fall back to
 * text-diff of the chat root with echo stripping.
 */
async function waitForAssistantReply(
  root: HTMLElement,
  beforeAssistant: string[],
  beforeBlob: string,
  prompt: string,
  timeoutMs = 45000,
): Promise<string> {
  const start = Date.now();
  const POLL = 250;
  const SETTLE = 800; // wait for stream to finish growing
  const MIN_WAIT = 1200; // never return in the first 1.2s (user bubble phase)
  const NO_REPLY_BAILOUT = 12000;

  let lastCandidate = "";
  let stableFor = 0;
  let sawReal = false;
  const beforeSet = new Set(beforeAssistant);
  const promptNorm = normalizeWs(prompt);

  while (Date.now() - start < timeoutMs) {
    await delay(POLL);
    if (Date.now() - start < MIN_WAIT) continue;

    // 1) Structured: new assistant (or unknown non-user) messages.
    const msgs = readMessages(root);
    const fresh = msgs.filter((m) => {
      if (m.role === "user") return false;
      const n = normalizeWs(m.text);
      if (!n || isTypingNoise(n)) return false;
      // A bare speaker label ("USER@ECORP:", "MOBLEY:") is not a reply.
      if (isLabelOnly(n)) return false;
      if (beforeSet.has(n)) return false;
      // Skip pure echoes of our prompt.
      if (n === promptNorm || (promptNorm.includes(n) && n.length < promptNorm.length * 1.05)) {
        return false;
      }
      if (n.startsWith(promptNorm) && stripEchoAndNoise(n, prompt).length < 12) return false;
      return true;
    });

    let candidate = "";
    if (fresh.length > 0) {
      // Prefer last assistant-labeled; else last fresh unknown after strip.
      const assistants = fresh.filter((m) => m.role === "assistant");
      const pick = (assistants.length ? assistants : fresh)[assistants.length ? assistants.length - 1 : fresh.length - 1]!;
      candidate = stripLeadingSpeaker(stripEchoAndNoise(pick.text, prompt));
      // If multiple new assistant chunks streamed as separate nodes, join recent ones.
      if (assistants.length > 1) {
        const joined = assistants
          .map((m) => stripLeadingSpeaker(stripEchoAndNoise(m.text, prompt)))
          .filter(Boolean)
          .join("\n");
        if (joined.length > candidate.length) candidate = joined;
      }
    }

    // 2) Speaker-aware: parse the full transcript into "SPEAKER: text" turns and
    // take what came after our prompt echo. Robust on multi-agent lab/CTF pages
    // where structured nodes are just labels (e.g. SentinelGoat's MOBLEY panel).
    if (!candidate || candidate.length < 8 || isLabelOnly(candidate)) {
      const fromTurns = extractReplyFromTranscript(root.innerText ?? "", prompt);
      if (fromTurns.length >= 2 && !beforeSet.has(normalizeWs(fromTurns))) {
        candidate = fromTurns;
      }
    }

    // 3) Fallback: text diff of chat root, strip echo + typing + leading label.
    if (!candidate || candidate.length < 8 || isLabelOnly(candidate)) {
      const added = diffTail(beforeBlob, root.innerText ?? "");
      candidate = stripLeadingSpeaker(stripEchoAndNoise(added, prompt));
    }

    // Still only noise?
    if (!candidate || isTypingNoise(candidate) || isLabelOnly(candidate) || normalizeWs(candidate) === promptNorm) {
      if (!sawReal && Date.now() - start >= NO_REPLY_BAILOUT) {
        return ""; // nothing real arrived
      }
      stableFor = 0;
      lastCandidate = "";
      continue;
    }

    sawReal = true;
    if (candidate === lastCandidate) {
      stableFor += POLL;
      if (stableFor >= SETTLE) return candidate;
    } else {
      stableFor = 0;
      lastCandidate = candidate;
    }
  }

  return lastCandidate.trim();
}

function diffTail(before: string, after: string): string {
  if (after.startsWith(before)) return after.slice(before.length);
  // Content re-flowed — try longest common prefix strip.
  let i = 0;
  const max = Math.min(before.length, after.length);
  while (i < max && before[i] === after[i]) i++;
  if (i > 40) return after.slice(i);
  return after.length > before.length ? after.slice(before.length) : after;
}

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
