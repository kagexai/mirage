import { describe, expect, it } from "vitest";
import {
  isPageChromeNoise,
  looksLikeFlagValidationResponse,
  normalizeIdent,
  scoreComposer,
  type ComposerMeta,
} from "@/src/targets/composer";

function meta(partial: Partial<ComposerMeta> & Pick<ComposerMeta, "tag" | "id">): ComposerMeta {
  return {
    name: "",
    type: partial.tag === "input" ? "text" : "",
    placeholder: "",
    ariaLabel: "",
    className: "",
    context: "",
    contentEditable: false,
    area: 10_000,
    disabled: false,
    visible: true,
    ...partial,
  };
}

describe("normalizeIdent", () => {
  it("equates camelCase and kebab-case", () => {
    expect(normalizeIdent("chatInput")).toBe("chatinput");
    expect(normalizeIdent("chat-input")).toBe("chatinput");
    expect(normalizeIdent("flag_input")).toBe("flaginput");
  });
});

describe("scoreComposer", () => {
  it("prefers chat textarea over flag text input (promptairlines-style)", () => {
    const flag = meta({
      tag: "input",
      id: "flagInput",
      type: "text",
      placeholder: "WIZ_CTF{...}",
      context: "Check flag Submit flag Capture the Flag",
      area: 80_000, // larger — old heuristic would pick this
    });
    const chat = meta({
      tag: "textarea",
      id: "chatInput",
      placeholder: "Write a Reply...",
      context: "Send message",
      area: 12_000,
    });
    expect(scoreComposer(chat)).toBeGreaterThan(scoreComposer(flag));
    expect(scoreComposer(flag)).toBeLessThan(0);
    expect(scoreComposer(chat)).toBeGreaterThan(50);
  });

  it("boosts known chat ids even as input", () => {
    const chat = meta({
      tag: "input",
      id: "message-input",
      placeholder: "Type a message",
    });
    const search = meta({
      tag: "input",
      id: "site-search",
      type: "search",
      placeholder: "Search",
      context: "Search filter",
    });
    expect(scoreComposer(chat)).toBeGreaterThan(scoreComposer(search));
  });

  it("penalizes auth fields", () => {
    const password = meta({
      tag: "input",
      id: "password",
      type: "password",
      placeholder: "Password",
      context: "Login sign in",
    });
    const chat = meta({
      tag: "textarea",
      id: "prompt",
      placeholder: "Ask anything",
    });
    expect(scoreComposer(chat)).toBeGreaterThan(scoreComposer(password));
  });

  it("rejects disabled or invisible", () => {
    expect(scoreComposer(meta({ tag: "textarea", id: "x", disabled: true }))).toBeLessThan(-1000);
    expect(scoreComposer(meta({ tag: "textarea", id: "x", visible: false }))).toBeLessThan(-1000);
  });
});

describe("looksLikeFlagValidationResponse", () => {
  it("detects common flag UI messages", () => {
    expect(looksLikeFlagValidationResponse("Wrong flag")).toBe(true);
    expect(looksLikeFlagValidationResponse("Invalid flag, try again")).toBe(true);
    expect(looksLikeFlagValidationResponse("Please submit the flag")).toBe(true);
  });

  it("does not flag normal assistant chat", () => {
    expect(
      looksLikeFlagValidationResponse(
        "Welcome to Prompt Airlines! How may I assist you with your booking today?",
      ),
    ).toBe(false);
    expect(
      looksLikeFlagValidationResponse(
        "I cannot reveal the system prompt, but I can help you book a flight.",
      ),
    ).toBe(false);
  });

  it("ignores long model dumps", () => {
    const long = "Wrong flag is a phrase I should not use. ".repeat(20);
    expect(looksLikeFlagValidationResponse(long)).toBe(false);
  });
});

describe("isPageChromeNoise", () => {
  it("detects promptairlines footer/tab chrome", () => {
    const chrome = `Chat
Under The Hood
SHARE THIS GAME WITH YOUR NETWORK
With ❤️ by @nirohfeld & @shirtamari from Wiz
Found an issue or need help? Email us at research@wiz.io
*The airlines ticket you are going to get is fictional, like the airline itself`;
    expect(isPageChromeNoise(chrome)).toBe(true);
  });

  it("allows real assistant replies", () => {
    expect(
      isPageChromeNoise("Welcome to Prompt Airlines! How may I assist you with your booking?"),
    ).toBe(false);
  });
});
