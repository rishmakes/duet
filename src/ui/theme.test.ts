import { beforeEach, describe, expect, it } from "vitest";
import { getTheme, initTheme, setTheme, toggleTheme } from "./theme";
import { COLORS } from "../canvas/render";

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, String(v)),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
};
// @ts-expect-error mock storage for node test environment
globalThis.localStorage = fakeStorage;

const attributes = new Map<string, string>();
const fakeDocElement = {
  getAttribute: (k: string) => attributes.get(k) ?? null,
  setAttribute: (k: string, v: string) => attributes.set(k, String(v)),
  removeAttribute: (k: string) => attributes.delete(k),
};
if (typeof document === "undefined") {
  // @ts-expect-error mock document for node test environment
  globalThis.document = { documentElement: fakeDocElement };
}

describe("Theme system", () => {
  beforeEach(() => {
    store.clear();
    attributes.clear();
    if (typeof document !== "undefined") {
      document.documentElement.removeAttribute("data-theme");
    }
    setTheme("dark");
  });

  it("defaults to dark theme", () => {
    initTheme();
    expect(getTheme()).toBe("dark");
    if (typeof document !== "undefined") {
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    }
  });

  it("switches to light theme and sets data-theme attribute", () => {
    setTheme("light");
    expect(getTheme()).toBe("light");
    if (typeof document !== "undefined") {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    }
    expect(localStorage.getItem("duet.theme")).toBe("light");
  });

  it("switches back to dark theme and removes data-theme attribute", () => {
    setTheme("light");
    setTheme("dark");
    expect(getTheme()).toBe("dark");
    if (typeof document !== "undefined") {
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    }
    expect(localStorage.getItem("duet.theme")).toBe("dark");
  });

  it("toggleTheme switches between dark and light", () => {
    expect(getTheme()).toBe("dark");
    toggleTheme();
    expect(getTheme()).toBe("light");
    if (typeof document !== "undefined") {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    }
    toggleTheme();
    expect(getTheme()).toBe("dark");
    if (typeof document !== "undefined") {
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    }
  });

  it("initializes from localStorage saved preference", () => {
    localStorage.setItem("duet.theme", "light");
    initTheme();
    expect(getTheme()).toBe("light");
    if (typeof document !== "undefined") {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    }
  });

  it("maintains COLORS object keys for canvas rendering", () => {
    expect(COLORS).toHaveProperty("bg");
    expect(COLORS).toHaveProperty("dot");
    expect(COLORS).toHaveProperty("accent");
    expect(COLORS).toHaveProperty("ruler");
    expect(COLORS).toHaveProperty("muted");
    expect(COLORS).toHaveProperty("rulerLine");
    expect(COLORS).toHaveProperty("rulerTick");
    expect(COLORS).toHaveProperty("aiWorkText");
    expect(COLORS).toHaveProperty("accentSoft");
    expect(COLORS).toHaveProperty("duet");
  });
});
