// The system under test. Plugins are target-agnostic: they hand a prompt to
// `send` and read a response back. A target keeps conversation state across the
// turns of one probe and is `reset` between probes.

export interface TargetResponse {
  response: string;
  // Out-of-band signals a target can observe (a tab target may see an exfil
  // request fired by the page; an API target usually leaves this empty).
  sideEffects?: string[];
}

// A recon snapshot of the target page (tab target only).
export interface PageSnapshot {
  url: string;
  title: string;
  composerFound: boolean;
  buttons: string[]; // visible button/labels
  headings: string[]; // h1–h3 text
  textPreview: string; // first slice of the main content
  messageCount: number; // detected chat message nodes
}

export interface ClickResult {
  clicked: boolean;
  label?: string;
}

// Browser controls the agent can drive against a live page. Present only on the
// tab target — the API target leaves `browser` undefined.
export interface BrowserTools {
  // Capture the visible target tab as an image data URL (jpeg).
  screenshot(): Promise<string>;
  scroll(direction: "up" | "down" | "top" | "bottom"): Promise<void>;
  readPage(): Promise<PageSnapshot>;
  click(target: { selector?: string; text?: string }): Promise<ClickResult>;
}

export interface Target {
  readonly kind: "tab" | "api";
  readonly label: string;
  send(prompt: string, signal?: AbortSignal): Promise<TargetResponse>;
  reset(): void;
  // Live-page controls (tab target only).
  readonly browser?: BrowserTools;
}
