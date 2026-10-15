import { ComputerIcon, Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import type { ThemePref } from "#/theme";

declare module "react" {
  interface CSSProperties {
    /** The icon URL that `Logo` masks. */
    "--i"?: string;
  }
}

/** The grid fork mark, tinted with the brand yellow. */
export function Mark({ className }: { className?: string }) {
  return (
    <i
      aria-hidden="true"
      className={cn(
        "inline-block size-6 bg-primary [mask:url(/media/forkin-mark.svg)_center/contain_no-repeat]",
        className,
      )}
    />
  );
}

/** The mark beside the name. The apostrophe takes the text colour, so only the mark is yellow. */
export function Wordmark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <Mark className={markClassName} />
      forkin'
    </span>
  );
}

/** A Simple Icons logo drawn as a mask, so it follows the text colour in both themes. */
export function Logo({
  src,
  title,
  className,
}: {
  src: string;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      style={{ "--i": `url(${src})` }}
      className={cn(
        "inline-block size-5 shrink-0 bg-current [mask:var(--i)_center/contain_no-repeat]",
        className,
      )}
    />
  );
}

/** A hairline frame with corner ticks, for figures and code. */
export function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "relative border bg-card",
        "before:pointer-events-none before:absolute before:-top-px before:-left-px before:z-10 before:size-2.5 before:border-t before:border-l before:border-muted-foreground/60",
        "after:pointer-events-none after:absolute after:-right-px after:-bottom-px after:z-10 after:size-2.5 after:border-r after:border-b after:border-muted-foreground/60",
        className,
      )}
    >
      {children}
    </div>
  );
}

const themes: { pref: ThemePref; label: string; icon: typeof ComputerIcon }[] = [
  { pref: "system", label: "System theme", icon: ComputerIcon },
  { pref: "light", label: "Light theme", icon: Sun01Icon },
  { pref: "dark", label: "Dark theme", icon: Moon02Icon },
];

// System, light and dark buttons; the choice is saved and applied by the head script's applyTheme. The pressed one is styled from <html data-pref>.
export function ThemeButtons({ className }: { className?: string }) {
  const set = (pref: ThemePref) => {
    localStorage.setItem("theme", pref);
    window.applyTheme(pref);
  };

  return (
    <div role="group" aria-label="Colour theme" className={cn("inline-flex border", className)}>
      {themes.map((t) => (
        <Button
          key={t.pref}
          variant="ghost"
          size="icon-sm"
          title={t.label}
          aria-label={t.label}
          onClick={() => set(t.pref)}
          className={cn(
            "text-muted-foreground not-first:border-l",
            {
              system: "[[data-pref=system]_&]:bg-muted [[data-pref=system]_&]:text-foreground",
              light: "[[data-pref=light]_&]:bg-muted [[data-pref=light]_&]:text-foreground",
              dark: "[[data-pref=dark]_&]:bg-muted [[data-pref=dark]_&]:text-foreground",
            }[t.pref],
          )}
        >
          <HugeiconsIcon icon={t.icon} />
        </Button>
      ))}
    </div>
  );
}
