/** Timezone-aware reporting periods. Pure functions, safe on client and server. */

export const RANGES = ["today", "yesterday", "7d", "this_month", "last_month", "custom"] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_LABELS: Record<Range, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", this_month: "This month", last_month: "Last month", custom: "Custom",
};
export const COMPARES = ["previous", "last_year", "none"] as const;
export type Compare = (typeof COMPARES)[number];
export const COMPARE_LABELS: Record<Compare, string> = { previous: "Previous period", last_year: "Same period last year", none: "No comparison" };
export type Grouping = "hour" | "day" | "week" | "month";

export interface Period {
  range: Range;
  from: Date;
  to: Date; // exclusive
  label: string;
  prev: { from: Date; to: Date } | null;
  grouping: Grouping;
  timezone: string;
}

function parts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}
function offsetMs(d: Date, tz: string) {
  const p = parts(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}
/** The instant of local midnight on the given local calendar date. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  let t = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) t = Date.UTC(y, m - 1, d) - offsetMs(new Date(t), tz);
  return new Date(t);
}
export function localDate(d: Date, tz: string) {
  const p = parts(d, tz);
  return { y: p.y, m: p.m, d: p.d };
}
function addDays(y: number, m: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const isoDate = (x: { y: number; m: number; d: number }) => `${x.y}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;

function groupingFor(days: number): Grouping {
  if (days <= 1) return "hour";
  if (days <= 62) return "day";
  if (days <= 366) return "week";
  return "month";
}

export function resolvePeriod(input: { range?: string; from?: string; to?: string; compare?: string }, tz: string, now = new Date()): Period & { compare: Compare } {
  const range = (RANGES as readonly string[]).includes(input.range ?? "") ? (input.range as Range) : "this_month";
  const compare = (COMPARES as readonly string[]).includes(input.compare ?? "") ? (input.compare as Compare) : "previous";
  const today = localDate(now, tz);
  let a: { y: number; m: number; d: number };
  let b: { y: number; m: number; d: number }; // exclusive end date
  switch (range) {
    case "today": a = today; b = addDays(today.y, today.m, today.d, 1); break;
    case "yesterday": a = addDays(today.y, today.m, today.d, -1); b = today; break;
    case "7d": a = addDays(today.y, today.m, today.d, -6); b = addDays(today.y, today.m, today.d, 1); break;
    case "last_month": {
      const first = { y: today.y, m: today.m, d: 1 };
      a = { y: today.m === 1 ? today.y - 1 : today.y, m: today.m === 1 ? 12 : today.m - 1, d: 1 };
      b = first;
      break;
    }
    case "custom": {
      const re = /^(\d{4})-(\d{2})-(\d{2})$/;
      const f = input.from?.match(re);
      const t = input.to?.match(re);
      if (f && t && input.from! <= input.to!) {
        a = { y: +f[1], m: +f[2], d: +f[3] };
        const end = { y: +t[1], m: +t[2], d: +t[3] };
        b = addDays(end.y, end.m, end.d, 1);
        // Cap at ~2 years to keep queries bounded.
        const span = (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000;
        if (span > 731) a = addDays(b.y, b.m, b.d, -731);
        break;
      }
      a = { y: today.y, m: today.m, d: 1 };
      b = addDays(today.y, today.m, today.d, 1);
      break;
    }
    default: a = { y: today.y, m: today.m, d: 1 }; b = addDays(today.y, today.m, today.d, 1);
  }
  const from = zonedMidnight(a.y, a.m, a.d, tz);
  const to = zonedMidnight(b.y, b.m, b.d, tz);
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
  let prev: Period["prev"] = null;
  if (compare === "previous") {
    if (range === "this_month" || range === "last_month") {
      // Same days of the previous month (month-to-date compares with last month-to-date).
      const pa = { y: a.m === 1 ? a.y - 1 : a.y, m: a.m === 1 ? 12 : a.m - 1, d: 1 };
      const pb = addDays(pa.y, pa.m, pa.d, days);
      const monthEnd = { y: a.y, m: a.m, d: 1 };
      const end = Date.UTC(pb.y, pb.m - 1, pb.d) > Date.UTC(monthEnd.y, monthEnd.m - 1, 1) ? monthEnd : pb;
      prev = { from: zonedMidnight(pa.y, pa.m, pa.d, tz), to: zonedMidnight(end.y, end.m, end.d, tz) };
    } else {
      const pa = addDays(a.y, a.m, a.d, -days);
      prev = { from: zonedMidnight(pa.y, pa.m, pa.d, tz), to: from };
    }
  } else if (compare === "last_year") {
    prev = { from: zonedMidnight(a.y - 1, a.m, a.d, tz), to: zonedMidnight(b.y - 1, b.m, b.d, tz) };
  }
  const last = addDays(b.y, b.m, b.d, -1);
  const label = range === "custom" ? `${isoDate(a)} – ${isoDate(last)}` : RANGE_LABELS[range];
  return { range, compare, from, to, prev, label, grouping: groupingFor(days), timezone: tz };
}

/** Percentage change, or null when there's no meaningful base. */
export function pctChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function greeting(hour: number) {
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
