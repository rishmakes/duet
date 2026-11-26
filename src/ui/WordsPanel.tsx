import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentDoc, dispatch, useStore } from "../state/store";
import { clipsWithWords, wordsOfEdit } from "../document/words";
import type { EditWord, WordFix } from "../document/words";
import { toSrt, toTxt, transcriptLines } from "../document/transcriptFile";
import { message, save } from "./dialog";
import { seek } from "../video/play";
import Icon from "./Icons";
import { ASK_TRANSCRIBE, LANGUAGES, languageOf, useHearingAll } from "./Transcribe";

/**
 * The Words tab in Video (#340): everything said in the open video, as it is cut now, in short lines with
 * their time. The word playing now is lit; a click on a word moves the playhead to it.
 * Fixing by hand (#397): a click picks a word (Shift-click picks a run), Backspace takes the picked words
 * out of the transcript, a double-click types the right word over it. The video is never cut from here.
 */

const clockText = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function WordsPanel() {
  const sceneId = useStore((s) => s.clock.scene);
  const doc = useStore((s) => currentDoc(s));
  const t = useStore((s) => s.clock.t);
  const words = useMemo(() => (sceneId ? wordsOfEdit(doc, sceneId) : []), [doc, sceneId]);
  const rows = useMemo(() => transcriptLines(words), [words]);
  const [note, setNote] = useState("");
  const [menu, setMenu] = useState<"export" | "more" | null>(null);
  // the picked words, by their place in the edit, and where a Shift-click run starts
  const [picked, setPicked] = useState<number[]>([]);
  const anchor = useRef(-1);
  const [typing, setTyping] = useState<{ at: number; text: string } | null>(null);
  // a pick means nothing once the words change under it
  useEffect(() => {
    setPicked([]);
    anchor.current = -1;
  }, [words]);
  const now = words.findIndex((w) => t >= w.s && t < w.e);
  const nowWord = now >= 0 ? words[now] : null;

  // the languages heard, by name, for the line under the title
  const heardIn = [...new Set(Object.values(doc.words ?? {}).map((tr) => tr.language))]
    .map((k) => (LANGUAGES.find((l) => l.key === k) ?? languageOf(k))?.name.replace(/ \(.*\)$/, ""))
    .filter(Boolean)
    .join(", ");
  const scene = sceneId ? doc.elements[sceneId] : null;
  const listening = useHearingAll().length > 0;

  // the recordings in this video that have words, even when every word was taken out by hand
  const heard = sceneId ? [...new Set(clipsWithWords(doc, sceneId).map((id) => doc.elements[id].src))] : [];

  // the open menu closes on a click anywhere else, or Escape
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".words-menu")) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const exportAs = async (kind: "srt" | "txt") => {
    setMenu(null);
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

  const fixOf = (w: EditWord, text: string): WordFix | null => {
    const src = doc.elements[w.clip]?.src;
    return src ? { src, s: w.fs, e: w.fe, text } : null;
  };

  const pick = (i: number, run: boolean) => {
    seek(words[i].s + 0.01);
    if (run && anchor.current >= 0) {
      const [a, b] = anchor.current < i ? [anchor.current, i] : [i, anchor.current];
      setPicked(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else {
      anchor.current = i;
      setPicked([i]);
    }
  };

  const removePicked = () => {
    const fixes = picked.map((i) => fixOf(words[i], "")).filter((f): f is WordFix => !!f);
    if (fixes.length) dispatch("fix_words", { fixes });
  };

  const finishTyping = () => {
    if (!typing) return;
    const w = words[typing.at];
    setTyping(null);
    if (!w || typing.text.trim() === w.w) return;
    const fix = fixOf(w, typing.text);
    if (fix) dispatch("fix_words", { fixes: [fix] });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (typing) return;
    if ((e.key === "Backspace" || e.key === "Delete") && picked.length) {
      e.preventDefault();
      e.stopPropagation();
      removePicked();
    } else if (e.key === "Escape" && picked.length) {
      e.stopPropagation();
      setPicked([]);
    }
  };

  return (
    <div className="words-panel" data-name="words-panel" tabIndex={-1} onKeyDown={onKey}>
      <div className="words-top">
        <div className="words-head">
          <div className="words-title">Words</div>
          <div className="words-tools">
            {words.length > 0 && (
              <div className="words-menu" data-name="words-export">
                <button className="words-menu-btn" data-name="words-export-button" aria-expanded={menu === "export"} onClick={() => setMenu(menu === "export" ? null : "export")}>
                  Export
                </button>
                {menu === "export" && (
                  <div className="words-menu-list">
                    <button data-name="words-export-srt" onClick={() => void exportAs("srt")}>Save as SRT</button>
                    <button data-name="words-export-txt" onClick={() => void exportAs("txt")}>Save as TXT</button>
                  </div>
                )}
              </div>
            )}
            {heard.length > 0 && (
              <div className="words-menu">
                <button className="words-menu-btn" data-name="words-more-button" title="More" aria-label="More" aria-expanded={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")}>
                  <Icon name="dots" size={14} />
                </button>
                {menu === "more" && (
                  <div className="words-menu-list">
                    <button
                      data-name="words-again"
                      disabled={listening}
                      onClick={() => {
                        setMenu(null);
                        window.dispatchEvent(new CustomEvent(ASK_TRANSCRIBE));
                      }}
                    >
                      Transcribe again…
                    </button>
                    <button
                      data-name="words-remove"
                      disabled={listening}
                      onClick={() => {
                        setMenu(null);
                        setNote("");
                        dispatch("set_words", { src: heard, transcript: null });
                      }}
                    >
                      Remove transcription
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
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
                  {row.map((w) => {
                    const i = words.indexOf(w);
                    if (typing?.at === i)
                      return (
                        <input
                          key={i}
                          className="words-typing"
                          data-name="words-typing"
                          autoFocus
                          value={typing.text}
                          size={Math.max(2, typing.text.length)}
                          onChange={(e) => setTyping({ at: i, text: e.target.value })}
                          onBlur={finishTyping}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") finishTyping();
                            if (e.key === "Escape") setTyping(null);
                          }}
                        />
                      );
                    return (
                      <span
                        key={i}
                        className={`words-word${w === nowWord ? " on" : ""}${picked.includes(i) ? " picked" : ""}`}
                        data-name="words-word"
                        onClick={(e) => pick(i, e.shiftKey)}
                        onDoubleClick={() => setTyping({ at: i, text: w.w })}
                      >
                        {w.w}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
          {note && <div className="words-foot">{note}</div>}
        </>
      )}
    </div>
  );
}
