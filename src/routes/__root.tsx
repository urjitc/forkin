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
