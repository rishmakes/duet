import { useState } from "react";
import { currentDoc, dispatch, useStore } from "../state/store";
import type { El } from "../document/types";
import { CAPTION_FONTS, CAPTION_LOOKS, SPOKEN_COLOURS } from "../document/captions";
import { fetchFamily } from "../project/fonts";
import type { CaptionLook } from "../document/captions";
import { LookSample, useCaptionFonts } from "./CaptionLooks";
import { EVERY_LANGUAGE, LANGUAGES, lastLanguage, openVoiceInStore, transcribe, voiceReady } from "./Transcribe";

/**
 * Auto captions (#71): the box under the timeline that makes captions from what is said. Clips with no
 * words yet are transcribed first, on this computer; then every caption is plain text on a Captions track.
 */

const LOOK = "duet.captions.look";
const PER = "duet.captions.per";
const LIT = "duet.captions.lit";

function remembered<T>(key: string, ok: (v: string) => boolean, fallback: T, read: (v: string) => T): T {
  try {
    const v = localStorage.getItem(key);
    if (v && ok(v)) return read(v);
  } catch {
    /* no storage: the default */
  }
  return fallback;
}

function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* remembering is a nicety */
  }
}


export function AutoCaptionsBox({ scene, clips, picked, onClose, onError }: { scene: El; clips: El[]; picked: boolean; onClose: () => void; onError: (note: string) => void }) {
  useCaptionFonts();
  const [look, setLook] = useState<CaptionLook>(() => remembered(LOOK, (v) => CAPTION_LOOKS.some((l) => l.key === v), "bold" as CaptionLook, (v) => v as CaptionLook));
  const [per, setPer] = useState(() => remembered(PER, (v) => +v >= 1 && +v <= 6, 3, Number));
  const [lang, setLang] = useState(lastLanguage);
  // the colour the spoken word lights up in, or "" for none
  const [lit, setLit] = useState(() => remembered(LIT, (v) => v === "none" || SPOKEN_COLOURS.includes(v), SPOKEN_COLOURS[0], (v) => (v === "none" ? "" : v)));
  const words = useStore((s) => currentDoc(s).words);
  const missing = [...new Set(clips.map((el) => el.src))].filter((src) => !words?.[src]);

  const go = async () => {
    remember(LOOK, look);
    remember(PER, String(per));
    remember(LIT, lit || "none");
    onClose();
    if (missing.length && !(await voiceReady())) {
      openVoiceInStore();
      return;
    }
    try {
      for (const src of missing) await transcribe(src, lang);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Voice to text could not hear this clip.");
      return;
    }
    // the look's font comes along; the captions show in the computer's font until it is here
    void fetchFamily(CAPTION_FONTS[look]);
    dispatch("add_captions", { sceneId: scene.id, clips: picked ? clips.map((el) => el.id) : undefined, look, per, spokenFill: lit || undefined });
  };

  return (
    <div className="export-pop act-pop transcribe-pop captions-pop" data-name="captions-box">
      <div className="transcribe-title">Auto captions</div>
      <div className="transcribe-sub">{picked ? (clips.length === 1 ? "For the picked clip" : `For the ${clips.length} picked clips`) : "For the whole video"}</div>
      <div className="captions-label">Look</div>
      <div className="caption-looks">
        {CAPTION_LOOKS.map((l) => (
          <button key={l.key} className={`caption-look look-${l.key}${look === l.key ? " on" : ""}`} data-name={`captions-look-${l.key}`} title={l.name} onClick={() => setLook(l.key)}>
            <LookSample look={l.key} words={["Say", "it"]} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
      <div className={`captions-row${look === "one" ? " off" : ""}`}>
        <span>Words at a time</span>
        <div className="captions-per">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button key={n} className={(look === "one" ? n === 1 : per === n) ? "on" : ""} data-name={`captions-per-${n}`} disabled={look === "one"} onClick={() => setPer(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className={`captions-row${look === "one" ? " off" : ""}`}>
        <span>Light up the spoken word</span>
        <div className="captions-lit">
          <button className={!lit ? "none on" : "none"} data-name="captions-lit-none" title="No colour" disabled={look === "one"} onClick={() => setLit("")} />
          {SPOKEN_COLOURS.map((c) => (
            <button key={c} className={lit === c ? "on" : ""} style={{ background: c }} data-name={`captions-lit-${c.slice(1)}`} title="Light up in this colour" disabled={look === "one"} onClick={() => setLit(c)} />
          ))}
        </div>
      </div>
      {missing.length > 0 && (
        <label className="transcribe-field">
          <span>Spoken language</span>
          <select data-name="captions-language" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
            <optgroup label="Every language">
              {EVERY_LANGUAGE.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
      <div className="transcribe-hint">
        {missing.length ? "Duet listens for the words first, on this computer. The captions come when it is done." : "Captions made before for the same part are replaced."}
      </div>
      <div className="transcribe-foot">
        <span>Plain text you can change</span>
        <button className="pill" data-name="captions-cancel" onClick={onClose}>
          Cancel
        </button>
        <button className="pill primary" data-name="captions-go" disabled={!clips.length} onClick={() => void go()}>
          Add captions
        </button>
      </div>
    </div>
  );
}
