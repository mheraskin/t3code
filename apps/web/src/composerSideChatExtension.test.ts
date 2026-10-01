import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { buildDocJson, serializeEditorDoc } from "./composer-rich-text-doc";
import { ComposerSideChatExtension } from "./composerSideChatExtension";

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  for (const key of [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "MutationObserver",
    "getComputedStyle",
  ] as const) {
    vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

function typeSpace(editor: Editor) {
  const view = editor.view;
  const { from, to } = view.state.selection;
  return view.someProp("handleTextInput", (handler) =>
    handler(view, from, to, " ", () => view.state.tr.insertText(" ", from, to)),
  );
}

describe("side chat composer input", () => {
  it("turns /side plus space into a chip, keeps subsequent text, and removes the chip atomically", () => {
    const editor = new Editor({ extensions: [StarterKit, ComposerSideChatExtension] });
    try {
      editor.commands.insertContent("/side");
      expect(typeSpace(editor)).toBe(true);
      editor.commands.insertContent("explain this");
      expect(serializeEditorDoc(editor.state.doc).value).toBe("/side explain this");
      expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe("composer-side-command");
      editor.commands.deleteRange({ from: 1, to: 2 });
      expect(serializeEditorDoc(editor.state.doc).value).toBe(" explain this");
    } finally {
      editor.destroy();
    }
  });

  it("keeps a later line's /side as text", () => {
    const editor = new Editor({
      extensions: [StarterKit, ComposerSideChatExtension],
      content: buildDocJson("hello\n/side", (name) => ({ label: name, description: null })),
    });
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      expect(typeSpace(editor)).toBeFalsy();
      expect(editor.state.doc.lastChild?.firstChild?.type.name).toBe("text");
    } finally {
      editor.destroy();
    }
  });
});
