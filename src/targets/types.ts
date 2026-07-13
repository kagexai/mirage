// The system under test. Plugins are target-agnostic: they hand a prompt to
// `send` and read a response back. A target keeps conversation state across the
// turns of one probe and is `reset` between probes.

export interface TargetResponse {
  response: string;
  // Out-of-band signals a target can observe (a tab target may see an exfil
  // request fired by the page; an API target usually leaves this empty).
  sideEffects?: string[];
}

export interface Target {
  readonly kind: "tab" | "api";
  readonly label: string;
  send(prompt: string, signal?: AbortSignal): Promise<TargetResponse>;
  reset(): void;
}
