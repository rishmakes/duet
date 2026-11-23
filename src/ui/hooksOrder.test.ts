import { describe, expect, it } from "vitest";

/** Every .tsx file under src, as written. */
const sources = import.meta.glob<string>("/src/**/*.tsx", { query: "?raw", import: "default", eager: true });

/**
 * Hooks used after a component has already returned early, in the files as written: a component's body is
 * indented two spaces, so a two-space `if (...) return` is an early return and a later two-space `use...(` is a hook
 * React only meets on some renders. Nested functions sit deeper and are not looked at.
 */
export function lateHooks(source: string): number[] {
  const out: number[] = [];
  let returned = false;
  source.split("\n").forEach((line, i) => {
    // anything new at the left edge starts a new function, component or hook
    if (/^[^\s}]/.test(line)) returned = false;
    else if (/^ {2}if \(.*\) return\b/.test(line)) returned = true;
    else if (returned && /^ {2}(const .*= )?use[A-Z]\w*[<(]/.test(line)) out.push(i + 1);
  });
  return out;
}

describe("Hooks before an early return", () => {
  it("finds a hook after an early return", () => {
    expect(lateHooks("function A() {\n  const [a] = useState(0);\n  if (!a) return null;\n  const [b] = useState<number>(1);\n}")).toEqual([4]);
    expect(lateHooks("function A() {\n  if (x) return null;\n}\nfunction B() {\n  const [b] = useState(1);\n}")).toEqual([]);
  });

  // the first cut on a track (a split) blanked the screen: CutSeams kept a hook after returning when there were no cuts (#423)
  it("no component in Duet uses a hook after returning early", () => {
    const found = Object.entries(sources).flatMap(([f, text]) => lateHooks(text).map((n) => `${f}:${n}`));
    expect(found).toEqual([]);
  });
});
