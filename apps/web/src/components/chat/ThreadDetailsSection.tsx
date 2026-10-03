import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "../../lib/utils";

/** Sections share header and content insets in both the sidebar and popover. */
export function ThreadDetailsSection({
  headingId,
  title,
  actions,
  separated = true,
  collapsible = false,
  children,
  ...props
}: Omit<ComponentProps<"section">, "className" | "style" | "title" | "aria-labelledby"> & {
  headingId: string;
  title: string;
  actions?: ReactNode;
  separated?: boolean;
  collapsible?: boolean;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(true);
  const open = !collapsible || expanded;
  return (
    <section
      {...props}
      aria-labelledby={headingId}
      className={cn("px-2 pt-2 pb-2.5", separated && "border-t border-border/65")}
    >
      <div
        className={cn("flex min-h-8 min-w-0 items-center justify-between gap-2", open && "mb-1")}
      >
        <h3
          id={headingId}
          className="min-w-0 flex-1 text-2xs font-medium text-muted-foreground select-none"
        >
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => setExpanded((current) => !current)}
              className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRightIcon
                aria-hidden
                className={cn("size-3 shrink-0", open && "rotate-90")}
              />
              <span className="truncate">{title}</span>
            </button>
          ) : (
            <span className="block truncate px-1.5">{title}</span>
          )}
        </h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      <div id={contentId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
