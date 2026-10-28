import { useEffect, useRef, useState } from "react";
import { SHORTCUTS, keyText } from "./shortcuts";
import { BUILDER_TOOLS } from "../ai/builder";
import { AGENTS, useChat } from "../ai/chat";
import { busyOutside } from "../ai/outside";
import { toolName } from "../ai/who";
import { useStore } from "../state/store";
import { getVersion } from "@tauri-apps/api/app";
import { setLayout, useLayout } from "./layout";
import { ConnectAddon } from "./AddOns";

interface SettingsProps {
  check?: boolean;
  onClose: () => void;
}

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function matchShortcuts(
  shortcuts: typeof SHORTCUTS,
  query: string,
  mac: boolean
): typeof SHORTCUTS {
  const q = query.trim().toLowerCase();
  if (!q) return shortcuts;
  return shortcuts
    .map((g) => ({
      group: g.group,
      keys: g.keys.filter(([keys, what]) => {
        const displayed = keyText(keys, mac).toLowerCase();
        return (
          what.toLowerCase().includes(q) ||
          keys.toLowerCase().includes(q) ||
          displayed.includes(q)
        );
      }),
    }))
    .filter((g) => g.keys.length > 0);
}

export function matchGeneralRow(
  row: "ai" | "version",
  query: string,
  meta: { agentName?: string; version?: string }
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ("general".includes(q)) return true;
  if (row === "ai") {
    return (
      "ai tool:".includes(q) ||
      "ai tool".includes(q) ||
      Boolean(meta.agentName && meta.agentName.toLowerCase().includes(q))
    );
  }
  if (row === "version") {
    return (
      "duet version:".includes(q) ||
      "duet version".includes(q) ||
      Boolean(meta.version && meta.version.toLowerCase().includes(q)) ||
      "check for updates".includes(q) ||
      "updates".includes(q)
    );
  }
  return false;
}

export default function Settings({ check = false, onClose }: SettingsProps) {
  const [section, setSection] = useState<"Keyboard shortcuts" | "General" | "Add-ons" | "Developer">("Keyboard shortcuts");
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => void getVersion().then(setVersion).catch(() => undefined), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        if ((document.activeElement === searchRef.current || e.target === searchRef.current) && search) {
          e.preventDefault();
          setSearch("");
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, search]);

  const agent = useChat((s) => s.agent);
  const running = useChat((s) => s.running);
  const agentName = AGENTS.find((a) => a.id === agent)?.name ?? toolName(agent) ?? agent;
  const projectName = useStore((s) => s.project.name);

  const busy = busyOutside();
  const who = running
    ? (toolName(AGENTS.find((a) => a.id === agent)?.name) ?? toolName(agent) ?? agent)
    : busy
    ? (toolName(busy) ?? busy)
    : undefined;
  const workingNow = who ?? "No one";

  const sections = check ? (["Keyboard shortcuts", "General", "Add-ons", "Developer"] as const) : (["Keyboard shortcuts", "General", "Add-ons"] as const);
  const activeSection = section === "Developer" && !check ? "General" : section;

  const searching = Boolean(search.trim());
  const matchingShortcuts = searching ? matchShortcuts(SHORTCUTS, search, MAC) : [];
  const matchAiTool = searching && matchGeneralRow("ai", search, { agentName, version });
  const matchVersion = searching && matchGeneralRow("version", search, { agentName, version });
  const wheelZooms = useLayout((d) => d.wheelZooms);
  const matchWheel = searching && ["general", "mouse wheel zooms", "scroll", "zoom"].some((w) => w.includes(search.trim().toLowerCase()));
  const hasGeneralMatches = matchAiTool || matchVersion || matchWheel;
  const matchAddons = searching && ["add-ons", "addons", "connect to chatgpt and claude", "web"].some((w) => w.includes(search.trim().toLowerCase()));

  const q = search.trim().toLowerCase();
  const matchProject =
    check &&
    searching &&
    ("developer".includes(q) ||
      "open project:".includes(q) ||
      "open project".includes(q) ||
      Boolean(projectName && projectName.toLowerCase().includes(q)));
  const matchWho =
    check &&
    searching &&
    ("developer".includes(q) ||
      "who is working now:".includes(q) ||
      "who is working now".includes(q) ||
      Boolean(workingNow && workingNow.toLowerCase().includes(q)));
  const matchingTools =
    check && searching
      ? BUILDER_TOOLS.filter(
          (t) => "developer".includes(q) || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
        )
      : [];
  const hasDeveloperMatches = check && searching && (matchProject || matchWho || matchingTools.length > 0);

  return (
    <div className="settings-screen" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <header className={`settings-bar ${MAC ? "mac" : ""}`}>
        <button className="pill" onClick={onClose} title="Back (Esc)">
          ← Back
        </button>
        <span className="settings-title">Settings</span>
      </header>
      <main className="settings-main">
        <aside className="settings-left">
          <input
            ref={searchRef}
            className="settings-search"
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="settings-nav">
            {sections.map((s) => (
              <button
                key={s}
                className={`settings-nav-btn ${!searching && activeSection === s ? "active" : ""}`}
                onClick={() => {
                  setSearch("");
                  setSection(s);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </aside>
        <section className="settings-right">
          {searching ? (
            <div className="settings-content">
              {matchingShortcuts.length > 0 && (
                <>
                  <div className="settings-section-title">Keyboard shortcuts</div>
                  {matchingShortcuts.map((g) => (
                    <div key={g.group} className="shortcut-group">
                      <div className="settings-subtitle">{g.group}</div>
                      {g.keys.map(([keys, what]) => (
                        <div key={g.group + keys} className="shortcut-row">
                          <span>{what}</span>
                          <kbd>{keyText(keys, MAC)}</kbd>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}
              {hasGeneralMatches && (
                <>
                  <div className="settings-section-title">General</div>
                  {matchAiTool && (
                    <div className="settings-row">
                      <span>AI tool:</span> <b>{agentName}</b>
                    </div>
                  )}
                  {matchVersion && (
                    <div className="settings-row">
                      <span>Duet version:</span> <b>{version || "?"}</b>
                      <button
                        className="mini"
                        data-name="check-update"
                        onClick={() => {
                          onClose();
                          window.dispatchEvent(new Event("duet:check-update"));
                        }}
                      >
                        Check for updates
                      </button>
                    </div>
                  )}
                  {matchWheel && (
                    <label className="settings-row">
                      <span>Mouse wheel zooms</span>
                      <input type="checkbox" checked={wheelZooms} onChange={(e) => setLayout({ wheelZooms: e.target.checked })} />
                    </label>
                  )}
                </>
              )}
              {hasDeveloperMatches && (
                <>
                  <div className="settings-section-title">Developer</div>
                  {(matchProject || matchWho) && (
                    <div className="settings-meta">
                      {matchProject && (
                        <div className="settings-row">
                          <span>Open project:</span> <b>{projectName}</b>
                        </div>
                      )}
                      {matchWho && (
                        <div className="settings-row">
                          <span>Who is working now:</span> <b>{workingNow}</b>
                        </div>
                      )}
                    </div>
                  )}
                  {matchingTools.length > 0 && (
                    <>
                      <div className="settings-subtitle">Builder tools</div>
                      <div className="settings-tools-list">
                        {matchingTools.map((tool) => (
                          <div key={tool.name} className="settings-tool-row">
                            <span className="settings-tool-name">{tool.name}</span>
                            <span className="settings-tool-desc">{tool.description}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {matchAddons && (
                <>
                  <div className="settings-section-title">Add-ons</div>
                  <ConnectAddon />
                </>
              )}
              {!matchingShortcuts.length && !hasGeneralMatches && !hasDeveloperMatches && !matchAddons && (
                <div className="settings-empty">Nothing found</div>
              )}
            </div>
          ) : (
            <>
              {activeSection === "Keyboard shortcuts" && (
                <div className="settings-content">
                  <div className="settings-section-title">Keyboard shortcuts</div>
                  {SHORTCUTS.map((g) => (
                    <div key={g.group} className="shortcut-group">
                      <div className="settings-subtitle">{g.group}</div>
                      {g.keys.map(([keys, what]) => (
                        <div key={g.group + keys} className="shortcut-row">
                          <span>{what}</span>
                          <kbd>{keyText(keys, MAC)}</kbd>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {activeSection === "General" && (
                <div className="settings-content">
                  <div className="settings-section-title">General</div>
                  <div className="settings-row">
                    <span>AI tool:</span> <b>{agentName}</b>
                  </div>
                  <div className="settings-row">
                    <span>Duet version:</span> <b>{version || "?"}</b>
                    <button
                      className="mini"
                      data-name="check-update"
                      onClick={() => {
                        onClose();
                        window.dispatchEvent(new Event("duet:check-update"));
                      }}
                    >
                      Check for updates
                    </button>
                  </div>
                  <label className="settings-row">
                    <span>Mouse wheel zooms</span>
                    <input type="checkbox" checked={wheelZooms} onChange={(e) => setLayout({ wheelZooms: e.target.checked })} />
                  </label>
                </div>
              )}
              {activeSection === "Add-ons" && (
                <div className="settings-content">
                  <div className="settings-section-title">Add-ons</div>
                  <ConnectAddon />
                </div>
              )}
              {activeSection === "Developer" && check && (
                <div className="settings-content">
                  <div className="settings-section-title">Developer</div>
                  <div className="settings-meta">
                    <div className="settings-row">
                      <span>Open project:</span> <b>{projectName}</b>
                    </div>
                    <div className="settings-row">
                      <span>Who is working now:</span> <b>{workingNow}</b>
                    </div>
                  </div>
                  <div className="settings-subtitle">Builder tools</div>
                  <div className="settings-tools-list">
                    {BUILDER_TOOLS.map((tool) => (
                      <div key={tool.name} className="settings-tool-row">
                        <span className="settings-tool-name">{tool.name}</span>
                        <span className="settings-tool-desc">{tool.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
