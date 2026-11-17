import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Status {
  status: "off" | "starting" | "on" | "error";
  note: string;
  link: string | null;
}

/** Connect to ChatGPT and Claude: an AI on the web works in this Duet through a private link. */
export function ConnectAddon() {
  const [s, setS] = useState<Status>({ status: "off", note: "", link: null });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void invoke<Status>("connect_status").then(setS).catch(() => undefined);
    const off = listen<Status>("connect-status", (e) => setS(e.payload));
    return () => void off.then((f) => f());
  }, []);

  const on = s.status === "on" || s.status === "starting";
  const copy = () => {
    if (!s.link) return;
    void navigator.clipboard.writeText(s.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="addon">
      <div className="addon-head">
        <div>
          <div className="addon-name">Connect to ChatGPT and Claude</div>
          <div className="addon-what">Talk to ChatGPT or Claude on the web, and watch them design here.</div>
        </div>
        <button
          className={`mini ${on ? "" : "primary"}`}
          data-name="connect-toggle"
          onClick={() => void invoke(on ? "connect_stop" : "connect_start")}
        >
          {on ? "Turn off" : "Turn on"}
        </button>
      </div>
      {s.status === "starting" && <div className="addon-note">{s.note || "Getting ready"}…</div>}
      {s.status === "error" && <div className="addon-note addon-error">{s.note}</div>}
      {s.status === "on" && s.link && (
        <>
          <div className="addon-link">
            <input readOnly value={s.link} onFocus={(e) => e.currentTarget.select()} />
            <button className="mini primary" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <ol className="addon-steps">
            <li>In ChatGPT, open Settings, then Apps, and add a custom app. In Claude, open Settings, then Connectors, and add a custom connector.</li>
            <li>Name it Duet, paste the link, and choose no sign-in.</li>
            <li>Start a chat, turn Duet on, and ask for a design.</li>
          </ol>
          <div className="addon-note">
            Keep this link private: anyone who has it can change your open design while this is on. It changes each time you turn this on, so paste the new one.
          </div>
        </>
      )}
    </div>
  );
}

interface VoiceStatus {
  /** The stop picked on the slider, 1 (fastest) to 5 (most accurate). */
  level: number;
  suggested: number;
  /** The picked stop's download is here. */
  ready: boolean;
  /** Any stop's download is here, so Transcribe works. */
  usable: boolean;
  downloading: string | null;
  step: "" | "downloading" | "checking";
  got: number;
  total: number | null;
  error: string;
  free: number | null;
  stops: { level: number; ready: boolean; bytes: number }[];
}

/** The slider's stops, fastest to most accurate (#364). What is behind each is in src-tauri/src/voice.rs. */
export const VOICE_STOPS: { level: number; name: string; what: string }[] = [
  { level: 1, name: "Fastest", what: "Ready soonest. A few words may be off." },
  { level: 2, name: "Fast", what: "Same small download, listens more carefully. Good with two languages in one sentence." },
  { level: 3, name: "Balanced", what: "A bigger listener. Careful words at a fair wait." },
  { level: 4, name: "Careful", what: "Slower, and more careful. Good for client work." },
  { level: 5, name: "Most accurate", what: "Slowest and most careful. Best on a strong computer." },
];

/** A size in plain words: "574 MB", "1.6 GB". */
export function sizeWords(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Time left in plain words, from bytes still to come and bytes a second. */
export function timeLeftWords(left: number, perSecond: number): string {
  if (!(perSecond > 0)) return "";
  const s = left / perSecond;
  if (s < 60) return "less than a minute left";
  const m = Math.round(s / 60);
  return m === 1 ? "about a minute left" : `about ${m} minutes left`;
}

/** Voice to text: one slider from fastest to most accurate, download once, then transcribe clips on this computer (#340, #364). */
export function VoiceAddon() {
  const [s, setS] = useState<VoiceStatus | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [sureRemove, setSureRemove] = useState(false);
  const [rate, setRate] = useState<{ at: number; got: number; perSecond: number } | null>(null);

  useEffect(() => {
    void invoke<VoiceStatus>("voice_status").then(setS).catch(() => undefined);
    const off = listen<VoiceStatus>("voice-status", (e) => setS(e.payload));
    return () => void off.then((f) => f());
  }, []);

  // download speed, smoothed, for the time left
  useEffect(() => {
    if (!s?.downloading || s.step !== "downloading") {
      setRate(null);
      return;
    }
    const now = Date.now();
    setRate((r) => {
      if (!r) return { at: now, got: s.got, perSecond: 0 };
      const dt = (now - r.at) / 1000;
      if (dt < 1) return r;
      const fresh = Math.max(0, (s.got - r.got) / dt);
      return { at: now, got: s.got, perSecond: r.perSecond ? r.perSecond * 0.7 + fresh * 0.3 : fresh };
    });
  }, [s?.got, s?.downloading, s?.step]);

  if (!s) return null;
  const shown = pick ?? s.level;
  const stopOf = (l: number) => VOICE_STOPS.find((v) => v.level === l) ?? VOICE_STOPS[1];
  const info = s.stops.find((x) => x.level === shown);
  const here = !!info?.ready;
  const need = info?.bytes ?? 0;
  const short = !here && s.free != null && s.free < need + 200e6;
  const using = s.stops.filter((x) => x.ready).sort((a, b) => Math.abs(a.level - s.level) - Math.abs(b.level - s.level) || b.level - a.level)[0];

  // a stop whose download is here is used at once; one that needs a download waits for Download
  const choose = (l: number) => {
    setPick(l);
    setSureRemove(false);
    if (s.stops.find((x) => x.level === l)?.ready) void invoke("voice_set_level", { level: l }).catch(() => undefined);
  };

  const total = s.total ?? 0;
  const share = total ? Math.min(1, s.got / total) : 0;
  return (
    <div className="voice-addon">
      <div className="voice-title">
        {s.ready && !s.downloading ? <span className="voice-ready-dot" /> : null}
        {s.ready && !s.downloading ? `Ready · ${stopOf(s.level).name}` : "How Duet listens"}
      </div>
      <div className="voice-slider" data-name="voice-slider">
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={shown}
          aria-label="How Duet listens, from fastest to most accurate"
          aria-valuetext={stopOf(shown).name}
          onChange={(e) => choose(Number(e.target.value))}
        />
        <div className="voice-stops">
          {VOICE_STOPS.map((v) => (
            <button
              key={v.level}
              data-name={`voice-stop-${v.level}`}
              className={`voice-stop ${shown === v.level ? "on" : ""}`}
              onClick={() => choose(v.level)}
              title={v.level === s.suggested ? `${v.name}, suggested` : v.name}
            >
              <span className={`voice-stop-dot ${v.level === s.suggested ? "suggested" : ""}`} />
            </button>
          ))}
        </div>
        <div className="voice-ends">
          <span>Fastest</span>
          <span>Most accurate</span>
        </div>
      </div>
      <div className="voice-pick" data-name="voice-pick">
        <span className="voice-pick-name">
          {stopOf(shown).name}
          {shown === s.suggested && <span className="voice-tag">Suggested</span>}
        </span>
        <span className="voice-pick-what">{stopOf(shown).what}</span>
        <span className="voice-pick-size" data-name="voice-pick-size">
          {need ? (here ? `${sizeWords(need)}, on this computer` : `${sizeWords(need)} to download, one time`) : ""}
        </span>
      </div>

      {s.downloading ? (
        <>
          <div className="voice-bar">
            <div style={{ width: `${share * 100}%` }} />
          </div>
          <div className="voice-foot">
            <div className="addon-note">
              {s.step === "checking"
                ? "Checking the download is complete and unchanged."
                : [`Downloading ${sizeWords(s.got)} of ${sizeWords(total)}`, rate ? timeLeftWords(total - s.got, rate.perSecond) : ""].filter(Boolean).join(" · ")}
              <br />
              {using ? `Until it is ready, Transcribe uses ${stopOf(using.level).name}.` : "Keep working. If you close Duet, press Download again and it carries on."}
            </div>
            <button className="mini" data-name="voice-cancel" onClick={() => void invoke("voice_cancel")}>
              Cancel
            </button>
          </div>
        </>
      ) : here ? (
        <>
          <div className="addon-note">Right-click a clip and pick Transcribe. The AI can use it too.</div>
          <div className="voice-foot">
            <div className="addon-note">
              {sureRemove ? "Press again to delete the download and get the space back." : "Remove deletes the download and gives the space back. Words already made stay with their clips."}
            </div>
            <div className="voice-actions">
              <button
                className="mini"
                data-name="voice-remove"
                onClick={() => {
                  if (!sureRemove) {
                    setSureRemove(true);
                    return;
                  }
                  setSureRemove(false);
                  void invoke("voice_remove");
                }}
                onBlur={() => setSureRemove(false)}
              >
                {sureRemove ? "Remove it" : "Remove"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {s.error && <div className="addon-note addon-error">{s.error}</div>}
          <div className="voice-foot">
            <div className={`addon-note ${short ? "addon-error" : ""}`}>
              {s.free != null ? `You have about ${sizeWords(s.free)} free.` : ""}
              {using && ` Until it is ready, Transcribe uses ${stopOf(using.level).name}. What is not needed is removed after.`}
            </div>
            <div className="voice-actions">
              <button
                className="mini primary"
                data-name="voice-download"
                disabled={short}
                onClick={() => void invoke("voice_set_level", { level: shown }).catch(() => undefined)}
              >
                Download
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
