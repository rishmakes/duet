import { useMemo } from "react";
import { currentDoc, useStore } from "../state/store";
import { wordsOfEdit } from "../document/words";
import type { EditWord } from "../document/words";
import { seek } from "../video/play";
import { LANGUAGES, languageOf } from "./Transcribe";

/**
 * The Words tab in Video (#340): everything said in the open video, as it is cut now, in short lines with
 * their time. The word playing now is lit; a click on a word moves the playhead to it.
 */

/** A pause this long, or the end of a sentence, starts a new line. */
const BREAK = 0.7;

function lines(words: EditWord[]): EditWord[][] {
  const out: EditWord[][] = [];
  let run: EditWord[] = [];
  for (const w of words) {
    const last = run[run.length - 1];
    if (last && (w.s - last.e > BREAK || /[.?!]$/.test(last.w) || run.length >= 14)) {
      out.push(run);
      run = [];
    }
    run.push(w);
  }
  if (run.length) out.push(run);
  return out;
}

const clockText = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function WordsPanel() {
  const sceneId = useStore((s) => s.clock.scene);
  const doc = useStore((s) => currentDoc(s));
  const t = useStore((s) => s.clock.t);
  const words = useMemo(() => (sceneId ? wordsOfEdit(doc, sceneId) : []), [doc, sceneId]);
  const rows = useMemo(() => lines(words), [words]);
  const now = words.findIndex((w) => t >= w.s && t < w.e);
  const nowWord = now >= 0 ? words[now] : null;

  // the languages heard, by name, for the line under the title
  const heardIn = [...new Set(Object.values(doc.words ?? {}).map((tr) => tr.language))]
    .map((k) => (LANGUAGES.find((l) => l.key === k) ?? languageOf(k))?.name.replace(/ \(.*\)$/, ""))
    .filter(Boolean)
    .join(", ");
  const scene = sceneId ? doc.elements[sceneId] : null;

  return (
    <div className="words-panel" data-name="words-panel">
      <div className="words-title">Words</div>
      <div className="words-sub">{words.length ? [scene?.name, heardIn].filter(Boolean).join(" · ") : "Nothing heard yet"}</div>
      {!words.length ? (
        <div className="words-foot">Press Transcribe under the timeline, and everything said in this video shows here.</div>
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
          <div className="words-foot">Lit = playing now. Click a word to go there.</div>
        </>
      )}
    </div>
  );
}
