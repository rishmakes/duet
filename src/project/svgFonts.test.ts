import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../ui/dialog", () => ({ ask: vi.fn(), message: vi.fn(), open: vi.fn() }));

import { closest, fontsReport } from "./svgImport";
import type { OnlineFont } from "./fonts";

const f = (family: string): OnlineFont => ({ id: family.toLowerCase().replace(/ /g, "-"), family, category: "sans-serif", weights: [400], subsets: ["latin"], defSubset: "latin" });
const all = [f("Roboto"), f("Roboto Mono"), f("Open Sans"), f("Oxygen")];

describe("finding a missing font", () => {
  it("takes the same name first", () => expect(closest(all, "open sans")?.family).toBe("Open Sans"));
  it("falls back to the closest shorter name", () => expect(closest(all, "Oxygen Bold Italic")?.family).toBe("Oxygen"));
  it("gives nothing when nothing is close", () => expect(closest(all, "Zzyzx")).toBeNull());
  it("tells the designer plainly", () =>
    expect(fontsReport({ got: ["Roboto"], swapped: [["Oxygen Bold", "Oxygen"]], none: ["Zzyzx"] })).toBe("Found online: Roboto. Used the closest instead: Oxygen for Oxygen Bold. Nothing close found for: Zzyzx. They stay in a stand-in font."));
});
