import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { parseDoc, serializeDoc } from "./serialize";
import { dbText, dipKeys, fromDb, gainAt, gainPoints, loudnessMap, toDb, volumeAt } from "./sound";
import { emptyDoc } from "./types";
import { cutGains, soundsBetween, soundsOf } from "../video/scene";

function withSound(props: Record<string, unknown> = {}) {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "set_duration", { id: "f", seconds: 10 });
  return runCommand(doc, "create_element", { type: "sound", id: "m", parentId: "f", x: 0, y: 0, width: 1, height: 1, props: { src: "/music.mp3", start: 2, end: 8, ...props } });
}

describe("sound", () => {
  it("reads volumes in decibels", () => {
    expect(toDb(1)).toBe(0);
    expect(Math.round(toDb(0.5))).toBe(-6);
    expect(fromDb(0)).toBe(1);
    expect(fromDb(-80)).toBe(0);
    expect(fromDb(6)).toBe(1);
    expect(dbText(0)).toBe("Silent");
    expect(dbText(0.5)).toBe("-6 dB");
  });

  it("fades rise from silence at the start and die away at the end, and stay with the ends", () => {
    const doc = withSound({ fadeIn: 1, fadeOut: 2 });
    const f = doc.elements.f;
    const m = doc.elements.m;
    expect(gainAt(doc, m, f, 2)).toBe(0);
    expect(gainAt(doc, m, f, 2.5)).toBeGreaterThan(0.5);
    expect(gainAt(doc, m, f, 4)).toBe(1);
    expect(gainAt(doc, m, f, 7)).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(gainAt(doc, m, f, 8)).toBe(0);
    const trimmed = runCommand(doc, "set_props", { ids: ["m"], props: { end: 6 } });
    expect(gainAt(trimmed, trimmed.elements.m, f, 6)).toBe(0);
  });

  it("is saved with its fades, and a clip without them saves nothing new", () => {
    expect(parseDoc(serializeDoc(withSound({ fadeIn: 1.5 }))).elements.m.fadeIn).toBe(1.5);
    expect(serializeDoc(withSound())).not.toContain("fade");
  });

  it("a track's volume and its sound switch count for everything on it", () => {
    let doc = withSound({ volume: 0.5 });
    const track = { index: 0 };
    doc = runCommand(doc, "set_track_switch", { id: "f", track, volume: 0.5 });
    expect(gainAt(doc, doc.elements.m, doc.elements.f, 5)).toBe(0.25);
    expect(soundsOf(doc, "f")[0].volume).toBe(0.25);
    expect(parseDoc(serializeDoc(doc)).elements.f.tracks?.[0].volume).toBe(0.5);
    doc = runCommand(doc, "set_track_switch", { id: "f", track, silent: true });
    expect(gainAt(doc, doc.elements.m, doc.elements.f, 5)).toBe(0);
  });

  it("volume changes over time like any other property, and moves with the clip", () => {
    let doc = withSound();
    doc = runCommand(doc, "set_keys", { id: "m", prop: "volume", keys: [{ t: 3, v: 1 }, { t: 5, v: 0.25, ease: "linear" }] });
    expect(volumeAt(doc.elements.m, 4)).toBeCloseTo(0.625);
    doc = runCommand(doc, "set_timing", { ids: ["m"], start: 4 });
    expect(doc.elements.m.keys.volume?.map((k) => k.t)).toEqual([5, 7]);
  });

  it("lowering a stretch makes a smooth dip and leaves the rest alone", () => {
    const doc = withSound({ volume: 0.8 });
    const keys = dipKeys(doc.elements.m, doc.elements.f, 4, 6, -12);
    const dipped = { ...doc.elements.m, keys: { volume: keys } };
    expect(volumeAt(dipped, 3)).toBeCloseTo(0.8);
    expect(volumeAt(dipped, 5)).toBeCloseTo(0.8 * fromDb(-12));
    expect(volumeAt(dipped, 7.5)).toBeCloseTo(0.8);
    // raising it back by the same amount brings it back
    const back = dipKeys(dipped, doc.elements.f, 4, 6, 12);
    expect(volumeAt({ ...dipped, keys: { volume: back } }, 5)).toBeCloseTo(0.8, 2);
  });

  it("export gets the loudness as straight pieces, few on a steady stretch, cut with the part exported", () => {
    let doc = withSound({ fadeIn: 1 });
    const pts = gainPoints(doc, doc.elements.m, doc.elements.f, 2, 8);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1][0]).toBe(6);
    expect(pts.length).toBeLessThan(30);
    const [s] = soundsOf(doc, "f");
    expect(s.volume).toBe(1);
    expect(s.gains?.length).toBe(pts.length);
    const part = soundsBetween([s], 2.5, 8)[0];
    expect(part.gains?.[0][0]).toBe(0);
    expect(part.gains?.[0][1]).toBeGreaterThan(0.5);
    expect(cutGains([[0, 0], [2, 1]], 1, 2)).toEqual([[0, 0.5], [1, 1], [2, 1]]);
    doc = runCommand(doc, "set_props", { ids: ["m"], props: { fadeIn: 0 } });
    expect(soundsOf(doc, "f")[0].gains).toBeUndefined();
  });

  it("an AI that cannot hear gets one digit per second and where it gets louder", () => {
    const peaks = new Uint8Array(200);
    peaks.fill(20, 0, 60);
    peaks.fill(250, 60, 200);
    const map = loudnessMap({ ...withSound().elements.m, clipFrom: 0 }, { start: 2, end: 8 }, peaks, 0.05);
    expect(map.fromSecond).toBe(2);
    expect(map.levels).toBe("111999");
    expect(map.getsLouderAt).toEqual([5]);
  });
});
