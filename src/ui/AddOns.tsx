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
