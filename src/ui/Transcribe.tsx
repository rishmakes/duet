import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentDoc, dispatch, useStore } from "../state/store";
import type { El, Transcript } from "../document/types";
import { spanOf } from "../document/time";
import { pickListeningLine } from "../ai/waitingLines";

/**
 * Transcribe a clip (#340): the box that asks which language is spoken, and the work that follows.
 * The speech is heard on this computer, by the Voice to text add-on from the Store. The words are kept
 * with the recording, so every clip of the same file has them, however it is cut.
 */

/**
 * Auto-detect, then the languages people here speak. Auto-detect can mishear mixed speech, so Hinglish
 * and Banglish sit right under it.
 * Hinglish and Banglish come out in English letters, the way people type them: the model hears them as
 * English, led by a line written that way. It also hears more of them than when told Hindi or Bengali.
 */
export const LANGUAGES: { key: string; name: string; code: string; prompt?: string }[] = [
  { key: "auto", name: "Auto-detect", code: "auto" },
  { key: "en", name: "English", code: "en" },
  {
    key: "hi-en",
    name: "Hinglish (Hindi + English)",
    code: "en",
    prompt: "Haan toh aaj main aapko dikhata hoon ki video kaise edit karte hain. Yeh bahut simple hai, bas thoda dhyan dena padta hai.",
  },
  {
    key: "bn-en",
    name: "Banglish (Bengali + English)",
    code: "en",
    prompt: "Ki khobor? Ami bhalo achi. Aaj ami tomake dekhabo kivabe video edit korte hoy. Eta khub simple, shudhu ektu dhyan dite hoy.",
  },
];

/** Every other language the speech model knows, by name, A to Z. */
export const EVERY_LANGUAGE: [string, string][] = [
  ["af", "Afrikaans"],
  ["sq", "Albanian"],
  ["am", "Amharic"],
  ["ar", "Arabic"],
  ["hy", "Armenian"],
  ["as", "Assamese"],
  ["az", "Azerbaijani"],
  ["ba", "Bashkir"],
  ["eu", "Basque"],
  ["be", "Belarusian"],
  ["bn", "Bengali"],
  ["bs", "Bosnian"],
  ["br", "Breton"],
  ["bg", "Bulgarian"],
  ["my", "Burmese"],
  ["yue", "Cantonese"],
  ["ca", "Catalan"],
  ["zh", "Chinese"],
  ["hr", "Croatian"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["nl", "Dutch"],
  ["et", "Estonian"],
  ["fo", "Faroese"],
  ["fi", "Finnish"],
  ["fr", "French"],
  ["gl", "Galician"],
  ["ka", "Georgian"],
  ["de", "German"],
  ["el", "Greek"],
  ["gu", "Gujarati"],
  ["ht", "Haitian Creole"],
  ["ha", "Hausa"],
  ["haw", "Hawaiian"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["hu", "Hungarian"],
  ["is", "Icelandic"],
  ["id", "Indonesian"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["jw", "Javanese"],
  ["kn", "Kannada"],
  ["kk", "Kazakh"],
  ["km", "Khmer"],
  ["ko", "Korean"],
  ["lo", "Lao"],
  ["la", "Latin"],
  ["lv", "Latvian"],
  ["ln", "Lingala"],
  ["lt", "Lithuanian"],
  ["lb", "Luxembourgish"],
  ["mk", "Macedonian"],
  ["mg", "Malagasy"],
  ["ms", "Malay"],
  ["ml", "Malayalam"],
  ["mt", "Maltese"],
  ["mi", "Maori"],
  ["mr", "Marathi"],
  ["mn", "Mongolian"],
  ["ne", "Nepali"],
  ["no", "Norwegian"],
  ["nn", "Norwegian Nynorsk"],
  ["oc", "Occitan"],
  ["ps", "Pashto"],
  ["fa", "Persian"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["pa", "Punjabi"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["sa", "Sanskrit"],
  ["sr", "Serbian"],
  ["sn", "Shona"],
  ["sd", "Sindhi"],
  ["si", "Sinhala"],
  ["sk", "Slovak"],
  ["sl", "Slovenian"],
  ["so", "Somali"],
  ["es", "Spanish"],
  ["su", "Sundanese"],
  ["sw", "Swahili"],
  ["sv", "Swedish"],
  ["tl", "Tagalog"],
  ["tg", "Tajik"],
  ["ta", "Tamil"],
  ["tt", "Tatar"],
  ["te", "Telugu"],
  ["th", "Thai"],
  ["bo", "Tibetan"],
  ["tr", "Turkish"],
  ["tk", "Turkmen"],
  ["uk", "Ukrainian"],
  ["ur", "Urdu"],
  ["uz", "Uzbek"],
  ["vi", "Vietnamese"],
  ["cy", "Welsh"],
  ["yi", "Yiddish"],
  ["yo", "Yoruba"],
];
const ALL: { key: string; name: string; code: string; prompt?: string }[] = [...LANGUAGES, ...EVERY_LANGUAGE.map(([code, name]) => ({ key: code, name, code }))];

/** The language a key or a name stands for, such as "hi-en", "Hinglish" or "English". */
export function languageOf(said: string): { key: string; name: string; code: string; prompt?: string } | undefined {
  const k = said.trim().toLowerCase();
  if (!k) return undefined;
  return ALL.find((l) => l.key.toLowerCase() === k) ?? ALL.find((l) => l.name.toLowerCase() === k) ?? ALL.find((l) => l.name.toLowerCase().startsWith(k));
}

const LAST = "duet.voice.language";
export function lastLanguage(): string {
  try {
    const k = localStorage.getItem(LAST);
    if (k && ALL.some((l) => l.key === k)) return k;
  } catch {
    /* no storage: start from the top of the list */
  }
  return LANGUAGES[0].key;
}

// ---------- the clips being heard now, by file ----------

/** Where a file is in being heard: reading its sound, loading the voice model, or listening for words. */
export type HearingStage = "sound" | "model" | "hear";

export interface Hearing {
  stage: HearingStage;
  /** How far the speech model says it is, 0 to 100. It moves in jumps, one stretch of about 30 seconds at a time. */
  percent: number;
  /** How long the recording is, once its sound is read. */
  seconds?: number;
  /** When it started, when listening started, and when the model last said how far it was (ms). */
  started: number;
  hearFrom?: number;
  lastAt?: number;
}

const jobs = new Map<string, Hearing>();
const listeners = new Set<() => void>();
let snapshot = new Map(jobs);
const changed = () => {
  snapshot = new Map(jobs);
  listeners.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

/**
 * How far it is, 0 to 99, moving smoothly: the model reports only after each stretch of about 30
 * seconds, so between reports the bar creeps on at the pace the stretches have taken so far.
 */
export function shownPercent(h: Hearing, now = Date.now()): number {
  if (h.stage !== "hear") return 0;
  const stretches = Math.max(1, Math.ceil((h.seconds ?? 30) / 30));
  const each = 100 / stretches;
  const from = h.hearFrom ?? now;
  const done = h.percent;
  // the time one stretch takes: measured once one is done, else a guess that keeps the bar moving slowly
  const per = done > 0 && h.lastAt ? (h.lastAt - from) / (done / each) : 90_000;
  const since = now - (h.lastAt ?? from);
  const creep = Math.min(each * 0.9, (since / per) * each);
  return Math.max(0, Math.min(99, Math.floor(done + creep)));
}

/** Seconds left, once one stretch has been heard and the pace is known. */
export function secondsLeft(h: Hearing, now = Date.now()): number | null {
  if (h.stage !== "hear" || h.hearFrom === undefined || !(h.percent > 0)) return null;
  const elapsed = (now - h.hearFrom) / 1000;
  const p = Math.max(h.percent, shownPercent(h, now));
  return Math.max(1, (elapsed * (100 - p)) / p);
}

/** How far a file is through being heard, 0 to 100, or undefined when it is not being heard. */
export function useHearing(src: string): number | undefined {
  const h = useSyncExternalStore(subscribe, () => snapshot).get(src);
  return h ? shownPercent(h) : undefined;
}

/** Every file being heard now. */
export function useHearingAll(): [string, Hearing][] {
  return [...useSyncExternalStore(subscribe, () => snapshot)];
}

/** Stop hearing a file. Nothing is kept. */
export function stopHearing(src: string) {
  void invoke("voice_stop", { path: src }).catch(() => undefined);
}

/** Is Voice to text downloaded? While a new choice downloads, the one already here stands in. */
export async function voiceReady(): Promise<boolean> {
  try {
    const s = await invoke<{ usable: boolean }>("voice_status");
    return !!s.usable;
  } catch {
    return false;
  }
}

/** Open the Store on Voice to text, for when it is not downloaded yet. */
export function openVoiceInStore() {
  window.dispatchEvent(new CustomEvent("duet:skills-page", { detail: { thing: "plugin-voice" } }));
}

/** How far a file is through being heard now, 0 to 100, or undefined when it is not being heard. */
export const hearingNow = (src: string) => {
  const h = jobs.get(src);
  return h ? shownPercent(h) : undefined;
};

const running = new Map<string, Promise<void>>();

/**
 * Hear the speech in a file and keep its words. Rejects with a sentence a designer can read. A file
 * already being heard is not heard twice: the same work is waited on.
 */
export function transcribe(src: string, languageKey: string, keep: (t: Transcript) => void = (t) => dispatch("set_words", { src, transcript: t })): Promise<void> {
  const now = running.get(src);
  if (now) return now;
  const job = hear(src, languageKey, keep).finally(() => running.delete(src));
  running.set(src, job);
  return job;
}

async function hear(src: string, languageKey: string, keep: (t: Transcript) => void): Promise<void> {
  const lang = ALL.find((l) => l.key === languageKey) ?? LANGUAGES[0];
  try {
    localStorage.setItem(LAST, lang.key);
  } catch {
    /* remembering is a nicety */
  }
  jobs.set(src, { stage: "sound", percent: 0, started: Date.now() });
  changed();
  const off = listen<{ path: string; percent?: number; stage?: HearingStage; seconds?: number }>("voice-progress", (e) => {
    const h = jobs.get(src);
    if (e.payload.path !== src || !h) return;
    const next: Hearing = { ...h };
    if (e.payload.stage) {
      next.stage = e.payload.stage;
      if (e.payload.stage === "hear") next.hearFrom = Date.now();
    }
    if (typeof e.payload.seconds === "number") next.seconds = e.payload.seconds;
    if (typeof e.payload.percent === "number") {
      const p = Math.max(0, Math.min(100, e.payload.percent));
      if (p > next.percent) {
        next.percent = p;
        next.lastAt = Date.now();
      }
      next.stage = "hear";
      next.hearFrom ??= Date.now();
    }
    jobs.set(src, next);
    changed();
  });
  try {
    // how carefully it listens is the stop picked in Voice to text settings (#364)
    const t = await invoke<Transcript>("voice_transcribe", { path: src, language: lang.code, prompt: lang.prompt ?? null });
    // English letters only for the mixed ones: no accents left over, like the a in "na"
    const words = lang.prompt ? t.words.map((w) => ({ ...w, w: plainLetters(w.w) })).filter((w) => w.w) : t.words;
    keep({ language: lang.key, model: t.model, words });
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Voice to text could not hear this clip.");
  } finally {
    void off.then((f) => f());
    jobs.delete(src);
    changed();
  }
}

/** A word without accents: "ná" becomes "na". */
export const plainLetters = (w: string) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const secondsText = (s: number) => {
  const n = Math.round(s);
  if (n < 60) return `${n} ${n === 1 ? "second" : "seconds"}`;
  const m = Math.floor(n / 60);
  return `${m} min ${n % 60} s`;
};

/** The box: which language is spoken in these clips, then Transcribe. Picked clips, or the whole video. */
export function TranscribeBox({ els, scene, picked, onClose, onError }: { els: El[]; scene: El; picked: boolean; onClose: () => void; onError: (note: string) => void }) {
  const [key, setKey] = useState(lastLanguage);
  const words = useStore((s) => currentDoc(s).words);
  const srcs = [...new Set(els.map((el) => el.src))];
  const has = srcs.length > 0 && srcs.every((src) => !!words?.[src]);
  const seconds = els.reduce((t, el) => {
    const span = spanOf(el, scene);
    return t + span.end - span.start;
  }, 0);

  // not downloaded yet: the Store page says how to get it
  useEffect(() => {
    let live = true;
    void voiceReady().then((ok) => {
      if (!live || ok) return;
      onClose();
      openVoiceInStore();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const what = !picked ? "The whole video" : els.length === 1 ? els[0].name : `${els.length} picked clips`;
  return (
    <div className="export-pop act-pop transcribe-pop" data-name="transcribe-box">
      <div className="transcribe-title">Transcribe speech</div>
      <div className="transcribe-sub">
        {what} · {secondsText(seconds)}
      </div>
      <label className="transcribe-field">
        <span>Language</span>
        <select data-name="transcribe-language" value={key} onChange={(e) => setKey(e.target.value)}>
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
      <div className="transcribe-hint">
        {has ? "These have their words already. Transcribing again replaces them. Read them in the Words tab." : "Pick what is spoken. Duet suggests the one you used last. The words show in the Words tab."}
      </div>
      <div className="transcribe-foot">
        <span>Runs on this computer</span>
        <button className="pill" data-name="transcribe-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pill primary"
          data-name="transcribe-go"
          disabled={!srcs.length}
          onClick={() => {
            onClose();
            void (async () => {
              try {
                for (const src of srcs) await transcribe(src, key);
              } catch (e) {
                onError(e instanceof Error ? e.message : "Voice to text could not hear this clip.");
              }
            })();
          }}
        >
          Transcribe
        </button>
      </div>
    </div>
  );
}

const STAGE_TEXT: Record<HearingStage, string> = {
  sound: "Reading the sound",
  model: "Loading the voice model",
  hear: "Listening for words",
};

const shortTime = (s: number) => {
  const n = Math.round(s);
  return n < 60 ? `${n} s` : `${Math.floor(n / 60)} min ${n % 60} s`;
};

/** A ticking clock while anything is being heard, so the bar and the times move between reports. */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [on]);
}

/**
 * The card over the video while Duet listens for words (#354): which step, how far, the time so far
 * and the time left, and Stop. Work goes on around it. On a slow computer this is the only sign that
 * it is working, so it never sits still.
 */
export function HearingCard() {
  const all = useHearingAll();
  useTick(all.length > 0);
  // a playful line that changes now and then, like the chat's waiting lines
  const [line, setLine] = useState(() => pickListeningLine());
  const busy = all.length > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setLine((l) => pickListeningLine(l)), 7000);
    return () => clearInterval(t);
  }, [busy]);
  if (!all.length) return null;
  const now = Date.now();
  return (
    <div className="hearing-card" data-name="hearing-card" role="status">
      {all.map(([src, h]) => {
        const p = shownPercent(h, now);
        const moving = h.stage === "hear";
        const left = secondsLeft(h, now);
        const name = src.split(/[\\/]/).pop();
        return (
          <div className="hearing-row" key={src}>
            <div className="hearing-head">
              <span className="hearing-step">
                <span className="hearing-wave" aria-hidden>
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                {STAGE_TEXT[h.stage]}
              </span>
              <span className="hearing-pct">{moving ? `${p}%` : ""}</span>
            </div>
            <div className={`hearing-bar ${moving ? "" : "waiting"}`}>
              <i style={{ width: moving ? `${Math.max(2, p)}%` : undefined }} />
            </div>
            <div className="hearing-line" data-name="hearing-line" key={line}>
              {line}
            </div>
            <div className="hearing-foot">
              <span title={src}>
                {name} · {shortTime((now - h.started) / 1000)} so far{left !== null ? ` · about ${shortTime(left)} left` : h.stage === "hear" ? " · working out the time left" : ""}
              </span>
              <button className="hearing-stop" data-name="stop-hearing" onClick={() => stopHearing(src)} title="Stop listening. Nothing is kept.">
                Stop
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The thin line along a clip while its file is being heard. */
export function HearingLine({ src }: { src: string }) {
  const p = useHearing(src);
  useTick(p !== undefined);
  if (p === undefined) return null;
  return (
    <i className="time-hearing" data-name="transcribe-progress" title={`Listening for words, ${p}%`}>
      <i style={{ width: `${Math.max(3, p)}%` }} />
    </i>
  );
}
