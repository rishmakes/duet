import { describe, expect, it } from "vitest";
import { fixLayouts } from "./tools";

describe("fixLayouts", () => {
  it("fills in the fields an AI left out, deep inside a build", () => {
    const out = fixLayouts({ elements: [{ type: "frame", children: [{ type: "frame", props: { layout: { dir: "row", gap: 8 } } }] }] }) as any;
    expect(out.elements[0].children[0].props.layout).toEqual({ dir: "row", gap: 8, padX: 0, padY: 0, align: "start", justify: "start", hug: true });
  });
  it("keeps the values it was given and leaves null alone", () => {
    const out = fixLayouts({ props: { layout: { dir: "column", gap: 4, padX: 16, padY: 12, align: "stretch", justify: "between", hug: true } } }) as any;
    expect(out.props.layout).toEqual({ dir: "column", gap: 4, padX: 16, padY: 12, align: "stretch", justify: "between", hug: true });
    expect((fixLayouts({ props: { layout: null } }) as any).props.layout).toBeNull();
  });
  it("never leaves a number empty", () => {
    const out = fixLayouts({ props: { layout: { gap: "big", padX: NaN } } }) as any;
    expect(out.props.layout.gap).toBe(12);
    expect(out.props.layout.padX).toBe(0);
  });
  it("hugs a frame made with no size, but not one with a size, an update, or hug set to false", () => {
    const out = fixLayouts({ elements: [{ type: "frame", width: 1440, height: 900, props: { layout: { dir: "column" } }, children: [{ type: "frame", props: { layout: { dir: "row" } } }, { type: "frame", layout: { dir: "row", hug: false } }] }] }) as any;
    expect(out.elements[0].props.layout.hug).toBe(false);
    expect(out.elements[0].children[0].props.layout.hug).toBe(true);
    expect(out.elements[0].children[1].layout.hug).toBe(false);
    expect((fixLayouts({ ids: ["f"], props: { layout: { dir: "row" } } }) as any).props.layout.hug).toBe(false);
  });
});
