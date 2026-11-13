import { describe, expect, it } from "vitest";
import { parseDuration, addBusinessMinutes, ALWAYS_ON, businessMinutesBetween, type Calendar, DEFAULT_SCHEDULE, formatMinutes, isWorkingTime, toHhmm, toMinutes, wallTime } from "@/domains/support/business-time";

const chicago: Calendar = { mode: "business", timezone: "America/Chicago", schedule: DEFAULT_SCHEDULE, holidays: new Set() };
const lagos: Calendar = { mode: "business", timezone: "Africa/Lagos", schedule: { "1": [[480, 720], [780, 1020]], "6": [[600, 840]] }, holidays: new Set() };
const at = (s: string) => new Date(s);

describe("business time", () => {
  it("adds minutes inside the same working day", () => {
    // Tue 2026-11-10 10:00 CST = 16:00Z
    expect(addBusinessMinutes(at("2026-11-10T16:00:00Z"), 120, chicago).toISOString()).toBe("2026-11-10T18:00:00.000Z");
  });

  it("carries over the evening and the weekend", () => {
    // Fri 2026-11-13 16:00 CST + 2h → Mon 10:00 CST
    expect(addBusinessMinutes(at("2026-11-13T22:00:00Z"), 120, chicago).toISOString()).toBe("2026-11-16T16:00:00.000Z");
  });

  it("starts the clock at opening time when created outside hours", () => {
    // Sun 2026-11-15 20:00 CST + 30m → Mon 09:30 CST
    expect(addBusinessMinutes(at("2026-11-16T02:00:00Z"), 30, chicago).toISOString()).toBe("2026-11-16T15:30:00.000Z");
  });

  it("skips holidays", () => {
    const cal = { ...chicago, holidays: new Set(["2026-11-26"]) }; // Thanksgiving Thu
    // Wed 16:00 CST + 2h → Fri 10:00 CST
    expect(addBusinessMinutes(at("2026-11-25T22:00:00Z"), 120, cal).toISOString()).toBe("2026-11-27T16:00:00.000Z");
  });

  it("handles split shifts", () => {
    // Mon 2026-11-16 11:00 WAT (10:00Z) + 3h: 1h until 12:00, lunch, 2h from 13:00 → 15:00 WAT
    expect(addBusinessMinutes(at("2026-11-16T10:00:00Z"), 180, lagos).toISOString()).toBe("2026-11-16T14:00:00.000Z");
  });

  it("is DST-safe: working hours stay at local wall time across the change", () => {
    // DST ends Sun 2026-11-01 in Chicago. Fri Oct 30 16:00 CDT (21:00Z) + 2h → Mon Nov 2 10:00 CST (16:00Z)
    expect(addBusinessMinutes(at("2026-10-30T21:00:00Z"), 120, chicago).toISOString()).toBe("2026-11-02T16:00:00.000Z");
    // Spring forward Sun 2027-03-14: Mon 09:00 CDT is 14:00Z
    expect(wallTime(2027, 3, 15, 540, "America/Chicago").toISOString()).toBe("2027-03-15T14:00:00.000Z");
  });

  it("counts working minutes between instants", () => {
    // Fri 16:00 CST → Mon 10:00 CST = 60 + 60
    expect(businessMinutesBetween(at("2026-11-13T22:00:00Z"), at("2026-11-16T16:00:00Z"), chicago)).toBe(120);
    expect(businessMinutesBetween(at("2026-11-16T16:00:00Z"), at("2026-11-13T22:00:00Z"), chicago)).toBe(0);
    // Inverse of addBusinessMinutes
    const start = at("2026-11-11T20:17:00Z");
    expect(businessMinutesBetween(start, addBusinessMinutes(start, 1234, chicago), chicago)).toBe(1234);
  });

  it("24/7 is plain wall-clock time", () => {
    expect(addBusinessMinutes(at("2026-11-14T03:00:00Z"), 90, ALWAYS_ON).toISOString()).toBe("2026-11-14T04:30:00.000Z");
    expect(businessMinutesBetween(at("2026-11-14T03:00:00Z"), at("2026-11-14T04:30:00Z"), ALWAYS_ON)).toBe(90);
  });

  it("knows whether a moment is inside working hours", () => {
    expect(isWorkingTime(at("2026-11-10T16:00:00Z"), chicago)).toBe(true); // Tue 10:00
    expect(isWorkingTime(at("2026-11-15T16:00:00Z"), chicago)).toBe(false); // Sun
    expect(isWorkingTime(at("2026-11-16T11:30:00Z"), lagos)).toBe(false); // Mon 12:30 lunch
  });

  it("parses and formats", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("24:00")).toBe(1440);
    expect(toMinutes("25:00")).toBeNull();
    expect(toHhmm(570)).toBe("09:30");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(1440)).toBe("1d");
    expect(formatMinutes(2160)).toBe("36h");
    expect(formatMinutes(45)).toBe("45m");
    expect(parseDuration("30m")).toBe(30);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("2d")).toBe(2880);
    expect(parseDuration("4")).toBe(240);
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});
