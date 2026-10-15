import { Bug01Icon, GithubIcon, RoboticIcon, UserCheck01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, type ReactNode } from "react";
import { Frame, Logo, Mark, ThemeButtons, Wordmark } from "#/components/brand";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { liveRepos } from "#/dashboard/live-repos";
import { cn } from "#/lib/utils";
import { Flow } from "./Flow";

const col = "mx-auto w-[min(760px,calc(100%-3rem))]";
const source = "https://github.com/urjitc/forkin";

const agents = [
  { name: "Claude Code", src: "https://cdn.simpleicons.org/claude" },
  { name: "Codex", src: "https://cdn.jsdelivr.net/npm/simple-icons@9.0.0/icons/openai.svg" },
  { name: "Cursor", src: "https://cdn.simpleicons.org/cursor" },
  { name: "Copilot", src: "https://cdn.simpleicons.org/githubcopilot" },
  { name: "OpenCode", src: "https://cdn.simpleicons.org/opencode" },
];

const sections = [
  { href: "#top", label: "Intro" },
  { href: "#why", label: "Problem" },
  { href: "#how", label: "How it works" },
  { href: "#coordination", label: "Many agents" },
  { href: "#live", label: "Live" },
  { href: "#agents", label: "Agents" },
  { href: "#who", label: "Who it's for" },
];

// Highlights the last section whose top has scrolled past a line 30% down the window.
function useActiveSection() {
  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-toc] a")];
    const targets = links.map((a) => document.querySelector(a.hash === "#top" ? "#hero" : a.hash));

    const update = () => {
      let current = 0;
      targets.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= innerHeight * 0.3) current = i;
      });
      links.forEach((a, i) => a.toggleAttribute("data-active", i === current));
    };

    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();

    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, []);
}

// Reveals each .reveal block once as it scrolls into view, staggering siblings.
function useReveal() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          const el = e.target;

          if (!e.isIntersecting || !(el instanceof HTMLElement) || !el.parentElement) return;

          const siblings = [...el.parentElement.children].filter((s) =>
            s.classList.contains("reveal"),
          );

          el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 3) * 40}ms`;
          el.classList.add("in");
          io.unobserve(el);
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );

    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    return () => io.disconnect();
  }, []);
}

/** Scrolls to the real repos Forkin runs on, where judges can watch it work. */
function LiveButton() {
  return (
    <Button
      size="lg"
      variant="outline"
      className="h-11 px-4 text-sm"
      nativeButton={false}
      render={<a href="#live" />}
    >
      See it live
    </Button>
  );
}

function SourceButton() {
  return (
    <Button
      size="lg"
      className="h-11 px-4 text-sm"
      nativeButton={false}
      render={<a href={source} />}
    >
      <HugeiconsIcon icon={GithubIcon} />
      Read the source
    </Button>
  );
}

function Section({ id, title, children }: { id?: string; title?: string; children: ReactNode }) {
  return (
    <section id={id} className={cn(col, "pt-18")}>
      {title && (
        <h2 className="reveal mb-4 border-t pt-10 text-[1.625rem] font-medium tracking-tight">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function Statement({ children }: { children: ReactNode }) {
  return (
    <p className="reveal mb-8 text-[clamp(1.375rem,2.6vw,1.75rem)] leading-snug tracking-tight text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">
      {children}
    </p>
  );
}

/** Each feature's colour, so the four read as distinct at a glance. */
const featureTone = {
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

function Feature({
  glyph,
  tone,
  title,
  children,
}: {
  glyph: ReactNode;
  tone: keyof typeof featureTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="reveal grid grid-cols-[52px_1fr] items-center gap-4">
      <div
        aria-hidden="true"
        className={cn("grid size-13 place-items-center border", featureTone[tone])}
      >
        <svg
          viewBox="0 0 34 34"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="size-7"
        >
          {glyph}
        </svg>
      </div>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-[0.9375rem] leading-normal text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

// A titled card with a short tag (coloured when tested) or a custom aside such as a reference mark.
// `icon` is an SVG URL, drawn as a mask in the brand colour.
function Note({
  title,
  tag,
  icon,
  glyph,
  aside,
  children,
}: {
  title: string;
  tag?: string;
  /** An icon image, like Cloudflare's product icons. */
  icon?: string;
  /** An icon from the bundled set, for cards with no logo of their own. */
  glyph?: IconSvgElement;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="reveal">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          {icon && <Logo src={icon} className="size-4.5 text-brand-ink" />}
          {glyph && <HugeiconsIcon icon={glyph} className="size-4.5 text-brand-ink" />}
          {title}
        </CardTitle>
        {tag && <span className="text-[0.8125rem] text-muted-foreground">{tag}</span>}
        {aside}
      </CardHeader>
      <CardContent className="text-[0.9375rem] leading-relaxed text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

/** What maintainers have said about the flood, verbatim, with where each was said. */
const quotes = [
  {
    project: "curl",
    logo: "curl",
    who: "Daniel Stenberg, creator, January 2026",
    text: "We don’t need to waste any human time on pull requests until the quality is good enough to get green check-marks from 200 CI jobs.",
    href: "https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/",
  },
  {
    project: "Godot",
    logo: "godotengine",
    who: "Rémi Verschelde, lead maintainer, February 2026",
    text: "Honestly, AI slop PRs are becoming increasingly draining and demoralizing for #Godot maintainers.",
    href: "https://bsky.app/profile/akien.bsky.social/post/3meyerixvhs2p",
  },
  {
    project: "Ghostty",
    logo: "ghostty",
    who: "AI policy, by Mitchell Hashimoto",
    text: "It is rude and disrespectful to approach this boundary with low-effort, unqualified work, since it puts the burden of validation on the maintainer.",
    href: "https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md",
  },
  {
    project: "tldraw",
    logo: "tldraw",
    who: "Steve Ruiz, founder, January 2026",
    text: "While some of these pull requests are formally correct, most suffer from incomplete or misleading context, misunderstanding of the codebase, and little to no follow-up engagement from their authors.",
    href: "https://github.com/tldraw/tldraw/issues/7695",
  },
  {
    project: "Hono",
    logo: "hono",
    who: "Contribution guide",
    text: "Pull requests are limited to maintainers. A clear issue with a minimal reproduction helps us more than a pull request.",
    href: "https://github.com/honojs/hono/blob/main/docs/CONTRIBUTING.md",
  },
  {
    project: "GitHub",
    logo: "github",
    who: "GitHub staff, community discussion, January 2026",
    text: "…the increasing volume of low-quality contributions that is creating significant operational challenges for maintainers.",
    href: "https://github.com/orgs/community/discussions/185387",
  },
];

/** A link to where a quote comes from. */
function Source({ href }: { href: string }) {
  return (
    <a href={href} className="text-[0.8125rem] text-muted-foreground">
      Source ↗
    </a>
  );
}

/** Cloudflare's four questions about many agents on one codebase, and how Forkin answers each. */
const coordination = [
  {
    question: "Who's working on what?",
    answer:
      "Every attempt is listed on its issue, live. Agents read each other's changes, learn from rejected ones, and can start from another's fork.",
    on: "Durable Objects",
    icon: "/cloudflare/durable-objects.svg",
  },
  {
    question: "What about conflicting changes?",
    answer:
      "Nothing to conflict. Each attempt is its own fork, so attempts compete instead of merging.",
    on: "Artifacts",
    icon: "/cloudflare/artifacts.svg",
  },
  {
    question: "Who reviews it all?",
    answer:
      "The runs do. Only a fix that passes the issue's test, keeps the suite green and leaves the test alone reaches a person.",
    on: "Sandbox",
    icon: "/cloudflare/sandbox.svg",
  },
  {
    question: "Why was a change made?",
    answer:
      "Every fix belongs to an issue with a failing test, and its verdict is a git note on the fork.",
    on: "Artifacts",
    icon: "/cloudflare/artifacts.svg",
  },
];

/** An example of one issue's forks, one per agent, and what the runs made of each. */
const forks = [
  { id: "7f3a", agent: agents[0], verdict: "Proven", ok: true },
  { id: "91c2", agent: agents[1], verdict: "Rejected: edited the test", ok: false },
  { id: "c04e", agent: agents[2], verdict: "Rejected: test still fails", ok: false },
  { id: "2b8d", agent: agents[3], verdict: "Rejected: broke 2 other tests", ok: false },
];

/** One step on the way from a GitHub repo to an agent's fork, all on Artifacts after GitHub. */
function Step({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border bg-background px-3.5 py-2.5">
      <div className="font-medium">{title}</div>
      <div className="font-mono text-[0.75rem] text-muted-foreground">{sub}</div>
    </div>
  );
}

/** How one bug becomes any number of forks on Artifacts, each checked on its own. */
function ForkFan() {
  return (
    <figure className="reveal mt-6 border bg-card p-5 text-[0.875rem] leading-snug">
      <div className="flex flex-wrap items-center gap-2.5">
        <Step title="Your repo" sub="GitHub" />
        <span aria-hidden="true" className="text-muted-foreground">
          →
        </span>
        <Step title="Mirror" sub="Artifacts" />
        <span aria-hidden="true" className="text-muted-foreground">
          →
        </span>
        <Step title="Issue #2" sub="code + failing test" />
        <span aria-hidden="true" className="text-muted-foreground">
          → one fork per agent
        </span>
      </div>
      <ul className="mt-4 divide-y border bg-background">
        {forks.map((fork) => (
          <li key={fork.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5">
            <span className="font-mono text-[0.75rem] text-muted-foreground">
              issue-2--fix-{fork.id}
            </span>
            <span className="flex items-center gap-2">
              <Logo src={fork.agent.src} className="size-4 text-muted-foreground" />
              {fork.agent.name}
            </span>
            <span className={cn("ml-auto", fork.ok ? "text-add" : "text-del")}>{fork.verdict}</span>
          </li>
        ))}
        <li className="px-3.5 py-2.5 text-muted-foreground">…and as many more as you start</li>
      </ul>
      <figcaption className="mt-3 text-[0.8125rem] text-muted-foreground">
        Each push to a fork starts its own check: 3 runs of the issue's test and the whole suite, in
        sandboxes restored from a snapshot with the network off.
      </figcaption>
    </figure>
  );
}

/** The real repos Forkin runs on, linking to their dashboards. */
function LiveRepos() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {liveRepos.map((repo) => (
        <a
          key={`${repo.owner}/${repo.repo}`}
          href={`/${repo.owner}/${repo.repo}`}
          className="reveal block no-underline hover:no-underline"
        >
          <Card className="h-full transition-colors hover:ring-foreground/30">
            <CardHeader className="flex flex-row items-center gap-3">
              <img src={repo.avatar} alt="" className="size-8 rounded-md" />
              <div>
                <CardTitle>{repo.name}</CardTitle>
                <div className="font-mono text-[0.8125rem] text-muted-foreground">
                  {repo.owner}/{repo.repo}
                </div>
              </div>
            </CardHeader>
            <CardContent className="text-[0.9375rem] leading-relaxed text-muted-foreground">
              <p>{repo.about}</p>
            </CardContent>
          </Card>
        </a>
      ))}
    </div>
  );
}

export function Landing() {
  useActiveSection();
  useReveal();

  return (
    <div className="text-[1.0625rem] leading-[1.75]">
      {/* Top bar; on wide screens it becomes a fixed sidebar with a section list that follows your scroll. */}
      <div className="sticky top-0 z-20 bg-background max-sm:static min-[1360px]:fixed min-[1360px]:inset-y-0 min-[1360px]:left-0 min-[1360px]:w-[272px]">
        <header
          className={cn(
            col,
            "flex h-16 items-center gap-6",
            "min-[1360px]:m-0 min-[1360px]:h-full min-[1360px]:w-auto min-[1360px]:flex-col min-[1360px]:items-start min-[1360px]:gap-8 min-[1360px]:px-8 min-[1360px]:py-10",
          )}
        >
          <a href="#top" aria-label="Forkin home">
            <Wordmark className="gap-3 text-2xl" markClassName="size-7" />
          </a>
          <nav
            data-toc
            aria-label="On this page"
            className="hidden w-full flex-col min-[1360px]:flex"
          >
            {sections.map((s) => (
              <a
                key={s.href}
                href={s.href}
                className="relative py-1.5 pl-6 text-[0.9375rem] leading-snug text-muted-foreground transition-colors before:absolute before:top-1/2 before:left-0 before:h-px before:w-2.5 before:bg-border before:transition-all hover:text-foreground data-active:text-foreground data-active:before:h-0.5 data-active:before:w-3.5 data-active:before:bg-primary"
              >
                {s.label}
              </a>
            ))}
          </nav>
          <ThemeButtons className="mt-auto hidden min-[1360px]:inline-flex" />
        </header>
      </div>

      <main>
        <div id="hero" className={cn(col, "pt-20 pb-14 max-sm:pt-10 min-[1360px]:pt-[4.1rem]")}>
          <h1 className="reveal mb-5 text-[clamp(2.5rem,6vw,3.75rem)] leading-[1.05] font-medium tracking-[-0.04em]">
            Issues are the new
            <br />
            pull requests.
          </h1>
          <p className="reveal mb-8 max-w-[36em] text-[1.1875rem] leading-relaxed text-muted-foreground">
            Open source maintainers are drowning in swarms of AI slop. Forkin reproduces and
            verifies every issue that comes in, and lets any number of agents find and fix bugs in
            parallel.
          </p>
          <div className="reveal flex flex-wrap gap-3">
            <SourceButton />
            <LiveButton />
          </div>
          <div
            aria-label="Works with"
            className="reveal mt-8 flex flex-wrap items-center gap-4 text-muted-foreground"
          >
            <span className="text-[0.8125rem] text-muted-foreground/70">
              Works with your agents
            </span>
            {agents.map((a) => (
              <Logo key={a.name} src={a.src} title={a.name} className="size-4.5" />
            ))}
          </div>
        </div>

        <figure className={cn(col, "reveal")}>
          <img
            src="/media/tulips.webp"
            srcSet="/media/tulips-760.webp 760w, /media/tulips.webp 1520w"
            sizes="(max-width: 808px) 100vw, 760px"
            width={1520}
            height={651}
            alt=""
            decoding="async"
            className="block h-auto w-full opacity-85"
          />
        </figure>

        <Section id="why">
          <Statement>
            Agents made pull requests cheap, so maintainers are closing them. Now the same slop is
            flooding <b>issues</b>, and every report costs a maintainer time just to tell if it's{" "}
            <b>real</b>.
          </Statement>
          <div className="grid gap-3 sm:grid-cols-2">
            {quotes.map((quote) => (
              <Card key={quote.href} className="reveal">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Logo src={`https://cdn.simpleicons.org/${quote.logo}`} className="size-4.5" />
                    {quote.project}
                  </CardTitle>
                  <Source href={quote.href} />
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-[0.9375rem] leading-relaxed">
                  <q className="text-muted-foreground">{quote.text}</q>
                  <span className="text-[0.8125rem] text-muted-foreground">{quote.who}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="how" title="What Forkin does">
          <div className="mt-7 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            <Feature
              tone="amber"
              title="Issues that prove themselves"
              glyph={
                <>
                  <rect x="7" y="5" width="20" height="24" />
                  <path d="M12 13l4 4 7-7" />
                  <path d="M12 23h10" />
                </>
              }
            >
              Contributors attach a failing test. Forkin runs it on a fresh copy of your code.
            </Feature>
            <Feature
              tone="sky"
              title="Sorted in seconds"
              glyph={
                <>
                  <rect x="6" y="22" width="22" height="6" />
                  <rect x="6" y="14" width="22" height="6" />
                  <rect x="6" y="6" width="22" height="6" strokeDasharray="2.5 2.5" />
                </>
              }
            >
              Reproduced, already fixed, or couldn't reproduce.
            </Feature>
            <Feature
              tone="violet"
              title="Your agents, in parallel"
              glyph={
                <>
                  <rect x="5" y="9" width="16" height="20" />
                  <rect x="13" y="4" width="16" height="20" strokeDasharray="2.5 2.5" />
                </>
              }
            >
              Each in its own fork, so they never collide. The runs decide which fix ships.
            </Feature>
            <Feature
              tone="emerald"
              title="Verified before review"
              glyph={
                <>
                  <path d="M27 17a10 10 0 1 1-3-7.1" />
                  <path d="M25 4v6h-6" />
                </>
              }
            >
              Fails before, passes after, suite still green, test untouched.
            </Feature>
          </div>
        </Section>

        <figure className={cn(col, "reveal mt-14")}>
          <Frame>
            <Flow />
          </Frame>
        </figure>

        <Section id="coordination" title="Built for thousands of agents running in parallel">
          <p className="reveal text-muted-foreground">
            Every agent works in its own fork, and every attempt is checked the same way. They never
            collide, and you only ever review what's proven.
          </p>
          <div className="reveal mt-6 divide-y border bg-card">
            {coordination.map((row) => (
              <div
                key={row.question}
                className="grid gap-x-6 gap-y-1 px-5 py-4 text-[0.9375rem] leading-relaxed sm:grid-cols-[12rem_1fr_9rem]"
              >
                <div className="font-medium">{row.question}</div>
                <div className="text-muted-foreground">{row.answer}</div>
                <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground sm:justify-end">
                  <Logo src={row.icon} className="size-4 text-brand-ink" />
                  {row.on}
                </div>
              </div>
            ))}
          </div>
          <ForkFan />
        </Section>

        <Section id="live" title="See it live">
          <p className="reveal mb-6 text-muted-foreground">
            Forkin runs on two real repositories. Every issue there is a real bug with a real test.
          </p>
          <LiveRepos />
        </Section>

        <Section id="agents" title="Bring your agents. Runs on Cloudflare.">
          <p className="reveal text-muted-foreground">
            Agents connect over MCP, the CLI and plain Git.
          </p>
          <div className="reveal mt-6 mb-3 grid grid-cols-2 gap-px bg-foreground/10 ring-1 ring-foreground/10 sm:grid-cols-3 md:grid-cols-6">
            {[...agents, { name: "Plain Git", src: "https://cdn.simpleicons.org/git" }].map((a) => (
              <div
                key={a.name}
                className="flex items-center gap-2 bg-card px-3.5 py-3 text-[0.8125rem] font-medium whitespace-nowrap"
              >
                <Logo src={a.src} className="size-4 text-muted-foreground" />
                {a.name}
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Note title="Sandbox" icon="/cloudflare/sandbox.svg">
              Runs every check offline, from a snapshot of the repo.
            </Note>
            <Note title="Artifacts" icon="/cloudflare/artifacts.svg">
              A mirror per repo, a repo per issue, a fork per fix, verdicts as git notes.
            </Note>
            <Note title="Durable Objects" icon="/cloudflare/durable-objects.svg">
              A Project per repo: issues, fixes and every run, live to every dashboard.
            </Note>
            <Note title="Agents SDK" icon="/cloudflare/agents.svg">
              The MCP server agents connect to, and the live dashboards.
            </Note>
            <Note title="Workers" icon="/cloudflare/workers.svg">
              The API, the dashboard and the GitHub App's webhook, in one Worker.
            </Note>
            <Note title="Workers Logs" icon="/cloudflare/logs.svg">
              Every step, run and error, queryable while it happens.
            </Note>
          </div>
        </Section>

        <Section id="who" title="Who it's for">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Note title="For maintainers" glyph={UserCheck01Icon}>
              Issues that already prove themselves, and fixes you only approve.
            </Note>
            <Note title="For contributors" glyph={Bug01Icon}>
              A failing test moves your bug to the top.
            </Note>
            <Note title="For agents" glyph={RoboticIcon}>
              Fork, fix and prove it, next to any number of others.
            </Note>
          </div>
        </Section>

        <div className={col}>
          {/* Always dark grey, whatever the page theme, so it stands out on either. */}
          <div className="dark reveal mt-20 border bg-[oklch(0.17_0_0)] px-10 py-12 text-foreground max-sm:px-6 max-sm:py-10">
            <h2 className="mb-3 text-[clamp(2rem,4.5vw,2.75rem)] font-medium tracking-[-0.04em]">
              Start forkin<span className="text-primary">'</span> around.
            </h2>
            <p className="mb-7 max-w-[34em] text-muted-foreground">
              MIT licensed. Built on Cloudflare.
            </p>
            <div className="flex flex-wrap gap-3">
              <LiveButton />
              <SourceButton />
            </div>
          </div>
        </div>
      </main>

      <footer
        className={cn(
          col,
          "mt-16 flex flex-wrap justify-between gap-8 border-t pt-8 pb-12 text-sm text-muted-foreground",
        )}
      >
        <a href="#top" aria-label="Forkin, back to top">
          <Mark className="size-7" />
        </a>
        <nav aria-label="Footer" className="flex gap-5 [&_a:hover]:text-foreground">
          <a href={source}>GitHub</a>
          <a href="#top">Back to top ↑</a>
        </nav>
      </footer>
    </div>
  );
}
