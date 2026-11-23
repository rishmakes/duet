import { useEffect, useRef } from "react";
import { drawElement } from "../canvas/render";
import { docAt } from "../document/time";
import type { Doc, El } from "../document/types";

/** A thing drawn small to fit its box, for the Export page. A scene is drawn as it looks at second `at`. */
export default function ExportPicture({ doc, el, at }: { doc: Doc; el: El; at?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // fit inside the box's padding
    const box = canvas.parentElement!;
    const pad = getComputedStyle(box);
    const w = box.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    const h = box.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom);
    const k = Math.min(w / el.width, h / el.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(el.width * k * dpr));
    canvas.height = Math.max(1, Math.round(el.height * k * dpr));
    canvas.style.width = `${el.width * k}px`;
    canvas.style.height = `${el.height * k}px`;
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    const now = at === undefined ? doc : docAt(doc, el.id, at);
    const drawn = now.elements[el.id];
    if (drawn) drawElement(ctx, now, drawn, -drawn.x, -drawn.y);
  }, [doc, el, at]);
  return <canvas ref={ref} />;
}
