import { describe, expect, it } from "vitest";
import { ago, clampDim, CREATE_TILES, editedAgo, firstTab, hideKind, HOME_KINDS, outlineOf, ratioOf, rememberSize, shownKinds, startsVideo } from "./homeLogic";

describe("homeLogic pure helpers", () => {
  it("gives every kind its sizes, with real numbers", () => {
    const byId = Object.fromEntries(CREATE_TILES.map((t) => [t.id, t]));
    expect(new Set(CREATE_TILES.map((t) => t.id)).size).toBe(CREATE_TILES.length);
    expect(byId["ig-post"]).toMatchObject({ width: 1080, height: 1080, group: "social" });
    expect(byId["portrait-post"]).toMatchObject({ width: 1080, height: 1350, group: "social" });
    expect(byId["linkedin-banner"]).toMatchObject({ width: 1584, height: 396, group: "social" });
    expect(byId["a4"]).toMatchObject({ width: 2480, height: 3508, group: "print" });
    expect(byId["photo"]).toMatchObject({ kind: "photo", group: "photo" });
    for (const k of HOME_KINDS) expect(CREATE_TILES.some((t) => t.group === k.id)).toBe(true);
    for (const t of CREATE_TILES) if (t.kind === "sized" || t.kind === "video") expect(t.width! > 0 && t.height! > 0).toBe(true);
  });

  it("writes the shape of a size as a simple ratio, or nothing", () => {
    expect(ratioOf(1080, 1920)).toBe("9:16");
    expect(ratioOf(1080, 1080)).toBe("1:1");
    expect(ratioOf(1080, 1350)).toBe("4:5");
    expect(ratioOf(1584, 396)).toBe("4:1");
    expect(ratioOf(2480, 3508)).toBe("");
    expect(ratioOf(undefined, 10)).toBe("");
  });

  it("knows which sizes start a video", () => {
    const byId = Object.fromEntries(CREATE_TILES.map((t) => [t.id, t]));
    expect(startsVideo(byId["reel"])).toBe(true);
    expect(startsVideo(byId["social-reel"])).toBe(true);
    expect(startsVideo(byId["story"])).toBe(false);
    expect(CREATE_TILES.filter((t) => t.group === "video").every(startsVideo)).toBe(true);
  });

  it("opens on New for someone who made things before, else on the first kind showing", () => {
    expect(firstTab(true, [])).toBe("new");
    expect(firstTab(false, [])).toBe("social");
    expect(firstTab(false, ["social"])).toBe("video");
    expect(firstTab(false, HOME_KINDS.map((k) => k.id))).toBe("new");
  });

  it("hides a kind without changing the list it was given, and never the last one", () => {
    const none: string[] = [];
    expect(hideKind(none, "print")).toEqual(["print"]);
    expect(none).toEqual([]);
    expect(shownKinds(["print"])).toEqual(["social", "video", "photo", "screens"]);
    const four = ["social", "video", "print", "photo"];
    expect(hideKind(four, "screens")).toBe(four);
    expect(hideKind(["print"], "print")).toEqual(["print"]);
  });

  it("remembers sizes used before, newest first, never twice, at most 8", () => {
    const reel = { name: "Reel", width: 1080, height: 1920, video: true };
    const post = { name: "Post", width: 1080, height: 1080, video: false };
    const start: never[] = [];
    let list = rememberSize(start, reel);
    list = rememberSize(list, post);
    expect(list.map((u) => u.name)).toEqual(["Post", "Reel"]);
    list = rememberSize(list, { ...reel, name: "Custom" });
    expect(list.map((u) => u.name)).toEqual(["Custom", "Post"]);
    expect(rememberSize(list, { ...post, video: true })).toHaveLength(3);
    expect(start).toEqual([]);
    for (let i = 0; i < 12; i++) list = rememberSize(list, { name: "S", width: 100 + i, height: 100, video: false });
    expect(list).toHaveLength(8);
  });

  it("fits a size's outline in a small box", () => {
    expect(outlineOf(1080, 1920)).toEqual({ width: 26, height: 46 });
    expect(outlineOf(1584, 396)).toEqual({ width: 46, height: 12 });
  });

  it("formats relative times into plain words", () => {
    const base = 1_700_000_000_000;
    expect(ago(base, base)).toBe("just now");
    expect(ago(base - 30_000, base)).toBe("just now");
    expect(ago(base - 120_000, base)).toBe("2 minutes ago");
    expect(ago(base - 7_200_000, base)).toBe("2 hours ago");
    // one is never plural: "1 hours ago" showed on Home
    expect(ago(base - 60_000, base)).toBe("1 minute ago");
    expect(ago(base - 3_600_000, base)).toBe("1 hour ago");
    expect(ago(base - 86_400_000, base)).toBe("yesterday");
    expect(ago(base - 259_200_000, base)).toBe("3 days ago");
  });

  it("formats edited label nicely", () => {
    const base = 1_700_000_000_000;
    expect(editedAgo(base, base)).toBe("Edited just now");
    expect(editedAgo(base - 7_200_000, base)).toBe("Edited 2 hours ago");
    expect(editedAgo(base - 86_400_000, base)).toBe("Edited yesterday");
    expect(editedAgo(base - 172_800_000, base)).toBe("Edited 2 days ago");
  });

  it("clamps dimension input cleanly", () => {
    expect(clampDim(1080)).toBe(1080);
    expect(clampDim("1920")).toBe(1920);
    expect(clampDim(0)).toBe(10);
    expect(clampDim(-50)).toBe(10);
    expect(clampDim(50000)).toBe(20000);
    expect(clampDim("invalid", 1080)).toBe(1080);
  });
});
