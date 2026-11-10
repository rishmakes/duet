import { useEffect, useRef, useState } from "react";
import { newId } from "../commands";
import { dispatch, getState, select, setPagesView } from "../state/store";
import { getTabs, getUntitled, listedProjects, newDesignTab, openProject, openProjectAt } from "../project/project";
import type { Recent } from "../project/project";
import { keepMode, setLayout } from "./layout";
import { getChat, newTask } from "../ai/chat";
import { sendToTask } from "../ai/agent";
import Icon from "./Icons";
import { clampDim, CREATE_TILES, CUSTOM_PRESETS, editedAgo, hideKind, HOME_KINDS, openKind, ratioOf, shownKinds, startsVideo } from "./homeLogic";
import { pickPhoto, placePhoto } from "../project/imageImport";
import type { CreateTile, HomeKind } from "./homeLogic";
import { resetPageFocus } from "./pageFocus";
import { isProjectOpen, ProjectMenu, TrashView, usePreview } from "./ChatHome";

interface HomeProps {
  onClose: () => void;
  /** True when Home was opened from a project: only then is there somewhere to go back to. */
  fromProject: boolean;
  /** True in Duet dev, which wears its DEV tag here too so the top row matches a project's. */
  dev?: boolean;
}

// what Home remembers between visits, on this computer
const LAST_KIND = "duet.home.kind";
const HIDDEN_KINDS = "duet.home.hidden";
const readHidden = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KINDS) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const readLast = (): string | null => {
  try {
    return localStorage.getItem(LAST_KIND);
  } catch {
    return null;
  }
};
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Home still works, it only forgets
  }
};

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export default function Home({ onClose, fromProject, dev }: HomeProps) {
  // any project open behind Home, saved or not, is somewhere the switch can go back to
  const canGoBack = fromProject || !!getState().project.file || getTabs().length > 0 || getUntitled().length > 0;
  // where the box for your own size hangs: under the Custom size button, or under the tile in the open kind
  const [customAt, setCustomAt] = useState<"top" | "tray" | null>(null);
  const customOpen = customAt !== null;
  const setCustomOpen = (on: boolean) => setCustomAt(on ? "top" : null);
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [last, setLast] = useState<string | null>(readLast);
  const kind = openKind(last, hidden);
  const pickKind = (id: HomeKind) => {
    setLast(id);
    keep(LAST_KIND, id);
    setCustomAt(null);
  };
  const setHiddenKinds = (next: string[]) => {
    setHidden(next);
    keep(HIDDEN_KINDS, JSON.stringify(next));
  };
  const [customW, setCustomW] = useState(1080);
  const [customH, setCustomH] = useState(1350);
  const [askText, setAskText] = useState("");
  const [recents, setRecents] = useState<Recent[]>(() => listedProjects());
  const popoverRef = useRef<HTMLDivElement>(null);
  const askInputRef = useRef<HTMLInputElement>(null);

  // Esc closes popover first if open, else closes Home
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (customOpen) {
          setCustomOpen(false);
          return;
        }
        if (fromProject) onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [customOpen, onClose, fromProject]);

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

  // Dismiss popover on outside click
  useEffect(() => {
    if (!customOpen) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (popoverRef.current && !popoverRef.current.contains(target) && !target?.closest(".custom-anchor")) {
        setCustomOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [customOpen]);

  /** A new project with one frame of this size. A video opens in the editor with its timeline, empty and ready for clips. */
  const startSized = async (name: string, width: number, height: number, video: boolean, pages = true) => {
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

  const handleCreateCustom = async () => {
    const video = customAt === "tray" && kind === "video";
    const pages = !(customAt === "tray" && kind === "screens");
    setCustomAt(null);
    await startSized(video ? "Video" : "Custom", clampDim(customW, 1080), clampDim(customH, 1350), video, pages);
  };

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

  const customBox = () => (
    <div ref={popoverRef} className="custom-popover" data-name="custom-size-popover" onClick={(e) => e.stopPropagation()}>
      <div className="popover-head">
        <span className="popover-title">{customAt === "tray" && kind === "video" ? "Your own video size" : "Your own size"}</span>
        <button type="button" className="popover-close" title="Close" onClick={() => setCustomAt(null)}>
          ×
        </button>
      </div>
      <div className="dimension-fields">
        <div className="dim-field">
          <label className="field-label">Width</label>
          <div className="field-input-box">
            <input type="number" min={10} max={20000} value={customW} onChange={(e) => setCustomW(Number(e.target.value) || 0)} onKeyDown={(e) => e.key === "Enter" && void handleCreateCustom()} />
          </div>
        </div>
        <div className="dim-field">
          <label className="field-label">Height</label>
          <div className="field-input-box">
            <input type="number" min={10} max={20000} value={customH} onChange={(e) => setCustomH(Number(e.target.value) || 0)} onKeyDown={(e) => e.key === "Enter" && void handleCreateCustom()} />
          </div>
        </div>
      </div>
      <div className="popover-presets">
        <div className="preset-list-title">Presets</div>
        <div className="preset-pills">
          {CUSTOM_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`preset-pill ${customW === p.width && customH === p.height ? "active" : ""}`}
              onClick={() => {
                setCustomW(p.width);
                setCustomH(p.height);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="popover-actions">
        <button type="button" className="pill" onClick={() => setCustomAt(null)}>
          Cancel
        </button>
        <button type="button" className="pill primary" onClick={() => void handleCreateCustom()}>
          Create
        </button>
      </div>
    </div>
  );

  const kinds = shownKinds(hidden);
  const kindLabel = HOME_KINDS.find((k) => k.id === kind)?.label ?? "";

  const visibleRecents = recents.slice(0, 12);

  return (
    <div className="home-screen" data-name="home-screen">
      <header className={`home-bar ${MAC ? "mac" : ""}`} data-tauri-drag-region>
        <span className="logo home-logo" data-tauri-drag-region>
          Du<b>et</b>
          {dev && <i className="checkmark">dev</i>}
          <i className="early-tag" title="Duet is in early access. Some things are unfinished and you may meet bugs. Save versions of work that matters.">Early access</i>
        </span>
        {/* the same switch as the top of a project, in the same place, so you always know where you are */}
        <div className="pill mode-switch space-switch">
          <button className="active home-btn" data-name="home-space-home" title="Home">
            <Icon name="home" size={14} />
          </button>
          {(["kitchen", "edit"] as const).map((space) => (
            <button
              key={space}
              data-name={`home-space-${space}`}
              disabled={!canGoBack}
              title={canGoBack ? (space === "kitchen" ? "Back to your project, in Kitchen" : "Back to your project, in Studio (Esc)") : "Start or open a project first"}
              onClick={() => (setLayout({ space }), onClose())}
            >
              {space === "kitchen" ? "Kitchen" : "Studio"}
            </button>
          ))}
        </div>
        <span className="home-bar-end" />
      </header>

      <main className="home-content">
        <div className="home-hero">
          <h2 className="home-headline">What will you make today?</h2>
          <p className="home-sub">Pick a kind and its sizes open below. Duet remembers your last pick.</p>
        </div>

        {/* Kinds in a row; the open one shows its sizes below */}
        <section className="kinds-section">
          <div className="kinds-row" data-name="home-kinds">
            {kinds.map((id) => (
              <button key={id} type="button" className={`kind-btn ${id === kind ? "on" : ""}`} data-name={`home-kind-${id}`} onClick={() => pickKind(id)}>
                <span className={`kind-swatch kind-${id}`}>
                  <Icon name={HOME_KINDS.find((k) => k.id === id)!.icon} size={28} />
                </span>
                <span className="kind-name">{HOME_KINDS.find((k) => k.id === id)?.label}</span>
              </button>
            ))}
            <span className="kinds-gap" />
            <div className="kind-btn-wrap custom-anchor">
              <button type="button" className={`kind-btn plain ${customAt === "top" ? "on" : ""}`} data-name="home-custom-size" onClick={() => setCustomAt(customAt === "top" ? null : "top")}>
                <span className="kind-swatch">
                  <Icon name="plus" size={20} />
                </span>
                <span className="kind-name">Custom size</span>
              </button>
              {customAt === "top" && customBox()}
            </div>
            <button type="button" className="kind-btn plain" data-name="home-open-file" onClick={() => void openFile()}>
              <span className="kind-swatch">
                <Icon name="folder" size={20} />
              </span>
              <span className="kind-name">Open a file</span>
            </button>
            {hidden.length > 0 && (
              <button type="button" className="kinds-all" data-name="home-show-kinds" title="Bring back the kinds you hid" onClick={() => setHiddenKinds([])}>
                Show all kinds
              </button>
            )}
          </div>

          {kind && (
            <div className="sizes-tray" data-name={`home-sizes-${kind}`}>
              <div className="section-label">
                <span>{kindLabel}</span>
                {kinds.length > 1 && (
                  <button type="button" className="home-trash" data-name="home-hide-kind" title={`Take ${kindLabel} off Home. You can bring it back.`} onClick={() => setHiddenKinds(hideKind(hidden, kind))}>
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
                {kind !== "photo" && (
                  <div className={`size-card own custom-anchor ${customAt === "tray" ? "highlight" : ""}`} data-name="create-tile-own-size" onClick={() => setCustomAt(customAt === "tray" ? null : "tray")}>
                    <div className="own-title">+ Your own size</div>
                    <div className="create-dims">width &amp; height</div>
                    {customAt === "tray" && customBox()}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Quiet Ask Box */}
        <div className="home-chat-banner">
          <div className="chat-ai-quiet" title="Duet Assistant">
            <Icon name="skills" size={17} />
          </div>
          <div className="chat-input-wrap">
            <input
              ref={askInputRef}
              className="chat-text-input"
              placeholder="Or tell Duet what you want to make…"
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            />
            <div className="chat-suggestions">
              {["Café poster", "Modern logo", "App store screenshot"].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="chat-chip"
                  onClick={() => {
                    setAskText(chip);
                    askInputRef.current?.focus();
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="chat-send-btn"
            title="Create with Duet"
            onClick={() => handleAsk()}
          >
            <Icon name="arrow" size={15} />
          </button>
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
