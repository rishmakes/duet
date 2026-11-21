import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { parseDoc, serializeDoc } from "./serialize";
import { emptyDoc } from "./types";
import { lookNow } from "./captions";

describe("shapes round captions (#404 step 5)", () => {
  const doc0 = () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1080, height: 1920 });
    doc = runCommand(doc, "create_element", { type: "text", id: "c", parentId: "f", x: 0, y: 0, width: 400, height: 80 });
    return runCommand(doc, "set_props", { ids: ["c"], props: { text: "be a doer" } });
  };

  it("keeps sticker, drawn box, copies and rainbow in the saved file", () => {
    const doc = runCommand(doc0(), "set_props", { ids: ["c"], props: { sticker: "#ffffff", drawnBox: "#ffe14d", copies: { n: 3, color: "#2f7bff" }, rainbow: true } });
    const back = parseDoc(serializeDoc(doc)).elements.c;
    expect(back).toMatchObject({ sticker: "#ffffff", drawnBox: "#ffe14d", copies: { n: 3, color: "#2f7bff" }, rainbow: true });
  });

  it("leaves them out of the file when they are off", () => {
    expect(serializeDoc(doc0())).not.toMatch(/sticker|drawnBox|copies|rainbow/);
  });

  it("a named look with a sticker added becomes the designer's own", () => {
    let doc = runCommand(doc0(), "style_captions", { ids: ["c"], look: "bold" });
    expect(lookNow(doc.elements.c, doc.elements.f)).toBe("bold");
    doc = runCommand(doc, "set_props", { ids: ["c"], props: { sticker: "#ffffff" } });
    expect(lookNow(doc.elements.c, doc.elements.f)).toBeNull();
    // picking a named look again takes the sticker off
    doc = runCommand(doc, "style_captions", { ids: ["c"], look: "bold" });
    expect(doc.elements.c.sticker).toBeUndefined();
  });
});
