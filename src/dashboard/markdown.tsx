import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Text people write, rendered as GitHub-flavoured Markdown. Raw HTML in it is shown as text, never
 * run, since descriptions come from anyone who files an issue.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
