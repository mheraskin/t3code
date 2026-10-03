import * as NodeModule from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { chatOwnsEvent } from "./composerEventScope";

// Keep this suite in the Node project: its shared setup uses Node host-process APIs.
const { JSDOM } = NodeModule.createRequire(import.meta.url)("jsdom") as {
  JSDOM: new () => { window: Window & typeof globalThis };
};
let dom: InstanceType<typeof JSDOM>;
beforeEach(() => {
  dom = new JSDOM();
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("KeyboardEvent", dom.window.KeyboardEvent);
});

function chat(owner: string, parent: HTMLElement = document.body) {
  const element = document.createElement("section");
  element.dataset.chatOwner = owner;
  element.tabIndex = -1;
  parent.append(element);
  return element;
}

function ownersForEvent(target: EventTarget, parent: string, child: string) {
  let owners: string[] = [];
  const listener = (event: Event) => {
    owners = [
      ...(chatOwnsEvent(event, parent, true) ? [parent] : []),
      ...(chatOwnsEvent(event, child, false) ? [child] : []),
    ];
  };
  window.addEventListener("keydown", listener);
  try {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, composed: true }));
    return owners;
  } finally {
    window.removeEventListener("keydown", listener);
  }
}

afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

describe("chat input ownership", () => {
  it("routes a nested side composer's model shortcut only to the child", () => {
    const parent = chat("parent");
    const child = chat("child", parent);
    const editor = document.createElement("textarea");
    child.append(editor);
    expect(ownersForEvent(editor, "parent", "child")).toEqual(["child"]);
  });

  it("routes main composer input only to the parent while a child is mounted", () => {
    const parent = chat("parent");
    chat("child", parent);
    expect(ownersForEvent(parent, "parent", "child")).toEqual(["parent"]);
  });

  it("keeps a side model menu's shortcuts with the child when it portals to body", () => {
    chat("child", chat("parent"));
    const menu = chat("child");
    const item = document.createElement("button");
    menu.append(item);
    expect(ownersForEvent(item, "parent", "child")).toEqual(["child"]);
  });

  it("routes native window events to the focused side conversation", () => {
    const child = chat("child", chat("parent"));
    child.focus();
    expect(ownersForEvent(window, "parent", "child")).toEqual(["child"]);
    expect(ownersForEvent(document.body, "parent", "child")).toEqual(["child"]);
  });

  it("keeps the page as the fallback when focus is outside both chats", () => {
    chat("child", chat("parent"));
    expect(ownersForEvent(window, "parent", "child")).toEqual(["parent"]);
  });

  it("uses the nearest chat scope for events inside a shadow root", () => {
    const child = chat("child", chat("parent"));
    const host = document.createElement("div");
    child.append(host);
    const editor = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(editor);
    expect(ownersForEvent(editor, "parent", "child")).toEqual(["child"]);
  });
});
