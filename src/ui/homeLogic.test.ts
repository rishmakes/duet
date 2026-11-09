import { describe, expect, it } from "vitest";
import { ago, clampDim, CREATE_TILES, CUSTOM_PRESETS, editedAgo, TILE_GROUPS } from "./homeLogic";

describe("homeLogic pure helpers", () => {
  it("defines the 12 create format tiles with correct shapes and dimensions", () => {
    expect(CREATE_TILES).toHaveLength(12);
    const byId = Object.fromEntries(CREATE_TILES.map((t) => [t.id, t]));

    expect(byId["ig-post"]).toMatchObject({ width: 1080, height: 1080, dims: "1080 × 1080", shape: "square" });
    expect(byId["story"]).toMatchObject({ width: 1080, height: 1920, dims: "1080 × 1920", shape: "story" });
    expect(byId["yt-thumb"]).toMatchObject({ width: 1280, height: 720, dims: "1280 × 720", shape: "video" });
    expect(byId["presentation"]).toMatchObject({ width: 1920, height: 1080, dims: "1920 × 1080", shape: "slide" });
    expect(byId["a4"]).toMatchObject({ width: 2480, height: 3508, dims: "A4", shape: "a4" });
    expect(byId["screens"]).toMatchObject({ kind: "screens", shape: "screens" });
    expect(byId["canvas"]).toMatchObject({ kind: "canvas", shape: "canvas" });
    expect(byId["custom"]).toMatchObject({ kind: "custom", shape: "custom" });
    expect(byId["file"]).toMatchObject({ kind: "file", shape: "file" });
    expect(byId["reel"]).toMatchObject({ kind: "video", width: 1080, height: 1920, group: "video" });
    expect(byId["yt-video"]).toMatchObject({ kind: "video", width: 1920, height: 1080, group: "video" });
    expect(byId["photo"]).toMatchObject({ kind: "photo", group: "photo" });
  });

  it("puts every tile in a row Home shows, and every row has tiles", () => {
    const rows = TILE_GROUPS.map((g) => g.id);
    for (const t of CREATE_TILES) expect(rows).toContain(t.group);
    for (const g of rows) expect(CREATE_TILES.some((t) => t.group === g)).toBe(true);
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
