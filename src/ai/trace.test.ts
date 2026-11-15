import { describe, expect, it } from "vitest";
import { clearTrace, recordStep, startTrace, tally, traceSteps } from "./trace";

const step = (tool: string, ms: number, error = false) => ({ at: 0, ms, who: "Claude", tool, args: {}, text: "x".repeat(10), error });

describe("the AI trail", () => {
  it("keeps nothing until Duet dev turns it on", () => {
    recordStep(step("get_outline", 5));
    expect(traceSteps()).toHaveLength(0);
  });

  it("numbers each step and counts each tool, most used first", () => {
    startTrace();
    clearTrace();
    recordStep(step("get_outline", 10));
    recordStep(step("set_props", 20, true));
    recordStep(step("get_outline", 30));
    expect(traceSteps().map((s) => s.n)).toEqual([1, 2, 3]);
    expect(tally(traceSteps())).toEqual([
      { tool: "get_outline", count: 2, errors: 0, ms: 20, chars: 10 },
      { tool: "set_props", count: 1, errors: 1, ms: 20, chars: 10 },
    ]);
  });
});
