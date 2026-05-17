import { describe, expect, it } from "vitest";
import {
  formatAbsoluteDateTime,
  formatISOTimestamp,
  formatTimeAgo,
  formatUnixTimestamp,
  getFirstLine,
  truncateText,
} from "@/lib/date-utils";

describe("date-utils.formatUnixTimestamp", () => {
  it("formats a Unix timestamp to yy-MM-dd HH:mm in local time", () => {
    // Construct a known local date so the test is locale-stable.
    const local = new Date(2024, 11, 30, 14, 30, 0);
    const result = formatUnixTimestamp(Math.floor(local.getTime() / 1000));
    expect(result).toBe("24-12-30 14:30");
  });
});

describe("date-utils.formatAbsoluteDateTime", () => {
  it("uses a full 4-digit year", () => {
    const local = new Date(2025, 0, 4, 10, 13, 0);
    const result = formatAbsoluteDateTime(Math.floor(local.getTime() / 1000));
    expect(result).toBe("2025-01-04 10:13");
  });
});

describe("date-utils.formatISOTimestamp", () => {
  it("converts an ISO string to short format", () => {
    const local = new Date(2025, 0, 4, 10, 13, 29);
    const result = formatISOTimestamp(local.toISOString());
    expect(result).toMatch(/^25-01-04 \d{2}:\d{2}$/);
  });
});

describe("date-utils.truncateText", () => {
  it("returns the original string when below the limit", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("truncates and appends an ellipsis", () => {
    expect(truncateText("hello world", 8)).toBe("hello...");
  });

  it("handles the equality edge case (no truncation when equal)", () => {
    expect(truncateText("12345", 5)).toBe("12345");
  });
});

describe("date-utils.getFirstLine", () => {
  it("returns the first line of a multi-line string", () => {
    expect(getFirstLine("first\nsecond\nthird")).toBe("first");
  });

  it("returns the original string when single line", () => {
    expect(getFirstLine("only one")).toBe("only one");
  });

  it("returns empty string for empty input", () => {
    expect(getFirstLine("")).toBe("");
  });
});

describe("date-utils.formatTimeAgo", () => {
  it("returns 'just now' for very recent timestamps", () => {
    expect(formatTimeAgo(Date.now() - 100)).toBe("just now");
  });

  it("returns minute-granularity for sub-hour deltas", () => {
    const result = formatTimeAgo(Date.now() - 5 * 60 * 1000);
    expect(result).toMatch(/^5 minutes ago$/);
  });

  it("returns hour-granularity for sub-day deltas", () => {
    const result = formatTimeAgo(Date.now() - 2 * 60 * 60 * 1000);
    expect(result).toMatch(/^2 hours ago$/);
  });

  it("uses singular form for exactly 1 unit", () => {
    expect(formatTimeAgo(Date.now() - 60 * 1000)).toBe("1 minute ago");
    expect(formatTimeAgo(Date.now() - 60 * 60 * 1000)).toBe("1 hour ago");
    expect(formatTimeAgo(Date.now() - 24 * 60 * 60 * 1000)).toBe("1 day ago");
  });

  it("uses year granularity for very old timestamps", () => {
    const twoYearsAgo = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
    expect(formatTimeAgo(twoYearsAgo)).toBe("2 years ago");
  });
});
