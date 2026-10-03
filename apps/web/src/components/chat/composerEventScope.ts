import { useComposerHandleContext } from "../../composerHandleContext";
import { createContext, use } from "react";

export const ChatOwnerContext = createContext<string | null>(null);

export function useComposerFloatingLayerProps() {
  const owner = use(ChatOwnerContext);
  return { ...composerFloatingLayerProps, "data-chat-owner": owner ?? undefined };
}

/** The nearest chat owns input, including its menus rendered outside the chat column. */
export function chatOwnsEvent(event: Event, owner: string, fallbackOwner: boolean): boolean {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    const scope = target.closest("[data-chat-owner]");
    if (scope) return scope.getAttribute("data-chat-owner") === owner;
  }
  const scope = document.activeElement?.closest("[data-chat-owner]");
  return scope ? scope.getAttribute("data-chat-owner") === owner : fallbackOwner;
}

const COMPOSER_FLOATING_LAYER_SELECTOR = [
  '[data-composer-drawer-layer="true"]',
  '[data-chat-composer-floating-layer="true"]',
].join(",");

export const composerFloatingLayerProps = {
  "data-chat-composer-floating-layer": "true",
} as const;

export function useComposerMenuProps() {
  const composerRef = useComposerHandleContext();
  const floatingLayerProps = useComposerFloatingLayerProps();

  return {
    ...floatingLayerProps,
    finalFocus: composerRef
      ? () => {
          const activeElement = document.activeElement;
          const owner = floatingLayerProps["data-chat-owner"];
          const focusedOwner = activeElement
            ?.closest("[data-chat-owner]")
            ?.getAttribute("data-chat-owner");
          if (owner && focusedOwner && owner !== focusedOwner) return false;
          if (activeElement !== document.body && !isInsideComposerFloatingLayer(activeElement)) {
            return false;
          }
          composerRef.current?.focusAtEnd();
          return false;
        }
      : undefined,
  };
}

export function isInsideComposerFloatingLayer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(COMPOSER_FLOATING_LAYER_SELECTOR) !== null;
}

// Banners, the approval row, and the tasks badge dock above the surface. A
// pointer or focus landing on one of them acts on that control and must not
// expand a resting or collapsed composer.
export function isInsideCollapsedComposerControls(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-chat-composer-collapsed-controls="true"]') !== null
  );
}

export function isInsideRestingComposerControlScope(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.closest('[data-chat-composer-resting-controls="true"]') !== null ||
      target.closest('[data-chat-composer-resting-images="true"]') !== null ||
      target.closest("[data-composer-context-control]") !== null ||
      isInsideComposerFloatingLayer(target))
  );
}
