import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import CanvasView from "../canvas/CanvasView";
import { useChat } from "../ai/chat";
import type { Recipe, Step } from "../ai/recipes";
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
import { getState, setTool, useStore } from "../state/store";
import { getLayout, setLayout, useLayout } from "./layout";
import { openScene, togglePlay } from "../video/play";
import ChatPanel from "./ChatPanel";
import { ask, message, open, save } from "./dialog";
import Icon from "./Icons";
import Rich from "./rich";
import StepIcon, { stepIconFor } from "./StepIcons";
import { useDismiss } from "./useDismiss";

export const NODE_W = 224;
export const NODE_H = 80;

/**
 * Kitchen: you and the AI on one design.
 * - The chat on the left, in its own column, or floating over the canvas.
 * - Your design in the middle, with Comment and Fit.
 * - A recipe only when you pick one from the chat: its steps open on the right, and the cross puts them away.
 */
export default function Kitchen() {
  const recipes = useRecipes();
  const cooking = useCooking();
  const tool = useStore((s) => s.tool);
  const docked = useLayout((d) => d.chatDocked.kitchen);
  const chatW = useLayout((d) => d.kitchenChatW);
  const recipeW = useLayout((d) => d.recipeW);
  const recipeOn = useLayout((d) => d.recipeOn);
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

  // a cook that is still going keeps its recipe on show
  useEffect(() => {
    if (cooking && cooking.status !== "stopped" && cooking.status !== "done") setLayout({ recipeOn: cooking.recipe.id });
  }, [cooking?.recipe.id]);

  const use = (id: string | null) => {
    setLayout({ recipeOn: id });
    setStepId(null);
  };
  const recipe = recipeOn ? (recipes.find((r) => r.id === recipeOn) ?? (cooking && cooking.recipe.id === recipeOn ? cooking.recipe : undefined)) : undefined;
  const live = cooking && recipe && cooking.recipe.id === recipe.id && cooking.status !== "stopped" ? cooking : null;

  const change = (r: Recipe) => keepRecipe(r);

  const newRecipe = () => {
    const r = blankRecipe();
    keepRecipe(r);
    use(r.id);
    setStepId(r.steps[0]?.id ?? null);
  };

  const openFile = async () => {
    const path = await open({ title: "Open a recipe", filters: [{ name: "Recipe", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    const r = readRecipe(await invoke<string>("read_text_file", { path }).catch(() => ""));
    if (!r) return void message("That file is not a recipe.");
    const fresh = recipes.some((x) => x.id === r.id) ? { ...r, id: Math.random().toString(36).slice(2, 9) } : r;
    keepRecipe(fresh);
    use(fresh.id);
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

  // the recipe is picked from the chat, so working with or without one starts in the same place
  const pick = <RecipePick recipes={recipes} on={recipe ?? null} cooking={!!live && live.status !== "done"} onUse={use} onNew={newRecipe} onOpenFile={() => void openFile()} />;

  return (
    <div
      className={`kitchen ${docked ? "chat-docked" : ""} ${recipe ? "with-recipe" : ""}`}
      style={{ gridTemplateColumns: [docked ? `${chatW}px` : "", "minmax(0, 1fr)", recipe ? `${recipeW}px` : ""].filter(Boolean).join(" ") }}
    >
      {docked && (
        <section className="kitchen-chat-col">
          <ChatPanel docked extra={pick} />
          <PullEdge side="right" k="kitchenChatW" min={280} max={560} reset={360} />
        </section>
      )}

      <section className="kitchen-preview">
        <div className="kitchen-canvas-stage">
          <main className="canvas chathome-canvas">
            <div className="chathome-stage">
              <CanvasView />
            </div>
            {!docked && <ChatPanel extra={pick} />}
          </main>
          <KitchenTools tool={tool} />
        </div>
      </section>

      {recipe && (
        <section className="kitchen-middle">
          <PullEdge side="left" k="recipeW" min={420} max={900} reset={560} />
          <div className="kitchen-bar">
            <div className="kitchen-section-label">Recipe</div>
            <div className="kitchen-bar-body">
              <div className="kitchen-bar-info">
                <input
                  key={recipe.id}
                  className="kitchen-name"
                  defaultValue={recipe.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== recipe.name && change({ ...recipe, name: e.target.value.trim() })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <div className="kitchen-cook-hint">Cook runs these steps on your design, and stops when it needs you.</div>
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
                {!(live && live.status !== "done") && (
                  <button className="pill icon" data-name="recipe-off" title="Stop using this recipe: back to the chat and your design" onClick={() => use(null)}>
                    <Icon name="close" size={14} />
                  </button>
                )}
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
                      use(null);
                    }}
                  >
                    <Icon name="trash" size={14} /> Delete recipe
                  </div>
                )}
              </div>
            )}
          </div>
          <StraightBoard recipe={recipe} pickedId={stepId} onPick={setStepId} onChange={change} live={live} />
        </section>
      )}
    </div>
  );
}

/** A few tools under the design: pick and move, look around, comment, play a video, and the way to Studio. */
function KitchenTools({ tool }: { tool: string }) {
  const playing = useStore((s) => s.clock.playing);
  // the frame that plays: the open one, or else the first on the page
  const scene = useStore((s) => {
    const els = s.timeline[s.cursor].doc.elements;
    if (s.clock.scene && els[s.clock.scene]?.duration) return s.clock.scene;
    return Object.values(els).find((e) => e.type === "frame" && e.duration)?.id ?? null;
  });
  const play = () => {
    if (scene && getState().clock.scene !== scene) openScene(scene);
    togglePlay();
  };
  const toolBtn = (t: "move" | "hand" | "comment", icon: "move" | "hand" | "marker", title: string) => (
    <button className={`kitchen-tool ${tool === t ? "on" : ""}`} data-name={`kitchen-${t}`} title={title} onClick={() => setTool(t)}>
      <Icon name={icon} size={15} />
    </button>
  );
  return (
    <div className="kitchen-tools">
      {toolBtn("move", "move", "Pick and move (V)")}
      {toolBtn("hand", "hand", "Look around: drag the view (H, or hold Space)")}
      {toolBtn("comment", "marker", "Mark a spot and leave a note, for the AI or for people (C)")}
      {scene && (
        <>
          <span className="kitchen-tools-sep" />
          <button className="kitchen-tool wide" data-name="kitchen-play" title={playing ? "Pause (Space)" : "Play the video (Space)"} onClick={play}>
            {playing ? "Pause" : "▶ Play"}
          </button>
        </>
      )}
      <span className="kitchen-tools-sep" />
      <button className="kitchen-tool wide" title="Fit the whole design in view (Shift 1)" onClick={() => window.dispatchEvent(new Event("duet:fit"))}>
        Fit
      </button>
      <button className="kitchen-tool wide" data-name="open-in-studio" title="Every tool, to work on the design yourself" onClick={() => setLayout({ space: "edit" })}>
        Open in Studio
      </button>
    </div>
  );
}

/** The edge of a Kitchen column: drag it to make the column wider or narrower, double-click to put it back. */
function PullEdge({ side, k, min, max, reset }: { side: "left" | "right"; k: "kitchenChatW" | "recipeW"; min: number; max: number; reset: number }) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = getLayout()[k];
    const move = (m: PointerEvent) => {
      const d = side === "right" ? m.clientX - x0 : x0 - m.clientX;
      setLayout({ [k]: Math.max(min, Math.min(max, Math.round(w0 + d))) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className={`kitchen-pull ${side}`} onPointerDown={down} onDoubleClick={() => setLayout({ [k]: reset })} title="Drag to make wider or narrower. Double-click to put it back." />;
}

/** Every recipe on a page of its own, from the projects bar, like Skills: pick one to cook with in Kitchen. */
export function RecipesPage({ onClose }: { onClose: () => void }) {
  const recipes = useRecipes();
  const on = useLayout((d) => d.recipeOn);
  useEffect(() => void loadRecipes(), []);
  const use = (id: string) => {
    setLayout({ space: "kitchen", recipeOn: id });
    onClose();
  };
  const openFile = async () => {
    const path = await open({ title: "Open a recipe", filters: [{ name: "Recipe", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    const r = readRecipe(await invoke<string>("read_text_file", { path }).catch(() => ""));
    if (!r) return void message("That file is not a recipe.");
    const fresh = recipes.some((x) => x.id === r.id) ? { ...r, id: Math.random().toString(36).slice(2, 9) } : r;
    keepRecipe(fresh);
    use(fresh.id);
  };
  return (
    <section className="skills-page recipes-page">
      <div className="skills-page-head">
        <h2>Recipes</h2>
        <div className="recipes-page-actions">
          <button className="pill" onClick={() => void openFile()}>
            Open a recipe file
          </button>
          <button
            className="pill"
            onClick={() => {
              const r = blankRecipe();
              keepRecipe(r);
              use(r.id);
            }}
          >
            New recipe
          </button>
          <button className="pill" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <p className="recipes-page-about">A recipe is a way of working, step by step: what the AI does, and where it stops to ask you. Pick one, and Kitchen follows it on your design.</p>
      <div className="recipes-page-list">
        {recipes.map((r) => (
          <div key={r.id} className={`recipes-page-card ${r.id === on ? "on" : ""}`}>
            <div className="recipes-page-text">
              <b>{r.name}</b>
              <span>{r.about || `${r.steps.length} steps`}</span>
              <small>{r.steps.map((x) => x.title).join(" · ")}</small>
            </div>
            <button className={`pill ${r.id === on ? "" : "primary"}`} onClick={() => use(r.id)}>
              {r.id === on ? "In use" : "Use"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** In the chat's top row: work with a recipe, or with none. */
function RecipePick({
  recipes,
  on,
  cooking,
  onUse,
  onNew,
  onOpenFile,
}: {
  recipes: Recipe[];
  on: Recipe | null;
  cooking: boolean;
  onUse: (id: string | null) => void;
  onNew: () => void;
  onOpenFile: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), ".recipe-pick-menu, .recipe-pick");
  const choose = (f: () => void) => () => (setOpen(false), f());
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`recipe-pick ${on ? "on" : ""}`}
        data-name="use-recipe"
        title={on ? `Using the recipe ${on.name}` : "Work step by step from a recipe"}
        onClick={() => {
          const b = btn.current?.getBoundingClientRect();
          if (b) setPos({ top: b.bottom + 4, left: Math.min(b.left, window.innerWidth - 300) });
          setOpen(!open);
        }}
      >
        <span>{on ? on.name : "Use a recipe"}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1.5 2.5 4 5.5l2.5-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="recipe-pick-menu" style={pos}>
          {recipes.map((r) => (
            <div key={r.id} className={r.id === on?.id ? "on" : ""} onClick={choose(() => onUse(r.id))}>
              <b>{r.name}</b>
              <small>{r.about || `${r.steps.length} steps`}</small>
            </div>
          ))}
          <hr />
          <div onClick={choose(onNew)}>New recipe</div>
          <div onClick={choose(onOpenFile)}>Open a recipe file</div>
          {on && !cooking && <div onClick={choose(() => onUse(null))}>No recipe, just the chat</div>}
        </div>
      )}
    </>
  );
}

type Live = ReturnType<typeof useCooking>;

/** A step just added with a plus: no instructions and its default name. Who does it is not chosen yet. */
const isBlankStep = (s: Step) => !s.does.trim() && (s.title === "New step" || s.title === "Blank step");

/**
 * Straight line of steps:
 * - Straight column from top to bottom, numbered, full-width cards with icon, "AI" or "You", and name.
 * - Thin line joins the cards with small centered plus buttons between cards and after the last one.
 * - Step editor sits to the right of the column, beside the picked step.
 */
function StraightBoard({
  recipe,
  pickedId,
  onPick,
  onChange,
  live,
}: {
  recipe: Recipe;
  pickedId: string | null;
  onPick: (id: string | null) => void;
  onChange: (r: Recipe) => void;
  live: Live;
}) {
  const steps = recipe.steps;
  const effectiveId = pickedId ?? (live && live.status !== "done" ? steps[live.at]?.id : steps[0]?.id) ?? null;
  const pickedStep = steps.find((s) => s.id === effectiveId) ?? null;

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [editorTop, setEditorTop] = useState(16);

  // Keyboard shortcut to remove step
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!effectiveId) return;
      const stepIndex = steps.findIndex((s) => s.id === effectiveId);
      if (stepIndex < 0) return;
      if (live && live.status === "working" && live.at === stepIndex) return;
      e.preventDefault();
      onChange(removeStep(recipe, effectiveId));
      onPick(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recipe, effectiveId, live, onChange, onPick, steps]);

  // Compute vertical offset of step editor so it sits directly beside the picked step
  useLayoutEffect(() => {
    if (!effectiveId) return;
    const cardEl = cardRefs.current[effectiveId];
    const scrollEl = scrollRef.current;
    if (!cardEl || !scrollEl) return;

    const cardRect = cardEl.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    const offset = cardRect.top - scrollRect.top;
    setEditorTop(Math.max(0, offset + 12));
  }, [effectiveId, steps]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const update = () => {
      if (!effectiveId) return;
      const cardEl = cardRefs.current[effectiveId];
      if (!cardEl) return;
      const cardRect = cardEl.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const offset = cardRect.top - scrollRect.top;
      setEditorTop(Math.max(0, offset + 12));
    };
    scrollEl.addEventListener("scroll", update, { passive: true });
    return () => scrollEl.removeEventListener("scroll", update);
  }, [effectiveId]);

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

  const insert = (after: string | null) => {
    const { recipe: r, id } = addStep(recipe, after);
    onChange(r);
    onPick(id);
  };

  return (
    <div className="kitchen-board" ref={boardRef}>
      <div className="kitchen-steps-scroll" ref={scrollRef}>
        <div className="kitchen-steps-column">
          {steps.map((s, i) => {
            const isPicked = s.id === effectiveId;
            const st = stateOf(s, i);
            return (
              <React.Fragment key={s.id}>
                {i > 0 && (
                  <div className="kitchen-stem">
                    <div className="kitchen-stem-line" />
                    <button
                      className="kitchen-add between"
                      title="Add a step here"
                      onClick={(e) => {
                        e.stopPropagation();
                        insert(steps[i - 1].id);
                      }}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                  </div>
                )}
                <div
                  ref={(el) => {
                    cardRefs.current[s.id] = el;
                  }}
                  className={`kitchen-card ${isPicked ? "picked" : ""} ${st}`}
                  onClick={() => onPick(s.id)}
                >
                  <div className="kitchen-card-tile">
                    <StepIcon name={stepIconFor(s)} />
                  </div>
                  <div className="kitchen-card-info">
                    <span className="kitchen-card-kind">
                      {i + 1} · {isBlankStep(s) ? "Not chosen yet" : s.kind === "ai" ? "AI" : "You"}
                    </span>
                    <span className="kitchen-card-title">{s.title}</span>
                  </div>
                  {st === "done" && <span className="kitchen-card-badge done">Done</span>}
                  {st === "working" && <span className="kitchen-card-badge working">Cooking…</span>}
                  {st === "turn" && <span className="kitchen-card-badge turn">{s.kind === "ai" ? "Stuck" : "Your turn"}</span>}
                  {st === "paused" && <span className="kitchen-card-badge paused">Paused</span>}
                </div>
              </React.Fragment>
            );
          })}

          {steps.length > 0 && (
            <div className="kitchen-stem end">
              <div className="kitchen-stem-line" />
              <button
                className="kitchen-add end"
                title="Add a step at the end"
                onClick={(e) => {
                  e.stopPropagation();
                  insert(steps[steps.length - 1].id);
                }}
              >
                <Icon name="plus" size={12} />
              </button>
            </div>
          )}

          {steps.length === 0 && (
            <div className="kitchen-stem empty">
              <button className="kitchen-add end" title="Add the first step" onClick={() => insert(null)}>
                <Icon name="plus" size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="kitchen-editor-pane">
        {pickedStep ? (
          <div className="kitchen-editor-anchor" style={{ transform: `translateY(${editorTop}px)` }}>
            <div className="kitchen-editor-connector">
              <div className="kitchen-connector-pointer" />
              <div className="kitchen-connector-line" />
            </div>
            <StepEditor
              recipe={recipe}
              step={pickedStep}
              onChange={onChange}
              onPick={onPick}
              live={live}
            />
          </div>
        ) : (
          <div className="kitchen-editor-empty">
            <p className="kitchen-step-note">
              Pick a step to change it, or press <b>Cook</b> to make the open design with this recipe.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Step editor beside the picked step.
 * - Blank step first asks what it is: "AI does it" or "You do it" (then your comments, or your answers).
 * - Configured step shows title, switch, instructions, and actions.
 * - While cooking, shows the active cook turn / working / paused status.
 */
function StepEditor({
  recipe,
  step,
  onChange,
  onPick,
  live,
}: {
  recipe: Recipe;
  step: Step;
  onChange: (r: Recipe) => void;
  onPick: (id: string | null) => void;
  live: Live;
}) {
  const running = useChat((c) => c.running);
  const [typed, setTyped] = useState("");
  const isCurrentLive = live && live.status !== "done" && live.recipe.steps[live.at]?.id === step.id;

  const isBlank = isBlankStep(step);
  const [subChoice, setSubChoice] = useState<"none" | "you">("none");

  const i = recipe.steps.findIndex((s) => s.id === step.id);
  const set = (patch: Partial<Step>) => onChange(changeStep(recipe, step.id, patch));

  // When live cook is on this step, show the live execution panel
  if (isCurrentLive && live) {
    const before = live.recipe.steps[live.at - 1];
    const reply = before ? live.replies[before.id] : "";

    if (live.paused) {
      return (
        <div className="kitchen-editor-card live paused">
          <div className="kitchen-step-kind">
            Step {live.at + 1} of {live.recipe.steps.length} · Paused
          </div>
          <b className="kitchen-editor-card-title">{step.title}</b>
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
    }

    if (live.status === "working") {
      return (
        <div className="kitchen-editor-card live working">
          <div className="kitchen-step-kind">
            Step {live.at + 1} of {live.recipe.steps.length} · The AI is cooking
          </div>
          <b className="kitchen-editor-card-title">{step.title}</b>
          <p className="kitchen-step-does">{step.does}</p>
          {!running && <p className="kitchen-step-note">Starting…</p>}
        </div>
      );
    }

    if (step.kind === "ai") {
      return (
        <div className="kitchen-editor-card live error">
          <div className="kitchen-step-kind">
            Step {live.at + 1} of {live.recipe.steps.length} · {step.title}
          </div>
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
    }

    const send = () => {
      answer(typed.trim());
      setTyped("");
    };

    return (
      <div className="kitchen-editor-card live turn">
        <div className="kitchen-step-kind">
          Step {live.at + 1} of {live.recipe.steps.length} · Your turn
        </div>
        <b className="kitchen-editor-card-title">{step.title}</b>
        {reply && (
          <div className="kitchen-step-reply">
            <Rich text={reply} />
          </div>
        )}
        <p className="kitchen-step-does">{step.does}</p>
        {step.kind === "ask" ? (
          <textarea
            className="kitchen-answer"
            autoFocus
            value={typed}
            placeholder="Write your answer"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && typed.trim() && send()}
          />
        ) : (
          <p className="kitchen-step-note">Use the comment tool over the design on the left, then continue.</p>
        )}
        <div className="kitchen-step-actions">
          {step.kind === "review" && (
            <button className="pill" onClick={() => setTool("comment")}>
              Comment
            </button>
          )}
          <button className="pill primary" disabled={step.kind === "ask" && !typed.trim()} onClick={send}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  // Blank step: asks what it is with clear choices
  if (isBlank) {
    if (subChoice === "you") {
      return (
        <div className="kitchen-editor-card blank-card">
          <div className="kitchen-blank-head">
            <span className="kitchen-blank-prompt">You do it</span>
            <button className="pill icon kitchen-blank-back" onClick={() => setSubChoice("none")} title="Back to choices">
              <Icon name="arrow" size={14} className="kitchen-fold-arrow-back" /> Back
            </button>
          </div>
          <div className="kitchen-blank-choices">
            <button
              className="kitchen-blank-option"
              onClick={() => {
                set({
                  kind: "review",
                  title: "Your comments",
                  does: "Pin comments on the design where you want changes. Continue when you are done.",
                });
              }}
            >
              <div className="kitchen-blank-icon">
                <StepIcon name="comments" />
              </div>
              <div className="kitchen-blank-text">
                <span className="kitchen-blank-title">Your comments</span>
                <span className="kitchen-blank-desc">Leave feedback directly on the design</span>
              </div>
            </button>
            <button
              className="kitchen-blank-option"
              onClick={() => {
                set({
                  kind: "ask",
                  title: "Your answers",
                  does: "Answer questions from the AI.",
                });
              }}
            >
              <div className="kitchen-blank-icon">
                <StepIcon name="answers" />
              </div>
              <div className="kitchen-blank-text">
                <span className="kitchen-blank-title">Your answers</span>
                <span className="kitchen-blank-desc">Answer questions asked by the AI</span>
              </div>
            </button>
          </div>
          <div className="kitchen-step-actions">
            <button
              className="pill danger-text"
              onClick={() => {
                onChange(removeStep(recipe, step.id));
                onPick(null);
              }}
            >
              Remove step
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="kitchen-editor-card blank-card">
        <div className="kitchen-blank-head">
          <span className="kitchen-blank-prompt">What is this step?</span>
        </div>
        <div className="kitchen-blank-choices">
          <button
            className="kitchen-blank-option"
            onClick={() => {
              set({
                kind: "ai",
                title: "AI does something",
                does: "Describe what the AI does in this step.",
              });
            }}
          >
            <div className="kitchen-blank-icon">
              <StepIcon name="ai-fallback" />
            </div>
            <div className="kitchen-blank-text">
              <span className="kitchen-blank-title">AI does it</span>
              <span className="kitchen-blank-desc">The AI works on the design</span>
            </div>
          </button>
          <button className="kitchen-blank-option" onClick={() => setSubChoice("you")}>
            <div className="kitchen-blank-icon">
              <StepIcon name="you-fallback" />
            </div>
            <div className="kitchen-blank-text">
              <span className="kitchen-blank-title">You do it</span>
              <span className="kitchen-blank-desc">Your comments, or your answers</span>
            </div>
          </button>
        </div>
        <div className="kitchen-step-actions">
          <button
            className="pill danger-text"
            onClick={() => {
              onChange(removeStep(recipe, step.id));
              onPick(null);
            }}
          >
            Remove step
          </button>
        </div>
      </div>
    );
  }

  // Standard step editor
  return (
    <div className="kitchen-editor-card" key={step.id}>
      <div className="kitchen-editor-row">
        <input
          className="kitchen-step-title-input"
          defaultValue={step.title}
          placeholder="Step title"
          onBlur={(e) => e.target.value.trim() && e.target.value !== step.title && set({ title: e.target.value.trim() })}
        />
      </div>
      {/* who does the step, in the same quiet switch as Design, Video, Photo */}
      <div className="kitchen-who-row">
        <span className="kitchen-editor-prompt-label">Who does it</span>
        <div className="kind-quiet kitchen-who" role="tablist">
          <button role="tab" className={step.kind === "ai" ? "on" : ""} onClick={() => set({ kind: "ai" })}>
            AI does it
          </button>
          <button role="tab" className={step.kind === "ask" ? "on" : ""} onClick={() => set({ kind: "ask" })}>
            AI asks you
          </button>
          <button role="tab" className={step.kind === "review" ? "on" : ""} onClick={() => set({ kind: "review" })}>
            You review
          </button>
        </div>
      </div>

      <div className="kitchen-editor-prompt-wrap">
        <div className="kitchen-editor-prompt-label">
          {step.kind === "ai" ? "What the AI does in this step" : step.kind === "ask" ? "The question you are asked" : "What to look at before you comment"}
        </div>
        <textarea
          className="kitchen-does-input"
          defaultValue={step.does}
          placeholder={step.kind === "ai" ? "What the AI does in this step" : step.kind === "ask" ? "The question you are asked" : "What to look at before you comment"}
          onBlur={(e) => e.target.value !== step.does && set({ does: e.target.value })}
        />
      </div>

      <div className="kitchen-step-actions">
        <button className="pill" disabled={i <= 0} onClick={() => onChange(moveStep(recipe, step.id, -1))}>
          Earlier
        </button>
        <button className="pill" disabled={i >= recipe.steps.length - 1} onClick={() => onChange(moveStep(recipe, step.id, 1))}>
          Later
        </button>
        <span className="kitchen-gap" />
        <button
          className="pill danger-text"
          disabled={!!(live && live.status === "working" && live.at === i)}
          onClick={() => {
            onChange(removeStep(recipe, step.id));
            onPick(null);
          }}
          title={live && live.status === "working" && live.at === i ? "Cannot remove a step that is cooking" : "Remove this step"}
        >
          Remove step
        </button>
      </div>
    </div>
  );
}

/** Legacy connecting line helper kept for test backwards-compatibility */
export function link(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dy = b.y - a.y;
  const dx = b.x - a.x;

  if (dy >= NODE_H * 0.7) {
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y;
    const bend = Math.max(20, (y2 - y1) / 2);
    return `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`;
  }

  if (dy <= -NODE_H * 0.7) {
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y + NODE_H;
    const bend = Math.max(20, (y1 - y2) / 2);
    return `M${x1},${y1} C${x1},${y1 - bend} ${x2},${y2 + bend} ${x2},${y2}`;
  }

  if (dx >= 0) {
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const gap = Math.max(0, x2 - x1);
    const bend = Math.min(60, Math.max(16, gap / 2));
    return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
  }

  const x1 = a.x;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x + NODE_W;
  const y2 = b.y + NODE_H / 2;
  const gap = Math.max(0, x1 - x2);
  const bend = Math.min(60, Math.max(16, gap / 2));
  return `M${x1},${y1} C${x1 - bend},${y1} ${x2 + bend},${y2} ${x2},${y2}`;
}
