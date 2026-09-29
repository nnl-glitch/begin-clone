import React from "react";
import ReactMarkdown from "react-markdown";

/**
 * Renders Companion output with **bold**, *italic*, line breaks, and lists.
 * Keeps everything inside the parent's typographic scale — no headings, no
 * code, no images (the Companion shouldn't emit those anyway).
 */
export function Markdown({ children, className = "" }) {
  return (
    <div
      className={`markdown-body ${className}`}
      style={{ fontSize: "inherit", lineHeight: "inherit" }}
    >
      <ReactMarkdown
        components={{
          // p inherits font-size AND line-height from the parent bubble so
          // user (brown) and Jupiter (navy) bubbles render at identical size.
          p: ({ node, ...p }) => (
            <p
              className="my-3 first:mt-0 last:mb-0"
              style={{ fontSize: "inherit", lineHeight: "inherit" }}
              {...p}
            />
          ),
          strong: ({ node, ...p }) => <strong className="font-semibold" {...p} />,
          em: ({ node, ...p }) => <em className="italic" {...p} />,
          ul: ({ node, ...p }) => <ul className="list-disc pl-5 my-2 space-y-1" {...p} />,
          ol: ({ node, ...p }) => <ol className="list-decimal pl-5 my-2 space-y-1" {...p} />,
          li: ({ node, ...p }) => <li style={{ fontSize: "inherit", lineHeight: "inherit" }} {...p} />,
          h1: ({ node, ...p }) => <p className="font-serif-reader text-lg my-3" {...p} />,
          h2: ({ node, ...p }) => <p className="font-serif-reader text-base my-2" {...p} />,
          h3: ({ node, ...p }) => <p className="font-serif-reader text-base my-2" {...p} />,
          blockquote: ({ node, ...p }) => (
            <blockquote className="border-l-2 pl-3 italic my-3" style={{ borderColor: "var(--sc-accent-primary)", fontSize: "inherit", lineHeight: "inherit" }} {...p} />
          ),
          a: ({ node, ...p }) => <a className="underline" {...p} />,
          code: ({ node, inline, ...p }) => (
            inline ? <code className="px-1 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)" }} {...p} />
                  : <pre className="p-3 rounded my-3 overflow-x-auto text-xs" style={{ background: "rgba(255,255,255,0.06)" }}><code {...p} /></pre>
          ),
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
