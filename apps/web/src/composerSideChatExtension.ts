import { InputRule, Node } from "@tiptap/core";

/** /side becomes an atomic routing chip when followed by a space. */
export const ComposerSideChatExtension = Node.create({
  name: "composer-side-command",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { source: { default: "/side" } };
  },
  parseHTML() {
    return [{ tag: "span[data-composer-side-command]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-composer-side-command": "", ...HTMLAttributes }, "Open Side"];
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^(\/side) $/i,
        handler: ({ state, range, match }) => {
          if (range.from !== 1) return null;
          state.tr.replaceWith(range.from, range.to, [
            this.type.create({ source: match[1] }),
            state.schema.text(" "),
          ]);
        },
      }),
    ];
  },
});
