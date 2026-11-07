import { useId } from "react";

const LEAF =
  "M32 7.5 C33.4 11.6 36.4 14.6 40.2 18.6 C44.2 22.8 46.6 26.8 46.6 31.6 C46.6 40.4 40.2 46.8 32 50.5 C23.8 46.8 17.4 40.4 17.4 31.6 C17.4 26.8 19.8 22.8 23.8 18.6 C27.6 14.6 30.6 11.6 32 7.5 Z";

/** Mystic's mark: the Earth Care leaf with four agents joined into one constellation (brand/mark.svg). */
export function Mark({ big = false }: { big?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`mark ${big ? "big" : ""}`} viewBox="0 0 64 64" aria-hidden focusable="false">
      <defs>
        <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d={LEAF} fill="#000" stroke="#000" strokeWidth="4.3" strokeLinejoin="round" />
        </mask>
      </defs>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <g mask={`url(#m${id})`} strokeWidth={big ? 1.25 : 1.9}>
          <path d="M4.08 35.2 C11.5 36 21 39 30 46.5" />
          <path d="M59.92 35.2 C52.5 36 43 39 34 46.5" />
          <path d="M4.08 35.2 C10 43.5 21 51.8 32 54.4" />
          <path d="M59.92 35.2 C54 43.5 43 51.8 32 54.4" />
        </g>
        <path d={LEAF} strokeWidth={big ? 1.5 : 2.4} />
        <path d="M32 13 V59.2" strokeWidth={big ? 1.25 : 1.9} />
        <path d="M32 21.2 L24.2 31 L32 40.8 L39.8 31 Z" strokeWidth={big ? 0.9 : 1.5} />
        {[
          [32, 21.2],
          [24.2, 31],
          [39.8, 31],
          [32, 40.8],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={big ? 2.1 : 3} fill="currentColor" stroke="none" />
        ))}
      </g>
    </svg>
  );
}
