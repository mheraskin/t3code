import { useComposerHandleContext } from "../../composerHandleContext";
import { createContext, use } from "react";

export const ChatOwnerContext = createContext<string | null>(null);

export function useComposerFloatingLayerProps() {
  const owner = use(ChatOwnerContext);
  return { ...composerFloatingLayerProps, "data-chat-owner": owner ?? undefined };
}

/** The nearest chat owns input, including its menus rendered outside the chat column. */
export function chatEventOwner(event: Event): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    const scope = target.closest("[data-chat-owner]");
    if (scope) return scope.getAttribute("data-chat-owner");
  }
  const scope = document.activeElement?.closest("[data-chat-owner]");
  return scope?.getAttribute("data-chat-owner") ?? null;
}

export function chatOwnsEvent(event: Event, owner: string, fallbackOwner: boolean): boolean {
  const eventOwner = chatEventOwner(event);
  return eventOwner === null ? fallbackOwner : eventOwner === owner;
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

function isInsideComposerFloatingLayer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(COMPOSER_FLOATING_LAYER_SELECTOR) !== null;
}

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
