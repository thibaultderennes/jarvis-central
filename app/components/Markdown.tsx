import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// No raw HTML: react-markdown escapes it by default, so review text can't inject markup.
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        table: ({ children }) => <div className="tw"><table>{children}</table></div>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      }}>{children}</ReactMarkdown>
    </div>
  );
}
