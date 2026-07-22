// Pure text helpers for extracting a target assistant's reply out of a chat
// UI's text — no DOM. Kept separate from content.ts so it is unit-testable.
//
// The hard cases these solve, seen on real lab/CTF pages:
//  - Speaker-prefixed transcripts ("USER@ECORP: …", "MOBLEY: …") where a naive
//    grab returns a bare label like "USER@ECORP:" instead of the reply.
//  - Multi-agent pages with two interleaved conversations.
//  - Echoed user prompt + typing indicators mixed into the captured blob.

export const TYPING_RE =
  /^(?:[\w.-]+\s+)?(?:is\s+)?typing\.{0,3}$|^\s*(?:thinking|generating|loading|please wait)\.{0,3}\s*$|^\s*\.{2,}\s*$/i;

// A bare speaker label with no content: "MOBLEY:", "USER@ECORP:", "SENTINELGOAT :".
export const LABEL_ONLY_RE = /^[A-Za-z][A-Za-z0-9@._-]{0,24}\s*:\s*$/;

// A leading speaker label to strip from the front of a reply: "MOBLEY: <text>".
const LEADING_LABEL_RE = /^[A-Za-z][A-Za-z0-9@._-]{0,24}\s*:\s+/;

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function isTypingNoise(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (TYPING_RE.test(t)) return true;
  if (/is typing/i.test(t) && t.length < 80) return true;
  return false;
}

export function isLabelOnly(text: string): boolean {
  return LABEL_ONLY_RE.test(normalizeWs(text));
}

export function stripLeadingSpeaker(text: string): string {
  return text.replace(LEADING_LABEL_RE, "").trim();
}

/** Remove the reflected user prompt and typing chrome from a text blob. */
export function stripEchoAndNoise(blob: string, prompt: string): string {
  let t = blob;
  const p = prompt.trim();
  if (p.length >= 8) {
    t = t.split(p).join("\n");
    const pNorm = normalizeWs(p);
    const tNorm = normalizeWs(t);
    if (tNorm.includes(pNorm)) {
      t = tNorm.split(pNorm).join("\n");
    }
  }
  t = t
    .split("\n")
    .filter((line) => !isTypingNoise(line))
    .join("\n");
  t = t.replace(/\b[\w.-]+\s+is typing\.{0,3}/gi, " ");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

interface Turn {
  speaker: string;
  text: string;
}

// Parse a chat blob into speaker turns using leading "SPEAKER:" labels. Lines
// without a label are appended to the previous turn (wrapped messages).
export function parseTurns(blob: string): Turn[] {
  const lines = blob
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const turns: Turn[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9@._ -]{0,24}?)\s*:\s*(.*)$/);
    // Treat as a new turn only when the label looks like a speaker tag
    // (has an uppercase letter and isn't a normal sentence with a colon).
    if (m && m[1] && /[A-Z]/.test(m[1]) && m[1].length <= 20) {
      turns.push({ speaker: m[1].trim(), text: m[2] ?? "" });
    } else if (turns.length) {
      const last = turns[turns.length - 1]!;
      last.text = last.text ? `${last.text} ${line}` : line;
    }
  }
  return turns;
}

/**
 * Extract the assistant's reply from a speaker-prefixed transcript: find the
 * last turn that echoes our prompt (the message we just sent) and return the
 * turns after it (the reply). Returns "" if the blob has no speaker structure.
 */
export function extractReplyFromTranscript(blob: string, prompt: string): string {
  const turns = parseTurns(blob);
  if (turns.length < 2) return "";
  const promptNorm = normalizeWs(prompt);
  const head = promptNorm.slice(0, Math.min(40, promptNorm.length));

  let userIdx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = normalizeWs(turns[i]!.text);
    if (!t) continue;
    if (t === promptNorm || promptNorm.includes(t) || (head.length >= 12 && t.includes(head))) {
      userIdx = i;
      break;
    }
  }
  if (userIdx === -1) return "";

  const reply = turns
    .slice(userIdx + 1)
    .map((t) => normalizeWs(t.text))
    .filter((t) => t && !isTypingNoise(t) && normalizeWs(t) !== promptNorm)
    .join("\n")
    .trim();
  return reply;
}
