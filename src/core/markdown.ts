/**
 * A small, safe Markdown reader for agent answers. It never produces HTML: it returns a
 * tree the UI draws as React elements, so model output can't inject markup or script.
 * Links are kept only for https (and mailto); anything else stays plain text.
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^https:\/\/[^\s<>"']+$/i.test(h) || /^mailto:[^\s<>"']+$/i.test(h) ? h : null;
}

export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^`([^`\n]+)`/))) {
      flush();
      out.push({ t: "code", v: m[1] });
    } else if ((m = rest.match(/^\*\*([^*\n]+?)\*\*/)) || (m = rest.match(/^__([^_\n]+?)__/))) {
      flush();
      out.push({ t: "strong", c: inline(m[1]) });
    } else if ((m = rest.match(/^\*([^*\n]+?)\*/)) || (m = rest.match(/^_([^_\n]+?)_(?![A-Za-z0-9])/))) {
      flush();
      out.push({ t: "em", c: inline(m[1]) });
    } else if ((m = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/))) {
      flush();
      const href = safeHref(m[2]);
      if (href) out.push({ t: "link", href, c: inline(m[1]) });
      else out.push({ t: "text", v: m[1] });
    } else {
      text += src[i];
      i += 1;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => inline(c.trim()));

export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ t: "p", c: inline(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*```\s*([\w+-]*)\s*$/))) {
      endPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ t: "code", lang: m[1] || "", v: body.join("\n") });
    } else if (!line.trim()) {
      endPara();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      endPara();
      blocks.push({ t: "h", level: Math.min(3, m[1].length) as 1 | 2 | 3, c: inline(m[2]) });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endPara();
      blocks.push({ t: "hr" });
    } else if (/^\s*[-*+]\s+/.test(line)) {
      endPara();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*[-*+]\s+/, "")));
      i--;
      blocks.push({ t: "ul", items });
    } else if ((m = line.match(/^\s*(\d{1,9})[.)]\s+/))) {
      endPara();
      const start = Number(m[1]);
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*\d{1,9}[.)]\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*\d{1,9}[.)]\s+/, "")));
      i--;
      blocks.push({ t: "ol", start, items });
    } else if (/^\s*>/.test(line)) {
      endPara();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      i--;
      blocks.push({ t: "quote", c: inline(body.join("\n")) });
    } else if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      endPara();
      const head = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      blocks.push({ t: "table", head, rows });
    } else {
      para.push(line);
    }
  }
  endPara();
  return blocks;
}
