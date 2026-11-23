import { useEffect, useState } from "react";
import { cancelRest, restingAt } from "../ai/jobs";
import { useJobs } from "./ExportPage";

/** Every export is made and the computer sleeps or shuts down in a minute: say so over everything, with Cancel. */
export default function RestWarning() {
  useJobs();
  const resting = restingAt();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!resting) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [resting?.at]);
  if (!resting) return null;
  const left = Math.max(0, Math.ceil((resting.at - Date.now()) / 1000));
  const when = `in ${left} ${left === 1 ? "second" : "seconds"}`;
  return (
    <div className="rest-warning" data-name="rest-warning" role="alert">
      <span>
        Every export is made. Your computer {resting.what === "sleep" ? `sleeps ${when}` : `shuts down ${when}`}.
      </span>
      <button className="pill primary" data-name="rest-cancel" onClick={cancelRest} autoFocus>
        Cancel
      </button>
    </div>
  );
}
