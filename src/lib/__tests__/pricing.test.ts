import { describe, expect, it } from "vitest";
import {
  calculateMessageCost,
  formatCost,
  formatDuration,
  getPricingForModel,
} from "@/lib/pricing";

describe("pricing.getPricingForModel", () => {
  it("returns explicit pricing for a known Claude Sonnet 4.6 model", () => {
    const pricing = getPricingForModel("claude-sonnet-4.6", "claude");
    expect(pricing.input).toBeGreaterThan(0);
    expect(pricing.output).toBeGreaterThan(0);
    expect(pricing.cacheRead).toBeGreaterThanOrEqual(0);
    expect(pricing.cacheWrite).toBeGreaterThanOrEqual(0);
  });

  it("returns positive prices for a Claude Opus 4.7 model", () => {
    const pricing = getPricingForModel("claude-opus-4.7", "claude");
    expect(pricing.input).toBeGreaterThan(0);
    expect(pricing.output).toBeGreaterThan(pricing.input);
  });

  it("falls back to a default pricing when model is unknown", () => {
    const pricing = getPricingForModel("totally-unknown-model");
    expect(pricing).toBeDefined();
    expect(typeof pricing.input).toBe("number");
    expect(typeof pricing.output).toBe("number");
  });
});

describe("pricing.calculateMessageCost", () => {
  it("returns 0 when all token counts are 0", () => {
    const cost = calculateMessageCost(
      { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
      "claude-sonnet-4.6",
      "claude",
    );
    expect(cost).toBe(0);
  });

  it("scales linearly with token counts", () => {
    const cost1 = calculateMessageCost(
      { input_tokens: 1000, output_tokens: 1000, cache_creation_tokens: 0, cache_read_tokens: 0 },
      "claude-sonnet-4.6",
      "claude",
    );
    const cost2 = calculateMessageCost(
      { input_tokens: 2000, output_tokens: 2000, cache_creation_tokens: 0, cache_read_tokens: 0 },
      "claude-sonnet-4.6",
      "claude",
    );
    expect(cost2).toBeCloseTo(cost1 * 2, 8);
  });

  it("output tokens cost more than input tokens for the same volume", () => {
    const inputOnly = calculateMessageCost(
      { input_tokens: 1_000_000, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
      "claude-sonnet-4.6",
      "claude",
    );
    const outputOnly = calculateMessageCost(
      { input_tokens: 0, output_tokens: 1_000_000, cache_creation_tokens: 0, cache_read_tokens: 0 },
      "claude-sonnet-4.6",
      "claude",
    );
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });

  it("cache reads cost less than fresh input for the same volume", () => {
    const freshInput = calculateMessageCost(
      { input_tokens: 1_000_000, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
      "claude-sonnet-4.6",
      "claude",
    );
    const cachedRead = calculateMessageCost(
      { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 1_000_000 },
      "claude-sonnet-4.6",
      "claude",
    );
    expect(cachedRead).toBeLessThan(freshInput);
  });
});

describe("pricing.formatCost", () => {
  it("returns $0.00 for zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("uses cent notation for sub-cent amounts", () => {
    expect(formatCost(0.001)).toContain("¢");
  });

  it("uses dollar notation for amounts >= 1 cent", () => {
    expect(formatCost(0.5)).toBe("$0.5000");
  });
});

describe("pricing.formatDuration", () => {
  it("formats seconds-only durations", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minute+second durations", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("drops the seconds part when zero", () => {
    expect(formatDuration(180)).toBe("3m");
  });

  it("formats hour+minute durations", () => {
    expect(formatDuration(3 * 3600 + 30 * 60)).toBe("3h 30m");
  });

  it("drops the minutes part when zero", () => {
    expect(formatDuration(2 * 3600)).toBe("2h");
  });
});
