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
  moveStepTo,
  readRecipe,
  removeStep,
  startCooking,
  stopCooking,
  useCooking,
  getCooking,
  useRecipes,
} from "../ai/recipes";
import PageFlipButton from "./PageFlip";
import { dispatch, getState, openingNumber, setTool, useStore, workDoc } from "../state/store";
import { loadRecipeChoice, saveRecipeChoice } from "../memory/files";
import { schedulePack } from "../project/project";
import { fitKitchen, getLayout, setLayout, useLayout, useWindowWidth } from "./layout";
import { openScene, pause, seek, togglePlay } from "../video/play";
import { boardsOf, openBoard, pinnedOn } from "../document/boards";
import { showComment, useOpenComment } from "./commentFocus";
import type { Comment } from "../document/types";
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
  // in Kitchen the chat always lives in the side, under the recipe; it gets small or big there, never floats
  const docked = true;
  const chatW = useLayout((d) => d.kitchenChatW);
  const plays = useStore((s) => Object.values(s.timeline[s.cursor].doc.elements).some((e) => e.type === "frame" && e.duration > 0));
  const recipeW = useLayout((d) => d.recipeW);
  const projectsOpen = useLayout((d) => d.projectsOpen.kitchen);
  const win = useWindowWidth();
  const commentsOpen = useLayout((d) => d.kitchenComments);
  const recipeFull = useLayout((d) => d.recipeFull);
  const chatH = useLayout((d) => d.kitchenChatH);
  const recipeFolded = useLayout((d) => d.recipeFolded);
  const chatFolded = useLayout((d) => d.kitchenChatFolded);
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

  // each design file remembers the recipe it was last used with; a new file starts with none
  const projectPath = useStore((s) => s.project.path);
  const choiceFor = useRef<{ path: string | null; id: string | null | undefined; opening: number } | null>(null);
  useEffect(() => {
    const was = choiceFor.current;
    choiceFor.current = null;
    // work that was not saved anywhere keeps its recipe when it gets its first file
    if (projectPath && was && was.path === null && was.opening === openingNumber()) {
      choiceFor.current = { path: projectPath, id: null, opening: was.opening };
      return;
    }
    if (!projectPath) {
      const c = getCooking();
      if (!c || c.status === "stopped" || c.status === "done") setLayout({ recipeOn: null });
      choiceFor.current = { path: null, id: null, opening: openingNumber() };
      return;
    }
    let gone = false;
    void loadRecipeChoice(projectPath).then((id) => {
      if (gone) return;
      // a project that has never said keeps the recipe on show, and from now on remembers it
      if (id === undefined) {
        choiceFor.current = { path: projectPath, id: undefined, opening: openingNumber() };
        return;
      }
      const c = getCooking();
      // a cook that is still going keeps its own recipe on show
      if (!c || c.status === "stopped" || c.status === "done") setLayout({ recipeOn: id });
      choiceFor.current = { path: projectPath, id, opening: openingNumber() };
    });
    return () => void (gone = true);
  }, [projectPath]);
  useEffect(() => {
    const at = choiceFor.current;
    if (!at || !at.path || at.path !== projectPath || at.id === recipeOn) return;
    at.id = recipeOn;
    void saveRecipeChoice(at.path, recipeOn).then(schedulePack, () => undefined);
  }, [recipeOn, projectPath]);

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

  // the right side: the recipe on top when one is in use, the chat under it; full screen, only the recipe
  const full = recipeFull && !!recipe;
  const side = true;
  const recipeOpen = !!recipe && !recipeFolded;
  // on a small window the column shrinks toward its smallest width so the design keeps its room
  const fitW = fitKitchen(win, { projectsOpen: projectsOpen, sideW: recipeOpen ? recipeW : chatW, sideMin: recipeOpen ? 420 : 280, comments: commentsOpen ? 300 : 0 });
  const sideW = full ? "minmax(0, 1fr)" : `${fitW}px`;
  return (
    <div
      className={`kitchen ${docked ? "chat-docked" : ""} ${recipe ? "with-recipe" : ""} ${full ? "recipe-full" : ""}`}
      style={{ gridTemplateColumns: [full ? "" : "minmax(0, 1fr)", commentsOpen && !full ? "300px" : "", side ? sideW : ""].filter(Boolean).join(" ") }}
    >
      {!full && (
        <section className="kitchen-preview">
          <div className="kitchen-canvas-stage">
            <main className="canvas chathome-canvas">
              <div className="chathome-stage">
                <CanvasView />
              </div>
              {!docked && <ChatPanel extra={pick} />}
            </main>
            <KitchenTools tool={tool} />
            <PageFlipButton className="kitchen-flip" />
          </div>
          {/* many people never leave Kitchen: a long review timeline, where every comment is a marker */}
          {plays && <ReviewBar />}
        </section>
      )}

      {commentsOpen && !full && <KitchenComments />}

      {side && (
      <div className="kitchen-side">
      {!full && <PullEdge side="left" k={recipeOpen ? "recipeW" : "kitchenChatW"} min={recipeOpen ? 420 : 280} max={900} reset={recipeOpen ? 560 : 360} now={fitW} />}
      {/* with no recipe in use, its bar stays, so recipes are always one click away */}
      {!recipe && (
        <section className="kitchen-middle folded">
          <div className="kitchen-bar">
            <div className="kitchen-bar-body">
              <div className="kitchen-bar-info">
                <div className="kitchen-section-label">Recipe</div>
                <div className="kitchen-cook-hint">None. Work with the chat, or follow a recipe step by step.</div>
              </div>
              <div className="kitchen-bar-actions">{pick}</div>
            </div>
          </div>
        </section>
      )}
      {recipe && (
        <section className={`kitchen-middle ${recipeFolded && !full ? "folded" : ""}`}>
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
                {!full && (
                  <button className="pill icon" data-name="recipe-fold" title={recipeFolded ? "Make the recipe big again" : "Make the recipe small, down to its bar"} onClick={() => setLayout({ recipeFolded: !recipeFolded })}>
                    {recipeFolded ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8M7 3v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg> : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
                  </button>
                )}
                {/* full screen, to build and plan; a cross brings back your design and the chat */}
                <button className="pill icon" data-name="recipe-full" title={recipeFull ? "Back to your design and the chat" : "Full screen, to build and plan the recipe"} onClick={() => setLayout({ recipeFull: !recipeFull, recipeFolded: false })}>
                  {recipeFull ? <Icon name="close" size={14} /> : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.5 2.5h3v3M5.5 11.5h-3v-3M11.5 2.5 8 6M2.5 11.5 6 8" /></svg>}
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
                {!(live && live.status !== "done") && (
                  <div
                    onClick={() => {
                      setMenuOpen(false);
                      use(null);
                    }}
                  >
                    <Icon name="close" size={14} /> Stop using this recipe
                  </div>
                )}
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
          {(!recipeFolded || full) && <StraightBoard recipe={recipe} pickedId={stepId} onPick={setStepId} onChange={change} live={live} />}
        </section>
      )}
      {docked && !full && (
        <section className={`kitchen-chat ${recipeOpen && !chatFolded ? "under-recipe" : ""} ${chatFolded ? "folded" : ""}`} style={recipeOpen && !chatFolded ? { height: chatH } : undefined}>
          {recipeOpen && !chatFolded && <PullHeight />}
          {chatFolded ? (
            <button className="kitchen-chat-bar" data-name="chat-unfold" title="Make the chat big again" onClick={() => setLayout({ kitchenChatFolded: false })}>
              <b>Chat</b>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8M7 3v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          ) : (
            <ChatPanel docked onFold={() => setLayout({ kitchenChatFolded: true })} />
          )}
        </section>
      )}
      </div>
      )}
    </div>
  );
}

/** A few tools under the design: pick and move, look around, comment, play a video, and the way to Studio. */
function KitchenTools({ tool }: { tool: string }) {
  const doc = useStore((s) => s.timeline[s.cursor].doc);
  const boards = boardsOf(doc);
  const boardOpen = openBoard(doc);
  const toolBtn = (k: "move" | "hand", icon: "move" | "hand", title: string) => (
    <button className={`kitchen-tool ${tool === k ? "on" : ""}`} data-name={`kitchen-${k}`} title={title} onClick={() => setTool(k)}>
      <Icon name={icon} size={15} />
    </button>
  );
  return (
    <div className="kitchen-tools">
      {toolBtn("move", "move", "Pick and move (V)")}
      {toolBtn("hand", "hand", "Look around: drag the view (H, or hold Space)")}
      <button className={`kitchen-tool wide with-icon ${tool === "comment" ? "on" : ""}`} data-name="kitchen-comment" title="Click anywhere on the design to leave a note, for the AI or for people. On a video it marks the moment too (C)" onClick={() => setTool(tool === "comment" ? "move" : "comment")}>
        <Icon name="comment" size={15} /> Comment
      </button>
      {boards.length > 1 && (
        <>
          <span className="kitchen-tools-sep" />
          {/* a file with boards: pick which one you and the AI look at */}
          <select className="kitchen-board-pick" title="Which board is open" value={boardOpen} onChange={(e) => dispatch("open_board", { id: e.target.value })}>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
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

/** Comments still open on the board, numbered as on their pins. */
function useLiveComments() {
  const all = useStore((s) => workDoc(s).comments);
  const board = useStore((s) => openBoard(workDoc(s)));
  return (all ?? []).filter((c) => pinnedOn(c, board) && !c.resolved);
}
const clockTime = (x: number) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, "0")}`;

/**
 * The review timeline, like the ones on feedback sites: play, a long line of time to click or drag through,
 * and every comment made at a moment standing on it as a marker. It is for looking and marking, not for editing.
 */
function ReviewBar() {
  const doc = useStore((s) => s.timeline[s.cursor].doc);
  const clock = useStore((s) => s.clock);
  const live = useLiveComments();
  const commentsOpen = useLayout((d) => d.kitchenComments);
  const [zoom, setZoom] = useState(1);
  const [writing, setWriting] = useState<number | null>(null);
  const [words, setWords] = useState("");
  const openOne = clock.scene ? doc.elements[clock.scene] : undefined;
  const scene = openOne && openOne.duration > 0 ? openOne : doc.rootIds.map((id) => doc.elements[id]).find((e) => e?.type === "frame" && e.duration > 0);
  const lane = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scene && getState().clock.scene !== scene.id) openScene(scene.id);
  }, [scene?.id]);
  // pinch on a trackpad, or scroll a mouse wheel, over the line of time zooms it around the pointer; sliding sideways moves along it
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      const px = e.clientX - r.left;
      setZoom((z) => {
        const next = Math.max(1, Math.min(16, z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))));
        const at = (sc.scrollLeft + px) / z;
        requestAnimationFrame(() => (sc.scrollLeft = at * next - px));
        return next;
      });
    };
    sc.addEventListener("wheel", wheel, { passive: false });
    return () => sc.removeEventListener("wheel", wheel);
  }, [!!scene]);
  // zoomed in, the view follows the playhead
  useEffect(() => {
    const sc = scroller.current;
    const ln = lane.current;
    if (!sc || !ln || zoom === 1 || !scene) return;
    const x = (t / scene.duration) * ln.clientWidth;
    if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 20) sc.scrollLeft = x - sc.clientWidth / 3;
  });
  if (!scene) return null;
  const length = scene.duration;
  const t = clock.scene === scene.id ? clock.t : 0;
  const marks = live.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => c.scene === scene.id && typeof c.t === "number");
  const at = (x: number) => {
    const r = lane.current!.getBoundingClientRect();
    return Math.max(0, Math.min(length, ((x - r.left) / r.width) * length));
  };
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    pause();
    seek(at(e.clientX));
    const move = (m: PointerEvent) => seek(at(m.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // a comment written here belongs to the moment, and points at the middle of the picture
  const send = () => {
    const text = words.trim();
    if (text && writing !== null) dispatch("add_comment", { x: scene.x + scene.width / 2, y: scene.y + scene.height / 2, text, on: scene.id, scene: scene.id, t: writing });
    setWriting(null);
    setWords("");
  };
  return (
    <div className="review-bar" data-name="review-bar">
      <button className="review-play" title={clock.playing ? "Pause (Space)" : "Play (Space)"} onClick={togglePlay}>
        {clock.playing ? "❚❚" : "▶"}
      </button>
      <span className="review-time">
        {clockTime(t)} <i>/ {clockTime(length)}</i>
      </span>
      <div className="review-scroll" ref={scroller}>
        <div className="review-lane" ref={lane} style={{ width: `${zoom * 100}%` }} onPointerDown={scrub} title="Click or drag to any moment">
          <div className="review-fill" style={{ width: `${(t / length) * 100}%` }} />
          {marks.map(({ c, n }) => (
            <button
              key={c.id}
              className={`review-mark ${c.by === "ai" ? "ai" : ""}`}
              style={{ left: `${(c.t! / length) * 100}%` }}
              title={`${clockTime(c.t!)} · ${c.text}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => (pause(), seek(c.t!), showComment(c.id))}
            >
              {n}
            </button>
          ))}
          <div className="review-head" style={{ left: `${(t / length) * 100}%` }} />
        </div>
      </div>
      {/* zoom, as in video apps: a slider, or pinch and scroll over the line of time */}
      <input
        className="review-zoom"
        type="range"
        min={0}
        max={4}
        step={0.01}
        value={Math.log2(zoom)}
        title="Zoom the timeline. Or pinch, or scroll, over it"
        onChange={(e) => setZoom(2 ** Number(e.target.value))}
      />
      <div className="review-write-wrap">
        {writing !== null && (
          <div className="review-write">
            <span>At {clockTime(writing)}</span>
            <textarea
              autoFocus
              value={words}
              placeholder="What should change here?"
              onChange={(e) => setWords(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), send());
                if (e.key === "Escape") setWriting(null);
              }}
            />
            <div className="review-write-row">
              <button className="mini" onClick={() => setWriting(null)}>
                Cancel
              </button>
              <button className="mini primary" disabled={!words.trim()} onClick={send}>
                Comment
              </button>
            </div>
          </div>
        )}
        <button className="kitchen-tool wide with-icon review-comment" data-name="comment-at-moment" title="Write a comment about this moment" onClick={() => (pause(), setWriting(t))}>
          <Icon name="comment" size={14} /> Comment at {clockTime(t)}
        </button>
      </div>
      <button className={`kitchen-tool wide ${commentsOpen ? "on" : ""}`} data-name="kitchen-comments" title="Read and resolve the comments" onClick={() => setLayout({ kitchenComments: !commentsOpen })}>
        Comments {live.length || ""}
      </button>
    </div>
  );
}

/** Every comment, to read and resolve: open ones by number as on their pins, with their moment on a video. */
function KitchenComments() {
  const all = useStore((s) => workDoc(s).comments);
  const board = useStore((s) => openBoard(workDoc(s)));
  const openId = useOpenComment();
  const [showDone, setShowDone] = useState(false);
  const list = (all ?? []).filter((c) => pinnedOn(c, board));
  const live = list.filter((c) => !c.resolved);
  const done = list.filter((c) => c.resolved);
  const go = (c: Comment) => {
    if (c.scene && typeof c.t === "number") {
      pause();
      if (getState().clock.scene !== c.scene) openScene(c.scene);
      seek(c.t);
    }
    showComment(c.id);
  };
  return (
    <section className="kitchen-comments" data-name="kitchen-comments-column">
      <div className="kitchen-comments-head">
        <b>Comments {live.length || ""}</b>
        <button className="pill icon" title="Close" onClick={() => setLayout({ kitchenComments: false })}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="kitchen-comments-list">
        {live.map((c, i) => (
          <div key={c.id} className={`kitchen-comment ${openId === c.id ? "sel" : ""}`} onClick={() => go(c)}>
            <div className="kitchen-comment-top">
              <span className={`comment-dot${c.by === "ai" ? " ai" : ""}`}>{i + 1}</span>
              <span className="kitchen-comment-who">{c.by === "ai" ? "AI" : "You"}</span>
              {typeof c.t === "number" && <span className="kitchen-comment-time">{clockTime(c.t)}</span>}
            </div>
            <div className="kitchen-comment-text">{c.text}</div>
            <button
              className="mini"
              onClick={(e) => {
                e.stopPropagation();
                dispatch("resolve_comment", { id: c.id });
              }}
            >
              Resolve
            </button>
          </div>
        ))}
        {!live.length && <div className="empty">No comments open. Pick Comment, then click on the design, or comment at a moment on the timeline.</div>}
        {done.length > 0 && (
          <button className="mini kitchen-comments-done" onClick={() => setShowDone(!showDone)}>
            {showDone ? "Fold resolved" : `Resolved ${done.length}`}
          </button>
        )}
        {showDone &&
          done.map((c) => (
            <div key={c.id} className="kitchen-comment done">
              <div className="kitchen-comment-text">{c.text}</div>
              {c.reply && <small>{c.reply}</small>}
            </div>
          ))}
      </div>
    </section>
  );
}

/** The line between the recipe and the chat: drag it up or down, double-click to put it back. */
function PullHeight() {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = getLayout().kitchenChatH;
    const move = (m: PointerEvent) => setLayout({ kitchenChatH: Math.max(160, Math.min(window.innerHeight - 220, Math.round(h0 + y0 - m.clientY))) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className="kitchen-pull-h" onPointerDown={down} onDoubleClick={() => setLayout({ kitchenChatH: 380 })} title="Drag to give the chat or the recipe more room. Double-click to put it back." />;
}

/** The edge of a Kitchen column: drag it to make the column wider or narrower, double-click to put it back. */
/** Narrower than this, Kitchen's board opens a step's editor over the steps instead of beside them. */
const TIGHT_BOARD = 740;

function PullEdge({ side, k, min, max, reset, now }: { side: "left" | "right"; k: "kitchenChatW" | "recipeW"; min: number; max: number; reset: number; now?: number }) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    // start from the width it really has, which a small window may have shrunk
    const w0 = now ?? getLayout()[k];
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
  // a narrow board has no room for the editor beside the steps: it opens in the list, under the picked step,
  // and clicking that step again shuts it
  const [tight, setTight] = useState(false);
  const tightRef = useRef(false);
  const [shut, setShut] = useState(false);
  // the card that opens in the list scrolls into sight
  useEffect(() => {
    if (!tight || shut) return;
    const t = window.setTimeout(() => boardRef.current?.querySelector(".kitchen-inline-editor")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    return () => window.clearTimeout(t);
  }, [tight, shut, effectiveId]);

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

  // the editor sits beside the picked step, but never runs off the bottom: then it rises and its pointer still finds the step
  const editorRef = useRef<HTMLDivElement>(null);
  // the string from the picked step to its editor; it bends to follow the step even when the step is scrolled out of sight
  const [string, setString] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const place = () => {
    const boardW = boardRef.current?.getBoundingClientRect().width ?? 0;
    const narrow = boardW > 0 && boardW < TIGHT_BOARD;
    if (narrow !== tightRef.current) {
      tightRef.current = narrow;
      setTight(narrow);
    }
    if (narrow) {
      setString(null);
      return;
    }
    if (!effectiveId) return;
    const cardEl = cardRefs.current[effectiveId];
    const scrollEl = scrollRef.current;
    const boardEl = boardRef.current;
    const paneEl = editorRef.current?.parentElement;
    if (!cardEl || !scrollEl || !boardEl || !paneEl) return;
    const cardRect = cardEl.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    const board = boardEl.getBoundingClientRect();
    const pane = paneEl.getBoundingClientRect();
    const offset = cardRect.top - scrollRect.top;
    const tall = editorRef.current?.offsetHeight ?? 0;
    const top = Math.max(0, Math.min(offset, scrollRect.height - tall));
    setEditorTop(top);
    const mid = cardRect.top + cardRect.height / 2;
    const editorTopY = pane.top + top;
    setString({
      x1: cardRect.right - board.left,
      y1: mid - board.top,
      x2: pane.left - board.left,
      y2: Math.max(editorTopY + 18, Math.min(mid, editorTopY + tall - 18)) - board.top,
    });
  };
  useLayoutEffect(place, [effectiveId, steps]);
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollEl.addEventListener("scroll", place, { passive: true });
    // the editor changes height as its step changes kind, and the side changes height when pulled
    const watch = new ResizeObserver(() => place());
    watch.observe(scrollEl);
    if (boardRef.current) watch.observe(boardRef.current);
    if (editorRef.current) watch.observe(editorRef.current);
    return () => {
      scrollEl.removeEventListener("scroll", place);
      watch.disconnect();
    };
  });

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

  // a step is moved by dragging its card: it follows the pointer and the others slide aside to make room
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number; room: number } | null>(null);
  const dragged = useRef(false);
  const grab = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const from = steps.findIndex((x) => x.id === id);
    const startY = e.clientY;
    const el = cardRefs.current[id];
    const next = cardRefs.current[steps[from + 1]?.id] ?? cardRefs.current[steps[from - 1]?.id];
    // how far each card moves to make room: the dragged card's height and the gap to its neighbour
    const room = el && next ? Math.abs(next.getBoundingClientRect().top - el.getBoundingClientRect().top) : (el?.offsetHeight ?? 0);
    const mids = steps.map((x) => {
      const r = cardRefs.current[x.id]?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : 0;
    });
    dragged.current = false;
    let to = from;
    let moved = false;
    const move = (m: PointerEvent) => {
      const dy = m.clientY - startY;
      if (!moved && Math.abs(dy) < 5) return;
      moved = true;
      dragged.current = true;
      const y = mids[from] + dy;
      to = from;
      while (to < steps.length - 1 && y > mids[to + 1]) to++;
      while (to > 0 && y < mids[to - 1]) to--;
      setDrag({ id, from, to, dy, room });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (moved && to !== from) onChange(moveStepTo(recipe, id, to));
      // the click that ends a drag does not pick the step
      setTimeout(() => (dragged.current = false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  /** Where a card is drawn while a step is dragged: the dragged one under the pointer, the ones it passed shifted by one place. */
  const shift = (i: number): React.CSSProperties | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, transition: "none", zIndex: 5 };
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return { transform: `translateY(${-drag.room}px)` };
    if (drag.to < drag.from && i < drag.from && i >= drag.to) return { transform: `translateY(${drag.room}px)` };
    return { transform: "translateY(0)" };
  };

  const insert = (after: string | null) => {
    const { recipe: r, id } = addStep(recipe, after);
    onChange(r);
    onPick(id);
  };

  return (
    <div
      className={`kitchen-board ${tight ? "tight" : ""}`}
      ref={boardRef}
      // a click on the empty dotted space around the steps closes the open card
      onClick={(e) => {
        if (tight && !(e.target as HTMLElement).closest(".kitchen-card, .kitchen-inline-editor, button, input, textarea, select")) setShut(true);
      }}
    >
      <div className="kitchen-steps-scroll" ref={scrollRef}>
        <div className="kitchen-steps-column">
          {steps.map((s, i) => {
            const isPicked = s.id === effectiveId;
            const st = stateOf(s, i);
            return (
              <React.Fragment key={s.id}>
                {i > 0 && (
                  <div className={`kitchen-stem ${drag ? "still" : ""}`}>
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
                  className={`kitchen-card ${isPicked ? "picked" : ""} ${st} ${drag?.id === s.id ? "dragging" : ""}`}
                  style={shift(i)}
                  onPointerDown={(e) => grab(e, s.id)}
                  onClick={() => {
                    if (dragged.current) return;
                    if (tight && isPicked) return setShut(!shut);
                    setShut(false);
                    onPick(s.id);
                  }}
                  title="Drag to move this step"
                >
                  <div className="kitchen-card-main">
                    <div className="kitchen-card-tile">
                      <StepIcon name={stepIconFor(s)} />
                    </div>
                    <div className="kitchen-card-info">
                      <span className="kitchen-card-title">
                        <span className="kitchen-card-num">{i + 1}</span>
                        {s.title}
                      </span>
                      {st === "done" && <span className="kitchen-card-badge done">Done</span>}
                      {st === "working" && <span className="kitchen-card-badge working">Cooking…</span>}
                      {st === "turn" && <span className="kitchen-card-badge turn">{s.kind === "ai" ? "Stuck" : "Your turn"}</span>}
                      {st === "paused" && <span className="kitchen-card-badge paused">Paused</span>}
                      {!st && <span className="kitchen-card-kind">{isBlankStep(s) ? "Not chosen yet" : s.kind === "ai" ? "AI" : "You"}</span>}
                    </div>
                  </div>
                  <StepPreview step={s} live={live} />
                </div>
                {tight && isPicked && !shut && pickedStep && (
                  <div className="kitchen-inline-editor">
                    <StepEditor recipe={recipe} step={pickedStep} onChange={onChange} onPick={onPick} live={live} />
                  </div>
                )}
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

      {pickedStep && string && (
        <svg className="kitchen-string" aria-hidden="true">
          <path
            d={`M${string.x1},${string.y1} C${string.x1 + (string.x2 - string.x1) * 0.6},${string.y1} ${string.x2 - (string.x2 - string.x1) * 0.6},${string.y2} ${string.x2 - 7},${string.y2}`}
          />
          <circle cx={string.x1} cy={string.y1} r={3} />
          <polygon points={`${string.x2 - 8},${string.y2 - 5} ${string.x2},${string.y2} ${string.x2 - 8},${string.y2 + 5}`} />
        </svg>
      )}
      {!tight && (
      <div className="kitchen-editor-pane">
        {pickedStep ? (
          <div className="kitchen-editor-anchor" ref={editorRef} style={{ transform: `translateY(${editorTop}px)` }}>
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
      )}
    </div>
  );
}

/** The right half of a step: what it asks or does, and once cooked, what came of it (your answers, what the AI said, or a picture of the design). */
function StepPreview({ step, live }: { step: Step; live: Live }) {
  const clean = (t: string | undefined) => (t ?? "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
  const cooked = !!live && live.done.includes(step.id);
  const picture = cooked ? live?.pictures?.[step.id] : undefined;
  if (picture)
    return (
      <div className="kitchen-card-preview made">
        <img src={picture} alt="" />
      </div>
    );
  const made = cooked && live ? clean(step.kind === "ai" ? live.replies[step.id] : live.said.filter((x) => x.step === step.id).map((x) => x.text).join(" ")) : "";
  const line = made || clean(step.does);
  return (
    <div className={`kitchen-card-preview ${made ? "made" : ""}`}>
      <p>{line || "Nothing written yet"}</p>
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
  const cookingHere = !!(live && live.status === "working" && live.at === i);

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
              className="pill icon step-remove"
              title="Remove this step"
              onClick={() => {
                onChange(removeStep(recipe, step.id));
                onPick(null);
              }}
            >
              <Icon name="trash" size={15} />
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
            className="pill icon step-remove"
            title="Remove this step"
            onClick={() => {
              onChange(removeStep(recipe, step.id));
              onPick(null);
            }}
          >
            <Icon name="trash" size={15} />
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
        <button
          className="pill icon step-remove"
          disabled={cookingHere}
          title={cookingHere ? "This step is cooking. Stop it first." : "Remove this step"}
          onClick={() => {
            onChange(removeStep(recipe, step.id));
            onPick(null);
          }}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
      {/* who does the step, in the same quiet switch as Design, Video, Photo */}
      <div className="kitchen-who-row">
        <span className="kitchen-editor-prompt-label">Who does it</span>
        <div className="kind-quiet kitchen-who" role="tablist">
          <button role="tab" className={step.kind === "ai" ? "on" : ""} onClick={() => set({ kind: "ai" })} title="The AI works on the design">
            AI does it
          </button>
          <button role="tab" className={step.kind === "ask" ? "on" : ""} onClick={() => set({ kind: "ask" })} title="The cook stops and asks you a question; you type the answer">
            You answer
          </button>
          <button role="tab" className={step.kind === "review" ? "on" : ""} onClick={() => set({ kind: "review" })} title="The cook stops while you pin comments on the design">
            You comment
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
