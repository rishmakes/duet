import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentDoc, dispatch, useStore } from "../state/store";
import type { El, Transcript } from "../document/types";
import { spanOf } from "../document/time";

/**
 * Transcribe a clip (#340): the box that asks which language is spoken, and the work that follows.
 * The speech is heard on this computer, by the Voice to text add-on from the Store. The words are kept
 * with the recording, so every clip of the same file has them, however it is cut.
 */

/**
 * The languages people here speak sit on top. No "guess for me": guessing fails on mixed speech.
 * Hinglish and Banglish come out in English letters, the way people type them: the model hears them as
 * English, led by a line written that way. It also hears more of them than when told Hindi or Bengali.
 */
export const LANGUAGES: { key: string; name: string; code: string; prompt?: string }[] = [
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
  { key: "en", name: "English", code: "en" },
  // for anyone who wants Hindi or Bengali written in their own letters
  { key: "hi", name: "Hindi", code: "hi" },
  { key: "bn", name: "Bengali", code: "bn" },
];

/** Every other language the speech model knows, by name, A to Z. */
const EVERY: [string, string][] = [
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
const ALL: { key: string; name: string; code: string; prompt?: string }[] = [...LANGUAGES, ...EVERY.map(([code, name]) => ({ key: code, name, code }))];

const LAST = "duet.voice.language";
function lastLanguage(): string {
  try {
    const k = localStorage.getItem(LAST);
    if (k && ALL.some((l) => l.key === k)) return k;
  } catch {
    /* no storage: start from the top of the list */
  }
  return LANGUAGES[0].key;
}

// ---------- the clips being heard now, by file ----------

const jobs = new Map<string, number>();
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

/** How far a file is through being heard, 0 to 100, or undefined when it is not being heard. */
export function useHearing(src: string): number | undefined {
  return useSyncExternalStore(subscribe, () => snapshot).get(src);
}

/** Is Voice to text downloaded? */
export async function voiceReady(): Promise<boolean> {
  try {
    const s = await invoke<{ installed: string | null }>("voice_status");
    return !!s.installed;
  } catch {
    return false;
  }
}

/** Open the Store on Voice to text, for when it is not downloaded yet. */
export function openVoiceInStore() {
  window.dispatchEvent(new CustomEvent("duet:skills-page", { detail: { thing: "plugin-voice" } }));
}

/** Hear the speech in a file and keep its words. Rejects with a sentence a designer can read. */
export async function transcribe(src: string, languageKey: string): Promise<void> {
  if (jobs.has(src)) return;
  const lang = ALL.find((l) => l.key === languageKey) ?? LANGUAGES[0];
  try {
    localStorage.setItem(LAST, lang.key);
  } catch {
    /* remembering is a nicety */
  }
  jobs.set(src, 0);
  changed();
  const off = listen<{ path: string; percent: number }>("voice-progress", (e) => {
    if (e.payload.path !== src || !jobs.has(src)) return;
    jobs.set(src, Math.max(0, Math.min(100, e.payload.percent)));
    changed();
  });
  try {
    const t = await invoke<Transcript>("voice_transcribe", { path: src, language: lang.code, prompt: lang.prompt ?? null });
    // English letters only for the mixed ones: no accents left over, like the a in "na"
    const words = lang.prompt ? t.words.map((w) => ({ ...w, w: plainLetters(w.w) })).filter((w) => w.w) : t.words;
    dispatch("set_words", { src, transcript: { language: lang.key, model: t.model, words } });
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

/** The box: which language is spoken in this clip, then Transcribe. */
export function TranscribeBox({ el, scene, onClose, onError }: { el: El; scene: El; onClose: () => void; onError: (note: string) => void }) {
  const [key, setKey] = useState(lastLanguage);
  const has = useStore((s) => !!currentDoc(s).words?.[el.src]);
  const hearing = useHearing(el.src) !== undefined;
  const span = spanOf(el, scene);

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

  return (
    <div className="export-pop act-pop transcribe-pop" data-name="transcribe-box">
      <div className="transcribe-title">Transcribe speech</div>
      <div className="transcribe-sub">
        {el.name} · {secondsText(span.end - span.start)}
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
            {EVERY.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className="transcribe-hint">
        {has ? "This clip has its words already. Transcribing again replaces them." : "Pick what is spoken in this clip. Duet suggests the one you used last."}
      </div>
      <div className="transcribe-foot">
        <span>Runs on this computer</span>
        <button className="pill" data-name="transcribe-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pill primary"
          data-name="transcribe-go"
          disabled={hearing}
          onClick={() => {
            onClose();
            transcribe(el.src, key).catch((e: Error) => onError(e.message));
          }}
        >
          {hearing ? "Listening…" : "Transcribe"}
        </button>
      </div>
    </div>
  );
}

/** The thin line along a clip while its file is being heard. */
export function HearingLine({ src }: { src: string }) {
  const p = useHearing(src);
  if (p === undefined) return null;
  return (
    <i className="time-hearing" data-name="transcribe-progress" title={`Listening for words, ${p}%`}>
      <i style={{ width: `${Math.max(3, p)}%` }} />
    </i>
  );
}
