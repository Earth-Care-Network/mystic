/**
 * Schedules in plain language ("every weekday at 8am", "daily at 7:30",
 * "every 2 hours", "mondays at 9"), as Turnstone and OpenDuet's routines take
 * them. Parsing is deterministic: no model call decides when work runs.
 */
export type Schedule =
  | { kind: "daily"; hour: number; minute: number; days: number[] } // days: 0=Sun..6=Sat
  | { kind: "interval"; minutes: number };

const DAY: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
/** OpenBot's floor: nothing runs more often than every 15 minutes. */
export const MIN_INTERVAL_MINUTES = 15;

function time(text: string): { hour: number; minute: number } | null {
  if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0 };
  // A time is a number after "at" or one with am/pm or minutes, never the 2 in "every 2 hours".
  const m =
    text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) ||
    text.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/) ||
    text.match(/\b(\d{1,2})()\s*(am|pm)\b/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const ampm = m[3];
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function parseSchedule(input: string): Schedule | null {
  const text = input.toLowerCase().trim();
  // Units this parser can't run yet: refuse rather than guess "daily".
  if (/\b(every\s+(other|\d+)\s+(day|week|month)s?|fortnight|monthly|biweekly|every\s+month)\b/.test(text)) return null;
  const every = text.match(/every\s+(\d+)?\s*(minute|min|hour|hr)s?\b/);
  if (every) {
    const n = Number(every[1] || 1);
    const minutes = every[2].startsWith("h") ? n * 60 : n;
    return { kind: "interval", minutes: Math.max(MIN_INTERVAL_MINUTES, minutes) };
  }
  if (/\bhourly\b/.test(text)) return { kind: "interval", minutes: 60 };
  const t = time(text) || (/(morning)/.test(text) ? { hour: 8, minute: 0 } : null);
  if (!t) return null;
  let days = ALL;
  if (/weekday|work ?day|mon(day)?\s*(-|to|through)\s*fri(day)?/.test(text)) days = WEEKDAYS;
  else if (/weekend/.test(text)) days = [0, 6];
  else {
    const named = Object.entries(DAY)
      .filter(([k]) => new RegExp(`\\b${k}(?:[a-z]*day)?s?\\b`).test(text))
      .map(([, v]) => v);
    if (named.length) days = named.sort();
  }
  return { kind: "daily", ...t, days };
}

export function nextRun(s: Schedule, after: Date): Date {
  if (s.kind === "interval") return new Date(after.getTime() + s.minutes * 60_000);
  for (let add = 0; add <= 7; add++) {
    const d = new Date(after);
    d.setDate(d.getDate() + add);
    d.setHours(s.hour, s.minute, 0, 0);
    if (d > after && s.days.includes(d.getDay())) return d;
  }
  return new Date(after.getTime() + 86_400_000);
}

export function describe(s: Schedule): string {
  if (s.kind === "interval") return s.minutes % 60 === 0 ? `Every ${s.minutes / 60 === 1 ? "hour" : `${s.minutes / 60} hours`}` : `Every ${s.minutes} minutes`;
  const hh = ((s.hour + 11) % 12) + 1;
  const at = `${hh}${s.minute ? `:${String(s.minute).padStart(2, "0")}` : ""} ${s.hour < 12 ? "am" : "pm"}`;
  const days =
    s.days.length === 7 ? "Every day" : s.days.join() === WEEKDAYS.join() ? "Weekdays" : s.days.map((d) => Object.keys(DAY)[d].replace(/^./, (c) => c.toUpperCase())).join(", ");
  return `${days} at ${at}`;
}
