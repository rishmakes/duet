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
import {
  saveScript,
  deleteScript,
  runScript,
  RUNS_ON_WORDS,
  scriptAsk,
  useScripts,
  type RunsOn,
} from "../store/scripts";
import { sendToAgent } from "../ai/agent";
import { useDismiss } from "./useDismiss";
import { ConnectAddon } from "./AddOns";
import Icon, { type IconName } from "./Icons";

interface StorePageProps {
  onClose: () => void;
}

const RUNS_ON_KEYS: RunsOn[] = ["selection", "each-frame", "file", "list"];

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
  const userScripts = useScripts();
  const counts = countByKind(things);

  const [source, setSource] = useState<"duet" | "yours">("duet");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ThingKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedThing = selectedId ? things.find((t) => t.id === selectedId) : null;
  const selectedSkill = selectedThing?.kind === "skill" ? skills.find((s) => s.id === selectedThing.id) : null;
  const selectedSkillRules = selectedSkill ? skillParts(selectedSkill.body, selectedSkill.name).rules : "";
  const selectedScript = selectedThing?.kind === "script" ? userScripts.find((s) => s.id === selectedThing.id) : null;

  // Make choice dropdown (+ Make new)
  const [makeChoiceOpen, setMakeChoiceOpen] = useState(false);
  useDismiss(makeChoiceOpen, () => setMakeChoiceOpen(false), ".store-make-wrap");

  // Skill editing state
  const [editingId, setEditingId] = useState<"new" | string | null>(null);
  const [skillName, setSkillName] = useState("");
  const [skillLine, setSkillLine] = useState("");
  const [skillRules, setSkillRules] = useState("");
  const [note, setNote] = useState<string | null>(null);

  // Script maker state
  const [editingScriptId, setEditingScriptId] = useState<"new" | string | null>(null);
  const [scriptName, setScriptName] = useState("");
  const [scriptLine, setScriptLine] = useState("");
  const [scriptRunsOn, setScriptRunsOn] = useState<RunsOn>("selection");
  const [scriptCode, setScriptCode] = useState("");
  const [askText, setAskText] = useState("");
  const [makerListText, setMakerListText] = useState("");
  const [tryResult, setTryResult] = useState<{ text: string; logs: string[]; isError: boolean } | null>(null);
  const [trying, setTrying] = useState(false);
  const [scriptNote, setScriptNote] = useState<string | null>(null);

  // Script page state
  const [showCode, setShowCode] = useState(false);
  const [runListText, setRunListText] = useState("");
  const [runResult, setRunResult] = useState<{ text: string; logs: string[]; isError: boolean } | null>(null);
  const [runningScript, setRunningScript] = useState(false);

  useEffect(() => {
    setShowCode(false);
    setRunResult(null);
    setRunListText("");
  }, [selectedId]);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) {
        setSource("yours");
        setSelectedId(detail);
        setEditingId(null);
        setEditingScriptId(null);
      }
    };
    window.addEventListener("duet:script-saved", onSaved);
    return () => window.removeEventListener("duet:script-saved", onSaved);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (makeChoiceOpen) {
          setMakeChoiceOpen(false);
        } else if (editingScriptId) {
          setEditingScriptId(null);
          setScriptNote(null);
          setTryResult(null);
        } else if (editingId) {
          setEditingId(null);
          setNote(null);
        } else if (selectedId) {
          if (selectedThing && selectedThing.by === "You") {
            setSource("yours");
          }
          setSelectedId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [makeChoiceOpen, editingScriptId, editingId, selectedId, selectedThing, onClose]);

  const handleBack = () => {
    if (selectedThing && selectedThing.by === "You") {
      setSource("yours");
    }
    setSelectedId(null);
  };

  const startNewSkill = () => {
    setMakeChoiceOpen(false);
    setSelectedId(null);
    setEditingScriptId(null);
    setSkillName("");
    setSkillLine("");
    setSkillRules("");
    setNote(null);
    setEditingId("new");
  };

  const startNewScript = () => {
    setMakeChoiceOpen(false);
    setSelectedId(null);
    setEditingId(null);
    setScriptName("");
    setScriptLine("");
    setScriptRunsOn("selection");
    setScriptCode("");
    setAskText("");
    setMakerListText("");
    setTryResult(null);
    setScriptNote(null);
    setEditingScriptId("new");
  };

  const startEditSkill = () => {
    if (!selectedThing) return;
    const s = skills.find((item) => item.id === selectedThing.id);
    const parts = s ? skillParts(s.body, selectedThing.name) : { name: selectedThing.name, line: selectedThing.line, rules: "" };
    setSkillName(parts.name);
    setSkillLine(parts.line);
    setSkillRules(parts.rules);
    setNote(null);
    setEditingId(selectedThing.id);
  };

  const cancelEditSkill = () => {
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
      setSource("yours");
      setNote(null);
    } else if (editingId) {
      const result = await updateSkill(editingId, skillName, skillLine, skillRules);
      if (result) {
        setNote(result);
        return;
      }
      setEditingId(null);
      setSelectedId(editingId);
      if (selectedThing && selectedThing.by === "You") {
        setSource("yours");
      }
      setNote(null);
    }
  };

  const startEditScript = () => {
    if (!selectedScript && !selectedThing) return;
    const s = selectedScript || {
      name: selectedThing?.name ?? "",
      line: selectedThing?.line ?? "",
      runsOn: "selection" as RunsOn,
      code: "",
    };
    setScriptName(s.name);
    setScriptLine(s.line);
    setScriptRunsOn(s.runsOn);
    setScriptCode(s.code);
    setAskText("");
    setMakerListText("");
    setTryResult(null);
    setScriptNote(null);
    setEditingScriptId(selectedThing?.id ?? null);
  };

  const cancelEditScript = () => {
    setEditingScriptId(null);
    setScriptNote(null);
    setTryResult(null);
  };

  const handleSaveScript = async () => {
    const isNew = editingScriptId === "new";
    const res = await saveScript(
      {
        name: scriptName.trim(),
        line: scriptLine.trim(),
        runsOn: scriptRunsOn,
      },
      scriptCode,
      isNew ? undefined : editingScriptId || undefined,
    );
    if ("error" in res) {
      setScriptNote(res.error);
      return;
    }
    setEditingScriptId(null);
    setSelectedId(res.id);
    setSource("yours");
    setScriptNote(null);
    setTryResult(null);
  };

  const handleTryScript = async () => {
    setTrying(true);
    try {
      const list = scriptRunsOn === "list" ? makerListText.split("\n") : [];
      const res = await runScript(
        {
          name: scriptName.trim() || "Untitled script",
          code: scriptCode,
          runsOn: scriptRunsOn,
        },
        list,
      );
      if (res.error) {
        setTryResult({ text: res.error, logs: res.logs, isError: true });
      } else {
        const text = !res.changed
          ? "It ran. Nothing in the design changed."
          : res.steps === 1
            ? "Made 1 change. One Undo takes it back."
            : `Made ${res.steps} changes. One Undo takes them back.`;
        setTryResult({ text, logs: res.logs, isError: false });
      }
    } finally {
      setTrying(false);
    }
  };

  const handleAskAi = async () => {
    if (!askText.trim()) return;
    const prompt = scriptAsk(askText, scriptRunsOn, scriptName, scriptCode);
    window.dispatchEvent(new Event("duet:show-chat"));
    await sendToAgent(prompt);
  };

  const handleRunScript = async () => {
    if (!selectedScript) return;
    setRunningScript(true);
    try {
      const list = selectedScript.runsOn === "list" ? runListText.split("\n") : [];
      const res = await runScript(selectedScript, list);
      if (res.error) {
        setRunResult({ text: res.error, logs: res.logs, isError: true });
      } else {
        const text = !res.changed
          ? "It ran. Nothing in the design changed."
          : res.steps === 1
            ? "Made 1 change. One Undo takes it back."
            : `Made ${res.steps} changes. One Undo takes them back.`;
        setRunResult({ text, logs: res.logs, isError: false });
      }
    } finally {
      setRunningScript(false);
    }
  };

  const handleDeleteScript = async () => {
    if (!selectedThing) return;
    await deleteScript(selectedThing.id);
    setSource("yours");
    setSelectedId(null);
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
      setSource("yours");
      setNote(null);
    }
  };

  const yourThings = things.filter((t) => t.by === "You");
  const sourceThings = things.filter((t) => (source === "yours" ? t.by === "You" : t.by !== "You"));
  const availableKinds = (["skill", "script", "plugin"] as const).filter((k) => counts[k] > 0 || k === "script");
  const filtered = findThings(sourceThings, { query, kind: kindFilter });

  const isSearching = query.trim().length > 0;
  const onSkills = filtered.filter((t) => t.kind === "skill" && t.on);
  const offSkills = filtered.filter((t) => t.kind === "skill" && !t.on);
  const plugins = filtered.filter((t) => t.kind === "plugin");
  const scripts = filtered.filter((t) => t.kind === "script");

  const scriptsAsked = kindFilter === "all" || kindFilter === "script";
  const duetSections: { key: string; title: string; items: Thing[]; note?: string }[] = [
    { key: "on", title: "On", items: onSkills },
    { key: "off", title: "Off until you want it", items: offSkills },
    { key: "scripts", title: "Scripts", items: scripts, note: "More scripts from Duet are coming. You can make your own now." },
    { key: "plugins", title: "Plugins", items: plugins },
  ].filter((s) => s.items.length > 0 || (s.key === "scripts" && scriptsAsked));

  const yourSkills = filtered.filter((t) => t.kind === "skill");
  const yourScripts = filtered.filter((t) => t.kind === "script");
  const yourPlugins = filtered.filter((t) => t.kind === "plugin");

  const yoursSections: { key: string; title: string; items: Thing[]; note?: string }[] = [
    { key: "skills", title: "Skills", items: yourSkills },
    { key: "scripts", title: "Scripts", items: yourScripts, note: yourScripts.length ? undefined : "A script does a job in your design, again and again. Write it yourself or ask the AI." },
    { key: "plugins", title: "Plugins", items: yourPlugins },
  ].filter((s) => s.items.length > 0 || (s.key === "scripts" && scriptsAsked));

  const sections = source === "duet" ? duetSections : yoursSections;

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

  const renderMakeNewButton = () => (
    <div className="store-make-wrap">
      <button
        type="button"
        className={`pill store-make-btn ${makeChoiceOpen ? "on" : ""}`}
        onClick={() => setMakeChoiceOpen(!makeChoiceOpen)}
      >
        + Make new
      </button>
      {makeChoiceOpen && (
        <div className="ctx store-make-menu">
          <button
            type="button"
            className="ctx-item store-make-option"
            onClick={startNewSkill}
          >
            Skill
          </button>
          <button
            type="button"
            className="ctx-item store-make-option"
            onClick={startNewScript}
          >
            Script
          </button>
        </div>
      )}
    </div>
  );

  return (
    <section className="skills-page store-page" data-theme={theme}>
      {editingId ? (
        <div className="store-thing-page">
          <div className="skills-page-head store-thing-head">
            <button className="pill" onClick={cancelEditSkill}>
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
            <button className="pill" onClick={cancelEditSkill}>
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
      ) : editingScriptId ? (
        <div className="store-thing-page">
          <div className="skills-page-head store-thing-head">
            <button className="pill" onClick={cancelEditScript}>
              ← Back
            </button>
            <button className="pill" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="store-thing-hero">
            <div className="store-thing-hero-main">
              <div className="store-thing-hero-tile">
                <Icon name="skill-custom" size={32} />
              </div>
              <div className="store-thing-title-group">
                <h2 className="store-thing-name">{editingScriptId === "new" ? "New script" : "Edit script"}</h2>
                <div className="store-thing-meta">
                  Script · by You
                </div>
              </div>
            </div>
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">Name</div>
            <input
              type="text"
              className="store-field-input"
              value={scriptName}
              placeholder="Name, like Grid of photos"
              onChange={(e) => setScriptName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">What it does</div>
            <input
              type="text"
              className="store-field-input"
              value={scriptLine}
              placeholder="What the script does in one line"
              onChange={(e) => setScriptLine(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">Runs on</div>
            <div className="kind-quiet store-runs-on-switch" role="radiogroup" aria-label="Runs on">
              {RUNS_ON_KEYS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={scriptRunsOn === r}
                  className={scriptRunsOn === r ? "on" : ""}
                  onClick={() => setScriptRunsOn(r)}
                >
                  {RUNS_ON_WORDS[r]}
                </button>
              ))}
            </div>
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">Ask the AI to write it</div>
            <div className="store-ask-row">
              <input
                type="text"
                className="store-field-input"
                value={askText}
                placeholder="Ask the AI to write it..."
                onChange={(e) => setAskText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && askText.trim()) handleAskAi();
                }}
              />
              <button
                type="button"
                className="pill"
                onClick={handleAskAi}
                disabled={!askText.trim()}
              >
                Send
              </button>
            </div>
            <div className="store-ask-hint">The AI will ask you before it saves the script.</div>
          </div>

          <div className="store-thing-section">
            <div className="store-section-label">Code</div>
            <textarea
              className="store-field-textarea store-code-box"
              value={scriptCode}
              rows={10}
              placeholder={`// A small piece of JavaScript of your own\n// duet.call("create_element", { ... })\n// duet.log("hello")`}
              onChange={(e) => setScriptCode(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
            />
          </div>

          {scriptRunsOn === "list" && (
            <div className="store-thing-section">
              <div className="store-section-label">One item per line</div>
              <textarea
                className="store-field-textarea store-list-input"
                value={makerListText}
                rows={4}
                placeholder="One item per line"
                onChange={(e) => setMakerListText(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {tryResult && (
            <div className={`store-result-wrap ${tryResult.isError ? "error" : ""}`}>
              <div className="store-result-line">{tryResult.text}</div>
              {tryResult.logs.length > 0 && (
                <div className="store-result-logs">
                  {tryResult.logs.map((log, i) => (
                    <div key={i} className="store-result-log-line">{log}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {scriptNote && <div className="pop-note store-form-note">{scriptNote}</div>}

          <div className="store-edit-actions">
            <button type="button" className="pill" onClick={handleTryScript} disabled={trying}>
              {trying ? "Trying..." : "Try it"}
            </button>
            <button type="button" className="pill primary" onClick={handleSaveScript}>
              Save
            </button>
            <button type="button" className="pill" onClick={cancelEditScript}>
              Cancel
            </button>
          </div>
        </div>
      ) : selectedThing ? (
        selectedThing.kind === "script" ? (
          <div className="store-thing-page">
            <div className="skills-page-head store-thing-head">
              <button className="pill" onClick={handleBack}>
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
                    Script · by {selectedThing.by}
                  </div>
                </div>
              </div>

              <div className="store-thing-actions">
                {selectedThing.editable && (
                  <button className="pill store-edit-btn" onClick={startEditScript}>
                    Edit
                  </button>
                )}
                {selectedThing.removable && (
                  <button className="pill store-delete-btn" onClick={handleDeleteScript}>
                    Delete
                  </button>
                )}
              </div>
            </div>

            <div className="store-thing-section">
              <div className="store-section-label">What it does</div>
              <p className="store-thing-line">{selectedScript?.line || selectedThing.line}</p>
            </div>

            <div className="store-thing-section">
              <div className="store-section-label">Runs on</div>
              <p className="store-thing-line">{RUNS_ON_WORDS[selectedScript?.runsOn ?? "selection"]}</p>
            </div>

            <div className="store-thing-section">
              {selectedScript?.runsOn === "list" && (
                <div className="store-run-list-wrap">
                  <div className="store-section-label">One item per line</div>
                  <textarea
                    className="store-field-textarea store-list-input"
                    value={runListText}
                    rows={4}
                    placeholder="One item per line"
                    onChange={(e) => setRunListText(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              <div className="store-run-actions">
                <button
                  type="button"
                  className="pill primary"
                  onClick={handleRunScript}
                  disabled={runningScript}
                >
                  {runningScript ? "Running..." : "Run"}
                </button>
              </div>
              {runResult && (
                <div className={`store-result-wrap ${runResult.isError ? "error" : ""}`}>
                  <div className="store-result-line">{runResult.text}</div>
                  {runResult.logs.length > 0 && (
                    <div className="store-result-logs">
                      {runResult.logs.map((log, i) => (
                        <div key={i} className="store-result-log-line">{log}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="store-thing-section">
              <div className="store-see-code-wrap">
                <button
                  type="button"
                  className="pill store-see-code-btn"
                  onClick={() => setShowCode(!showCode)}
                >
                  {showCode ? "Hide the code" : "See the code"}
                </button>
              </div>
              {showCode && (
                <pre className="store-code-readonly">
                  <code>{selectedScript?.code || ""}</code>
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div className="store-thing-page">
            <div className="skills-page-head store-thing-head">
              <button className="pill" onClick={handleBack}>
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
                    <button className="pill store-edit-btn" onClick={startEditSkill}>
                      Edit
                    </button>
                  )}
                  {selectedThing.removable && (
                    <button
                      className="pill store-delete-btn"
                      onClick={async () => {
                        await deleteSkill(selectedThing.id);
                        setSource("yours");
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
        )
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
            <div className="store-toolbar-left">
              <div className="kind-quiet store-source-switch" role="tablist" aria-label="Source">
                <button
                  type="button"
                  role="tab"
                  aria-selected={source === "duet"}
                  className={source === "duet" ? "on" : ""}
                  onClick={() => setSource("duet")}
                >
                  From Duet
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={source === "yours"}
                  className={source === "yours" ? "on" : ""}
                  onClick={() => setSource("yours")}
                >
                  Yours
                </button>
              </div>

              <div className="store-tabs" role="tablist" aria-label="Kind">
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
            </div>

            {!(source === "yours" && yourThings.length === 0) && renderMakeNewButton()}
          </div>

          <div className="store-list">
            {source === "yours" && yourThings.length === 0 && kindFilter !== "script" ? (
              <div className="store-yours-empty">
                <div className="store-yours-empty-line">Skills, scripts and plugins you make live here</div>
                {renderMakeNewButton()}
              </div>
            ) : isSearching ? (
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
                  {sec.items.length > 0 && <div className="store-grid">{sec.items.map(renderRow)}</div>}
                  {sec.key === "scripts" && sec.note && (
                    <div className="store-section-note">
                      <span>{sec.note}</span>
                      <button className="store-section-make" onClick={startNewScript}>
                        + Make a script
                      </button>
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
