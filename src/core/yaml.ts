/** A small YAML writer for OpenDuet tenant packages (strings, numbers, booleans, lists, maps). */
function scalar(v: unknown, pad = ""): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (/[\r\t\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) return JSON.stringify(s);
  if (s.includes("\n")) return `|-\n${s.split("\n").map((l) => (l ? `${pad}  ${l}` : "")).join("\n")}`;
  if (s === "" || /^[-?:,\[\]{}#&*!|>'"%@`\s]|: | #|:$|\s$/.test(s) || /^(true|false|null|yes|no|on|off|~|[-+]?\d+(\.\d+)?)$/i.test(s)) return JSON.stringify(s);
  return s;
}

export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]\n`;
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const body = toYaml(item, indent + 1).replace(/^\s+/, "");
          return `${pad}- ${body}`;
        }
        return `${pad}- ${scalar(item)}\n`;
      })
      .join("");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (Array.isArray(v) && v.length === 0) return `${pad}${k}: []\n`;
        if (v && typeof v === "object") return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        return `${pad}${k}: ${scalar(v, pad)}\n`;
      })
      .join("");
  }
  return `${pad}${scalar(value)}\n`;
}
