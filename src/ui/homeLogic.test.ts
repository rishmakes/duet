import { describe, expect, it } from "vitest";
import { ago, clampDim, CREATE_TILES, CUSTOM_PRESETS, editedAgo, hideKind, HOME_KINDS, openKind, shownKinds, startsVideo } from "./homeLogic";

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

  it("knows which sizes start a video", () => {
    const byId = Object.fromEntries(CREATE_TILES.map((t) => [t.id, t]));
    expect(startsVideo(byId["reel"])).toBe(true);
    expect(startsVideo(byId["social-reel"])).toBe(true);
    expect(startsVideo(byId["story"])).toBe(false);
    expect(CREATE_TILES.filter((t) => t.group === "video").every(startsVideo)).toBe(true);
  });

  it("opens the last kind picked, or the first one showing", () => {
    expect(openKind(null, [])).toBe("social");
    expect(openKind("video", [])).toBe("video");
    expect(openKind("video", ["video"])).toBe("social");
    expect(openKind("nonsense", ["social"])).toBe("video");
    expect(openKind(null, HOME_KINDS.map((k) => k.id))).toBe(null);
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

  it("defines the 5 custom presets", () => {
    expect(CUSTOM_PRESETS).toHaveLength(5);
    expect(CUSTOM_PRESETS.map((p) => p.width)).toEqual([1080, 1080, 1080, 1280, 1920]);
    expect(CUSTOM_PRESETS.map((p) => p.height)).toEqual([1080, 1350, 1920, 720, 1080]);
  });

  it("formats relative times into plain words", () => {
    const base = 1_700_000_000_000;
    expect(ago(base, base)).toBe("just now");
    expect(ago(base - 30_000, base)).toBe("just now");
    expect(ago(base - 120_000, base)).toBe("2 minutes ago");
    expect(ago(base - 7_200_000, base)).toBe("2 hours ago");
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
