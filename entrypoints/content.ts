import { defineContentScript } from "wxt/sandbox";
import type { TabMessage, TabReply } from "@/src/targets/tab";
import { findBestComposer, isPageChromeNoise } from "@/src/targets/composer";
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
        if (msg.type === "mirage:prepare") {
          try {
            sendReply(handlePrepare());
          } catch (e) {
            sendReply({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
          return false;
        }
        if (msg.type === "mirage:await") {
          void handleAwait(msg.prompt, msg.beforeAssistant, msg.beforeBlob).then(
            sendReply,
            (e: unknown) =>
              sendReply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
          );
          return true;
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

function handlePrepare(): TabReply {
  // Ensure Chat tab (not "Under The Hood") so the panel is visible for later wait.
  const chatTab = document.getElementById("chat-tab-btn");
  if (chatTab) chatTab.click();

  const root = findChatRoot();
  const input = findComposer();
  return {
    ok: true,
    beforeAssistant: snapshotAssistantTexts(root),
    beforeBlob: root.innerText ?? "",
    composerId: input?.id || input?.tagName.toLowerCase(),
  };
}

async function handleAwait(
  prompt: string,
  beforeAssistant: string[],
  beforeBlob: string,
): Promise<TabReply> {
  const root = findChatRoot();
  const response = await waitForAssistantReply(root, beforeAssistant, beforeBlob, prompt);
  const sideEffects = scanSideEffects(root);
  if (!response.trim()) {
    const humanSeen = chatContainsPromptEcho(root, prompt);
    return {
      ok: false,
      error: humanSeen
        ? "prompt was sent but no assistant reply appeared (API slow, error, or blocked?)"
        : "no assistant reply detected — page may not have accepted the submit (composer not wired)",
    };
  }
  return { ok: true, response, sideEffects };
}

function chatContainsPromptEcho(root: HTMLElement, prompt: string): boolean {
  const slice = prompt.trim().slice(0, 48);
  if (slice.length < 8) return false;
  return (root.innerText ?? "").includes(slice);
}

async function handleSend(prompt: string): Promise<TabReply> {
  // promptairlines: "Under The Hood" hides the composer — force Chat tab first.
  const chatTab = document.getElementById("chat-tab-btn");
  if (chatTab && isVisible(chatTab)) chatTab.click();

  const input = findComposer();
  if (!input) return { ok: false, error: "no chat composer found on this page" };

  const root = findChatRoot();
  const beforeMsgs = snapshotAssistantTexts(root);
  const beforeBlob = root.innerText ?? "";
  const beforeCount = countChatBubbles(root);

  setComposerValue(input, prompt);
  await delay(50);
  // jQuery UIs (promptairlines submitMessage reads $('#chatInput').val()) —
  // re-assert if the framework cleared/ignored the first write.
  if (!composerHasValue(input, prompt)) setComposerValue(input, prompt);
  if (!composerHasValue(input, prompt)) {
    return {
      ok: false,
      error: `could not write prompt into composer (#${input.id || input.tagName.toLowerCase()})`,
    };
  }

  await delay(80);
  submit(input);

  // Give the UI a beat to render the user bubble / typing indicator so we don't
  // mistake those for the assistant reply.
  await delay(300);

  // If the site never accepted the message, fail clearly instead of scraping chrome.
  if (
    composerHasValue(input, prompt) &&
    countChatBubbles(root) <= beforeCount &&
    !(root.innerText ?? "").includes(prompt.slice(0, Math.min(40, prompt.length)))
  ) {
    // Still waiting — submitMessage may be async before logMessage. Don't early-fail yet.
  }

  const response = await waitForAssistantReply(root, beforeMsgs, beforeBlob, prompt);
  const sideEffects = scanSideEffects(root);
  if (!response.trim()) {
    return {
      ok: false,
      error:
        "no assistant reply detected in the chat panel — check that the Chat tab is active " +
        "and the prompt was sent (composer: #" +
        (input.id || input.tagName.toLowerCase()) +
        ")",
    };
  }
  return { ok: true, response, sideEffects };
}

function findChatRoot(): HTMLElement {
  // Prefer the message list — never fall through to body if a chat panel exists
  // (body text-diff returns "Chat / Under The Hood / SHARE THIS GAME…" chrome).
  const candidates = [
    document.querySelector<HTMLElement>(".inner-content"),
    document.getElementById("chat-content"),
    document.getElementById("chat-container"),
    document.getElementById("chatWindow"),
    document.getElementById("chat-history"),
    document.getElementById("chat-box"),
    document.getElementById("messages"),
    document.querySelector<HTMLElement>(
      "[data-chat], .chat-history, .messages, .conversation, .chat-content, [class*='chat-message']",
    ),
    document.querySelector("main"),
  ];
  for (const el of candidates) {
    // Chat roots may be overflow-scrolled with a small client box — don't require large area.
    if (el && isPresent(el)) return el;
  }
  // last resort — but waitForAssistantReply will refuse body-level chrome diffs
  return document.body;
}

/** Element exists in layout (not display:none). Softer than isVisible for panels. */
function isPresent(el: Element): boolean {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  // offsetParent null can mean fixed/body — still allow if it has any box
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 || (el as HTMLElement).offsetParent !== null;
}

function countChatBubbles(root: HTMLElement): number {
  return root.querySelectorAll(
    "[class*='ai-message'], [class*='human-message'], [class*='message'], [data-role], .bubble",
  ).length;
}

function composerHasValue(el: HTMLElement, expected: string): boolean {
  const want = expected.trim();
  if (el.isContentEditable) {
    return normalizeWs(el.textContent ?? "").includes(normalizeWs(want).slice(0, 40));
  }
  const v = ((el as HTMLInputElement | HTMLTextAreaElement).value ?? "").trim();
  return v === want || v.includes(want.slice(0, Math.min(40, want.length)));
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  // Send icons can be ~32–36px wide — keep threshold modest.
  return r.width > 16 && r.height > 12 && style.visibility !== "hidden" && style.display !== "none";
}

function findComposer(): HTMLElement | null {
  // Score chat vs flag/search/auth fields — never pick by area alone
  // (promptairlines.com: full-width #flagInput vs #chatInput textarea).
  return findBestComposer(document);
}

function setComposerValue(el: HTMLElement, value: string): void {
  el.focus();
  if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    return;
  }
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter ? setter.call(field, value) : (field.value = value);
  // Native events for React-style controlled inputs.
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  field.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));

  // jQuery sites (promptairlines) read via $(el).val() — keep in sync.
  const jq = (window as unknown as { jQuery?: JQueryLike; $?: JQueryLike }).jQuery
    ?? (window as unknown as { $?: JQueryLike }).$;
  if (typeof jq === "function") {
    try {
      const $el = jq(field);
      $el.val?.(value);
      $el.trigger?.("input");
      $el.trigger?.("change");
    } catch {
      /* ignore */
    }
  }
}

type JQueryLike = (el: Element) => {
  val?: (v?: string) => unknown;
  trigger?: (ev: string) => unknown;
};

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
  ].filter(isVisible);

  // Prefer known chat send ids (incl. promptairlines sendMessageBtn).
  for (const id of [
    "send-button",
    "send-btn",
    "sendMessageBtn",
    "send-message",
    "execute-btn",
    "ask-btn",
  ]) {
    const el = document.getElementById(id);
    if (el && isVisible(el)) return el;
  }

  const labelOf = (b: HTMLElement) =>
    `${b.id} ${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""} ${b.getAttribute("title") ?? ""}`.toLowerCase();

  // Never treat flag-check / upload as the chat send control.
  const notFlag = (b: HTMLElement) => !/flag|ctf|upload|check.?in|login/i.test(labelOf(b));

  const match = buttons.find((b) => {
    const label = labelOf(b);
    return (
      notFlag(b) &&
      /send|submit|ask|run|go|reply/i.test(label) &&
      !/stop|cancel|clear|new chat/i.test(label)
    );
  });
  if (match) return match;

  // Nearest visible button to the composer that isn't flag chrome.
  return buttons.find(notFlag) ?? null;
}

// ── Assistant reply extraction ────────────────────────────────────────────────
// Pure text helpers (stripEchoAndNoise / normalizeWs / isTypingNoise /
// isLabelOnly / extractReplyFromTranscript) live in src/targets/reply.ts so they
// are unit-testable without the DOM.

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
    // promptairlines.com bubbles
    "[class*='ai-message']",
    "[class*='human-message']",
    ".inner-content > div",
    "#chat-content .inner-content > div",
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
      // Skip pure page chrome nodes.
      if (isPageChromeNoise(text)) continue;
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
  timeoutMs = 60000,
): Promise<string> {
  const start = Date.now();
  const POLL = 250;
  const SETTLE = 600; // wait for stream to finish growing
  const MIN_WAIT = 800; // user bubble phase
  // Don't give up early — labs can take 15–30s; only exit empty at full timeout.

  let lastCandidate = "";
  let stableFor = 0;
  let sawReal = false;
  const beforeSet = new Set(beforeAssistant);
  const promptNorm = normalizeWs(prompt);

  while (Date.now() - start < timeoutMs) {
    await delay(POLL);
    if (Date.now() - start < MIN_WAIT) continue;

    // 0) Fast path: dedicated AI bubble classes (promptairlines bg-ai-message-bg).
    let candidate = latestNewAiBubble(root, beforeSet, promptNorm, prompt);

    // 1) Structured: new assistant (or unknown non-user) messages.
    if (!candidate || candidate.length < 4) {
      const msgs = readMessages(root);
      const fresh = msgs.filter((m) => {
        if (m.role === "user") return false;
        const n = normalizeWs(m.text);
        if (!n || isTypingNoise(n) || isPageChromeNoise(n)) return false;
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

      if (fresh.length > 0) {
        const assistants = fresh.filter((m) => m.role === "assistant");
        const pick = (assistants.length ? assistants : fresh)[
          assistants.length ? assistants.length - 1 : fresh.length - 1
        ]!;
        candidate = stripLeadingSpeaker(stripEchoAndNoise(pick.text, prompt));
        if (assistants.length > 1) {
          const joined = assistants
            .map((m) => stripLeadingSpeaker(stripEchoAndNoise(m.text, prompt)))
            .filter(Boolean)
            .join("\n");
          if (joined.length > candidate.length) candidate = joined;
        }
      }
    }

    // 1.5) Speaker-aware: parse the full transcript into "SPEAKER: text" turns and
    // take what came after our prompt echo. Robust on multi-agent lab/CTF pages
    // where structured nodes are just labels (e.g. SentinelGoat's MOBLEY panel).
    if (!candidate || candidate.length < 8 || isLabelOnly(candidate)) {
      const fromTurns = extractReplyFromTranscript(root.innerText ?? "", prompt);
      if (fromTurns.length >= 2 && !beforeSet.has(normalizeWs(fromTurns))) {
        candidate = fromTurns;
      }
    }

    // 2) Fallback: text diff of chat root ONLY (never document.body — pure chrome).
    if ((!candidate || candidate.length < 8 || isLabelOnly(candidate)) && root !== document.body) {
      const added = diffTail(beforeBlob, root.innerText ?? "");
      candidate = stripLeadingSpeaker(stripEchoAndNoise(added, prompt));
    }

    // Still only noise / page chrome?
    if (
      !candidate ||
      isTypingNoise(candidate) ||
      isPageChromeNoise(candidate) ||
      isLabelOnly(candidate) ||
      normalizeWs(candidate) === promptNorm
    ) {
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

  return sawReal ? lastCandidate.trim() : "";
}

/** Last new AI-styled bubble text not present before the probe. */
function latestNewAiBubble(
  root: HTMLElement,
  beforeSet: Set<string>,
  promptNorm: string,
  prompt: string,
): string {
  const nodes = [
    ...root.querySelectorAll<HTMLElement>(
      "[class*='ai-message'], [class*='assistant'], [data-role='assistant'], [data-message-author-role='assistant']",
    ),
  ];
  // Also scan .inner-content children that look assistant-side (logo + bubble).
  const inner = root.matches(".inner-content")
    ? root
    : root.querySelector<HTMLElement>(".inner-content");
  if (inner) {
    for (const child of inner.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.querySelector("[class*='ai-message'], img[src*='logo']")) {
        nodes.push(child);
      }
    }
  }

  let best = "";
  for (const el of nodes) {
    const raw = (el.innerText ?? "").trim();
    const n = normalizeWs(raw);
    if (!n || beforeSet.has(n) || isTypingNoise(n) || isPageChromeNoise(n)) continue;
    if (n === promptNorm) continue;
    // Skip human row (justify-end / human-message)
    const cls = (el.className?.toString?.() ?? "").toLowerCase();
    if (/human-message|justify-end/.test(cls) && !/ai-message/.test(cls)) continue;
    if (el.querySelector("[class*='human-message']") && !el.querySelector("[class*='ai-message']")) {
      continue;
    }
    const cleaned = stripEchoAndNoise(raw, prompt);
    if (cleaned.length >= best.length) best = cleaned;
  }
  return best;
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
