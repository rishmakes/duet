import { useState } from "react";
import { open } from "./dialog";
import { createSkill, deleteSkill, importSkillPath, toggleSkill, useSkills } from "../ai/skills";
import { inTauri } from "../project/project";

export default function SkillsPanel() {
  const skills = useSkills();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const row = (s: (typeof skills)[number]) => (
    <div className="skill" key={s.id}>
      <div className="n">
        {s.name}
        <small>{s.summary}</small>
      </div>
      {s.source === "mine" && (
        <span className="x" title="Delete this skill" onClick={() => deleteSkill(s.id)}>
          Delete
        </span>
      )}
      <div className={`sw ${s.enabled ? "on" : ""}`} onClick={() => toggleSkill(s.id)} role="switch" aria-checked={s.enabled} />
    </div>
  );

  const save = async () => {
    const result = await createSkill(name, rules);
    setNote(result);
    if (!result) {
      setName("");
      setRules("");
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

  const mine = skills.filter((s) => s.source === "mine");
  return (
    <div className="skills">
      <div className="h">Shipped with Duet</div>
      {skills.filter((s) => s.source === "shipped").map(row)}
      <div className="soon">
        <b>More skills are coming soon.</b> Duet is in early access. More skills made for Duet arrive with the next updates.
      </div>
      <div className="h">Mine</div>
      {mine.length === 0 && !adding && <div className="empty">Rules of your own, saved for every project.</div>}
      {mine.map(row)}
      {adding ? (
        <div className="newskill">
          <input value={name} placeholder="Name, like My brand rules" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <textarea
            value={rules}
            rows={6}
            placeholder={"One rule per line, like:\n- Buttons are always pill shaped\n- Use #5c0700 for warnings"}
            onChange={(e) => setRules(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {note && <div className="pop-note">{note}</div>}
          <div className="row2">
            <button className="mini primary" onClick={save}>
              Save skill
            </button>
            <button className="mini" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="add" onClick={() => setAdding(true)}>
            + Write a skill
          </div>
          <div className="row2 pad">
            <div className="add grow" onClick={() => bring(false)}>
              Import files
            </div>
            <div className="add grow" onClick={() => bring(true)}>
              Import folder
            </div>
          </div>
          {note && <div className="pop-note pad">{note}</div>}
        </>
      )}
      <div className="hint">Turned-on skills are given to Duet every time you chat.</div>
    </div>
  );
}
