import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import CanvasView from "../canvas/CanvasView";
import { useChat } from "../ai/chat";
import type { Recipe, Step, StepKind } from "../ai/recipes";
import {
  addStep,
  again,
  answer,
  blankRecipe,
  BUILT_IN,
  carryOn,
  changeStep,
  COOK_NO_DESIGN_ERROR,
  dropRecipe,
  keepRecipe,
  KIND_NAMES,
  loadCooking,
  loadRecipes,
  moveStep,
  readRecipe,
  removeStep,
  startCooking,
  stopCooking,
  useCooking,
  useRecipes,
} from "../ai/recipes";
import { setTool, useStore } from "../state/store";
import { setLayout } from "./layout";
import ChatPanel from "./ChatPanel";
import { ask, message, open, save } from "./dialog";
import Icon from "./Icons";
import Rich from "./rich";
import StepIcon, { stepIconFor } from "./StepIcons";
import { useDismiss } from "./useDismiss";

const NODE_W = 224;
const NODE_H = 80;

/**
 * Kitchen: where work is cooked from recipes. The recipes on the left, the steps of one as boxes
 * joined in the order they are cooked, the step at hand under them, and on the right the design
 * being made with the AI's chat under it.
 */
export default function Kitchen() {
  const recipes = useRecipes();
  const cooking = useCooking();
  const messages = useChat((s) => s.messages);
  const tool = useStore((s) => s.tool);
  const project = useStore((s) => s.project);
  const [pickedId, setPickedId] = useState<string>(recipes[0]?.id ?? "");
  const [stepId, setStepId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useDismiss(menuOpen, () => setMenuOpen(false), ".kitchen-menu, .kitchen-menu-btn");

  useEffect(() => {
    void loadRecipes();
    void loadCooking();
  }, []);
  useEffect(() => {
    if (cooking && cooking.status !== "stopped" && cooking.status !== "done") {
      setPickedId(cooking.recipe.id);
    }
  }, [cooking?.recipe.id]);
  const recipe = recipes.find((r) => r.id === pickedId) ?? (cooking && cooking.recipe.id === pickedId ? cooking.recipe : recipes[0]);
  // while one cooks, its board follows the step at hand
  const live = cooking && recipe && cooking.recipe.id === recipe.id && cooking.status !== "stopped" ? cooking : null;
  const step = recipe?.steps.find((s) => s.id === stepId) ?? null;

  const change = (r: Recipe) => keepRecipe(r);

  const newRecipe = () => {
    const r = blankRecipe();
    keepRecipe(r);
    setPickedId(r.id);
    setStepId(r.steps[0].id);
  };

  const openFile = async () => {
    const path = await open({ title: "Open a recipe", filters: [{ name: "Recipe", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    const r = readRecipe(await invoke<string>("read_text_file", { path }).catch(() => ""));
    if (!r) return void message("That file is not a recipe.");
    // a recipe brought in never replaces one you already have
    const fresh = recipes.some((x) => x.id === r.id) ? { ...r, id: Math.random().toString(36).slice(2, 9) } : r;
    keepRecipe(fresh);
    setPickedId(fresh.id);
  };

  const saveFile = async () => {
    if (!recipe) return;
    const path = await save({ title: "Save the recipe to share", defaultPath: `${recipe.name}.json`, filters: [{ name: "Recipe", extensions: ["json"] }] });
    if (!path) return;
    const { builtIn: _, ...plain } = recipe;
    await invoke("write_text_file", { path, contents: JSON.stringify(plain, null, 2) }).catch((e) => message(`Could not save the recipe: ${e}`));
  };

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!menuOpen && menuBtnRef.current) {
      const b = menuBtnRef.current.getBoundingClientRect();
      setMenuPos({ top: b.bottom + 4, right: window.innerWidth - b.right });
    }
    setMenuOpen(!menuOpen);
  };

  return (
    <div className="kitchen">
      <aside className="kitchen-recipes">
        <div className="kitchen-head">
          <span className="kitchen-section-label">Recipes</span>
          <button className="pill icon" title="New recipe" onClick={newRecipe}>
            <Icon name="plus" size={15} />
          </button>
        </div>
        <div className="kitchen-list">
          {recipes.map((r) => (
            <button key={r.id} className={`kitchen-recipe ${r.id === recipe?.id ? "on" : ""}`} onClick={() => (setPickedId(r.id), setStepId(null))}>
              <span className="kitchen-recipe-name">
                {r.name}
                {cooking?.recipe.id === r.id && cooking.status !== "stopped" && cooking.status !== "done" && <i className="kitchen-dot" />}
              </span>
              <span className="kitchen-recipe-about">{r.about || `${r.steps.length} steps`}</span>
            </button>
          ))}
        </div>
        <div className="kitchen-files">
          <button className="pill" onClick={() => void openFile()}>
            Open a recipe file
          </button>
        </div>
      </aside>

      <section className="kitchen-middle">
        {recipe ? (
          <>
            <div className="kitchen-bar">
              <div className="kitchen-section-label">STEPS</div>
              <div className="kitchen-bar-body">
                <div className="kitchen-bar-info">
                  <input
                    key={recipe.id}
                    className="kitchen-name"
                    defaultValue={recipe.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== recipe.name && change({ ...recipe, name: e.target.value.trim() })}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                  <div className="kitchen-cook-hint">Cook runs these steps on the design on the right, and stops when it needs you.</div>
                </div>
                <div className="kitchen-bar-actions">
                  {live && live.status !== "done" ? (
                    <button className="pill kitchen-cook-btn stop" onClick={stopCooking}>
                      Stop
                    </button>
                  ) : (
                    <button
                      className="pill primary kitchen-cook-btn"
                      disabled={!recipe.steps.length}
                      onClick={() => (setStepId(null), startCooking(recipe))}
                      title="Cook this recipe on the open design, step by step"
                    >
                      <span className="kitchen-play" aria-hidden="true">▶</span> Cook
                    </button>
                  )}
                  <button
                    ref={menuBtnRef}
                    className={`pill icon kitchen-menu-btn ${menuOpen ? "on" : ""}`}
                    title="Recipe options"
                    onClick={toggleMenu}
                  >
                    <Icon name="dots" size={15} />
                  </button>
                </div>
              </div>
              {menuOpen && (
                <div className="kitchen-menu" ref={menuRef} style={menuPos} onPointerDown={(e) => e.stopPropagation()}>
                  <div
                    onClick={() => {
                      setMenuOpen(false);
                      void saveFile();
                    }}
                  >
                    <Icon name="copy" size={14} /> Share recipe file
                  </div>
                  {recipe.builtIn ? (
                    <div
                      onClick={async () => {
                        setMenuOpen(false);
                        const original = BUILT_IN.find((b) => b.id === recipe.id);
                        const changed = !original || JSON.stringify(original) !== JSON.stringify(recipe);
                        if (changed) {
                          const ok = await ask("Put this recipe back to the steps it came with? Your changes will be lost.", {
                            title: "Back to original",
                            kind: "warning",
                            okLabel: "Put back",
                            cancelLabel: "Keep my changes",
                          });
                          if (!ok) return;
                        }
                        dropRecipe(recipe.id);
                      }}
                    >
                      <Icon name="restore" size={14} /> Back to original
                    </div>
                  ) : (
                    <div
                      onClick={() => {
                        setMenuOpen(false);
                        dropRecipe(recipe.id);
                        setPickedId(recipes[0]?.id ?? "");
                      }}
                    >
                      <Icon name="trash" size={14} /> Delete recipe
                    </div>
                  )}
                </div>
              )}
            </div>
            <Board recipe={recipe} picked={stepId} onPick={setStepId} onChange={change} live={live} />
            <StepPanel recipe={recipe} step={step} onChange={change} onPick={setStepId} live={live} />
          </>
        ) : (
          <div className="kitchen-empty">No recipes yet.</div>
        )}
      </section>

      <section className="kitchen-preview">
        <div className="kitchen-design-bar">
          <div className="kitchen-design-info">
            <span className="kitchen-section-label">YOUR DESIGN</span>
            <span className="kitchen-design-name" title={project.file ?? project.path ?? "No file saved yet"}>
              {project.name || "Untitled"}
            </span>
            {!project.file && !project.path ? <span className="kitchen-preview-saved">No file saved yet</span> : null}
          </div>
          <button className="pill" onClick={() => setLayout({ space: "edit" })} title="Open this design in Studio">
            Open in Studio
          </button>
        </div>
        <div className="kitchen-canvas-stage">
          <main className="canvas chathome-canvas">
            <div className="chathome-stage">
              <CanvasView />
            </div>
          </main>
          <div className="kitchen-canvas-tools">
            <button
              className={`pill ${tool === "comment" ? "on" : ""}`}
              onClick={() => setTool(tool === "comment" ? "move" : "comment")}
              title="Leave comments on the design"
            >
              Comment
            </button>
            <button
              className="pill"
              onClick={() => window.dispatchEvent(new Event("duet:fit"))}
              title="Fit the whole design in view (Shift 1)"
            >
              Fit
            </button>
          </div>
        </div>
        <div className="kitchen-chat">
          <div className="kitchen-chat-head">
            <span className="kitchen-section-label">CHAT</span>
            {cooking && cooking.status !== "stopped" && cooking.status !== "done" && (
              <span className="kitchen-chat-status">
                {cooking.status === "working" ? "cooking…" : cooking.status === "waiting" ? "waiting for you" : "done"}
              </span>
            )}
          </div>
          <div className="kitchen-chat-body">
            {messages.length === 0 && !live && (
              <div className="kitchen-chat-note">You can talk to the AI here about this design, or cook a recipe above.</div>
            )}
            <ChatPanel docked />
          </div>
        </div>
      </section>
    </div>
  );
}

type Live = ReturnType<typeof useCooking>;

/** Keep getting the pointer while it drags, even off the board. A pointer that is not really down cannot be held. */
function hold(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    // nothing to hold
  }
}

/** The steps as boxes joined by lines, on a board that slides and zooms. Boxes can be dragged. */
function Board({ recipe, picked, onPick, onChange, live }: { recipe: Recipe; picked: string | null; onPick: (id: string | null) => void; onChange: (r: Recipe) => void; live: Live }) {
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);
  const pan = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // a new recipe starts with its steps in view
  useEffect(() => {
    const el = box.current;
    if (!el || !recipe.steps.length) return;
    const minX = Math.min(...recipe.steps.map((s) => s.x)) - 40;
    const maxX = Math.max(...recipe.steps.map((s) => s.x)) + NODE_W + 40;
    const minY = Math.min(...recipe.steps.map((s) => s.y)) - 40;
    const maxY = Math.max(...recipe.steps.map((s) => s.y)) + NODE_H + 90;
    const z = Math.min(1, el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY));
    setView({ x: (el.clientWidth - (maxX - minX) * z) / 2 - minX * z, y: (el.clientHeight - (maxY - minY) * z) / 2 - minY * z, z });
  }, [recipe.id]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // a pinch or Ctrl and the wheel zooms where the pointer is; two fingers slide the board
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        setView((v) => {
          const z = Math.min(2, Math.max(0.3, v.z * Math.exp(-e.deltaY * 0.01)));
          const px = e.clientX - r.left;
          const py = e.clientY - r.top;
          return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const at = (s: Step) => (drag?.id === s.id ? { x: drag.x, y: drag.y } : { x: s.x, y: s.y });
  const stateOf = (s: Step, i: number) =>
    !live
      ? ""
      : live.done.includes(s.id)
        ? "done"
        : i === live.at && live.status !== "done"
          ? live.paused
            ? "paused"
            : live.status === "working"
              ? "working"
              : "turn"
          : "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!picked) return;
      const stepIndex = recipe.steps.findIndex((s) => s.id === picked);
      if (stepIndex < 0) return;
      if (live && live.status === "working" && live.at === stepIndex) return;
      e.preventDefault();
      onChange(removeStep(recipe, picked));
      onPick(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recipe, picked, live, onChange, onPick]);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pan.current = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
    hold(e.currentTarget as HTMLElement, e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (drag) return setDrag({ ...drag, x: (e.clientX - drag.dx) / view.z, y: (e.clientY - drag.dy) / view.z });
    const p = pan.current;
    if (p) setView((v) => ({ ...v, x: p.x + e.clientX - p.sx, y: p.y + e.clientY - p.sy }));
  };
  const up = (e: React.PointerEvent) => {
    if (drag) {
      const s = recipe.steps.find((x) => x.id === drag.id);
      if (s && (Math.abs(s.x - drag.x) > 2 || Math.abs(s.y - drag.y) > 2)) onChange(changeStep(recipe, drag.id, { x: Math.round(drag.x), y: Math.round(drag.y) }));
      setDrag(null);
      return;
    }
    const p = pan.current;
    pan.current = null;
    // a click on the empty board lets go of the step
    if (p && Math.abs(e.clientX - p.sx) < 3 && Math.abs(e.clientY - p.sy) < 3) onPick(null);
  };

  const insert = (after: string | null, kind: StepKind = "ai") => {
    const { recipe: r, id } = addStep(recipe, after, kind);
    onChange(r);
    onPick(id);
  };

  const steps = recipe.steps;
  return (
    <div className="kitchen-board" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <div className="kitchen-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <svg className="kitchen-lines" width="1" height="1">
          {steps.slice(1).map((s, i) => {
            const cooked = live?.done.includes(steps[i].id);
            return <path key={s.id} className={cooked ? "cooked" : ""} d={link(at(steps[i]), at(s))} />;
          })}
          {steps.length > 0 && (
            <path
              className="kitchen-stem-path"
              d={`M${at(steps[steps.length - 1]).x + NODE_W / 2},${at(steps[steps.length - 1]).y + NODE_H} L${at(steps[steps.length - 1]).x + NODE_W / 2},${at(steps[steps.length - 1]).y + NODE_H + 24}`}
            />
          )}
        </svg>
        {steps.map((s, i) => {
          const p = at(s);
          const st = stateOf(s, i);
          const isStepCooking = live && live.status === "working" && live.at === i;
          return (
            <div
              key={s.id}
              className={`kitchen-node ${s.kind} ${picked === s.id ? "picked" : ""} ${st}`}
              style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button !== 0) return;
                if (box.current) hold(box.current, e.pointerId);
                setDrag({ id: s.id, dx: e.clientX - s.x * view.z, dy: e.clientY - s.y * view.z, x: s.x, y: s.y });
                onPick(s.id);
              }}
            >
              <div className="kitchen-node-main">
                <div className={`kitchen-node-tile ${s.kind}`}>
                  <StepIcon name={stepIconFor(s)} />
                </div>
                <div className="kitchen-node-info">
                  <span className="kitchen-node-kind">
                    {i + 1} · {KIND_NAMES[s.kind]}
                  </span>
                  <span className="kitchen-node-title">{s.title}</span>
                </div>
              </div>
              {!isStepCooking && (
                <button
                  className="kitchen-node-remove"
                  title="Remove step"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(removeStep(recipe, s.id));
                    if (picked === s.id) onPick(null);
                  }}
                >
                  <Icon name="close" size={10} />
                </button>
              )}
              {st === "done" && <span className="kitchen-node-state done">Done</span>}
              {st === "working" && <span className="kitchen-node-state working">Cooking…</span>}
              {st === "turn" && <span className="kitchen-node-state turn">{s.kind === "ai" ? "Stuck" : "Your turn"}</span>}
              {st === "paused" && <span className="kitchen-node-state paused">Paused</span>}
            </div>
          );
        })}
        {steps.slice(1).map((s, i) => {
          const a = at(steps[i]);
          const b = at(s);
          const dy = b.y - a.y;
          const dx = b.x - a.x;
          let midX: number;
          let midY: number;

          if (dy >= NODE_H * 0.7) {
            midX = (a.x + b.x + NODE_W) / 2;
            midY = (a.y + NODE_H + b.y) / 2;
          } else if (dy <= -NODE_H * 0.7) {
            midX = (a.x + b.x + NODE_W) / 2;
            midY = (a.y + b.y + NODE_H) / 2;
          } else if (dx >= 0) {
            midX = (a.x + NODE_W + b.x) / 2;
            midY = a.y + NODE_H / 2;
          } else {
            midX = (a.x + b.x + NODE_W) / 2;
            midY = a.y + NODE_H / 2;
          }

          return (
            <button
              key={`add-${s.id}`}
              className="kitchen-add between"
              style={{ left: Math.round(midX) - 12, top: Math.round(midY) - 12 }}
              title="Add a step here"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => insert(steps[i].id)}
            >
              <Icon name="plus" size={13} />
            </button>
          );
        })}
        {steps.length > 0 && (
          <button
            className="kitchen-add end"
            style={{ left: Math.round(at(steps[steps.length - 1]).x + NODE_W / 2) - 12, top: Math.round(at(steps[steps.length - 1]).y + NODE_H + 24) }}
            title="Add a step at the end"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => insert(steps[steps.length - 1].id)}
          >
            <Icon name="plus" size={13} />
          </button>
        )}
        {steps.length === 0 && (
          <button className="kitchen-add end" style={{ left: 60, top: 140 }} title="Add the first step" onPointerDown={(e) => e.stopPropagation()} onClick={() => insert(null, "ask")}>
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The line from one box to the next: out of the bottom when the next sits below, or out of the facing side. */
export function link(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dy = b.y - a.y;
  const dx = b.x - a.x;

  // Next box is on a row below
  if (dy >= NODE_H * 0.7) {
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y;
    const bend = Math.max(20, (y2 - y1) / 2);
    return `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`;
  }

  // Next box is on a row above
  if (dy <= -NODE_H * 0.7) {
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y + NODE_H;
    const bend = Math.max(20, (y1 - y2) / 2);
    return `M${x1},${y1} C${x1},${y1 - bend} ${x2},${y2 + bend} ${x2},${y2}`;
  }

  // Same row: going right (forward)
  if (dx >= 0) {
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const gap = Math.max(0, x2 - x1);
    const bend = Math.min(60, Math.max(16, gap / 2));
    return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
  }

  // Same row: going left (snake backward)
  const x1 = a.x;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x + NODE_W;
  const y2 = b.y + NODE_H / 2;
  const gap = Math.max(0, x1 - x2);
  const bend = Math.min(60, Math.max(16, gap / 2));
  return `M${x1},${y1} C${x1 - bend},${y1} ${x2 + bend},${y2} ${x2},${y2}`;
}

/** Under the board: while cooking, the step at hand; otherwise the picked step, to change it. */
function StepPanel({ recipe, step, onChange, onPick, live }: { recipe: Recipe; step: Step | null; onChange: (r: Recipe) => void; onPick: (id: string | null) => void; live: Live }) {
  const running = useChat((c) => c.running);
  const [typed, setTyped] = useState("");
  const current = live && live.status !== "done" ? live.recipe.steps[live.at] : null;

  if (live && !step) {
    if (live.status === "done")
      return (
        <div className="kitchen-step">
          <b>Cooked.</b> Every step is done. Look at the design on the right, or cook it again.
        </div>
      );
    if (!current) return null;
    const before = live.recipe.steps[live.at - 1];
    const reply = before ? live.replies[before.id] : "";
    if (live.paused)
      return (
        <div className="kitchen-step paused">
          <div className="kitchen-step-kind">Step {live.at + 1} of {live.recipe.steps.length} · Paused</div>
          <b>{current.title}</b>
          <p className="kitchen-step-note">{`This recipe was paused at step ${live.at + 1}. Carry on?`}</p>
          {live.error && <p className="kitchen-step-error">{live.error}</p>}
          <div className="kitchen-step-actions">
            <button className="pill" onClick={stopCooking}>
              Stop
            </button>
            <button className="pill primary" onClick={carryOn}>
              Carry on
            </button>
            {live.error === COOK_NO_DESIGN_ERROR && (
              <button className="pill primary" onClick={() => startCooking(live.recipe)}>
                Start again
              </button>
            )}
          </div>
        </div>
      );
    if (live.status === "working")
      return (
        <div className="kitchen-step">
          <div className="kitchen-step-kind">Step {live.at + 1} of {live.recipe.steps.length} · The AI is cooking</div>
          <b>{current.title}</b>
          <p className="kitchen-step-does">{current.does}</p>
          {!running && <p className="kitchen-step-note">Starting…</p>}
        </div>
      );
    if (current.kind === "ai")
      return (
        <div className="kitchen-step">
          <div className="kitchen-step-kind">Step {live.at + 1} of {live.recipe.steps.length} · {current.title}</div>
          <p className="kitchen-step-error">{live.error ?? "This step did not finish."}</p>
          <div className="kitchen-step-actions">
            <button className="pill" onClick={() => answer("")}>
              Skip it
            </button>
            <button className="pill primary" onClick={again}>
              Try again
            </button>
          </div>
        </div>
      );
    const send = () => {
      answer(typed.trim());
      setTyped("");
    };
    return (
      <div className="kitchen-step turn">
        <div className="kitchen-step-kind">Step {live.at + 1} of {live.recipe.steps.length} · Your turn</div>
        <b>{current.title}</b>
        {reply && (
          <div className="kitchen-step-reply">
            <Rich text={reply} />
          </div>
        )}
        <p className="kitchen-step-does">{current.does}</p>
        {current.kind === "ask" ? (
          <textarea
            className="kitchen-answer"
            autoFocus
            value={typed}
            placeholder="Write your answer"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && typed.trim() && send()}
          />
        ) : (
          <p className="kitchen-step-note">Use the comment tool over the design on the right, then continue.</p>
        )}
        <div className="kitchen-step-actions">
          {current.kind === "review" && (
            <button className="pill" onClick={() => setTool("comment")}>
              Comment
            </button>
          )}
          <button className="pill primary" disabled={current.kind === "ask" && !typed.trim()} onClick={send}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (!step)
    return (
      <div className="kitchen-step quiet">
        <p className="kitchen-step-note">
          Pick a step to change it, or press <b>Cook</b> to make the open design with this recipe.
        </p>
      </div>
    );

  const i = recipe.steps.indexOf(step);
  const set = (patch: Partial<Step>) => onChange(changeStep(recipe, step.id, patch));
  return (
    <div className="kitchen-step" key={step.id}>
      <div className="kitchen-step-row">
        <input className="kitchen-step-title" defaultValue={step.title} onBlur={(e) => e.target.value.trim() && e.target.value !== step.title && set({ title: e.target.value.trim() })} />
        <div className="pill mode-switch">
          {(Object.keys(KIND_NAMES) as StepKind[]).map((k) => (
            <button key={k} className={step.kind === k ? "active" : ""} onClick={() => set({ kind: k })}>
              {KIND_NAMES[k]}
            </button>
          ))}
        </div>
      </div>
      <textarea
        className="kitchen-does"
        defaultValue={step.does}
        placeholder={step.kind === "ai" ? "What the AI does in this step" : step.kind === "ask" ? "The question you are asked" : "What to look at before you comment"}
        onBlur={(e) => e.target.value !== step.does && set({ does: e.target.value })}
      />
      <div className="kitchen-step-actions">
        <button className="pill" disabled={i <= 0} onClick={() => onChange(moveStep(recipe, step.id, -1))}>
          Earlier
        </button>
        <button className="pill" disabled={i >= recipe.steps.length - 1} onClick={() => onChange(moveStep(recipe, step.id, 1))}>
          Later
        </button>
        <span className="kitchen-gap" />
        <button
          className="pill"
          disabled={!!(live && live.status === "working" && live.at === i)}
          onClick={() => (onChange(removeStep(recipe, step.id)), onPick(null))}
          title={live && live.status === "working" && live.at === i ? "Cannot remove a step that is cooking" : "Remove this step"}
        >
          Remove step
        </button>
      </div>
    </div>
  );
}
