import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import css from "#/styles.css?url";
import { themeScript } from "#/theme";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "Forkin" },
      { property: "og:site_name", content: "Forkin" },
      { property: "og:title", content: "Forkin: issues are the new pull requests" },
      {
        property: "og:description",
        content:
          "Forkin reproduces and verifies every issue that comes in, and lets any number of agents find and fix bugs in parallel.",
      },
      { property: "og:image", content: "https://forkin.urjit.me/media/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://forkin.urjit.me/media/og.png" },
    ],
    links: [
      { rel: "icon", href: "/media/favicon.svg", type: "image/svg+xml" },
      { rel: "stylesheet", href: css },
    ],
  }),
  shellComponent: Shell,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body id="top" className="antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
