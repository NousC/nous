import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CSSProperties } from "react";

// Renders a markdown document (note / report / playbook / brief) as a clean,
// professional page. Keeps the llms.txt monospace look so it still reads like a
// served text file, but renders the structure — real headings, bullets,
// blockquotes, a divider, tables — instead of showing raw '#', '##', '>' symbols.
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const wrap: CSSProperties = {
  maxWidth: "880px",
  margin: "0 auto",
  padding: "48px 40px 96px",
  fontFamily: MONO,
  fontSize: "14px",
  lineHeight: 1.7,
  color: "#1a1a1a",
  background: "#ffffff",
};

const h1: CSSProperties = { fontSize: "26px", fontWeight: 700, lineHeight: 1.25, margin: "0 0 20px" };
const h2: CSSProperties = { fontSize: "18px", fontWeight: 700, margin: "36px 0 14px", paddingBottom: "6px", borderBottom: "1px solid #ececec" };
const h3: CSSProperties = { fontSize: "15px", fontWeight: 700, margin: "26px 0 10px" };
const p: CSSProperties = { margin: "0 0 16px" };
const blockquote: CSSProperties = { borderLeft: "3px solid #d4d4d4", paddingLeft: "16px", margin: "0 0 18px", color: "#555" };
const list: CSSProperties = { margin: "0 0 16px", paddingLeft: "22px" };
const li: CSSProperties = { margin: "0 0 6px" };
const hr: CSSProperties = { border: "none", borderTop: "1px solid #e4e4e4", margin: "32px 0" };
const inlineCode: CSSProperties = { fontFamily: MONO, fontSize: "13px", background: "#f3f3f3", padding: "1px 5px", borderRadius: "4px" };
const codeBlock: CSSProperties = { fontFamily: MONO, fontSize: "13px", background: "#f6f8fa", padding: "14px 16px", borderRadius: "8px", overflowX: "auto", margin: "0 0 18px", lineHeight: 1.5 };
const table: CSSProperties = { borderCollapse: "collapse", margin: "0 0 18px", fontSize: "13px", display: "block", overflowX: "auto" };
const th: CSSProperties = { border: "1px solid #e4e4e4", padding: "6px 10px", textAlign: "left", background: "#f6f6f6", fontWeight: 700 };
const td: CSSProperties = { border: "1px solid #e4e4e4", padding: "6px 10px", textAlign: "left", verticalAlign: "top" };
const link: CSSProperties = { color: "#2563eb", textDecoration: "underline", wordBreak: "break-word" };

export default function MarkdownDoc({ children }: { children: string }) {
  return (
    <div style={wrap}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={h1}>{children}</h1>,
          h2: ({ children }) => <h2 style={h2}>{children}</h2>,
          h3: ({ children }) => <h3 style={h3}>{children}</h3>,
          h4: ({ children }) => <h3 style={h3}>{children}</h3>,
          p: ({ children }) => <p style={p}>{children}</p>,
          blockquote: ({ children }) => <blockquote style={blockquote}>{children}</blockquote>,
          ul: ({ children }) => <ul style={list}>{children}</ul>,
          ol: ({ children }) => <ol style={list}>{children}</ol>,
          li: ({ children }) => <li style={li}>{children}</li>,
          hr: () => <hr style={hr} />,
          a: ({ children, href }) => <a style={link} href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
          strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
          table: ({ children }) => <table style={table}>{children}</table>,
          th: ({ children }) => <th style={th}>{children}</th>,
          td: ({ children }) => <td style={td}>{children}</td>,
          code: ({ className, children }) => {
            const block = /language-/.test(className || "");
            return block
              ? <pre style={codeBlock}><code>{children}</code></pre>
              : <code style={inlineCode}>{children}</code>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
