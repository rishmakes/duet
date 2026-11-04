import { useEffect, useState } from "react";
import { open } from "./dialog";
import { inTauri } from "../project/project";
import { useTheme } from "./theme";
import {
  createSkill,
  deleteSkill,
  importSkillPath,
  mySkillId,
  skillParts,
  toggleSkill,
  updateSkill,
  useSkills,
} from "../ai/skills";
import { useThings, findThings, countByKind, KIND_WORDS, type ThingKind, type Thing } from "../store/things";
import { ConnectAddon } from "./AddOns";
import Icon, { type IconName } from "./Icons";

interface StorePageProps {
  onClose: () => void;
}

function thingIcon(thing: Thing): IconName {
  if (thing.kind === "plugin") {
    if (thing.id === "plugin-connect") return "plugin-connect";
    return "plugin-connect";
  }
  switch (thing.id) {
    case "auto-layout":
      return "skill-auto-layout";
    case "mobile-screens":
      return "skill-mobile-screens";
    case "spacing":
      return "skill-spacing";
    case "type-scale":
      return "skill-type-scale";
    case "contrast":
      return "skill-contrast";
    case "plain-words":
      return "skill-plain-words";
    case "bold-blocks":
      return "skill-bold-blocks";
    case "bento":
      return "skill-bento";
    case "calm-and-trusted":
      return "skill-calm-and-trusted";
    case "friendly-and-modern":
      return "skill-friendly-and-modern";
    case "prototypes":
      return "skill-prototypes";
    default:
      return "skill-custom";
  }
}

export default function StorePage({ onClose }: StorePageProps) {
  const [theme] = useTheme();
  const things = useThings();
  const skills = useSkills();
  const counts = countByKind(things);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ThingKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<"new" | string | null>(null);
  const [skillName, setSkillName] = useState("");
  const [skillLine, setSkillLine] = useState("");
  const [skillRules, setSkillRules] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (editingId) {
          setEditingId(null);
          setNote(null);
        } else if (selectedId) {
          setSelectedId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editingId, selectedId, onClose]);

  const startNew = () => {
    setSelectedId(null);
    setSkillName("");
    setSkillLine("");
    setSkillRules("");
    setNote(null);
    setEditingId("new");
  };

  const startEdit = () => {
    if (!selectedThing) return;
    const s = skills.find((item) => item.id === selectedThing.id);
    const parts = s ? skillParts(s.body, selectedThing.name) : { name: selectedThing.name, line: selectedThing.line, rules: "" };
    setSkillName(parts.name);
    setSkillLine(parts.line);
    setSkillRules(parts.rules);
    setNote(null);
    setEditingId(selectedThing.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNote(null);
  };

  const saveSkill = async () => {
    if (editingId === "new") {
      const result = await createSkill(skillName, skillRules, skillLine);
      if (result) {
        setNote(result);
        return;
      }
      const newId = mySkillId(skillName);
      setEditingId(null);
      setSelectedId(newId);
      setNote(null);
    } else if (editingId) {
      const result = await updateSkill(editingId, skillName, skillLine, skillRules);
      if (result) {
        setNote(result);
        return;
      }
      setEditingId(null);
      setSelectedId(editingId);
      setNote(null);
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
    if (problems.length) {
      setNote(problems.join(" "));
    } else if (paths.length > 0) {
      setEditingId(null);
      setNote(null);
    }
  };

  const selectedThing = selectedId ? things.find((t) => t.id === selectedId) : null;
  const selectedSkill = selectedThing?.kind === "skill" ? skills.find((s) => s.id === selectedThing.id) : null;
  const selectedSkillRules = selectedSkill ? skillParts(selectedSkill.body, selectedSkill.name).rules : "";

  const availableKinds = (["skill", "script", "plugin"] as const).filter((k) => counts[k] > 0);
  const filtered = findThings(things, { query, kind: kindFilter });

  const isSearching = query.trim().length > 0;
  const onSkills = filtered.filter((t) => t.kind === "skill" && t.on);
  const offSkills = filtered.filter((t) => t.kind === "skill" && !t.on);
  const plugins = filtered.filter((t) => t.kind === "plugin");
  const scripts = filtered.filter((t) => t.kind === "script");

  const sections = [
    { key: "on", title: "On", items: onSkills },
    { key: "off", title: "Off until you want it", items: offSkills },
    { key: "plugins", title: "Plugins", items: plugins },
    { key: "scripts", title: "Scripts", items: scripts },
  ].filter((s) => s.items.length > 0);

  const renderRow = (thing: Thing) => (
    <div
      key={thing.id}
      className="store-row"
      onClick={() => setSelectedId(thing.id)}
    >
      <div className="store-row-tile">
        <Icon name={thingIcon(thing)} size={20} />
      </div>
      <div className="store-row-info">
        <div className="store-row-name-wrap">
          <span className="store-row-name">{thing.name}</span>
          {thing.by !== "Duet" && <span className="store-row-by">by {thing.by}</span>}
        </div>
        <div className="store-row-line" title={thing.line}>
          {thing.line}
        </div>
      </div>
      {thing.kind === "skill" && (
        <div className="store-row-action" onClick={(e) => e.stopPropagation()}>
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
  );

  return (
    <section className="skills-page store-page" data-theme={theme}>
      {editingId ? (
        <div className="store-thing-page">
          <div className="skills-page-head store-thing-head">
            <button className="pill" onClick={cancelEdit}>
              ← Back
            </button>
            <button className="pill" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="store-thing-hero">
            <div className="store-thing-hero-main">
              <div className="store-thing-hero-tile">
                <Icon
                  name={editingId === "new" || !selectedThing ? "skill-custom" : thingIcon(selectedThing)}
                  size={32}
                />
              </div>
              <div className="store-thing-title-group">
                <h2 className="store-thing-name">{editingId === "new" ? "New skill" : "Edit skill"}</h2>
                <div className="store-thing-meta">
                  {editingId === "new" ? "Skill · by You" : `Skill · by ${selectedThing?.by ?? "You"}`}
                </div>
              </div>
            </div>
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">Name</div>
            <input
              type="text"
              className="store-field-input"
              value={skillName}
              placeholder="Name, like My brand rules"
              onChange={(e) => setSkillName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">What it does</div>
            <input
              type="text"
              className="store-field-input"
              value={skillLine}
              placeholder="Keeps every design in my brand look"
              onChange={(e) => setSkillLine(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">Rules</div>
            <textarea
              className="store-field-textarea"
              value={skillRules}
              rows={8}
              placeholder={"One rule per line, like:\n- Buttons are always pill shaped\n- Use #5c0700 for warnings"}
              onChange={(e) => setSkillRules(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          {note && <div className="pop-note store-form-note">{note}</div>}

          <div className="store-edit-actions">
            <button className="pill primary" onClick={saveSkill}>
              Save skill
            </button>
            <button className="pill" onClick={cancelEdit}>
              Cancel
            </button>
          </div>

          {editingId === "new" && (
            <div className="store-bring-quieter">
              <div className="store-bring-label">Or bring a skill you already have</div>
              <div className="store-bring-actions">
                <button className="pill" onClick={() => bring(false)}>
                  Import files
                </button>
                <button className="pill" onClick={() => bring(true)}>
                  Import folder
                </button>
              </div>
            </div>
          )}
        </div>
      ) : selectedThing ? (
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
            <div className="store-thing-hero-main">
              <div className="store-thing-hero-tile">
                <Icon name={thingIcon(selectedThing)} size={32} />
              </div>
              <div className="store-thing-title-group">
                <h2 className="store-thing-name">{selectedThing.name}</h2>
                <div className="store-thing-meta">
                  {KIND_WORDS[selectedThing.kind].one} · by {selectedThing.by}
                </div>
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
                {selectedThing.editable && (
                  <button className="pill store-edit-btn" onClick={startEdit}>
                    Edit
                  </button>
                )}
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

          {selectedThing.kind === "skill" && (
            <div className="store-thing-section">
              <div className="store-section-label">Rules</div>
              <div className="store-rules-box">{selectedSkillRules || "No rules defined."}</div>
            </div>
          )}

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
            <div className="store-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={kindFilter === "all"}
                className={`store-tab ${kindFilter === "all" ? "on" : ""}`}
                onClick={() => setKindFilter("all")}
              >
                All
              </button>
              {availableKinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kindFilter === k}
                  className={`store-tab ${kindFilter === k ? "on" : ""}`}
                  onClick={() => setKindFilter(k)}
                >
                  {KIND_WORDS[k].many}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="pill store-make-btn"
              onClick={startNew}
            >
              + Make new
            </button>
          </div>

          <div className="store-list">
            {isSearching ? (
              filtered.length === 0 ? (
                <div className="store-empty">Nothing found</div>
              ) : (
                <div className="store-grid">
                  {filtered.map(renderRow)}
                </div>
              )
            ) : sections.length === 0 ? (
              <div className="store-empty">Nothing found</div>
            ) : (
              sections.map((sec) => (
                <div key={sec.key} className="store-section">
                  <div className="store-section-title">{sec.title}</div>
                  <div className="store-grid">
                    {sec.items.map(renderRow)}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
