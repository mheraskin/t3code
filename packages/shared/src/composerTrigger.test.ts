import { describe, expect, it } from "vite-plus/test";

import {
  detectComposerTrigger,
  parseComposerSideChatCommand,
  serializeComposerFileLink,
} from "./composerTrigger.ts";

describe("parseComposerSideChatCommand", () => {
  it.each(["/side", "/side ", " /SIDE\n"])("opens an empty side chat for %j", (text) => {
    expect(parseComposerSideChatCommand(text)?.message).toBe("");
  });

  it("routes the whole message, including multiline text and other slash commands", () => {
    const text = "  /SIDE explain this\n/plan next steps  ";
    const command = parseComposerSideChatCommand(text);
    expect(command).toEqual({
      rangeStart: 2,
      rangeEnd: 7,
      message: "explain this\n/plan next steps",
    });
    expect(text.slice(command?.rangeStart, command?.rangeEnd)).toBe("/SIDE");
  });

  it.each([
    "/sidebar hi",
    "/sideways",
    "explain /side this",
    "hello\n/side explain",
    "`/side hello`",
  ])("leaves ordinary prompts unchanged: %j", (text) =>
    expect(parseComposerSideChatCommand(text)).toBeNull(),
  );
});

describe("detectComposerTrigger", () => {
  it.each(["$", "€", "£", "¥", "₹", "₩", "₿", "𑿝"])(
    "detects %s skill prefixes and their source range",
    (prefix) => {
      const text = `Use ${prefix}review`;
      expect(detectComposerTrigger(text, text.length)).toEqual({
        kind: "skill",
        query: "review",
        rangeStart: 4,
        rangeEnd: text.length,
      });
    },
  );
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});
