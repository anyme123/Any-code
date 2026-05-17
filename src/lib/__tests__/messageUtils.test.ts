import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatTimestamp } from "@/lib/messageUtils";

describe("messageUtils.formatTimestamp", () => {
  it("returns empty string when undefined", () => {
    expect(formatTimestamp(undefined)).toBe("");
  });

  it("returns empty string for malformed input", () => {
    expect(formatTimestamp("not-a-real-date")).toBe("");
  });

  it("formats a valid ISO timestamp into HH:MM:SS-like form", () => {
    const iso = new Date(2025, 0, 1, 14, 30, 25).toISOString();
    const result = formatTimestamp(iso);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe("messageUtils.formatRelativeTime", () => {
  it("returns empty string when undefined", () => {
    expect(formatRelativeTime(undefined)).toBe("");
  });

  it("returns '刚刚' for a very recent timestamp", () => {
    const iso = new Date(Date.now() - 1000).toISOString();
    expect(formatRelativeTime(iso)).toBe("刚刚");
  });

  it("returns minute-granularity string for sub-hour deltas", () => {
    const iso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso)).toBe("5分钟前");
  });

  it("returns hour-granularity string for sub-day deltas", () => {
    const iso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso)).toBe("2小时前");
  });

  it("returns day-granularity string for sub-week deltas", () => {
    const iso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso)).toBe("3天前");
  });

  it("falls back to absolute timestamp for older entries", () => {
    const iso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
