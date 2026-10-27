import { describe, expect, it } from "vitest";
import { makePdf } from "./pdf";

describe("PDF export", () => {
  it("makes one page per screen, sized to the screen, with a table that points at each part", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const bytes = makePdf([
      { width: 400, height: 300, jpeg, pixelWidth: 1200, pixelHeight: 900 },
      { width: 100.5, height: 50, jpeg, pixelWidth: 302, pixelHeight: 150 },
    ]);
    const s = new TextDecoder("latin1").decode(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("/Count 2");
    expect(s).toContain("/MediaBox [0 0 400 300]");
    expect(s).toContain("/MediaBox [0 0 100.5 50]");
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    // every listed place really starts that part
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const rows = s.slice(start).split("\n").filter((l) => / 00000 n $/.test(l));
    expect(rows).toHaveLength(8);
    rows.forEach((r, i) => expect(s.slice(Number(r.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});
