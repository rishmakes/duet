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
import { setTool, useStore } from "../state/store";
import { setLayout } from "./layout";
import ChatPanel from "./ChatPanel";
import { ask, message, open, save } from "./dialog";
import Icon from "./Icons";
import Rich from "./rich";
import StepIcon, { stepIconFor } from "./StepIcons";
import { useDismiss } from "./useDismiss";

export const NODE_W = 224;
export const NODE_H = 80;

/**
 * Kitchen: where work is cooked from recipes.
 * - Recipes on the left (folds to a thin strip with an unfold arrow, and remembers state).
 * - Middle board: straight column of steps top to bottom, joined by a thin line with centered plus buttons.
 * - Step editor sits to the right of the column, beside the picked step.
 * - Right: open design preview with Studio canvas surface, and chat panel docked below it.
 */
export default function Kitchen() {
  const recipes = useRecipes();
  const cooking = useCooking();
  const tool = useStore((s) => s.tool);
  const project = useStore((s) => s.project);
  const [pickedId, setPickedId] = useState<string>(recipes[0]?.id ?? "");
  const [stepId, setStepId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [recipesFolded, setRecipesFolded] = useState<boolean>(() => {
    try {
      return localStorage.getItem("duet:kitchen-recipes-folded") === "1";
    } catch {
      return false;
    }
  });

  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useDismiss(menuOpen, () => setMenuOpen(false), ".kitchen-menu, .kitchen-menu-btn");

  const toggleFold = () => {
    setRecipesFolded((f) => {
      const next = !f;
      try {
        localStorage.setItem("duet:kitchen-recipes-folded", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

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
  const live = cooking && recipe && cooking.recipe.id === recipe.id && cooking.status !== "stopped" ? cooking : null;

  const change = (r: Recipe) => keepRecipe(r);

  const newRecipe = () => {
    const r = blankRecipe();
    keepRecipe(r);
    setPickedId(r.id);
    setStepId(r.steps[0]?.id ?? null);
  };

  const openFile = async () => {
    const path = await open({ title: "Open a recipe", filters: [{ name: "Recipe", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    const r = readRecipe(await invoke<string>("read_text_file", { path }).catch(() => ""));
    if (!r) return void message("That file is not a recipe.");
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
    <div className={`kitchen ${recipesFolded ? "recipes-folded" : ""}`}>
      {recipesFolded ? (
        <aside className="kitchen-recipes folded" onClick={toggleFold} title="Unfold recipes">
          <div className="kitchen-folded-head">
            <button
              className="pill icon kitchen-fold-btn"
              title="Unfold recipes"
              onClick={(e) => {
                e.stopPropagation();
                toggleFold();
              }}
            >
              <Icon name="arrow" size={14} />
            </button>
          </div>
          <div className="kitchen-folded-icon" aria-hidden="true">
            <StepIcon name="brief" />
          </div>
          <span className="kitchen-folded-label">RECIPES</span>
        </aside>
      ) : (
        <aside className="kitchen-recipes">
          <div className="kitchen-head">
            <span className="kitchen-section-label">Recipes</span>
            <div className="kitchen-head-actions">
              <button className="pill icon" title="New recipe" onClick={newRecipe}>
                <Icon name="plus" size={15} />
              </button>
              <button className="pill icon kitchen-fold-btn" title="Fold recipes" onClick={toggleFold}>
                <Icon name="arrow" size={14} className="kitchen-fold-arrow-back" />
              </button>
            </div>
          </div>
          <div className="kitchen-list">
            {recipes.map((r) => (
              <button
                key={r.id}
                className={`kitchen-recipe ${r.id === recipe?.id ? "on" : ""}`}
                onClick={() => {
                  setPickedId(r.id);
                  setStepId(null);
                }}
              >
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
      )}

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
            <StraightBoard
              recipe={recipe}
              pickedId={stepId}
              onPick={setStepId}
              onChange={change}
              live={live}
            />
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
            <ChatPanel docked />
          </div>
        </div>
      </section>
    </div>
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
          <p className="kitchen-step-note">Use the comment tool over the design on the right, then continue.</p>
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
        <div className="pill mode-switch kitchen-kind-switch">
          <button className={step.kind === "ai" ? "active" : ""} onClick={() => set({ kind: "ai" })}>
            AI
          </button>
          <button className={step.kind === "ask" ? "active" : ""} onClick={() => set({ kind: "ask" })}>
            Ask you
          </button>
          <button className={step.kind === "review" ? "active" : ""} onClick={() => set({ kind: "review" })}>
            Your review
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
