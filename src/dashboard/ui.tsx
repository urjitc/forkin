import { useState, type ReactNode } from "react";
import type { Fix, Run, RunningWork, Verdict } from "#/domain";
import { Mark } from "#/components/brand";
import { cn } from "#/lib/utils";

/** Evidence order: issues with stronger evidence come first. */
export const verdictOrder = [
  "Reproduced",
  "Checking",
  "AlreadyFixed",
  "BrokenTest",
  "CouldntReproduce",
  "Unverified",
] as const satisfies ReadonlyArray<Verdict["_tag"]>;

export const verdictLabel: Record<Verdict["_tag"], string> = {
  Reproduced: "Reproduced",
  Checking: "Checking",
  AlreadyFixed: "Already fixed",
  BrokenTest: "Broken test",
  CouldntReproduce: "Couldn't reproduce",
  Unverified: "Unverified",
};

type Tone = "bad" | "good" | "pending" | "quiet";

const verdictTone: Record<Verdict["_tag"], Tone> = {
  Reproduced: "bad",
  Checking: "pending",
  AlreadyFixed: "good",
  BrokenTest: "quiet",
  CouldntReproduce: "quiet",
  Unverified: "quiet",
};

const fixTone: Record<Fix["status"]["_tag"], Tone> = {
  Proven: "good",
  Rejected: "bad",
  Checking: "pending",
  Open: "quiet",
};

const iconTone: Record<Tone, string> = {
  bad: "text-del",
  good: "text-add",
  pending: "text-brand-ink animate-pulse",
  quiet: "text-muted-foreground",
};

// Solid fills are GitHub's: deep enough to carry white text in either theme.
const pillTone: Record<Tone, string> = {
  bad: "bg-[#cf222e] text-white dark:bg-[#da3633]",
  good: "bg-[#1f883d] text-white dark:bg-[#238636]",
  pending: "bg-primary text-primary-foreground",
  quiet: "bg-muted text-foreground",
};

const labelTone: Record<Tone, string> = {
  bad: "border-del/40 text-del",
  good: "border-add/40 text-add",
  pending: "border-primary/60 text-brand-ink",
  quiet: "border-border text-muted-foreground",
};

/** An issue's verdict as GitHub shows an issue's state: a ringed dot in the verdict's colour. */
export function VerdictIcon({ verdict }: { verdict: Verdict }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-label={verdictLabel[verdict._tag]}
      className={cn("size-4 shrink-0", iconTone[verdictTone[verdict._tag]])}
    >
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

/** The verdict as a filled pill, under an issue's title. */
export function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        pillTone[verdictTone[verdict._tag]],
      )}
    >
      {verdictLabel[verdict._tag]}
    </span>
  );
}

/** A small outlined label, as GitHub shows labels inline after a title. */
export function VerdictLabel({ verdict }: { verdict: Verdict }) {
  return <Label tone={verdictTone[verdict._tag]}>{verdictLabel[verdict._tag]}</Label>;
}

export function FixLabel({ status }: { status: Fix["status"] }) {
  return <Label tone={fixTone[status._tag]}>{status._tag}</Label>;
}

function Label({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        labelTone[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A forked-branch glyph, for counts of fixes. */
export function ForkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("size-4", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="12" cy="3.5" r="1.75" />
      <circle cx="8" cy="12.5" r="1.75" />
      <path d="M4 5.25v1.5c0 1.1.9 2 2 2h4c1.1 0 2-.9 2-2v-1.5M8 8.75v2" />
    </svg>
  );
}

const outcomeDot: Record<Run["outcome"], string> = {
  fail: "bg-del",
  pass: "bg-add",
  broken: "bg-muted-foreground",
};

const outcomeWord: Record<Run["outcome"], string> = {
  fail: "failed",
  pass: "passed",
  broken: "crashed before running",
};

/** One sandbox run: what ran, where, whether it passed, and how long it took. */
export function RunResult({
  run,
  what,
  repo,
}: {
  run: Run;
  what: string;
  repo: { owner: string; repo: string };
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span aria-hidden="true" className={cn("size-2 rounded-full", outcomeDot[run.outcome])} />
      <span className="flex-1">
        {what} <b className="font-medium">{outcomeWord[run.outcome]}</b>
        {` (${run.failed} failed, ${run.passed} passed)`} on{" "}
        <CommitLink {...repo} sha={run.commit} />
      </span>
      <span className="text-muted-foreground">{ago(run.at)}</span>
      <span className="w-10 text-right text-muted-foreground">{Math.round(run.seconds)} s</span>
    </li>
  );
}

/** A titled part of a page, headed the way GitHub heads one: plain and readable. */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A bordered box, the container for lists and cards. */
export const box = "rounded-md border bg-card";

/** "3 minutes ago", for when something happened. */
export const ago = (at: string) => {
  const seconds = (Date.parse(at) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unit, size] of [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }

  return "just now";
};

/** Full commit hashes in messages, cut to the 7 characters people read. */
export const shortenCommits = (text: string) =>
  text.replaceAll(/\b([0-9a-f]{7})[0-9a-f]{33}\b/g, "$1");

const runningWhat: Record<RunningWork["what"], string> = {
  build: "Moving the snapshot",
  check: "Checking",
  fix: "Checking a",
  try: "Running",
};

/** Work in flight that no issue row shows: snapshot builds and private tries. */
export function RunningElsewhere({ running }: { running: ReadonlyArray<RunningWork> }) {
  const shown = running.filter((work) => work.issue === null);

  if (shown.length === 0) return null;

  return (
    <div className={cn(box, "mb-4 flex flex-wrap gap-x-5 gap-y-1 px-4 py-2.5 text-sm")}>
      {shown.map((work, index) => (
        <span key={`${work.what}-${index}`} className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          {runningWhat[work.what]} <span className="text-muted-foreground">{work.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Up to two letters from a name like "urjitc" or "backtest-real-fix". */
const initials = (name: string) =>
  name
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

/** A GitHub user's picture, or their initials when the name isn't a GitHub account. */
export function Avatar({ login, className }: { login: string; className?: string }) {
  const [missing, setMissing] = useState(false);
  const circle = cn("size-10 shrink-0 rounded-full", className);

  if (missing) {
    return (
      <span
        aria-hidden="true"
        className={cn(circle, "flex items-center justify-center bg-muted text-sm font-semibold")}
      >
        {initials(login)}
      </span>
    );
  }

  return (
    <img
      src={`https://github.com/${login}.png?size=80`}
      alt=""
      className={cn(circle, "bg-muted")}
      onError={() => setMissing(true)}
    />
  );
}

/** Forkin's own mark, for what Forkin says. */
export function ForkinAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full border bg-card",
        className,
      )}
    >
      <Mark className="size-5" />
    </span>
  );
}

/** A commit on GitHub: its short hash, linked, as GitHub writes one. */
export function CommitLink({ owner, repo, sha }: { owner: string; repo: string; sha: string }) {
  return (
    <a
      href={`https://github.com/${owner}/${repo}/commit/${sha}`}
      className="font-mono text-[0.9em]"
      title="View this commit on GitHub"
    >
      {sha.slice(0, 7)}
    </a>
  );
}
