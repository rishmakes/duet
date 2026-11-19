import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentDoc, useStore } from "../state/store";
import { wordsOfEdit } from "../document/words";
import { toSrt, toTxt, transcriptLines } from "../document/transcriptFile";
import { message, save } from "./dialog";
import { seek } from "../video/play";
import { LANGUAGES, languageOf, useHearingAll } from "./Transcribe";

/**
 * The Words tab in Video (#340): everything said in the open video, as it is cut now, in short lines with
 * their time. The word playing now is lit; a click on a word moves the playhead to it.
 */

const clockText = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function WordsPanel() {
  const sceneId = useStore((s) => s.clock.scene);
  const doc = useStore((s) => currentDoc(s));
  const t = useStore((s) => s.clock.t);
  const words = useMemo(() => (sceneId ? wordsOfEdit(doc, sceneId) : []), [doc, sceneId]);
  const rows = useMemo(() => transcriptLines(words), [words]);
  const [note, setNote] = useState("");
  const [menu, setMenu] = useState(false);
  const now = words.findIndex((w) => t >= w.s && t < w.e);
  const nowWord = now >= 0 ? words[now] : null;

  // the languages heard, by name, for the line under the title
  const heardIn = [...new Set(Object.values(doc.words ?? {}).map((tr) => tr.language))]
    .map((k) => (LANGUAGES.find((l) => l.key === k) ?? languageOf(k))?.name.replace(/ \(.*\)$/, ""))
    .filter(Boolean)
    .join(", ");
  const scene = sceneId ? doc.elements[sceneId] : null;
  const listening = useHearingAll().length > 0;

  // the Export menu closes on a click anywhere else, or Escape
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-name=words-export]")) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const exportAs = async (kind: "srt" | "txt") => {
    setMenu(false);
    try {
      const path = await save({
        title: "Export transcript",
        defaultPath: `${(scene?.name || "Transcript").replace(/[\\/:*?"<>|]/g, "-")}.${kind}`,
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
      if (!path) return;
      const final = path.toLowerCase().endsWith(`.${kind}`) ? path : `${path}.${kind}`;
      await invoke("write_text_file", { path: final, contents: kind === "srt" ? toSrt(words) : toTxt(words) });
      setNote(`Saved ${final.split(/[\\/]/).pop()}`);
    } catch (e) {
      await message(String(e), { title: "Duet", kind: "error" });
      setNote("Could not export.");
    }
  };

  return (
    <div className="words-panel" data-name="words-panel">
      <div className="words-top">
        <div className="words-head">
          <div className="words-title">Words</div>
          {words.length > 0 && (
            <div className="words-export" data-name="words-export">
              <button className="words-export-btn" data-name="words-export-button" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                Export
              </button>
              {menu && (
                <div className="words-export-menu">
                  <button data-name="words-export-srt" onClick={() => void exportAs("srt")}>Save as SRT</button>
                  <button data-name="words-export-txt" onClick={() => void exportAs("txt")}>Save as TXT</button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="words-sub">{words.length ? [scene?.name, heardIn].filter(Boolean).join(" · ") : listening ? "Listening for words…" : "Nothing heard yet"}</div>
      </div>
      {!words.length ? (
        <div className="words-foot">{listening ? "Duet is listening on this computer. The words show here when it is done; the card over the video says how far it is." : "Press Transcribe under the timeline, and everything said in this video shows here."}</div>
      ) : (
        <>
          <div className="words-rows">
            {rows.map((row, i) => (
              <div className="words-row" key={i}>
                <span className="words-time">{clockText(row[0].s)}</span>
                <span className="words-line">
                  {row.map((w, j) => (
                    <span key={j} className={`words-word${w === nowWord ? " on" : ""}`} data-name="words-word" onClick={() => seek(w.s + 0.01)}>
                      {w.w}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <div className="words-foot">{note || "Lit = playing now. Click a word to go there."}</div>
        </>
      )}
    </div>
  );
}
