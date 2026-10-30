import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Where feedback lands: a Google Sheet of the creator's, with pictures kept in his Drive. It can only add rows. */
const INBOX = "https://script.google.com/macros/s/AKfycbxErFhxTHWXB_WZHYOGrRd-KAy8_DUri4B_CIXzNKgzTPj_gJ04MQ_2uk82nzxbndTu/exec";
const BOOK = "https://cal.com/rishmakes/coffee";
const MAX_PICTURES = 6;
/** Pictures are made smaller than this on their long side, so a message stays quick to send. */
const LONGEST = 1600;

/** Open feedback from anywhere: the button at the top, the Help menu, or the keys. */
export const askFeedback = () => window.dispatchEvent(new Event("duet:feedback"));

/** A picture of the Duet window as it is right now, before the feedback window covers it. */
async function pictureOfWindow(): Promise<string | null> {
  try {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.min(1, LONGEST / Math.max(w, h));
    return await toPng(document.body, { pixelRatio: ratio, width: w, height: h, cacheBust: false, skipFonts: true });
  } catch {
    return null;
  }
}

/** A picture file chosen or pasted by the person, made small enough to send. */
function shrink(file: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, LONGEST / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      done(c.toDataURL("image/png"));
    };
    img.onerror = fail;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Tell the creator what went wrong, or what you wish Duet did, in seconds. The keys work even with the
 * mouse busy. A picture of the window comes along by itself; more can be added. After sending, one
 * thing shows: book time with the creator.
 */
export default function Feedback() {
  const [open, setOpen] = useState(false);
  const [pictures, setPictures] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"writing" | "sending" | "sent" | "failed">("writing");
  const busy = useRef(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const start = async () => {
      if (busy.current) return;
      busy.current = true;
      const shot = await pictureOfWindow();
      setPictures(shot ? [shot] : []);
      setText("");
      setState("writing");
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        void start();
      }
    };
    window.addEventListener("duet:feedback", start);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("duet:feedback", start);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // keep the canvas shortcuts quiet while this is open
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape" && state !== "sending") close();
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) void add(files);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("paste", onPaste);
    };
  });

  const close = () => {
    setOpen(false);
    busy.current = false;
  };

  const add = async (files: Blob[]) => {
    const made = await Promise.all(files.map((f) => shrink(f).catch(() => null)));
    setPictures((p) => [...p, ...(made.filter(Boolean) as string[])].slice(0, MAX_PICTURES));
  };

  const send = async () => {
    setState("sending");
    try {
      const body = JSON.stringify({
        text,
        email: email.trim(),
        version: await getVersion().catch(() => ""),
        system: navigator.userAgent,
        pictures: pictures.map((p) => p.split(",")[1]),
      });
      // plain text, so the request goes straight through without a check first
      const res = await fetch(INBOX, { method: "POST", body, headers: { "Content-Type": "text/plain;charset=utf-8" } });
      const out = await res.json().catch(() => ({ ok: res.ok }));
      setState(out.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  };

  if (!open) return null;
  return (
    <div className="sheet-back" onPointerDown={(e) => e.target === e.currentTarget && state !== "sending" && close()}>
      <div className="sheet feedback">
        {state === "sent" ? (
          <>
            <div className="sheet-title">Thank you. Rish has it.</div>
            <p className="sheet-lead">
              Rish makes Duet and reads every message. Still stuck?{" "}
              <button className="feedback-talk" onClick={() => void openUrl(BOOK)}>
                Talk to Rish
              </button>{" "}
              on a free call.
            </p>
            <div className="sheet-actions">
              <button className="mini" onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="sheet-title">Feedback</div>
            <p className="sheet-lead">This goes straight to Rish, who makes Duet. Something odd, or something you wish Duet did? Say it in your own words. A picture of the window is already attached.</p>
            <textarea autoFocus value={text} placeholder="What happened, or what you want" onChange={(e) => setText(e.target.value)} />
            <div className="feedback-pics">
              {pictures.map((p, i) => (
                <span key={i} className="feedback-pic">
                  <img src={p} alt={`Picture ${i + 1}`} />
                  <button title="Take this picture away" onClick={() => setPictures((all) => all.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </span>
              ))}
              {pictures.length < MAX_PICTURES && (
                <button className="mini" onClick={() => picker.current?.click()}>
                  Add pictures
                </button>
              )}
              <input
                ref={picker}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void add([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </div>
            <input className="feedback-email" value={email} placeholder="Your email, if you want a reply" onChange={(e) => setEmail(e.target.value)} />
            {state === "failed" && <p className="sheet-lead feedback-why">It did not send. Check the internet connection and try again.</p>}
            <div className="sheet-actions">
              <button className="mini" disabled={state === "sending"} onClick={close}>
                Cancel
              </button>
              <button className="mini primary" disabled={state === "sending" || (!text.trim() && !pictures.length)} onClick={() => void send()}>
                {state === "sending" ? "Sending..." : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
