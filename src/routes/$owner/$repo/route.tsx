import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { Menu } from "@base-ui/react/menu";
import { ArrowDown01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ThemeButtons, Wordmark } from "#/components/brand";
import { liveRepos } from "#/dashboard/live-repos";
import { cn } from "#/lib/utils";

// Dashboard frame for one repository, at the same owner/repo path as on GitHub, with its tabs.
export const Route = createFileRoute("/$owner/$repo")({
  head: ({ params }) => ({ meta: [{ title: `${params.owner}/${params.repo} · Forkin` }] }),
  component: RepoLayout,
});

const tab = "-mb-px border-b-2 px-2 py-3 text-sm transition-colors hover:text-foreground";

function RepoLayout() {
  const { owner, repo } = Route.useParams();
  const onEnvironment = useLocation({ select: (l) => l.pathname.endsWith("/environment") });

  return (
    <div className="min-h-svh">
      <header className="border-b bg-background">
        <div className="mx-auto w-[min(1200px,calc(100%-3rem))]">
          <div className="flex h-14 items-center gap-3">
            <Link to="/">
              <Wordmark className="text-lg" markClassName="size-5.5" />
            </Link>
            <span className="text-muted-foreground/60">/</span>
            <Link to="/$owner/$repo" params={{ owner, repo }} className="text-lg">
              {owner} / <b className="font-semibold">{repo}</b>
            </Link>
            <RepoSwitcher owner={owner} repo={repo} />
            <a
              href={`https://github.com/${owner}/${repo}`}
              className="text-muted-foreground hover:text-foreground"
              title="This repo on GitHub"
              data-tab
            >
              <HugeiconsIcon icon={GithubIcon} className="size-4.5" />
            </a>
            <span className="ml-auto" />
            <ThemeButtons />
          </div>
          <nav className="flex gap-4" aria-label="Repository">
            <Link
              data-tab
              to="/$owner/$repo"
              params={{ owner, repo }}
              className={cn(
                tab,
                onEnvironment
                  ? "border-transparent text-muted-foreground"
                  : "border-primary font-medium text-foreground",
              )}
            >
              Issues
            </Link>
            <Link
              data-tab
              to="/$owner/$repo/environment"
              params={{ owner, repo }}
              className={cn(
                tab,
                onEnvironment
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground",
              )}
            >
              Environment
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-[min(1200px,calc(100%-3rem))] py-8">
        <Outlet />
      </main>
    </div>
  );
}

/** Jumps to the other repos Forkin runs on in public, as GitHub's repo menu does. */
function RepoSwitcher({ owner, repo }: { owner: string; repo: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Switch repository"
        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-50">
          <Menu.Popup className="min-w-72 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
            {liveRepos.map((live) => (
              <Menu.LinkItem
                key={`${live.owner}/${live.repo}`}
                render={<Link to="/$owner/$repo" params={{ owner: live.owner, repo: live.repo }} />}
                closeOnClick
                className="flex items-center gap-2.5 rounded-sm px-2.5 py-2 outline-none data-highlighted:bg-muted"
              >
                <img src={live.avatar} alt="" className="size-5 rounded-sm" />
                <span className="flex-1">
                  {live.owner} / <b className="font-semibold">{live.repo}</b>
                </span>
                {live.owner === owner.toLowerCase() && live.repo === repo.toLowerCase() && (
                  <span className="text-muted-foreground">Current</span>
                )}
              </Menu.LinkItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
