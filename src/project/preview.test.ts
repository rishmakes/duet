import { describe, expect, it } from "vitest";
import type { Doc } from "../document/types";
import { previewRoot } from "./project";

const doc = (els: Record<string, { type: string; childIds: string[] }>, rootIds: string[]) => ({ elements: els, rootIds }) as unknown as Doc;

describe("the picture of a project", () => {
  it("is taken of the first frame with something on it", () => {
    const d = doc({ a: { type: "frame", childIds: [] }, b: { type: "frame", childIds: [] }, c: { type: "frame", childIds: ["t"] }, t: { type: "text", childIds: [] } }, ["a", "b", "c"]);
    expect(previewRoot(d)).toBe("c");
  });

  it("falls back to the first frame when every frame is empty", () => {
    expect(previewRoot(doc({ a: { type: "frame", childIds: [] }, b: { type: "frame", childIds: [] } }, ["a", "b"]))).toBe("a");
  });

  it("is nothing for an empty project", () => {
    expect(previewRoot(doc({}, []))).toBeUndefined();
  });
});
