import { useEffect, useRef, useState } from "react";
import { newId } from "../commands";
import { dispatch, select, setPagesView } from "../state/store";
import { listedProjects, newDesignTab, openProject, openProjectAt } from "../project/project";
import type { Recent } from "../project/project";
import { setLayout } from "./layout";
import { getChat, newTask } from "../ai/chat";
import { sendToTask } from "../ai/agent";
import Icon from "./Icons";
import { clampDim, CREATE_TILES, CUSTOM_PRESETS, editedAgo, TILE_GROUPS } from "./homeLogic";
import { pickMedia, placeMedia } from "../video/scene";
import { pickPhoto, placePhoto } from "../project/imageImport";
import type { CreateTile } from "./homeLogic";
import { resetPageFocus } from "./pageFocus";
import { isProjectOpen, ProjectMenu, TrashView, usePreview } from "./ChatHome";

interface HomeProps {
  onClose: () => void;
}

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export default function Home({ onClose }: HomeProps) {
  const [customOpen, setCustomOpen] = useState(false);
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
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [customOpen, onClose]);

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
      if (popoverRef.current && !popoverRef.current.contains(target) && !target?.closest(".create-card.custom-anchor")) {
        setCustomOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [customOpen]);

  const handleTileClick = async (tile: CreateTile) => {
    if (tile.kind === "custom") {
      setCustomOpen((o) => !o);
      return;
    }
    if (tile.kind === "file") {
      await openProject();
      onClose();
      return;
    }
    if (tile.kind === "video" && tile.width && tile.height) {
      // pick the clips first, so backing out leaves no empty project behind
      const paths = await pickMedia("Choose clips for your video");
      if (!paths.length) return;
      resetPageFocus();
      await newDesignTab();
      setPagesView(true);
      const id = newId("frame");
      dispatch("create_preset_frame", { preset: { name: tile.title, width: tile.width, height: tile.height }, x: 0, y: 0, id });
      select([id]);
      setLayout({ space: "edit", mode: "motion", timeLook: "cut" });
      onClose();
      await placeMedia(id, paths);
      setTimeout(() => window.dispatchEvent(new Event("duet:fit")), 50);
      return;
    }
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
      setLayout({ space: "edit", mode: "design" });
      onClose();
      return;
    }
    if (tile.kind === "sized" && tile.width && tile.height) {
      resetPageFocus();
      await newDesignTab();
      setPagesView(true);
      const id = newId("frame");
      dispatch("create_preset_frame", {
        preset: { name: tile.title, width: tile.width, height: tile.height },
        x: 0,
        y: 0,
        id,
      });
      select([id]);
      setLayout({ space: "edit", mode: "design" });
      setTimeout(() => window.dispatchEvent(new Event("duet:fit")), 50);
      onClose();
    }
  };

  const handleCreateCustom = async () => {
    resetPageFocus();
    const w = clampDim(customW, 1080);
    const h = clampDim(customH, 1350);
    await newDesignTab();
    setPagesView(true);
    const id = newId("frame");
    dispatch("create_preset_frame", {
      preset: { name: "Custom", width: w, height: h },
      x: 0,
      y: 0,
      id,
    });
    select([id]);
    setLayout({ space: "edit", mode: "design" });
    setTimeout(() => window.dispatchEvent(new Event("duet:fit")), 50);
    setCustomOpen(false);
    onClose();
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
    switch (tile.shape) {
      case "square":
        return <div className="shape-square" />;
      case "story":
        return <div className="shape-story" />;
      case "video":
        return <div className="shape-video" />;
      case "slide":
        return <div className="shape-slide" />;
      case "a4":
        return <div className="shape-a4" />;
      case "screens":
        return (
          <div className="shape-screens">
            <span className="screen-phone" />
            <span className="screen-desk" />
          </div>
        );
      case "canvas":
        return <div className="shape-canvas" />;
      case "custom":
        return (
          <div className="shape-custom">
            <Icon name="plus" size={18} />
          </div>
        );
      case "reel":
        return <div className="shape-story shape-play" />;
      case "film":
        return <div className="shape-slide shape-play" />;
      case "photo":
        return (
          <div className="shape-file">
            <Icon name="image" size={18} />
          </div>
        );
      case "file":
        return (
          <div className="shape-file">
            <Icon name="folder" size={18} />
          </div>
        );
    }
  };

  const visibleRecents = recents.slice(0, 12);

  return (
    <div className="home-screen" data-name="home-screen" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <header className={`home-bar ${MAC ? "mac" : ""}`}>
        <button className="pill" onClick={onClose} title="Back (Esc)">
          ← Back
        </button>
        <span className="home-title">Home</span>
        <div />
      </header>

      <main className="home-content">
        {/* Title */}
        <div className="home-hero">
          <h2 className="home-headline">What would you like to make?</h2>
          <p className="home-sub">Design, photo and video, with your AI beside you on one canvas.</p>
        </div>

        {/* Create row */}
        {TILE_GROUPS.map((group) => (
        <section className="create-section" key={group.id} data-name={`create-row-${group.id}`}>
          <div className="section-label">{group.label}</div>
          <div className="create-grid">
            {CREATE_TILES.filter((t) => t.group === group.id).map((tile) => {
              const isCustom = tile.kind === "custom";
              return (
                <div
                  key={tile.id}
                  data-name={`create-tile-${tile.id}`}
                  className={`create-card ${isCustom ? "custom-anchor" : ""} ${isCustom && customOpen ? "highlight" : ""}`}
                  onClick={() => void handleTileClick(tile)}
                >
                  <div className="ratio-box">{renderShape(tile)}</div>
                  <div className="create-title">{tile.title}</div>
                  <div className="create-dims">{tile.dims}</div>

                  {/* Custom size popover */}
                  {isCustom && customOpen && (
                    <div
                      ref={popoverRef}
                      className="custom-popover"
                      data-name="custom-size-popover"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="popover-head">
                        <span className="popover-title">Custom size</span>
                        <button
                          type="button"
                          className="popover-close"
                          title="Close"
                          onClick={() => setCustomOpen(false)}
                        >
                          ×
                        </button>
                      </div>

                      <div className="dimension-fields">
                        <div className="dim-field">
                          <label className="field-label">Width</label>
                          <div className="field-input-box">
                            <input
                              type="number"
                              min={10}
                              max={20000}
                              value={customW}
                              onChange={(e) => setCustomW(Number(e.target.value) || 0)}
                              onKeyDown={(e) => e.key === "Enter" && void handleCreateCustom()}
                            />
                          </div>
                        </div>
                        <div className="dim-field">
                          <label className="field-label">Height</label>
                          <div className="field-input-box">
                            <input
                              type="number"
                              min={10}
                              max={20000}
                              value={customH}
                              onChange={(e) => setCustomH(Number(e.target.value) || 0)}
                              onKeyDown={(e) => e.key === "Enter" && void handleCreateCustom()}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="popover-presets">
                        <div className="preset-list-title">Presets</div>
                        <div className="preset-pills">
                          {CUSTOM_PRESETS.map((p) => {
                            const active = customW === p.width && customH === p.height;
                            return (
                              <button
                                key={p.label}
                                type="button"
                                className={`preset-pill ${active ? "active" : ""}`}
                                onClick={() => {
                                  setCustomW(p.width);
                                  setCustomH(p.height);
                                }}
                              >
                                {p.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="popover-actions">
                        <button
                          type="button"
                          className="pill"
                          onClick={() => setCustomOpen(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="pill primary"
                          onClick={() => void handleCreateCustom()}
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        ))}

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
            <div className="recents-empty">No projects yet. Pick a format above or tell Duet what to make.</div>
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
