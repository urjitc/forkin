import type { ActivityEvent } from "#/domain";
import { cn } from "#/lib/utils";
import { ago, box, shortenCommits } from "./ui";

const kindDot: Record<ActivityEvent["kind"], string> = {
  build: "bg-muted-foreground/50",
  baseline: "bg-muted-foreground/50",
  run: "bg-foreground/60",
  verdict: "bg-add",
  publish: "bg-muted-foreground/50",
  fix: "bg-primary",
  error: "bg-del",
};

/** One event: what happened, when, and any long output behind a click. */
function Event({ event, showIssue }: { event: ActivityEvent; showIssue: boolean }) {
  const message = shortenCommits(event.message);
  const [first = "", ...rest] = message.split("\n");

  return (
    <li className="flex items-start gap-3 px-4 py-2 text-sm">
      <span
        aria-hidden="true"
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", kindDot[event.kind])}
      />
      {rest.length > 0 ? (
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer">{first}</summary>
          <pre className="mt-1 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {message}
          </pre>
        </details>
      ) : (
        <span className={cn("min-w-0 flex-1 break-words", event.kind === "error" && "text-del")}>
          {showIssue && event.issue !== null && (
            <span className="text-muted-foreground">#{event.issue} · </span>
          )}
          {first}
        </span>
      )}
      <span className="shrink-0 text-muted-foreground" title={event.at}>
        {ago(event.at)}
      </span>
    </li>
  );
}

/** A repo's whole log: every build step, run and error. */
export function ActivityLog({ events }: { events: ReadonlyArray<ActivityEvent> }) {
  if (events.length === 0) return <p className="text-muted-foreground">Nothing yet.</p>;

  return (
    <ol className={cn(box, "max-h-[32rem] divide-y overflow-auto")}>
      {events.map((event, index) => (
        <Event key={`${event.at}-${index}`} event={event} showIssue />
      ))}
    </ol>
  );
}

/** What happened to one issue, newest first: runs, verdicts, fixes and errors. */
export function Timeline({ events }: { events: ReadonlyArray<ActivityEvent> }) {
  return (
    <ol className={cn(box, "max-h-[32rem] divide-y overflow-auto")}>
      {events.map((event, index) => (
        <Event key={`${event.at}-${index}`} event={event} showIssue={false} />
      ))}
    </ol>
  );
}
