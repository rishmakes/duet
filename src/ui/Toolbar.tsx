import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentDoc, dispatch, getState, select, setTool, useStore } from "../state/store";
import type { Tool } from "../state/store";
import { pickImages } from "../project/imageImport";
import { cutNow } from "../video/edit";
import { deleteSelection } from "./actions";
import type { CutKind } from "../video/edit";
import Icon from "./Icons";
import type { IconName } from "./Icons";
import { useLayout } from "./layout";
import { useDismiss } from "./useDismiss";
import { FRAME_PRESETS, newId } from "../commands";
import type { FramePreset } from "../commands";

/** The tools, in a strip down the left edge. Motion adds the cutting tools below the drawing ones, so nothing else moves. */

export const TOOLS: { tool: Tool; label: string; key: string; icon: IconName }[] = [
  { tool: "move", label: "Move", key: "V", icon: "move" },
  { tool: "frame", label: "Frame", key: "F", icon: "frame" },
  { tool: "rect", label: "Rectangle", key: "R", icon: "rect" },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: "ellipse" },
  { tool: "pen", label: "Pen", key: "P", icon: "pen" },
  { tool: "text", label: "Text", key: "T", icon: "text" },
  { tool: "hand", label: "Hand", key: "H", icon: "hand" },
  { tool: "zoom", label: "Zoom", key: "Z", icon: "zoom" },
];

export const PHOTO_TOOLS: { tool: Tool; label: string; key: string; icon: IconName }[] = [
  { tool: "brush", label: "Brush", key: "B", icon: "brush" },
  { tool: "eraser", label: "Eraser", key: "E", icon: "eraser" },
];

const CUTS: { kind: CutKind; label: string; key?: string; icon: IconName }[] = [
  { kind: "split", label: "Cut here", key: "C", icon: "cut-here" },
  { kind: "remove", label: "Delete and close the gap", key: "D", icon: "cut-close" },
  { kind: "before", label: "Cut away what comes before", icon: "cut-before" },
  { kind: "after", label: "Cut away what comes after", icon: "cut-after" },
];

export function screenCenter(vp = getState().viewport, canvasEl?: Element | null): { x: number; y: number } {
  const canvas = canvasEl ?? document.querySelector("main.canvas canvas") ?? document.querySelector("main.canvas");
  const r = canvas?.getBoundingClientRect();
  const width = r && r.width > 0 ? r.width : (typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 1200);
  const height = r && r.height > 0 ? r.height : (typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : 800);
  const zoom = vp?.zoom || 1;
  const cx = (width / 2 - (vp?.x || 0)) / zoom;
  const cy = (height / 2 - (vp?.y || 0)) / zoom;
  return { x: cx, y: cy };
}

export function presetFrameBounds(preset: FramePreset, center: { x: number; y: number }): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(center.x - preset.width / 2),
    y: Math.round(center.y - preset.height / 2),
    width: preset.width,
    height: preset.height,
  };
}

/** `row` lays the same tools out in a line, for the thin bar over the canvas beside the chat. */
export default function Toolbar({ row = false }: { row?: boolean }) {
  const tool = useStore((s) => s.tool);
  const scene = useStore((s) => s.clock.scene);
  const motion = useLayout((d) => d.mode === "motion");
  const photo = useLayout((d) => d.mode === "photo");
  const toolsList = photo ? [...TOOLS, ...PHOTO_TOOLS] : TOOLS;

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 50, left: 48 });
  const frameBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevTool = useRef(tool);

  useDismiss(menuOpen, () => setMenuOpen(false), ".frame-presets, [data-name='tool-frame']");

  useEffect(() => {
    if (tool === "frame" && prevTool.current !== "frame") {
      setMenuOpen(true);
    } else if (tool !== "frame") {
      setMenuOpen(false);
    }
    prevTool.current = tool;
  }, [tool]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const updatePos = () => {
      const r = frameBtnRef.current?.getBoundingClientRect();
      if (r) {
        setMenuPos(
          row
            ? { top: Math.round(r.bottom + 6), left: Math.round(r.left) }
            : { top: Math.max(10, Math.min(r.top, window.innerHeight - 340)), left: Math.round(r.right + 6) },
        );
      }
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    return () => window.removeEventListener("resize", updatePos);
  }, [menuOpen, row]);

  const pickPreset = (preset: FramePreset) => {
    const center = screenCenter();
    const id = newId("frame");
    dispatch("create_preset_frame", { preset, center, id });
    if (currentDoc().elements[id]) {
      select([id]);
    }
    setTool("move");
    setMenuOpen(false);
  };

  return (
    <div className={row ? "toolbar row" : "toolbar"} data-name="toolbar">
      {toolsList.map((t) => (
        <button
          key={t.tool}
          ref={t.tool === "frame" ? frameBtnRef : undefined}
          data-name={`tool-${t.tool}`}
          className={`tool ${tool === t.tool ? "on" : ""}`}
          title={`${t.label} (${t.key})`}
          onClick={() => {
            if (t.tool === "frame") {
              setTool("frame");
              setMenuOpen((open) => (tool === "frame" ? !open : true));
            } else {
              setTool(t.tool);
              setMenuOpen(false);
            }
          }}
        >
          <Icon name={t.icon} />
        </button>
      ))}
      <button className="tool" title="Image (Shift Cmd K)" onClick={() => void pickImages()}>
        <Icon name="image" />
      </button>
      <div className="tool-bottom">
      {motion && (
        <>
          <span className="tool-gap" />
          {CUTS.map((c) => (
            <button
              key={c.kind}
              className="tool"
              data-name={`cut-${c.kind}`}
              disabled={!scene}
              title={scene ? (c.key ? `${c.label} (${c.key})` : c.label) : `${c.label}. Select a scene first`}
              onClick={() => cutNow(c.kind)}
            >
              <Icon name={c.icon} />
            </button>
          ))}
          <button
            className="tool"
            data-name="add-marker"
            disabled={!scene}
            title={scene ? "Add a marker at the playhead (M)" : "Add a marker. Select a scene first"}
            onClick={() => scene && dispatch("add_marker", { id: scene, t: getState().clock.t })}
          >
            <Icon name="marker" />
          </button>
        </>
      )}
      <button className="tool" data-name="tool-delete" title="Delete what is selected (Delete)" onClick={deleteSelection}>
        <Icon name="trash" />
      </button>
      {!row && (
        <button
          className="tool tool-settings"
          title="Settings"
          onClick={() => window.dispatchEvent(new Event("duet:settings"))}
        >
          <Icon name="settings" />
        </button>
      )}
      </div>

      {menuOpen && (
        <div
          className="ctx frame-presets"
          data-name="frame-presets"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {FRAME_PRESETS.map((p) => (
            <div
              key={p.name}
              className="ctx-item frame-preset-item"
              data-name={`preset-${p.name.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => pickPreset(p)}
            >
              <span>{p.name}</span>
              <kbd>{p.width} x {p.height}</kbd>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
