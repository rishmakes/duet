import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "./types";
import type { SvgLayer } from "../commands";
import { countLayers, readSvg } from "./svgImport";
import type { SvgItem } from "./svgImport";
import { parseDoc, serializeDoc } from "./serialize";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const FIXTURE = `<svg width="200" height="100" viewBox="0 0 200 100" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g id="Page">
<g clip-path="url(#clip0)">
<rect width="200" height="100" fill="white"/>
<rect id="Bar &#38; Co" x="10" y="10" width="40" height="20" rx="4" fill="#483DD9" fill-opacity="0.5"/>
<text id="Title" fill="#060606" xml:space="preserve" font-family="Open Sans" font-size="20" font-weight="bold" letter-spacing="0.1em"><tspan x="60" y="30">Hello&#10;</tspan><tspan x="60" y="50">World</tspan></text>
<text id="Side" transform="translate(190 90) rotate(-90)" fill="black" font-family="Roboto" font-size="10"><tspan x="0" y="8">Turned</tspan></text>
<path id="Ring" fill-rule="evenodd" d="M130 10H170V50H130V10ZM140 20H160V40H140V20Z" fill="#ff0000"/>
<path id="Line" d="M10 80H50" stroke="#848279"/>
<rect id="Photo" x="150" y="60" width="30" height="30" fill="url(#pat)"/>
<g id="Cut" clip-path="url(#clip1)"><circle cx="100" cy="80" r="10" fill="blue"/></g>
</g>
</g>
<defs>
<pattern id="pat" patternContentUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#img" transform="scale(1)"/></pattern>
<clipPath id="clip0"><rect width="200" height="100" fill="white"/></clipPath>
<clipPath id="clip1"><rect x="90" y="70" width="10" height="20" fill="white"/></clipPath>
<image id="img" width="1" height="1" xlink:href="data:image/png;base64,${PNG}"/>
</defs>
</svg>`;

const flat = (items: SvgItem[]): SvgItem[] => items.flatMap((i) => [i, ...(i.children ? flat(i.children) : [])]);

describe("reading an SVG into layers", () => {
  const plan = readSvg(FIXTURE, "Card.svg");
  const by = (name: string) => flat(plan.items).find((i) => i.name === name)!;

  it("takes the frame size and name, and opens the wrapping group", () => {
    expect([plan.name, plan.width, plan.height]).toEqual(["Card", 200, 100]);
    expect(plan.items[0].type).toBe("rect");
    expect(plan.items.some((i) => i.name === "Page")).toBe(false);
  });

  it("keeps rounded corners, colour with its see-through, and decodes names", () => {
    const r = by("Bar & Co");
    expect([r.x, r.y, r.width, r.height, r.props.radius, r.props.fill]).toEqual([10, 10, 40, 20, 4, "#483dd980"]);
  });

  it("joins lines into one text and keeps font, weight and spacing in pixels", () => {
    const t = by("Title");
    expect(t.props.text).toBe("Hello\nWorld");
    expect([t.props.fontFamily, t.props.fontWeight, t.props.fontSize, t.props.letterSpacing]).toEqual(["Open Sans", 700, 20, 2]);
    expect(t.props.lineHeight).toBe(1);
    expect(plan.fonts).toEqual(expect.arrayContaining(["Open Sans", "Roboto"]));
  });

  it("turns rotated text around its centre", () => {
    const t = by("Side");
    expect(t.props.rotation).toBe(-90);
    // the box middle is where the transform sends the middle of the unturned box: 190 + its height / 2 across, 90 - its width / 2 up
    expect(t.x + t.width / 2).toBeCloseTo(190 + 5.5 + t.height / 2, 0);
    expect(t.y + t.height / 2).toBeCloseTo(90 - t.width / 2, 0);
  });

  it("makes a ring a closed path with a hole", () => {
    const ring = by("Ring");
    expect(ring.type).toBe("path");
    expect(ring.props.closed).toBe(true);
    expect(ring.props.holes).toHaveLength(1);
  });

  it("keeps a plain line as an open path with a line colour and no fill", () => {
    const line = by("Line");
    expect([line.props.closed, line.props.stroke, line.props.fill]).toEqual([false, "#848279", "#00000000"]);
  });

  it("brings a picture fill in as a picture, stored once", () => {
    const photo = by("Photo");
    expect(photo.type).toBe("image");
    expect(plan.pictures).toHaveLength(1);
    expect(plan.pictures[0].mime).toBe("image/png");
    expect(photo.picture).toBe(plan.pictures[0].key);
  });

  it("cuts a group to a shape when its clip is smaller than the page, and not when it is the page", () => {
    const cut = by("Cut");
    expect(cut.mask).toBe(true);
    expect(cut.children![0].props.fill).toBe("#000000");
    expect(cut.children).toHaveLength(2);
  });

  it("says what it could not keep and never throws", () => {
    expect(readSvg("not xml at all").notes.length).toBeGreaterThan(0);
    expect(readSvg("<svg width='10' height='10'><foo/></svg>").notes.join(" ")).toContain("foo");
    const slanted = readSvg(`<svg width="50" height="50"><text font-style="italic" font-size="10"><tspan x="0" y="10">a</tspan></text></svg>`);
    expect(slanted.notes.join(" ")).toContain("slanted");
  });
});

describe("making an SVG into a frame of layers", () => {
  const plan = readSvg(FIXTURE, "Card.svg");
  const toLayer = (i: SvgItem): SvgLayer => ({ id: i.id, type: i.picture ? "image" : i.type, name: i.name, x: i.x, y: i.y, width: i.width, height: i.height, props: i.picture ? { ...i.props, src: "assets/x.png" } : i.props, mask: i.mask, children: i.children?.map(toLayer) });

  it("makes one frame with everything inside, in order, without changing the document it was given", () => {
    const before = emptyDoc();
    const doc = runCommand(before, "import_svg_layers", { frame: { id: "f", name: "Card", x: 10, y: 20, width: plan.width, height: plan.height }, layers: plan.items.map(toLayer) });
    expect(before.rootIds).toEqual([]);
    expect(doc.rootIds).toEqual(["f"]);
    const f = doc.elements.f;
    expect([f.type, f.name, f.width, f.height]).toEqual(["frame", "Card", 200, 100]);
    expect(f.childIds.length).toBe(plan.items.length);
    const everything = Object.values(doc.elements).filter((e) => e.id !== "f");
    expect(everything.length).toBeGreaterThanOrEqual(countLayers(plan.items));
    const mask = everything.find((e) => e.name === "Cut")!;
    expect(mask.type).toBe("group");
    expect(mask.mask).toBe(true);
    const ring = everything.find((e) => e.name === "Ring")!;
    expect(ring.holes).toHaveLength(1);
    const title = everything.find((e) => e.name === "Title")!;
    expect(title.text).toBe("Hello\nWorld");
  });

  it("saves and reopens holes, and leaves them out for paths without any", () => {
    const doc = runCommand(emptyDoc(), "import_svg_layers", { frame: { id: "f", name: "Card", x: 0, y: 0, width: 200, height: 100 }, layers: plan.items.map(toLayer) });
    const text = serializeDoc(doc);
    const back = parseDoc(text);
    const ring = Object.values(back.elements).find((e) => e.name === "Ring")!;
    expect(ring.holes).toHaveLength(1);
    const line = Object.values(back.elements).find((e) => e.name === "Line")!;
    expect(line.holes).toBeUndefined();
    expect(text.match(/"holes"/g)).toHaveLength(1);
  });
});

describe("a shape of several separate lines", () => {
  it("keeps every line as its own layer inside a group", () => {
    const svg = `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="white"/><path id="Rules" d="M10 10H50M10 30H60M10 50H70" stroke="#000"/></svg>`;
    const plan = readSvg(svg, "Lines.svg");
    const group = plan.items.find((i) => i.name === "Rules")!;
    expect(group.type).toBe("group");
    expect(group.children?.map((c) => c.name)).toEqual(["Rules 1", "Rules 2", "Rules 3"]);
    expect(plan.notes.join(" ")).not.toContain("kept only its first line");
  });
});
