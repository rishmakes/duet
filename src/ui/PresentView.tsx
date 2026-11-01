import { useEffect, useRef, useState } from "react";
import { drawElement, presentScroll } from "../canvas/render";
import { ancestors, hitTest, worldPos } from "../document/geometry";
import type { Doc, El } from "../document/types";
import { currentDoc, getState } from "../state/store";

/** The screen to start on: the selected screen, or the one holding the selection, or the first one. */
export function startFrame(doc: Doc, selection: string[]): string | null {
  for (const id of selection) {
    const chain = [id, ...ancestors(doc, id)];
    const frame = chain.find((c) => doc.elements[c]?.type === "frame");
    if (frame) return frame;
  }
  return doc.rootIds.find((i) => doc.elements[i]?.type === "frame") ?? null;
}

/** What a click does: where it goes, how, and how it arrives. */
export interface LinkInfo {
  kind: "go" | "overlay" | "back";
  target: string | null;
  transition: string;
  ms: number;
}

/** What does a click at this spot do, or the pointer resting on it for hover? Looks at what is there and everything around it. */
export function linkInfoAt(doc: Doc, frameId: string, wx: number, wy: number, trigger: El["trigger"] = ""): LinkInfo | null {
  const hit = hitTest(doc, wx, wy);
  if (!hit) return null;
  const chain = [hit, ...ancestors(doc, hit)];
  if (!chain.includes(frameId)) return null;
  for (const id of chain) {
    const el = doc.elements[id];
    if (id === frameId && el.trigger !== trigger) break;
    if (el && (el.trigger ?? "") !== trigger) continue;
    if (el?.linkKind === "back") return { kind: "back", target: null, transition: el.transition, ms: el.transitionMs || 300 };
    const target = el?.link;
    if (el && target && doc.elements[target]?.type === "frame") {
      return { kind: el.linkKind === "overlay" ? "overlay" : "go", target, transition: el.transition, ms: el.transitionMs || 300 };
    }
    if (id === frameId) break;
  }
  return null;
}

/** Which screen does a click at this spot lead to? */
export function linkAt(doc: Doc, frameId: string, wx: number, wy: number): string | null {
  return linkInfoAt(doc, frameId, wx, wy)?.target ?? null;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** The tallest the content of a screen reaches, so we know how far it can scroll. */
const contentHeight = (doc: Doc, id: string) => Math.max(doc.elements[id].height, ...doc.elements[id].childIds.map((c) => (doc.elements[c] ? doc.elements[c].y + doc.elements[c].height : 0)));

interface Placed {
  ox: number;
  oy: number;
  scale: number;
}

export default function PresentView({ onClose }: { onClose: () => void }) {
  const doc = useRef<Doc>(currentDoc()).current;
  const first = useRef(startFrame(doc, getState().selection)).current;
  const [current, setCurrent] = useState<string | null>(first);
  const [overlays, setOverlays] = useState<string[]>([]);
  const [trail, setTrail] = useState<string[]>([]);
  const [hot, setHot] = useState(false);
  /** The screen a hover opened on top, closed again when the pointer leaves it and what opened it. */
  const hovered = useRef<string | null>(null);
  const [device, setDevice] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const placed = useRef<{ base: Placed | null; overlay: Placed | null }>({ base: null, overlay: null });
  const anim = useRef<{ from: string; to: string; kind: string; t0: number; ms: number } | null>(null);
  const raf = useRef(0);
  const [tick, setTick] = useState(0);
  const redraw = () => setTick((n) => n + 1);

  // each visit to a screen starts at the top
  useEffect(() => {
    for (const k of Object.keys(presentScroll)) delete presentScroll[k];
    return () => {
      for (const k of Object.keys(presentScroll)) delete presentScroll[k];
    };
  }, []);

  const go = (id: string, transition = "", ms = 300) => {
    if (!current || id === current) return;
    hovered.current = null;
    delete presentScroll[id];
    if (transition) anim.current = { from: current, to: id, kind: transition, t0: performance.now(), ms };
    setTrail((t) => [...t, current]);
    setOverlays([]);
    setCurrent(id);
  };
  const back = (transition = "", ms = 300) => {
    if (overlays.length) {
      setOverlays((o) => o.slice(0, -1));
      return;
    }
    const prev = trail[trail.length - 1];
    if (!prev || !current) return;
    if (transition) anim.current = { from: current, to: prev, kind: transition, t0: performance.now(), ms };
    setTrail((t) => t.slice(0, -1));
    setCurrent(prev);
  };

  /** Draw one screen as large as fits, shifted by an offset, optionally with a phone frame around it. */
  const drawScreen = (ctx: CanvasRenderingContext2D, W: number, H: number, id: string, dx: number, dy: number, alpha: number): Placed => {
    const el = doc.elements[id];
    const margin = device ? 120 : 96;
    const scale = Math.min((W - 64) / el.width, (H - margin) / el.height);
    const ox = (W - el.width * scale) / 2 + dx;
    const oy = (H - el.height * scale) / 2 + 12 + dy;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (device) {
      ctx.fillStyle = "#17171a";
      ctx.beginPath();
      ctx.roundRect(ox - 16, oy - 16, el.width * scale + 32, el.height * scale + 32, 46);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(ox, oy, el.width * scale, el.height * scale, 30);
      ctx.clip();
    }
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    drawElement(ctx, doc, { ...el, x: 0, y: 0 }, 0, 0);
    ctx.restore();
    return { ox, oy, scale };
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c || !current) return;
    const frame = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const W = window.innerWidth;
      const H = window.innerHeight;
      c.width = W * dpr;
      c.height = H * dpr;
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b0b0d";
      ctx.fillRect(0, 0, W, H);
      const a = anim.current;
      if (a) {
        const p = ease((now - a.t0) / a.ms);
        const dir = a.kind === "push-left" ? [-1, 0] : a.kind === "push-right" ? [1, 0] : a.kind === "push-up" ? [0, -1] : a.kind === "push-down" ? [0, 1] : [0, 0];
        if (a.kind === "dissolve") {
          drawScreen(ctx, W, H, a.from, 0, 0, 1);
          placed.current.base = drawScreen(ctx, W, H, a.to, 0, 0, p);
        } else {
          drawScreen(ctx, W, H, a.from, dir[0] * W * p, dir[1] * H * p, 1);
          placed.current.base = drawScreen(ctx, W, H, a.to, -dir[0] * W * (1 - p), -dir[1] * H * (1 - p), 1);
        }
        if (now - a.t0 >= a.ms) anim.current = null;
        raf.current = requestAnimationFrame(frame);
        return;
      }
      placed.current.base = drawScreen(ctx, W, H, current, 0, 0, 1);
      placed.current.overlay = null;
      if (overlays.length) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, W, H);
        const top = overlays[overlays.length - 1];
        const base = placed.current.base;
        const o = doc.elements[top];
        const scale = base.scale;
        const ox = (W - o.width * scale) / 2;
        const oy = (H - o.height * scale) / 2 + 12;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(scale, scale);
        drawElement(ctx, doc, { ...o, x: 0, y: 0 }, 0, 0);
        ctx.restore();
        placed.current.overlay = { ox, oy, scale };
      }
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(frame);
    const onResize = () => (raf.current = requestAnimationFrame(frame));
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, overlays, device, tick, doc]);

  // while presenting, no key may reach the editor underneath
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" || e.key === "Backspace") back();
      else if (e.key.toLowerCase() === "r" && first) {
        setOverlays([]);
        setTrail([]);
        setCurrent(first);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, overlays, trail]);

  /** What is under the pointer: the top overlay if there is one, otherwise the screen. */
  const probe = (e: { clientX: number; clientY: number }, trigger: El["trigger"] = "", under = false): { id: string; info: LinkInfo | null; inside: boolean } | null => {
    if (!current) return null;
    const top = under ? (overlays.length > 1 ? overlays[overlays.length - 2] : undefined) : overlays[overlays.length - 1];
    const p = top ? placed.current.overlay : placed.current.base;
    const id = top ?? current;
    if (!p) return null;
    const el = doc.elements[id];
    const lx = (e.clientX - p.ox) / p.scale;
    const ly = (e.clientY - p.oy) / p.scale;
    const inside = lx >= 0 && ly >= 0 && lx <= el.width && ly <= el.height;
    if (!inside) return { id, info: null, inside: false };
    const origin = worldPos(doc, id);
    return { id, info: linkInfoAt(doc, id, origin.x + lx, origin.y + ly + (presentScroll[id] ?? 0), trigger), inside: true };
  };

  if (!current) {
    return (
      <div className="present">
        <div className="present-empty">
          Draw a screen first, then link things to other screens.
          <button className="mini" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="present">
      <div className="present-bar">
        <span>{doc.elements[overlays[overlays.length - 1] ?? current].name}</span>
        <span className="muted">Click what you linked. Scroll tall screens. Left arrow goes back. R restarts. Esc closes.</span>
        <span className="spacer" />
        <button className={`mini ${device ? "on" : ""}`} onClick={() => setDevice(!device)}>
          Phone frame
        </button>
        <button className="mini" disabled={trail.length === 0 && overlays.length === 0} onClick={() => back()}>
          Back
        </button>
        <button className="mini" onClick={onClose}>
          Close
        </button>
      </div>
      <canvas
        ref={canvas}
        style={{ cursor: hot ? "pointer" : "default" }}
        onMouseMove={(e) => {
          setHot(!!probe(e)?.info);
          if (hovered.current) {
            // what a hover opened stays while the pointer is on it, or on what opened it
            if (probe(e)?.inside || probe(e, "hover", true)?.info?.target === hovered.current) return;
            hovered.current = null;
            setOverlays((o) => o.slice(0, -1));
            return;
          }
          const info = probe(e, "hover")?.info;
          if (!info) return;
          if (info.kind === "back") back(info.transition, info.ms);
          else if (info.kind === "overlay" && info.target) {
            hovered.current = info.target;
            setOverlays((o) => [...o, info.target as string]);
          } else if (info.target) go(info.target, info.transition, info.ms);
        }}
        onWheel={(e) => {
          const hit = probe(e);
          const el = hit ? doc.elements[hit.id] : null;
          if (!hit || !el || !el.scroll) return;
          const max = Math.max(0, contentHeight(doc, hit.id) - el.height);
          presentScroll[hit.id] = Math.max(0, Math.min(max, (presentScroll[hit.id] ?? 0) + e.deltaY / (placed.current.base?.scale ?? 1)));
          redraw();
        }}
        onClick={(e) => {
          const hit = probe(e);
          if (!hit) return;
          if (!hit.inside) {
            // a click on the dimmed area closes the overlay
            if (overlays.length) setOverlays((o) => o.slice(0, -1));
            return;
          }
          const info = hit.info;
          if (!info) return;
          if (info.kind === "back") back(info.transition, info.ms);
          else if (info.kind === "overlay" && info.target) setOverlays((o) => [...o, info.target as string]);
          else if (info.target) go(info.target, info.transition, info.ms);
        }}
      />
    </div>
  );
}
