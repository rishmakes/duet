import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { check, type Update as Found } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { flushPack, inTauri, isCheckCopy } from "../project/project";

/**
 * A new version of Duet, offered once it is out. Duet looks a little after it opens, and again when the
 * designer asks from the Duet menu. Nothing installs without a yes. Work is written to its file first.
 */
export default function Update() {
  const [found, setFound] = useState<Found | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!inTauri()) return;
    const look = async (asked: boolean) => {
      // Duet dev is built from the code, so there is nothing to update it to
      if (isCheckCopy()) return asked && setNote("Duet dev is built from the code. Updates are for the installed app.");
      // the Microsoft Store brings new versions of its own copy
      if (await invoke<boolean>("store_copy").catch(() => false)) return asked && setNote("This Duet comes from the Microsoft Store, which keeps it up to date.");
      try {
        const next = await check();
        if (next) setFound(next);
        else if (asked) setNote("You have the newest Duet.");
      } catch (e) {
        if (asked) setNote(`Could not look for a new version. Check the internet connection. (${String(e)})`);
      }
    };
    const soon = setTimeout(() => void look(false), 8000);
    const onAsk = () => void look(true);
    window.addEventListener("duet:check-update", onAsk);
    return () => {
      clearTimeout(soon);
      window.removeEventListener("duet:check-update", onAsk);
    };
  }, []);

  const install = async () => {
    if (!found) return;
    setBusy("Saving your work...");
    await Promise.race([flushPack().catch(() => undefined), new Promise((done) => setTimeout(done, 4000))]);
    let got = 0;
    let size = 0;
    try {
      await found.downloadAndInstall((e) => {
        if (e.event === "Started") size = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          got += e.data.chunkLength;
          setBusy(size ? `Getting the new version... ${Math.round((got / size) * 100)}%` : "Getting the new version...");
        }
        if (e.event === "Finished") setBusy("Installing...");
      });
      setBusy("Opening the new Duet...");
      await relaunch();
    } catch (e) {
      setBusy(null);
      setNote(`The update did not finish. Your work is safe. Try again later, or download it from the website. (${String(e)})`);
      setFound(null);
    }
  };

  if (!found && !note) return null;
  return (
    <div className="sheet-back" onPointerDown={(e) => e.target === e.currentTarget && !busy && (setFound(null), setNote(null))}>
      <div className="sheet">
        <div className="sheet-title">{found ? `Duet ${found.version} is ready` : "Updates"}</div>
        {found ? (
          <>
            <p className="sheet-lead">{busy ?? "A new version is out. Install it now and Duet opens again where you left off. Your work is saved first."}</p>
            {!busy && found.body && <p className="sheet-lead update-notes">{found.body}</p>}
            {!busy && (
              <div className="sheet-actions">
                <button className="mini" onClick={() => setFound(null)}>
                  Later
                </button>
                <button className="mini primary" onClick={() => void install()}>
                  Install and restart
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="sheet-lead">{note}</p>
            <div className="sheet-actions">
              <button className="mini primary" onClick={() => setNote(null)}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
