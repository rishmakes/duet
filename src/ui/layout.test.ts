import { describe, expect, it, beforeEach } from "vitest";
import { defaults, isColorOpen, modeOf, parseLayout, rightTabOf } from "./layout";

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, String(v)),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
};
// @ts-expect-error mock storage for node test environment
globalThis.localStorage = fakeStorage;

describe("layout migration and per-space panels", () => {
  beforeEach(() => {
    store.clear();
  });

  describe("color to photo layout load", () => {
    it("loads legacy mode 'color' as 'photo'", () => {
      const loaded = parseLayout({ mode: "color" });
      expect(loaded.mode).toBe("photo");
    });

    it("preserves mode 'photo', 'motion', and 'design'", () => {
      expect(parseLayout({ mode: "photo" }).mode).toBe("photo");
      expect(parseLayout({ mode: "motion" }).mode).toBe("motion");
      expect(parseLayout({ mode: "design" }).mode).toBe("design");
    });

    it("falls back to 'design' for unknown mode", () => {
      expect(parseLayout({ mode: "unknown" }).mode).toBe("design");
    });

    it("migrates legacy 'color' project mode in modeOf to 'photo'", () => {
      localStorage.setItem("duet:modes", JSON.stringify({ "/path/to/project.duet": "color" }));
      expect(modeOf("/path/to/project.duet")).toBe("photo");
    });

    it("returns correct mode for photo, motion, and design in modeOf", () => {
      localStorage.setItem(
        "duet:modes",
        JSON.stringify({
          "/a.duet": "photo",
          "/b.duet": "motion",
          "/c.duet": "design",
        }),
      );
      expect(modeOf("/a.duet")).toBe("photo");
      expect(modeOf("/b.duet")).toBe("motion");
      expect(modeOf("/c.duet")).toBe("design");
    });
  });

  describe("per-space right panel tabs and defaults", () => {
    it("defaults Video right panel to 'properties' and Photo to 'color'", () => {
      const def = defaults();
      expect(def.videoTab).toBe("properties");
      expect(def.photoTab).toBe("color");
    });

    it("opens on Colour the first time in Photo when not saved in layout", () => {
      const loaded = parseLayout({ mode: "photo" });
      expect(loaded.photoTab).toBe("color");
      expect(loaded.videoTab).toBe("properties");
    });

    it("remembers right panel tab choice per space when provided", () => {
      const loaded = parseLayout({
        videoTab: "color",
        photoTab: "properties",
      });
      expect(loaded.videoTab).toBe("color");
      expect(loaded.photoTab).toBe("properties");
    });

    it("resolves rightTabOf for the active space", () => {
      const dock = {
        ...defaults(),
        mode: "photo" as const,
        photoTab: "color" as const,
        videoTab: "properties" as const,
      };
      expect(rightTabOf(dock)).toBe("color");
      expect(rightTabOf(dock, "motion")).toBe("properties");
      expect(rightTabOf(dock, "design")).toBe("properties");
    });
  });

  describe("isColorOpen", () => {
    it("is true in Photo when photoTab is 'color'", () => {
      const dock = { ...defaults(), mode: "photo" as const, photoTab: "color" as const };
      expect(isColorOpen(dock)).toBe(true);
    });

    it("is false in Photo when photoTab is 'properties'", () => {
      const dock = { ...defaults(), mode: "photo" as const, photoTab: "properties" as const };
      expect(isColorOpen(dock)).toBe(false);
    });

    it("is true in Video when videoTab is 'color'", () => {
      const dock = { ...defaults(), mode: "motion" as const, videoTab: "color" as const };
      expect(isColorOpen(dock)).toBe(true);
    });

    it("is false in Video when videoTab is 'properties'", () => {
      const dock = { ...defaults(), mode: "motion" as const, videoTab: "properties" as const };
      expect(isColorOpen(dock)).toBe(false);
    });

    it("is always false in Design mode", () => {
      const dock = {
        ...defaults(),
        mode: "design" as const,
        photoTab: "color" as const,
        videoTab: "color" as const,
      };
      expect(isColorOpen(dock)).toBe(false);
    });
  });
});

describe("history line", () => {
  it("shows for everyone who never chose, and stays as the designer left it once they did", () => {
    expect(parseLayout({ historyLine: false }).historyLine).toBe(true);
    expect(parseLayout({ historyLine: false, historyLineChosen: true }).historyLine).toBe(false);
    expect(parseLayout({ historyLine: true, historyLineChosen: true }).historyLine).toBe(true);
    expect(defaults().historyLine).toBe(true);
  });
});
