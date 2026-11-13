/**
 * Business-time arithmetic for SLAs: working hours per weekday in the workspace's timezone,
 * minus holidays. Pure functions; DST-safe because every boundary is converted from local wall
 * time to an instant for that specific day.
 */

/** Minutes after local midnight, [start, end). Weekday keys 0 = Sunday … 6 = Saturday. */
export type Interval = [number, number];
export type WeekSchedule = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", Interval[]>>;

export interface Calendar {
  mode: "business" | "24x7";
  timezone: string;
  schedule: WeekSchedule;
  /** Local dates (YYYY-MM-DD) with no working hours. */
  holidays: Set<string>;
}

export const ALWAYS_ON: Calendar = { mode: "24x7", timezone: "UTC", schedule: {}, holidays: new Set() };

export const DEFAULT_SCHEDULE: WeekSchedule = {
  "1": [[540, 1020]], "2": [[540, 1020]], "3": [[540, 1020]], "4": [[540, 1020]], "5": [[540, 1020]],
};

const MAX_DAYS = 400;
const MIN = 60_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  return f;
}
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function local(d: Date, tz: string) {
  const p = fmt(tz).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { y: +g("year"), m: +g("month"), d: +g("day"), h: +g("hour"), min: +g("minute"), s: +g("second"), wd: WEEKDAY[g("weekday")] };
}
function offsetMs(d: Date, tz: string) {
  const p = local(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}
/** Instant of a local wall-clock time (minutes after midnight) on a local date. */
export function wallTime(y: number, m: number, d: number, minuteOfDay: number, tz: string): Date {
  const target = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  let t = target;
  for (let i = 0; i < 3; i++) t = target - offsetMs(new Date(t), tz);
  return new Date(t);
}
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function nextDay(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
}

/** Working windows (as instants) day by day, starting with the local day containing `from`. */
function* windows(cal: Calendar, from: Date): Generator<[number, number]> {
  const l = local(from, cal.timezone);
  let day = { y: l.y, m: l.m, d: l.d, wd: l.wd };
  for (let i = 0; i < MAX_DAYS; i++) {
    if (!cal.holidays.has(iso(day.y, day.m, day.d))) {
      const list = [...(cal.schedule[String(day.wd) as keyof WeekSchedule] ?? [])].sort((a, b) => a[0] - b[0]);
      for (const [a, b] of list) yield [wallTime(day.y, day.m, day.d, a, cal.timezone).getTime(), wallTime(day.y, day.m, day.d, b, cal.timezone).getTime()];
    }
    day = nextDay(day.y, day.m, day.d);
  }
}

export function hasWorkingTime(schedule: WeekSchedule) {
  return Object.values(schedule).some((l) => (l ?? []).some(([a, b]) => b > a));
}

/** The instant `minutes` of working time after `start`. */
export function addBusinessMinutes(start: Date, minutes: number, cal: Calendar): Date {
  if (cal.mode === "24x7" || !hasWorkingTime(cal.schedule)) return new Date(start.getTime() + minutes * MIN);
  let remaining = minutes * MIN;
  const s = start.getTime();
  for (const [a, b] of windows(cal, start)) {
    if (b <= s) continue;
    const from = Math.max(a, s);
    if (remaining <= b - from) return new Date(from + remaining);
    remaining -= b - from;
  }
  // Calendar with almost no working time: fall back to wall-clock so a due date always exists.
  return new Date(s + minutes * MIN);
}

/** Working minutes between two instants (0 if b ≤ a). */
export function businessMinutesBetween(a: Date, b: Date, cal: Calendar): number {
  if (b <= a) return 0;
  if (cal.mode === "24x7" || !hasWorkingTime(cal.schedule)) return Math.floor((b.getTime() - a.getTime()) / MIN);
  let total = 0;
  const s = a.getTime();
  const e = b.getTime();
  for (const [wa, wb] of windows(cal, a)) {
    if (wa >= e) break;
    if (wb <= s) continue;
    total += Math.min(wb, e) - Math.max(wa, s);
  }
  return Math.floor(total / MIN);
}

/** Whether `at` falls inside working hours. */
export function isWorkingTime(at: Date, cal: Calendar): boolean {
  if (cal.mode === "24x7" || !hasWorkingTime(cal.schedule)) return true;
  const t = at.getTime();
  for (const [a, b] of windows(cal, at)) {
    if (a > t) return false;
    if (t < b) return true;
  }
  return false;
}

/** "09:00" ↔ 540 */
export const toMinutes = (hhmm: string) => {
  const m = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return v <= 1440 ? v : null;
};
export const toHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Human duration for targets: 90 → "1h 30m", 1440 → "1d", 2160 → "36h". */
export function formatMinutes(min: number) {
  if (min < 60) return `${min}m`;
  if (min % 1440 === 0) return `${min / 1440}d`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "30m", "4h", "1h 30m", "2d" (working days count as 24h of clock time per day) → minutes; bare numbers are hours. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60) || null;
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(d|h|m)/g;
  let consumed = "";
  for (const m of s.matchAll(re)) {
    total += parseFloat(m[1]) * (m[2] === "d" ? 1440 : m[2] === "h" ? 60 : 1);
    consumed += m[0];
  }
  if (consumed.replace(/\s/g, "") !== s.replace(/\s/g, "")) return null;
  return total > 0 ? Math.round(total) : null;
}
