import { useEffect, useRef, useState } from "react";
import { MAC } from "./shortcuts";
import { newId } from "../commands";
import { dispatch, getState, select, setPagesView } from "../state/store";
import { getTabs, getUntitled, listedProjects, newDesignTab, openProject, openProjectAt } from "../project/project";
import type { Recent } from "../project/project";
import { keepMode, setLayout, useLayout } from "./layout";
import { studioIcon } from "./SpaceSwitch";
import { getChat, newTask } from "../ai/chat";
import { sendToTask } from "../ai/agent";
import Icon from "./Icons";
import { clampDim, CREATE_TILES, editedAgo, firstTab, hideKind, HOME_KINDS, outlineOf, ratioOf, rememberSize, shownKinds, startsVideo } from "./homeLogic";
import { pickPhoto, placePhoto } from "../project/imageImport";
import type { CreateTile, HomeTab, UsedSize } from "./homeLogic";
import { resetPageFocus } from "./pageFocus";
import { isProjectOpen, ProjectMenu, TrashView, usePreview } from "./ChatHome";

interface HomeProps {
  onClose: () => void;
  /** True when Home was opened from a project: only then is there somewhere to go back to. */
  fromProject: boolean;
}

// what Home remembers between visits, on this computer
const HIDDEN_KINDS = "duet.home.hidden";
const USED_SIZES = "duet.home.used";
const readList = <T,>(key: string, ok: (x: unknown) => boolean): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? (v.filter(ok) as T[]) : [];
  } catch {
    return [];
  }
};
const readHidden = () => readList<string>(HIDDEN_KINDS, (x) => typeof x === "string");
const readUsed = () =>
  readList<UsedSize>(USED_SIZES, (x) => {
    const u = x as UsedSize;
    return !!u && typeof u.name === "string" && u.width > 0 && u.height > 0 && typeof u.video === "boolean";
  });
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Home still works, it only forgets
  }
};


export default function Home({ onClose, fromProject }: HomeProps) {
  const mode = useLayout((d) => d.mode);
  // any project open behind Home, saved or not, is somewhere the switch can go back to
  const canGoBack = fromProject || !!getState().project.file || getTabs().length > 0 || getUntitled().length > 0;
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [used, setUsed] = useState<UsedSize[]>(readUsed);
  const [recents, setRecents] = useState<Recent[]>(() => listedProjects());
  // someone who has made things before opens on New; the very first time, on Social media
  const [tab, setTab] = useState<HomeTab>(() => firstTab(recents.length > 0 || used.length > 0, hidden));
  const setHiddenKinds = (next: string[]) => {
    setHidden(next);
    keep(HIDDEN_KINDS, JSON.stringify(next));
  };
  const [ownW, setOwnW] = useState(1080);
  const [ownH, setOwnH] = useState(1350);
  const [ownVideo, setOwnVideo] = useState(false);
  const [allUsed, setAllUsed] = useState(false);
  const [askText, setAskText] = useState("");
  const askInputRef = useRef<HTMLTextAreaElement>(null);

  // Esc goes back to the project Home was opened from
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (fromProject) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, fromProject]);

  const [trash, setTrash] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; r: Recent } | null>(null);

  // Keep recents reactive, and which of them are open
  useEffect(() => {
    const reload = () => setRecents(listedProjects());
    window.addEventListener("duet:recents", reload);
    window.addEventListener("duet:tabs", reload);
    return () => {
      window.removeEventListener("duet:recents", reload);
      window.removeEventListener("duet:tabs", reload);
    };
  }, []);

  /** A new project with one frame of this size. A video opens in the editor with its timeline, empty and ready for clips. */
  const startSized = async (name: string, width: number, height: number, video: boolean, pages = true) => {
    const nextUsed = rememberSize(used, { name, width, height, video });
    setUsed(nextUsed);
    keep(USED_SIZES, JSON.stringify(nextUsed));
    resetPageFocus();
    await newDesignTab();
    // screens for an app sit side by side on the open canvas; everything else is one page at a time
    setPagesView(pages);
    const id = newId("frame");
    dispatch("create_preset_frame", { preset: { name, width, height }, x: 0, y: 0, id });
    if (video) dispatch("set_duration", { id, seconds: 10 });
    select([id]);
    // a new project opens in Design unless it is told its space first
    const path = getState().project.path;
    if (video && path) keepMode(path, "motion");
    setLayout(video ? { space: "edit", mode: "motion", timeLook: "cut" } : { space: "edit", mode: "design" });
    setTimeout(() => window.dispatchEvent(new Event("duet:fit")), 50);
    onClose();
  };

  const openFile = async () => {
    await openProject();
    onClose();
  };

  const handleTileClick = async (tile: CreateTile) => {
    if (tile.kind === "photo") {
      const path = await pickPhoto();
      if (!path) return;
      resetPageFocus();
      await newDesignTab();
      setPagesView(true);
      await placePhoto(path);
      setLayout({ space: "edit", mode: "photo" });
      setTimeout(() => window.dispatchEvent(new Event("duet:fit")), 50);
      onClose();
      return;
    }
    if (tile.kind === "screens" || tile.kind === "canvas") {
      await newDesignTab();
      setPagesView(false);
      setLayout({ space: "edit", mode: "design" });
      onClose();
      return;
    }
    if (tile.width && tile.height) await startSized(tile.title, tile.width, tile.height, startsVideo(tile), tile.group !== "screens");
  };

  const createOwn = () => void startSized(ownVideo ? "Video" : "Your size", clampDim(ownW, 1080), clampDim(ownH, 1350), ownVideo);

  const handleAsk = (textToSend?: string) => {
    const q = (textToSend ?? askText).trim();
    if (!q) return;
    setAskText("");
    onClose();
    setLayout({ space: "edit", editChatOpen: true });
    const chat = getChat();
    const agent = chat.agent;
    const key = newTask(agent);
    const isReady = chat.installed[agent] && chat.agentFound !== false;
    if (isReady) {
      void sendToTask(key, q);
    } else {
      window.dispatchEvent(new CustomEvent("duet:chat-draft", { detail: { text: q } }));
    }
  };

  const handleOpenRecent = async (path: string) => {
    await openProjectAt(path);
    setLayout({ space: "edit" });
    onClose();
  };

  const renderShape = (tile: CreateTile) => {
    if (tile.shape === "screens")
      return (
        <div className="shape-screens">
          <span className="screen-phone" />
          <span className="screen-desk" />
        </div>
      );
    if (tile.shape === "photo")
      return (
        <div className="shape-file">
          <Icon name="image" size={18} />
        </div>
      );
    return <div className={`shape-${tile.shape}`} />;
  };

  const kinds = shownKinds(hidden);
  const kind = tab === "new" ? null : tab;
  const kindLabel = HOME_KINDS.find((k) => k.id === kind)?.label ?? "";
  const shownUsed = allUsed ? used : used.slice(0, 3);

  const visibleRecents = recents.slice(0, 12);

  return (
    <div className="home-screen" data-name="home-screen">
      <header className={`home-bar ${MAC ? "mac" : ""}`} data-tauri-drag-region>
        {/* the same top left as a project's, so you always know where you are: here, Home itself */}
        <span className="top-home on" data-name="home-space-home" data-tauri-drag-region>
          <Icon name="home" size={14} />
          Home
        </span>
        {/* the same switch as the top of a project, in the same place */}
        <div className="pill mode-switch space-switch">
          {/* never locked: with a project behind Home they go back to it; with none they start a new one there */}
          {(["kitchen", "edit"] as const).map((space) => (
            <button
              key={space}
              data-name={`home-space-${space}`}
              title={
                canGoBack
                  ? space === "kitchen" ? "Back to your project, in Kitchen" : "Back to your project, in Studio (Esc)"
                  : space === "kitchen" ? "Start a new project in Kitchen" : "Start a new project in Studio"
              }
              onClick={async () => {
                if (!canGoBack) {
                  resetPageFocus();
                  await newDesignTab();
                }
                setLayout({ space });
                onClose();
              }}
            >
              <Icon name={space === "kitchen" ? "wand" : studioIcon(mode)} size={14} />
              {space === "kitchen" ? "Kitchen" : "Studio"}
            </button>
          ))}
        </div>
        <span className="home-bar-end" />
      </header>

      <main className="home-content">
        <div className="home-top">
          <div className="home-start">
            <div className="home-hero">
              <h2 className="home-headline">What will you make today?</h2>
              <p className="home-sub">Pick a kind and its sizes open below.</p>
            </div>

            {/* New and Open a file first, then the kinds; the picked one shows what it holds in the tray below */}
            <section className="kinds-section">
              <div className="kinds-row" data-name="home-kinds">
                <button type="button" className={`kind-btn plain ${tab === "new" ? "on" : ""}`} data-name="home-new" onClick={() => setTab("new")}>
                  <span className="kind-swatch">
                    <Icon name="plus" size={22} />
                  </span>
                  <span className="kind-name">New</span>
                </button>
                <button type="button" className="kind-btn plain" data-name="home-open-file" onClick={() => void openFile()}>
                  <span className="kind-swatch">
                    <Icon name="file" size={22} />
                  </span>
                  <span className="kind-name">Open a file</span>
                </button>
                <span className="kinds-gap" />
                {kinds.map((id) => (
                  <button key={id} type="button" className={`kind-btn ${id === tab ? "on" : ""}`} data-name={`home-kind-${id}`} onClick={() => setTab(id)}>
                    <span className={`kind-swatch kind-${id}`}>
                      <Icon name={HOME_KINDS.find((k) => k.id === id)!.icon} size={28} />
                    </span>
                    <span className="kind-name">{HOME_KINDS.find((k) => k.id === id)?.label}</span>
                  </button>
                ))}
                {hidden.length > 0 && (
                  <button type="button" className="kinds-all" data-name="home-show-kinds" title="Bring back the kinds you hid" onClick={() => setHiddenKinds([])}>
                    Show all kinds
                  </button>
                )}
              </div>

              {tab === "new" ? (
                <div className="sizes-tray new-tray" data-name="home-new-tray">
                  <div className="own-size">
                    <div className="section-label">Your own size</div>
                    <div className="own-box" data-name="home-own-size">
                      <div className="own-head">Width and height</div>
                      <div className="own-dims">
                        <label className="own-field">
                          <input aria-label="Width" type="number" min={10} max={20000} value={ownW} onChange={(e) => setOwnW(Number(e.target.value) || 0)} onKeyDown={(e) => e.key === "Enter" && createOwn()} />
                          <span>px</span>
                        </label>
                        <button
                          type="button"
                          className="own-swap"
                          title="Swap width and height"
                          onClick={() => {
                            setOwnW(ownH);
                            setOwnH(ownW);
                          }}
                        >
                          <Icon name="swap" size={15} />
                        </button>
                        <label className="own-field">
                          <input aria-label="Height" type="number" min={10} max={20000} value={ownH} onChange={(e) => setOwnH(Number(e.target.value) || 0)} onKeyDown={(e) => e.key === "Enter" && createOwn()} />
                          <span>px</span>
                        </label>
                      </div>
                      <div className="own-actions">
                        <div className="own-medium">
                          <button type="button" className={ownVideo ? "" : "on"} onClick={() => setOwnVideo(false)} title="Opens as a design">
                            Design
                          </button>
                          <button type="button" className={ownVideo ? "on" : ""} onClick={() => setOwnVideo(true)} title="Opens as a video, with a timeline">
                            Video
                          </button>
                        </div>
                        <button type="button" className="own-create" data-name="home-own-create" onClick={createOwn}>
                          Create
                        </button>
                      </div>
                    </div>
                  </div>
                  {used.length > 0 && (
                    <div className="used-sizes">
                      <div className="section-label">Used before</div>
                      <div className="used-row">
                        {shownUsed.map((u) => {
                          const o = outlineOf(u.width, u.height);
                          return (
                            <div
                              key={`${u.width}x${u.height}${u.video ? "v" : ""}`}
                              className="size-card used-card"
                              data-name="home-used-size"
                              title={u.video ? "Opens as a video, with a timeline" : "Opens as a design"}
                              onClick={() => void startSized(u.name, u.width, u.height, u.video)}
                            >
                              {u.video && (
                                <span className="size-medium video">
                                  <Icon name="film" size={15} />
                                </span>
                              )}
                              <div className="ratio-box">
                                <span className="used-outline" style={o} />
                              </div>
                              <div className="create-title">{u.name}</div>
                              <div className="create-dims">
                                {u.width} × {u.height}
                              </div>
                            </div>
                          );
                        })}
                        {used.length > 3 && (
                          <button type="button" className="used-more" title={allUsed ? "Show fewer" : "Show all the sizes you used"} onClick={() => setAllUsed(!allUsed)}>
                            <Icon name={allUsed ? "fold" : "arrow"} size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                kind && (
                  <div className="sizes-tray" data-name={`home-sizes-${kind}`}>
                    <div className="section-label">
                      <span>{kindLabel}</span>
                      {kinds.length > 1 && (
                        <button
                          type="button"
                          className="home-trash"
                          data-name="home-hide-kind"
                          title={`Take ${kindLabel} off Home. You can bring it back.`}
                          onClick={() => {
                            setHiddenKinds(hideKind(hidden, kind));
                            setTab("new");
                          }}
                        >
                          Hide this kind
                        </button>
                      )}
                    </div>
                    <div className="sizes-row">
                      {CREATE_TILES.filter((t) => t.group === kind).map((tile) => (
                        <div key={tile.id} data-name={`create-tile-${tile.id}`} className="size-card" onClick={() => void handleTileClick(tile)}>
                          {/* a small mark of what it opens as: a design, a video, a photo, or screens */}
                          <span className={`size-medium ${startsVideo(tile) ? "video" : ""}`} title={startsVideo(tile) ? "Opens as a video, with a timeline" : tile.kind === "photo" ? "Opens your photo to edit" : tile.group === "screens" ? "Opens on the open canvas, for screens" : "Opens as a design"}>
                            <Icon name={startsVideo(tile) ? "film" : tile.kind === "photo" ? "image" : tile.group === "screens" ? "screens" : "pen"} size={15} />
                          </span>
                          <div className="ratio-box">{renderShape(tile)}</div>
                          <div className="create-title">{tile.title}</div>
                          <div className="create-dims">{[ratioOf(tile.width, tile.height), tile.dims].filter(Boolean).join(" · ")}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}
            </section>
          </div>

          {/* asking Duet: a card of its own beside the kinds */}
          <aside className="home-ask" data-name="home-ask">
            <div className="ask-head">
              <span className="ask-mark">
                <Icon name="skills" size={17} />
              </span>
              <div>
                <div className="ask-title">Or ask Duet</div>
                <div className="ask-sub">Say what you want, Duet makes it with you</div>
              </div>
            </div>
            <div className="ask-try">
              <div className="section-label">Try</div>
              {["A poster for my café", "A modern logo", "App store screenshots"].map((idea) => (
                <button
                  key={idea}
                  type="button"
                  className="ask-idea"
                  onClick={() => {
                    setAskText(idea);
                    askInputRef.current?.focus();
                  }}
                >
                  {idea}
                </button>
              ))}
            </div>
            <div className="ask-box">
              <textarea
                ref={askInputRef}
                data-name="home-ask-input"
                placeholder="What shall we make today?"
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAsk();
                  }
                }}
              />
              <button type="button" className="ask-send" title="Make it with Duet (Enter)" onClick={() => handleAsk()}>
                <Icon name="send" size={17} />
              </button>
            </div>
          </aside>
        </div>

        {/* Recent Work */}
        <section className="recents-section">
          <div className="section-label">
            <span>{trash ? "Trash" : "Recent work"}</span>
            {!trash && visibleRecents.length > 0 && (
              <span className="section-subcount">
                {visibleRecents.length} {visibleRecents.length === 1 ? "project" : "projects"}
              </span>
            )}
            {trash ? (
              <button type="button" className="home-trash" data-name="home-trash-back" title="Back to your recent projects" onClick={() => setTrash(false)}>
                ← Recent work
              </button>
            ) : (
              <button type="button" className="home-trash" data-name="home-trash" title="Projects moved to the Trash" onClick={() => setTrash(true)}>
                <Icon name="trash" size={13} /> Trash
              </button>
            )}
          </div>
          {trash ? (
            <TrashView cards onBack={() => setTrash(false)} />
          ) : visibleRecents.length === 0 ? (
            <div className="recents-empty">No projects yet. Pick a size above or tell Duet what to make.</div>
          ) : (
            <div className="recents-grid">
              {visibleRecents.map((r) => (
                <div
                  key={r.path}
                  className="recent-card"
                  data-name="recent-project-card"
                  onClick={() => void handleOpenRecent(r.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, r });
                  }}
                >
                  <div className="recent-thumb">
                    {isProjectOpen(r.path) && <span className="recent-open">Open</span>}
                    <button
                      type="button"
                      className="recent-more"
                      title="More: show in Finder, close, move to Trash"
                      onClick={(e) => {
                        e.stopPropagation();
                        const b = e.currentTarget.getBoundingClientRect();
                        setMenu({ x: b.left, y: b.bottom + 4, r });
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <Icon name="dots" size={14} />
                    </button>
                    <RecentPicture r={r} />
                  </div>
                  <div className="recent-info">
                    <div className="recent-name" title={r.name}>
                      {r.name}
                    </div>
                    <div className="recent-meta">{editedAgo(r.opened)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      {menu && <ProjectMenu at={menu} onDone={() => setMenu(null)} />}
    </div>
  );
}

/** The picture of a recent project: the one kept on this computer, else the one saved inside its file. */
function RecentPicture({ r }: { r: Recent }) {
  const kept = usePreview(r.thumb ? "" : r.path);
  const src = r.thumb ?? kept;
  return src ? (
    <img src={src} alt={r.name} />
  ) : (
    <div className="recent-thumb-blank">
      <Icon name="frame" size={26} />
    </div>
  );
}
