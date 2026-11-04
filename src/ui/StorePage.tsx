import { useEffect, useState } from "react";
import { open } from "./dialog";
import { inTauri } from "../project/project";
import { createSkill, deleteSkill, importSkillPath, toggleSkill } from "../ai/skills";
import { useThings, findThings, countByKind, KIND_WORDS, type ThingKind } from "../store/things";
import { ConnectAddon } from "./AddOns";

interface StorePageProps {
  onClose: () => void;
}

export default function StorePage({ onClose }: StorePageProps) {
  const things = useThings();
  const counts = countByKind(things);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ThingKind | "all">("all");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillRules, setNewSkillRules] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (selectedId) {
          setSelectedId(null);
        } else if (adding) {
          setAdding(false);
          setNote(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectedId, adding, onClose]);

  const saveSkill = async () => {
    const result = await createSkill(newSkillName, newSkillRules);
    setNote(result);
    if (!result) {
      setNewSkillName("");
      setNewSkillRules("");
      setAdding(false);
    }
  };

  const bring = async (directory: boolean) => {
    if (!inTauri()) return;
    const picked = await open({
      directory,
      multiple: !directory,
      title: directory ? "Pick a skill folder" : "Pick skill files",
      filters: directory ? undefined : [{ name: "Skill files", extensions: ["md", "markdown", "txt"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const problems: string[] = [];
    for (const p of paths) {
      const result = await importSkillPath(p);
      if (result) problems.push(result);
    }
    setNote(problems.length ? problems.join(" ") : null);
  };

  const selectedThing = selectedId ? things.find((t) => t.id === selectedId) : null;
  const availableKinds = (["skill", "script", "plugin"] as const).filter((k) => counts[k] > 0);
  const filtered = findThings(things, { query, kind: kindFilter, installedOnly });

  return (
    <section className="skills-page store-page">
      {selectedThing ? (
        <div className="store-thing-page">
          <div className="skills-page-head store-thing-head">
            <button className="pill" onClick={() => setSelectedId(null)}>
              ← Back
            </button>
            <button className="pill" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="store-thing-hero">
            <div className="store-thing-title-group">
              <h2 className="store-thing-name">{selectedThing.name}</h2>
              <div className="store-thing-meta">
                {KIND_WORDS[selectedThing.kind].one} · by {selectedThing.by}
              </div>
            </div>

            {selectedThing.kind === "skill" && (
              <div className="store-thing-actions">
                <div className="store-thing-switch-wrap">
                  <span className="store-thing-switch-label">{selectedThing.on ? "Turned on" : "Turned off"}</span>
                  <div
                    className={`sw ${selectedThing.on ? "on" : ""}`}
                    onClick={() => toggleSkill(selectedThing.id)}
                    role="switch"
                    aria-checked={selectedThing.on}
                    title={selectedThing.on ? "Turn off" : "Turn on"}
                  />
                </div>
                {selectedThing.removable && (
                  <button
                    className="pill store-delete-btn"
                    onClick={async () => {
                      await deleteSkill(selectedThing.id);
                      setSelectedId(null);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">What it does</div>
            <p className="store-thing-line">{selectedThing.line}</p>
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">What it can touch</div>
            <ul className="store-touches-list">
              {selectedThing.touches.map((touch, idx) => (
                <li key={idx}>{touch}</li>
              ))}
            </ul>
          </div>

          {selectedThing.id === "plugin-connect" && (
            <div className="store-thing-section">
              <ConnectAddon />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="skills-page-head">
            <div>
              <h2>Store</h2>
              <p className="store-page-about">Skills, scripts and plugins that teach Duet and its AI new things</p>
            </div>
            <div className="store-head-actions">
              <button className="pill" onClick={onClose}>
                Close
              </button>
            </div>
          </div>

          <div className="store-search-wrap">
            <input
              type="text"
              className="store-search"
              placeholder="Search the Store"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="store-toolbar">
            <div className="store-filters">
              <button
                type="button"
                className={`store-filter ${kindFilter === "all" ? "on" : ""}`}
                onClick={() => setKindFilter("all")}
              >
                All ({things.length})
              </button>
              {availableKinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`store-filter ${kindFilter === k ? "on" : ""}`}
                  onClick={() => setKindFilter(k)}
                >
                  {KIND_WORDS[k].many} ({counts[k]})
                </button>
              ))}
              <button
                type="button"
                className={`store-filter ${installedOnly ? "on" : ""}`}
                onClick={() => setInstalledOnly((v) => !v)}
              >
                Installed
              </button>
            </div>

            <button
              type="button"
              className={`pill store-make-btn ${adding ? "on" : ""}`}
              onClick={() => {
                setAdding((v) => !v);
                setNote(null);
              }}
            >
              + Make new
            </button>
          </div>

          {adding && (
            <div className="store-make-new">
              <input
                value={newSkillName}
                placeholder="Name, like My brand rules"
                onChange={(e) => setNewSkillName(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <textarea
                value={newSkillRules}
                rows={6}
                placeholder={"One rule per line, like:\n- Buttons are always pill shaped\n- Use #5c0700 for warnings"}
                onChange={(e) => setNewSkillRules(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              {note && <div className="pop-note">{note}</div>}
              <div className="store-make-actions">
                <button className="mini primary" onClick={saveSkill}>
                  Save skill
                </button>
                <button
                  className="mini"
                  onClick={() => {
                    setAdding(false);
                    setNote(null);
                  }}
                >
                  Cancel
                </button>
                <button className="mini" onClick={() => bring(false)}>
                  Import files
                </button>
                <button className="mini" onClick={() => bring(true)}>
                  Import folder
                </button>
              </div>
            </div>
          )}

          <div className="store-list">
            {filtered.length === 0 ? (
              <div className="store-empty">Nothing found</div>
            ) : (
              filtered.map((thing) => (
                <div
                  key={thing.id}
                  className="store-card"
                  onClick={() => setSelectedId(thing.id)}
                >
                  <div className="store-card-info">
                    <div className="store-card-name">{thing.name}</div>
                    <div className="store-card-line">{thing.line}</div>
                    <div className="store-card-meta">
                      {KIND_WORDS[thing.kind].one} · by {thing.by}
                    </div>
                  </div>
                  {thing.kind === "skill" && (
                    <div className="store-card-action" onClick={(e) => e.stopPropagation()}>
                      <div
                        className={`sw ${thing.on ? "on" : ""}`}
                        onClick={() => toggleSkill(thing.id)}
                        role="switch"
                        aria-checked={thing.on}
                        title={thing.on ? "Turn off" : "Turn on"}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
