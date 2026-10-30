import { beforeEach, describe, expect, it } from "vitest";
import { addTab, closeTab, getTabs, repoint } from "./project";

describe("open projects as tabs", () => {
  beforeEach(() => {
    for (const p of [...getTabs()]) closeTab(p);
  });

  it("keeps projects once, in the order they were opened", () => {
    addTab("/a/one.duet");
    addTab("/a/two.duet");
    addTab("/a/one.duet");
    expect(getTabs()).toEqual(["/a/one.duet", "/a/two.duet"]);
  });

  it("closing one says which to show next, and the last one leaves nothing", () => {
    addTab("/a/one.duet");
    addTab("/a/two.duet");
    addTab("/a/three.duet");
    expect(closeTab("/a/two.duet")).toBe("/a/three.duet");
    expect(closeTab("/a/three.duet")).toBe("/a/one.duet");
    expect(closeTab("/a/one.duet")).toBeNull();
    expect(getTabs()).toEqual([]);
  });

  it("holds at most twelve", () => {
    for (let i = 0; i < 15; i++) addTab(`/a/p${i}.duet`);
    expect(getTabs().length).toBe(12);
    expect(getTabs()[11]).toBe("/a/p14.duet");
  });
});

describe("a project whose file moved outside Duet", () => {
  beforeEach(() => {
    for (const p of [...getTabs()]) closeTab(p);
  });

  it("is followed to where it is now, in its tab", () => {
    addTab("/a/Untitled 29.duet");
    addTab("/a/Hero.duet");
    repoint("/a/Untitled 29.duet", "/a/Portrait.duet");
    expect(getTabs()).toEqual(["/a/Portrait.duet", "/a/Hero.duet"]);
  });

  it("is kept once when the new place is already open", () => {
    addTab("/a/Untitled 29.duet");
    addTab("/a/Portrait.duet");
    repoint("/a/Untitled 29.duet", "/a/Portrait.duet");
    expect(getTabs()).toEqual(["/a/Portrait.duet"]);
  });
});
