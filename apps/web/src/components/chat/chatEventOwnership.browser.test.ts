import { describe, expect, it } from "vite-plus/test";
import { chatOwnsEvent } from "./composerEventScope";

/** Creates chat scopes for one test and removes them, and any focus inside them, on dispose. */
function chatScopes() {
  const created: HTMLElement[] = [];
  return {
    chat(owner: string, parent: HTMLElement = document.body) {
      const element = document.createElement("section");
      element.dataset.chatOwner = owner;
      element.tabIndex = -1;
      parent.append(element);
      created.push(element);
      return element;
    },
    [Symbol.dispose]() {
      for (const element of created) element.remove();
    },
  };
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

describe("chat input ownership", () => {
  it("routes a nested side composer's model shortcut only to the child", () => {
    using scopes = chatScopes();
    const parent = scopes.chat("parent");
    const child = scopes.chat("child", parent);
    const editor = document.createElement("textarea");
    child.append(editor);
    expect(ownersForEvent(editor, "parent", "child")).toEqual(["child"]);
  });

  it("routes main composer input only to the parent while a child is mounted", () => {
    using scopes = chatScopes();
    const parent = scopes.chat("parent");
    scopes.chat("child", parent);
    expect(ownersForEvent(parent, "parent", "child")).toEqual(["parent"]);
  });

  it("keeps a side model menu's shortcuts with the child when it portals to body", () => {
    using scopes = chatScopes();
    scopes.chat("child", scopes.chat("parent"));
    const menu = scopes.chat("child");
    const item = document.createElement("button");
    menu.append(item);
    expect(ownersForEvent(item, "parent", "child")).toEqual(["child"]);
  });

  it("routes native window events to the focused side conversation", () => {
    using scopes = chatScopes();
    const child = scopes.chat("child", scopes.chat("parent"));
    child.focus();
    expect(ownersForEvent(window, "parent", "child")).toEqual(["child"]);
    expect(ownersForEvent(document.body, "parent", "child")).toEqual(["child"]);
  });

  it("keeps the page as the fallback when focus is outside both chats", () => {
    using scopes = chatScopes();
    scopes.chat("child", scopes.chat("parent"));
    expect(ownersForEvent(window, "parent", "child")).toEqual(["parent"]);
  });

  it("uses the nearest chat scope for events inside a shadow root", () => {
    using scopes = chatScopes();
    const child = scopes.chat("child", scopes.chat("parent"));
    const host = document.createElement("div");
    child.append(host);
    const editor = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(editor);
    expect(ownersForEvent(editor, "parent", "child")).toEqual(["child"]);
  });
});
