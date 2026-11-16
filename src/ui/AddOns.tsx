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

type VoiceSize = "small" | "medium" | "large";

interface VoiceStatus {
  installed: VoiceSize | null;
  downloading: VoiceSize | null;
  step: "" | "downloading" | "checking";
  got: number;
  total: number | null;
  error: string;
  free: number | null;
  sizes: { size: VoiceSize; bytes: number }[];
}

const VOICE_SIZES: { size: VoiceSize; name: string; what: string }[] = [
  { size: "small", name: "Small", what: "Quick. Fine for clear speech in one language." },
  { size: "medium", name: "Medium", what: "Better with mixed speech, like Hindi and English in one sentence." },
  { size: "large", name: "Large", what: "Most careful. Slowest. Best on a strong computer." },
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

/** Voice to text: pick a size, download it once, then transcribe clips on this computer (#340). */
export function VoiceAddon() {
  const [s, setS] = useState<VoiceStatus | null>(null);
  const [pick, setPick] = useState<VoiceSize>("medium");
  const [changing, setChanging] = useState(false);
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
  const bytesOf = (size: VoiceSize) => s.sizes.find((x) => x.size === size)?.bytes ?? 0;
  const nameOf = (size: VoiceSize) => VOICE_SIZES.find((x) => x.size === size)?.name ?? size;

  if (s.downloading) {
    const total = s.total ?? bytesOf(s.downloading);
    const share = total ? Math.min(1, s.got / total) : 0;
    return (
      <div className="voice-addon">
        <div className="voice-title">{s.step === "checking" ? `Checking ${nameOf(s.downloading)}` : `Downloading ${nameOf(s.downloading)}`}</div>
        <div className="voice-bar">
          <div style={{ width: `${share * 100}%` }} />
        </div>
        <div className="voice-foot">
          <div className="addon-note">
            {s.step === "checking"
              ? "Making sure the download is complete and unchanged."
              : [`${sizeWords(s.got)} of ${sizeWords(total)}`, rate ? timeLeftWords(total - s.got, rate.perSecond) : ""].filter(Boolean).join(" · ")}
            <br />
            Keep working. If you close Duet, press Download again and it carries on.
          </div>
          <button className="mini" data-name="voice-cancel" onClick={() => void invoke("voice_cancel")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (s.installed && !changing) {
    return (
      <div className="voice-addon">
        <div className="voice-title">
          <span className="voice-ready-dot" /> Ready · {nameOf(s.installed)}, {sizeWords(bytesOf(s.installed))}
        </div>
        <div className="addon-note">Right-click a clip and pick Transcribe. The AI can use it too.</div>
        <div className="voice-actions">
          <button
            className="mini"
            onClick={() => {
              setPick(s.installed === "medium" ? "large" : "medium");
              setChanging(true);
            }}
          >
            Change size
          </button>
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
        <div className="addon-note">
          {sureRemove
            ? "Press again to delete the download and get the space back."
            : "Remove deletes the download and gives the space back. Words already made stay with their clips."}
        </div>
      </div>
    );
  }

  const need = bytesOf(pick);
  const short = s.free != null && s.free < need + 200e6;
  return (
    <div className="voice-addon">
      <div className="voice-title">Pick a size</div>
      <div className="addon-note">One download understands every language. You can switch size later.</div>
      <div className="voice-sizes" role="radiogroup">
        {VOICE_SIZES.map((v) => (
          <button
            key={v.size}
            role="radio"
            aria-checked={pick === v.size}
            data-name={`voice-size-${v.size}`}
            className={`voice-size ${pick === v.size ? "on" : ""}`}
            onClick={() => setPick(v.size)}
          >
            <span className="voice-radio" />
            <span className="voice-size-words">
              <span className="voice-size-name">
                {v.name}
                {v.size === "medium" && <span className="voice-tag">Suggested</span>}
                {s.installed === v.size && <span className="voice-tag">You have this</span>}
              </span>
              <span className="voice-size-what">{v.what}</span>
            </span>
            <span className="voice-size-bytes">about {sizeWords(bytesOf(v.size))}</span>
          </button>
        ))}
      </div>
      {s.error && <div className="addon-note addon-error">{s.error}</div>}
      <div className="voice-foot">
        <div className={`addon-note ${short ? "addon-error" : ""}`}>
          Needs {sizeWords(need)} of space.{s.free != null && ` You have about ${sizeWords(s.free)} free.`}
          {s.installed && " The size you have now is removed once the new one is ready."}
        </div>
        <div className="voice-actions">
          {changing && (
            <button className="mini" onClick={() => setChanging(false)}>
              Keep {nameOf(s.installed ?? pick)}
            </button>
          )}
          <button
            className="mini primary"
            data-name="voice-download"
            disabled={short || s.installed === pick}
            onClick={() => {
              setChanging(false);
              void invoke("voice_download", { size: pick });
            }}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
