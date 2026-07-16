/**
 * Chat-composer discovery for arbitrary pages.
 *
 * CTF / lab UIs often have multiple text fields (flag validation, search, file
 * upload captions) next to the real chat composer. Picking by area alone
 * mis-targets pages like promptairlines.com (`#flagInput` vs `#chatInput`).
 *
 * Score candidates: boost chat-like fields, heavily penalize flag/search/
 * auth/upload chrome. Prefer textarea / contenteditable over single-line inputs.
 */

export interface ComposerMeta {
  tag: string;
  id: string;
  name: string;
  type: string;
  placeholder: string;
  ariaLabel: string;
  className: string;
  /** Nearby label / form / parent text (truncated). */
  context: string;
  /** True when element is contenteditable. */
  contentEditable: boolean;
  /** Bounding-box area (width * height). */
  area: number;
  disabled: boolean;
  visible: boolean;
}

/** Normalize id/name so chat-input matches chatInput. */
export function normalizeIdent(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const CHAT_ID_HINTS = [
  "messageinput",
  "promptinput",
  "chatinput",
  "prompt",
  "queryinput",
  "userinput",
  "composer",
  "chatbox",
  "chattextarea",
  "askinput",
  "userprompt",
  "llminput",
];

const FLAG_RE =
  /\b(flag|ctf|submit.?flag|check.?flag|validate.?flag|enter.?flag|capture.?the.?flag)\b/i;
const FLAG_PLACEHOLDER_RE =
  /^(wiz_)?ctf\{|flag\{|enter\s*(the\s*)?flag|paste\s*(your\s*)?flag|WIZ_CTF/i;
const SEARCH_RE = /\b(search|filter|find|query\s*box)\b/i;
const AUTH_RE = /\b(email|password|username|login|sign.?in|otp|phone|zip|postal)\b/i;
const CHAT_RE =
  /\b(chat|message|prompt|reply|composer|ask|conversation|assistant|send\s*a\s*message|write\s*a\s*reply|type\s*(a\s*)?message)\b/i;
const NON_CHAT_BUTTON_RE = /\b(check\s*flag|submit\s*flag|validate|upload|login|search|filter)\b/i;

/**
 * Score one candidate. Higher = more likely the chat composer.
 * Negative scores are almost never selected unless nothing else exists.
 */
export function scoreComposer(meta: ComposerMeta): number {
  if (!meta.visible || meta.disabled) return -10_000;

  const idN = normalizeIdent(meta.id);
  const nameN = normalizeIdent(meta.name);
  const blob = [
    meta.id,
    meta.name,
    meta.placeholder,
    meta.ariaLabel,
    meta.className,
    meta.context,
  ]
    .join(" ")
    .toLowerCase();
  const tag = meta.tag.toLowerCase();

  let score = 0;

  // Hard reject: flag validation / CTF submit fields.
  if (FLAG_RE.test(blob) || FLAG_PLACEHOLDER_RE.test(meta.placeholder)) {
    score -= 500;
  }
  if (/flaginput|ctfinput|submitflag|checkflag/.test(idN + nameN)) {
    score -= 500;
  }

  // Search / auth / non-chat chrome.
  if (SEARCH_RE.test(blob) && !CHAT_RE.test(blob)) score -= 120;
  if (AUTH_RE.test(blob) && !CHAT_RE.test(blob)) score -= 150;
  if (/\b(file|upload|attachment)\b/i.test(blob)) score -= 80;
  if (meta.type === "search" || meta.type === "email" || meta.type === "password") score -= 200;
  if (meta.type === "number" || meta.type === "tel" || meta.type === "url") score -= 80;

  // Chat-positive signals.
  if (CHAT_RE.test(blob)) score += 80;
  if (CHAT_ID_HINTS.some((h) => idN === h || idN.includes(h) || nameN === h || nameN.includes(h))) {
    score += 100;
  }
  // Prefer multi-line composers.
  if (tag === "textarea") score += 60;
  if (meta.contentEditable) score += 55;
  if (tag === "input") score -= 25; // single-line; often flag/search unless boosted above

  // Placeholder looks like chat.
  if (/write|type|message|reply|ask|say|prompt|chat/i.test(meta.placeholder)) score += 40;
  // Placeholder looks like a flag template.
  if (/[{_]ctf|flag\{|…\.\.\.|WIZ_/i.test(meta.placeholder)) score -= 200;

  // Nearby UI mentions non-chat actions → mild penalty.
  if (NON_CHAT_BUTTON_RE.test(meta.context) && !CHAT_RE.test(meta.context)) score -= 60;
  if (/\b(send|ask|submit)\b/i.test(meta.context) && CHAT_RE.test(meta.context)) score += 20;

  // Area is a weak tie-breaker only (log scale so huge flag fields don't dominate).
  score += Math.min(30, Math.log10(Math.max(meta.area, 1) + 1) * 10);

  return score;
}

/** Build meta from a live DOM element. */
export function metaFromElement(el: HTMLElement): ComposerMeta {
  const input = el as HTMLInputElement;
  const context = nearbyContext(el);
  return {
    tag: el.tagName,
    id: el.id ?? "",
    name: input.name ?? "",
    type: (input.type ?? "").toLowerCase(),
    placeholder: input.placeholder ?? el.getAttribute("placeholder") ?? "",
    ariaLabel: el.getAttribute("aria-label") ?? "",
    className: typeof el.className === "string" ? el.className : "",
    context,
    contentEditable: el.isContentEditable,
    area: area(el),
    disabled: !!(input as HTMLInputElement).disabled,
    visible: isVisible(el),
  };
}

function nearbyContext(el: HTMLElement): string {
  const scope =
    el.closest("form") ??
    el.closest("[class*='flag'], [class*='chat'], [class*='composer'], [class*='input']") ??
    el.parentElement?.parentElement ??
    el.parentElement;
  if (!scope) return "";
  // Prefer labels + button text over dumping the whole chat history.
  const parts: string[] = [];
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) parts.push(label.textContent ?? "");
  }
  for (const b of scope.querySelectorAll("button, [role='button'], input[type='submit'], label")) {
    parts.push(b.textContent ?? "", b.getAttribute("aria-label") ?? "");
  }
  // Small slice of scope text as last resort (avoid message history).
  const raw = (scope as HTMLElement).innerText ?? "";
  parts.push(raw.slice(0, 280));
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return r.width > 16 && r.height > 12 && style.visibility !== "hidden" && style.display !== "none";
}

function area(el: Element): number {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

/**
 * Pick the best chat composer on the page, or null if none look plausible.
 */
export function findBestComposer(root: ParentNode = document): HTMLElement | null {
  // Fast path: known chat ids (case-insensitive via normalize).
  const byId = collectIdMatches(root);
  if (byId) return byId;

  const candidates = [
    ...root.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"], input[type="text"], input[type="search"], input:not([type])',
    ),
  ];

  let best: HTMLElement | null = null;
  let bestScore = -Infinity;
  for (const el of candidates) {
    const meta = metaFromElement(el);
    const s = scoreComposer(meta);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }

  // Refuse extremely low scores (only garbage left) — still return best if any.
  if (best && bestScore < -400) {
    // Everything looks like flag/auth; still try textareas first among them.
    const textareas = candidates.filter((el) => el.tagName === "TEXTAREA" && isVisible(el));
    if (textareas.length === 1) return textareas[0]!;
  }
  return best;
}

function collectIdMatches(root: ParentNode): HTMLElement | null {
  // Prefer exact common ids, then camelCase / hyphen variants via full scan.
  const prefer = [
    "message-input",
    "prompt-input",
    "chat-input",
    "chatInput",
    "messageInput",
    "promptInput",
    "prompt",
    "query-input",
    "user-input",
    "composer",
  ];
  for (const id of prefer) {
    const el =
      (root as Document).getElementById?.(id) ??
      root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (el && isVisible(el) && scoreComposer(metaFromElement(el)) > -200) return el;
  }

  // Scan all elements with ids that normalize to chat hints.
  const withId = root.querySelectorAll<HTMLElement>("[id]");
  let best: HTMLElement | null = null;
  let bestScore = -Infinity;
  for (const el of withId) {
    const idN = normalizeIdent(el.id);
    if (!CHAT_ID_HINTS.some((h) => idN === h || idN.includes(h))) continue;
    if (!el.matches('textarea, input, [contenteditable="true"]')) continue;
    const s = scoreComposer(metaFromElement(el));
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (best && bestScore > 0) return best;
  return null;
}

/**
 * Heuristic: does this response look like flag-validation UI noise rather than
 * an AI chat reply? Used so the agent can pivot / surface a wrong-target note.
 */
export function looksLikeFlagValidationResponse(response: string): boolean {
  const t = response.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (t.length > 400) return false;
  return (
    /^(wrong|invalid|incorrect|bad)\s+flag\b/i.test(t) ||
    /\b(flag\s*(is\s*)?(wrong|invalid|incorrect)|try\s*again|not\s*the\s*(right|correct)\s*flag)\b/i.test(
      t,
    ) ||
    /\bplease\s*(enter|submit|check)\s*(a\s*|the\s*)?flag\b/i.test(t) ||
    /^WIZ_CTF\{/i.test(t) // echo of flag template only
  );
}

/** Static page chrome scraped when chat-root falls back to document.body. */
const PAGE_CHROME_RE =
  /share this game with your network|research@wiz\.io|under the hood|airlines ticket you are going to get is fictional|found an issue or need help|train your team|capture the flag challenge|with\s*❤|@nirohfeld|@shirtamari/i;

/**
 * True when scraped text is site chrome (tabs/footer), not a model reply.
 * Example failure mode: promptairlines "Chat / Under The Hood / SHARE THIS GAME…".
 */
export function isPageChromeNoise(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (PAGE_CHROME_RE.test(t)) return true;
  if (/^chat\s*(under the hood)?$/i.test(t)) return true;
  if (PAGE_CHROME_RE.test(t) && t.length < 500 && !/[.!?].{20,}/.test(t)) return true;
  return false;
}
