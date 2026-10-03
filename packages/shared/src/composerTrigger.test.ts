import { describe, expect, it } from "vite-plus/test";

import {
  detectComposerTrigger,
  parseComposerSideConversationCommand,
  serializeComposerFileLink,
} from "./composerTrigger.ts";

describe("side conversation command", () => {
  it.each(["/side", "/side ", " /SIDE\n", "/btw"])("opens an empty conversation for %j", (text) => {
    expect(parseComposerSideConversationCommand(text)).toEqual({ message: "" });
  });
  it.each(["/side explain this", " /SIDE\nexplain this ", "/btw explain this"])(
    "routes the question in %j",
    (text) => {
      expect(parseComposerSideConversationCommand(text)).toEqual({ message: "explain this" });
    },
  );
  it("preserves a multiline question", () => {
    expect(parseComposerSideConversationCommand("/side first line\nsecond line")).toEqual({
      message: "first line\nsecond line",
    });
  });
  it.each([
    "/sidebar hi",
    "/sideways",
    "explain /side this",
    "hello\n/side explain",
    "`/side hello`",
  ])("leaves %j as ordinary text", (text) => {
    expect(parseComposerSideConversationCommand(text)).toBeNull();
  });
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
