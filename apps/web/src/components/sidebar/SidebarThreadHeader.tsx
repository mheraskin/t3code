/**
 * The sidebar header controls, which live in the titlebar row beside the brand.
 *
 * At rest the row holds a search button and, with projects, the project scope
 * and new-project buttons, then new thread. Search opens in place of the whole
 * row (`SidebarThreadSearchBar`) and closes back to it once the query is
 * cleared, so the thread list keeps the height the old search row took.
 * The scope icon swaps to the project favicon while a project is selected,
 * so the header still names the scope.
 *
 * The scope picker itself is passed in: its combobox state lives with the rest
 * of the sidebar's scope logic. `anchorRef` lands on the button group so the
 * picker's popup can anchor to it rather than to its 28px trigger.
 */
import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
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
  onNewProject: () => void;
  /** Receives the click so Shift+click can skip the project picker. */
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  /** Shift+click only matters once there is more than one project to pick. */
  showNewThreadInProjectHint: boolean;
}

export function SidebarThreadHeaderActions({
  anchorRef,
  hasProjects,
  projectScope,
  onOpenSearch,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
}: SidebarThreadHeaderActionsProps) {
  const newThreadLabel = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";

  return (
    <div ref={anchorRef} className="flex shrink-0 items-center">
      <SidebarHeaderIconButton label="Search threads" onClick={onOpenSearch}>
        <SearchIcon />
      </SidebarHeaderIconButton>
      {hasProjects ? (
        <>
          {projectScope}
          <SidebarHeaderIconButton label="Add project" onClick={onNewProject}>
            <FolderPlusIcon />
          </SidebarHeaderIconButton>
        </>
      ) : null}
      <SidebarHeaderIconButton
        label="New thread"
        tooltip={
          showNewThreadInProjectHint ? (
            <span className="flex flex-col gap-0.5">
              <span>{newThreadLabel}</span>
              <span className="text-muted-foreground">
                New thread in current project: Shift+click
                {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
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
  const resultsVisible = isSearching && searchResultCount > 0;
  // Results shrink as the query narrows, so the active index can outrun the
  // list; pointing aria-activedescendant at a removed option strands the
  // screen reader on nothing.
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
        placeholder="Search threads"
        aria-label="Search threads"
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
        aria-label="Close thread search"
        // Keep focus on the input so its blur does not close first.
        onPointerDown={(event) => event.preventDefault()}
        onClick={onClose}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}

/**
 * Icon button with a tooltip, sized for the header's segmented pair. Spreads
 * unknown props through so it can serve as a popup trigger's render target,
 * which injects its own handlers, ref and aria state.
 */
export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  /** Accessible name; also the tooltip unless `tooltip` says more. */
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
        {/* Coarse-pointer hit area, matching the rest of the sidebar chrome. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
