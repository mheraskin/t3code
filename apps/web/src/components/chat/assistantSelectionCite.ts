// The Cite action currently offered for selected assistant text. Only one
// document selection exists, so at most one toolbar offers it at a time.
let offeredCite: (() => boolean) | null = null;

/** Lets the cite shortcut run `cite` until the returned cleanup runs. */
export function offerAssistantSelectionCite(cite: () => boolean): () => void {
  offeredCite = cite;
  return () => {
    if (offeredCite === cite) offeredCite = null;
  };
}

export function hasAssistantSelectionCite(): boolean {
  return offeredCite !== null;
}

/** Runs the offered Cite action, as if its button were clicked. */
export function citeAssistantSelection(): boolean {
  return offeredCite?.() ?? false;
}
