// Attack taxonomy — now used as *knowledge* the red-team agent reasons over
// (not as rigid packs). Derived from KageX's own corpus (the 20 FreakLab labs +
// the AgentBreaker taxonomy) and mapped to the OWASP Top 10 for LLM Apps.

export const OWASP_LLM = {
  LLM01: "Prompt Injection",
  LLM02: "Insecure Output Handling",
  LLM03: "Training Data / Knowledge Poisoning",
  LLM04: "Model Denial of Service",
  LLM05: "Supply Chain Vulnerabilities",
  LLM06: "Sensitive Information Disclosure",
  LLM07: "Insecure Plugin Design",
  LLM08: "Excessive Agency",
  LLM09: "Overreliance",
  LLM10: "Model Theft",
} as const;

export type OwaspId = keyof typeof OWASP_LLM;

// The attack classes the agent knows about. `tier` groups them by the channel
// the payload rides in on. The agent picks and adapts these during planning.
export const CATEGORIES = [
  "prompt-injection",
  "system-prompt-extraction",
  "multi-turn-jailbreak",
  "structured-output-injection",
  "llm-judge-bypass",
  "indirect-prompt-injection",
  "rag-poisoning",
  "membership-inference",
  "markdown-image-exfiltration",
  "multimodal-injection",
  "confused-deputy-tool-auth",
  "insecure-plugin-design",
  "agentic-exfiltration",
  "tool-definition-poisoning",
  "multi-agent-trust-chain",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_TIER: Record<Category, "direct" | "indirect" | "agentic"> = {
  "prompt-injection": "direct",
  "system-prompt-extraction": "direct",
  "multi-turn-jailbreak": "direct",
  "structured-output-injection": "direct",
  "llm-judge-bypass": "direct",
  "indirect-prompt-injection": "indirect",
  "rag-poisoning": "indirect",
  "membership-inference": "indirect",
  "markdown-image-exfiltration": "indirect",
  "multimodal-injection": "indirect",
  "confused-deputy-tool-auth": "agentic",
  "insecure-plugin-design": "agentic",
  "agentic-exfiltration": "agentic",
  "tool-definition-poisoning": "agentic",
  "multi-agent-trust-chain": "agentic",
};

// Map a category to its OWASP-LLM id (a finding's owasp is derived from the
// category the agent names).
export const CATEGORY_OWASP: Record<Category, OwaspId> = {
  "prompt-injection": "LLM01",
  "system-prompt-extraction": "LLM06",
  "multi-turn-jailbreak": "LLM01",
  "structured-output-injection": "LLM02",
  "llm-judge-bypass": "LLM01",
  "indirect-prompt-injection": "LLM01",
  "rag-poisoning": "LLM03",
  "membership-inference": "LLM06",
  "markdown-image-exfiltration": "LLM06",
  "multimodal-injection": "LLM01",
  "confused-deputy-tool-auth": "LLM07",
  "insecure-plugin-design": "LLM07",
  "agentic-exfiltration": "LLM08",
  "tool-definition-poisoning": "LLM07",
  "multi-agent-trust-chain": "LLM08",
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

// A finding's OWASP id from an agent-supplied category string (falls back to
// LLM01 for a free-form/unknown label).
export function owaspForCategory(category: string | undefined): OwaspId {
  return category && isCategory(category) ? CATEGORY_OWASP[category] : "LLM01";
}

export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];
