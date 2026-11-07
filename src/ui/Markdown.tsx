import { Fragment, type ReactNode } from "react";
import { parse, type Block, type Inline } from "../core/markdown";
import { openUrl } from "../platform";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i): ReactNode => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "code":
            return <code key={i}>{n.v}</code>;
          case "strong":
            return (
              <strong key={i}>
                <Inlines nodes={n.c} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            );
          case "link":
            // Opens in the system browser; the address shows on hover, so the words can't hide it.
            return (
              <a
                key={i}
                href={n.href}
                title={n.href}
                onClick={(ev) => {
                  ev.preventDefault();
                  void openUrl(n.href);
                }}
              >
                <Inlines nodes={n.c} />
              </a>
            );
        }
      })}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p":
      return (
        <p>
          <Inlines nodes={b.c} />
        </p>
      );
    case "h": {
      const H = (`h${b.level + 2}` as "h3" | "h4" | "h5");
      return (
        <H>
          <Inlines nodes={b.c} />
        </H>
      );
    }
    case "code":
      return (
        <pre className="codeblock" data-lang={b.lang || undefined}>
          <code>{b.v}</code>
        </pre>
      );
    case "ul":
      return (
        <ul>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inlines nodes={it} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol start={b.start}>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inlines nodes={it} />
            </li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote>
          <Inlines nodes={b.c} />
        </blockquote>
      );
    case "table":
      return (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i}>
                    <Inlines nodes={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      <Inlines nodes={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr />;
  }
}

/** An agent's answer, with its formatting, drawn as React elements (never HTML). */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="bubble md">
      {parse(text).map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  );
}
