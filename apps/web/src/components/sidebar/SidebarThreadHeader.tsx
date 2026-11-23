// Header controls share the titlebar row; search replaces the row until its query clears.
// The scope picker is passed in because its state lives with the sidebar's scope logic, and
// `anchorRef` sits on the button group so the popup anchors there, not on the 28px trigger.
import { useGT } from "gt-react";
import { SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderActionsProps {
  /** Lands on the button group so a popup can anchor to it. */
  anchorRef?: RefObject<HTMLDivElement | null>;
  /** Without projects there is nothing to scope, so those controls stay out. */
  hasProjects: boolean;
  /** The project scope combobox, rendered after search. */
  projectScope: ReactNode;
  onOpenSearch: () => void;
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  showNewThreadInProjectHint: boolean;
}

export function SidebarThreadHeaderActions({
  anchorRef,
  hasProjects,
  projectScope,
  onOpenSearch,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
}: SidebarThreadHeaderActionsProps) {
  const gt = useGT();
  const newThreadLabel = newThreadShortcutLabel
    ? gt("New thread ({shortcut})", { shortcut: newThreadShortcutLabel })
    : gt("New thread");

  return (
    <div ref={anchorRef} className="flex shrink-0 items-center">
      <SidebarHeaderIconButton label={gt("Search threads")} onClick={onOpenSearch}>
        <SearchIcon />
      </SidebarHeaderIconButton>
      {hasProjects ? projectScope : null}
      <SidebarHeaderIconButton
        label={gt("New thread")}
        tooltip={
          showNewThreadInProjectHint ? (
            <span className="flex flex-col gap-0.5">
              <span>{newThreadLabel}</span>
              <span className="text-muted-foreground">
                {newThreadInProjectShortcutLabel
                  ? gt("New thread in current project: Shift+click ({shortcut})", {
                      shortcut: newThreadInProjectShortcutLabel,
                    })
                  : gt("New thread in current project: Shift+click")}
              </span>
            </span>
          ) : (
            newThreadLabel
          )
        }
        disabled={newThreadDisabled}
        onClick={onNewThread}
      >
        <SquarePenIcon />
      </SidebarHeaderIconButton>
    </div>
  );
}

export interface SidebarThreadSearchBarProps {
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  /** Clears the query and gives the row back to the header controls. */
  onClose: () => void;
}

export function SidebarThreadSearchBar({
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClose,
}: SidebarThreadSearchBarProps) {
  const gt = useGT();
  const resultsVisible = isSearching && searchResultCount > 0;
  // Shrinking results can remove the active option; never leave aria-activedescendant pointing at it.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;

  return (
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-sidebar-row-hover px-2 py-1.5 text-sm font-medium text-sidebar-foreground">
      <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
      <SidebarInput
        ref={searchInputRef}
        nativeInput
        autoFocus
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
        onKeyDown={onSearchKeyDown}
        // An untouched search gives the row back as soon as focus leaves it.
        onBlur={() => {
          if (searchQuery.length === 0) onClose();
        }}
        placeholder={gt("Search threads")}
        aria-label={gt("Search threads")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={resultsVisible}
        aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
        aria-activedescendant={
          activeResultExists ? `sidebar-thread-search-result-${activeSearchResultIndex}` : undefined
        }
        className="min-w-0 flex-1"
      />
      <Button
        type="button"
        size="icon-micro"
        variant="ghost-muted"
        className="shrink-0"
        aria-label={gt("Close thread search")}
        // Keep focus on the input so its blur does not close first.
        onPointerDown={(event) => event.preventDefault()}
        onClick={onClose}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
