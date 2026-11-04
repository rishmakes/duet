import { useEffect, useState } from "react";
import { newId } from "../commands";
import { hasDesignSystem, liveAssets, liveComponents } from "../commands/designSystem";
import { componentsIn } from "../document/components";
import { worldPos } from "../document/geometry";
import type { TextStyle } from "../document/types";
import { currentDoc, dispatch, getState, select, useStore } from "../state/store";
import { loadKits, saveKit, useKits } from "../store/kits";
import { ColorPicker } from "./ColorPicker";
import Icon from "./Icons";

/** Pixel steps or numbers parsed from a comma-separated string. */
function parseNumbers(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function weightName(w: number | undefined): string {
  const weight = w ?? 400;
  if (weight <= 300) return "light";
  if (weight <= 400) return "regular";
  if (weight <= 500) return "medium";
  if (weight <= 600) return "semibold";
  return "bold";
}

function styleHint(s: TextStyle): string {
  return `${Math.round(s.fontSize)} px, ${weightName(s.fontWeight)}`;
}

function SaveKitRow({ defaultName, withSystem }: { defaultName: string; withSystem: boolean }) {
  const [name, setName] = useState(defaultName);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const handleSave = async () => {
    const res = await saveKit(currentDoc(), name.trim() || defaultName, withSystem);
    if ("error" in res) {
      setMsg({ text: res.error, isError: true });
    } else {
      setMsg({ text: "Saved. Use it in any project.", isError: false });
    }
  };

  return (
    <div className="kit-save-wrap">
      <div className="kit-save-row">
        <input
          type="text"
          className="kit-save-input"
          value={name}
          placeholder={defaultName}
          onChange={(e) => {
            setName(e.target.value);
            if (msg) setMsg(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void handleSave();
          }}
        />
        <button type="button" className="mini primary kit-save-btn" onClick={() => void handleSave()}>
          Save
        </button>
      </div>
      {msg && (
        <div className={`kit-save-msg ${msg.isError ? "error" : "success"}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

/** The components in this design. Click one to put a copy on the canvas. */
function place(componentId: string) {
  const doc = currentDoc();
  const main = doc.elements[componentId];
  if (!main) return;
  const sel = getState().selection;
  const parent = sel.length === 1 && doc.elements[sel[0]]?.type === "frame" && !doc.elements[sel[0]].component ? sel[0] : null;
  const wrap = document.querySelector(".canvas-wrap");
  const vp = getState().viewport;
  const cx = ((wrap?.clientWidth ?? 800) / 2 - vp.x) / vp.zoom;
  const cy = ((wrap?.clientHeight ?? 600) / 2 - vp.y) / vp.zoom;
  const origin = parent ? worldPos(doc, parent) : { x: 0, y: 0 };
  const id = newId("instance");
  dispatch("create_instance", {
    componentId,
    id,
    parentId: parent,
    x: Math.round(cx - main.width / 2 - origin.x),
    y: Math.round(cy - main.height / 2 - origin.y),
  });
  if (currentDoc().elements[id]) select([id]);
}

export default function AssetsPanel() {
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  const sel = useStore((s) => s.selection);

  const doc = currentDoc();
  const brand = doc.brand;

  const [picker, setPicker] = useState<{ id: string; at: DOMRect } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [voice, setVoice] = useState(brand?.voice ?? "");

  useEffect(() => {
    setVoice(brand?.voice ?? "");
  }, [brand?.voice]);

  const commitVoice = () => {
    const v = voice.trim();
    if (v !== (brand?.voice ?? "")) {
      dispatch("set_brand", { voice: v });
    }
  };

  const pickedEl = sel.length === 1 ? doc.elements[sel[0]] : null;
  const pickedFill =
    pickedEl?.fill && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pickedEl.fill.slice(0, 7))
      ? pickedEl.fill.slice(0, 7)
      : null;
  const hexToAdd = pickedFill ?? "#888888";

  const logoEl = brand?.logoId ? doc.elements[brand.logoId] : null;
  const list = componentsIn(doc);

  useEffect(() => {
    void loadKits();
  }, []);

  const savedKits = useKits();

  const brandAssets = liveAssets(doc);
  const uiComponents = liveComponents(doc);
  const textStylesList = Object.entries(doc.styles ?? {});

  const docSpacing = (doc.system?.spacing ?? []).join(", ");
  const docCorners = (doc.system?.corners ?? []).join(", ");

  const [spacingStr, setSpacingStr] = useState(docSpacing);
  const [cornersStr, setCornersStr] = useState(docCorners);

  useEffect(() => {
    setSpacingStr(docSpacing);
  }, [docSpacing]);

  useEffect(() => {
    setCornersStr(docCorners);
  }, [docCorners]);

  const commitSpacing = () => {
    const nums = parseNumbers(spacingStr);
    const current = doc.system?.spacing ?? [];
    const same = nums.length === current.length && nums.every((v, i) => v === current[i]);
    if (!same) {
      dispatch("set_design_system", { spacing: nums });
    }
  };

  const commitCorners = () => {
    const nums = parseNumbers(cornersStr);
    const current = doc.system?.corners ?? [];
    const same = nums.length === current.length && nums.every((v, i) => v === current[i]);
    if (!same) {
      dispatch("set_design_system", { corners: nums });
    }
  };

  const isSingleTextPicked = sel.length === 1 && pickedEl?.type === "text";

  return (
    <div className="skills">
      <div className="h">Brand kit</div>
      {!brand ? (
        <div className="brand-kit-empty">
          <div className="empty">Keep this project's colours, fonts, logo and voice in one place.</div>
          <button
            type="button"
            className="mini primary wide brand-make-btn-init"
            onClick={() => dispatch("make_brand_kit", {})}
          >
            Make from this design
          </button>
        </div>
      ) : (
        <>
          {brand.colours.map((c) => (
            <div key={c.id} className="skill brand-colour-row">
              <button
                type="button"
                className={`cswatch round ${picker?.id === c.id ? "open" : ""}`}
                data-cp={`brand-${c.id}`}
                title={`Change ${c.name}`}
                aria-label={`Change ${c.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setPicker(picker?.id === c.id ? null : { id: c.id, at: r });
                }}
              >
                <span style={{ background: c.hex }} />
              </button>
              <div className="grow">
                {editingId === c.id ? (
                  <input
                    className="brand-rename-input"
                    aria-label={`Rename ${c.name}`}
                    placeholder="Colour name"
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => {
                      if (editingName.trim() && editingName.trim() !== c.name) {
                        dispatch("change_brand_colour", { id: c.id, name: editingName.trim() });
                      }
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <div
                    className="brand-colour-name"
                    title="Double-click to rename"
                    onDoubleClick={() => {
                      setEditingId(c.id);
                      setEditingName(c.name);
                    }}
                  >
                    {c.name}
                  </div>
                )}
                <div className="hint2">{c.hex.toUpperCase()}</div>
              </div>
              <button
                type="button"
                className="brand-remove"
                title={`Remove ${c.name}`}
                aria-label={`Remove ${c.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (picker?.id === c.id) setPicker(null);
                  dispatch("remove_brand_colour", { id: c.id });
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}

          <button
            type="button"
            className="mini wide brand-add-colour"
            onClick={() => {
              dispatch("add_brand_colour", {
                name: `Colour ${brand.colours.length + 1}`,
                hex: hexToAdd,
              });
            }}
          >
            Add colour
          </button>

          <div className="brand-fonts">
            {brand.fonts.length > 0 ? `Fonts: ${brand.fonts.join(", ")}` : "Any font"}
          </div>

          <div className="brand-logo-section">
            <div className="brand-logo-row">
              <span className="brand-logo-label">Logo:</span>
              {logoEl ? (
                <button
                  type="button"
                  className="linkbtn brand-logo-name"
                  title="Select logo on canvas"
                  onClick={() => select([brand.logoId!])}
                >
                  {logoEl.name}
                </button>
              ) : (
                <span className="hint2">None</span>
              )}
            </div>
            {sel.length === 1 && (
              <button
                type="button"
                className="mini wide brand-logo-btn"
                onClick={() => dispatch("set_brand", { logoId: sel[0] })}
              >
                Use picked as logo
              </button>
            )}
          </div>

          <div className="brand-assets-section">
            <div className="brand-assets-label">Brand assets</div>
            {brandAssets.length === 0 && (
              <div className="hint2 brand-empty-hint">None</div>
            )}
            {brandAssets.map((id) => {
              const el = doc.elements[id];
              if (!el) return null;
              return (
                <div
                  key={id}
                  className="skill asset brand-asset-row"
                  onClick={() => place(id)}
                  title="Click to place a copy"
                >
                  <Icon name="component" size={14} className="ico" />
                  <div className="grow">
                    <div>{el.name}</div>
                    <div className="hint2">
                      {Math.round(el.width)} by {Math.round(el.height)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="brand-remove"
                    title={`Remove ${el.name}`}
                    aria-label={`Remove ${el.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch("change_brand_kit", {
                        assets: brandAssets.filter((a) => a !== id),
                      });
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              );
            })}
            {sel.length === 1 && !brandAssets.includes(sel[0]) && (
              <button
                type="button"
                className="mini wide brand-asset-btn"
                onClick={() =>
                  dispatch("change_brand_kit", {
                    assets: [...brandAssets, sel[0]],
                  })
                }
              >
                Make picked a brand asset
              </button>
            )}
          </div>

          <div className="brand-voice-row">
            <input
              type="text"
              className="brand-voice-input"
              value={voice}
              placeholder="How the brand speaks, in one line"
              title="How the brand speaks, in one line"
              aria-label="How the brand speaks, in one line"
              onChange={(e) => setVoice(e.target.value)}
              onBlur={commitVoice}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  commitVoice();
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setVoice(brand.voice ?? "");
                  e.currentTarget.blur();
                }
              }}
            />
          </div>

          <div className="skill brand-lock-row">
            <div className="n">
              <div>Keep the AI to this kit</div>
              <small>The AI can only use these colours and fonts.</small>
            </div>
            <button
              type="button"
              className={`sw ${brand.locked ? "on" : ""}`}
              role="switch"
              aria-label="Keep the AI to this kit"
              aria-checked={!!brand.locked}
              title="Keep the AI to this kit"
              onClick={() => dispatch("set_brand", { locked: !brand.locked })}
            />
          </div>

          <div className="brand-make-wrap">
            <button
              type="button"
              className="linkbtn brand-make-btn"
              onClick={() => dispatch("make_brand_kit", {})}
            >
              Make from this design
            </button>
          </div>

          <SaveKitRow defaultName="My brand kit" withSystem={false} />
        </>
      )}

      {picker && (
        <ColorPicker
          value={brand?.colours.find((c) => c.id === picker.id)?.hex ?? "#000000"}
          at={picker.at}
          tag={`brand-${picker.id}`}
          onCommit={(hex) => {
            dispatch("change_brand_colour", { id: picker.id, hex: hex.slice(0, 7) });
          }}
          onClose={() => setPicker(null)}
        />
      )}

      <div className="h brand-comp-head">Design system</div>
      {!hasDesignSystem(doc) ? (
        <div className="brand-kit-empty">
          <div className="empty">
            How your app or site screens are built: text styles, spacing, corners and UI components. It uses the brand kit's colours and fonts.
          </div>
          <button
            type="button"
            className="mini primary wide brand-make-btn-init"
            onClick={() => dispatch("make_design_system", {})}
          >
            Make from this design
          </button>
        </div>
      ) : (
        <>
          <div className="design-section">
            <div className="brand-assets-label">Text styles</div>
            {textStylesList.length === 0 && (
              <div className="hint2 brand-empty-hint">None</div>
            )}
            {textStylesList.map(([styleId, style]) => (
              <div key={styleId} className="skill design-style-row">
                <Icon name="text" size={14} className="ico" />
                <div className="grow">
                  <div>{style.name}</div>
                  <div className="hint2">{styleHint(style)}</div>
                </div>
                {isSingleTextPicked && (
                  <button
                    type="button"
                    className="mini design-use-btn"
                    title={`Use ${style.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch("apply_text_style", { ids: [sel[0]], styleId });
                    }}
                  >
                    Use
                  </button>
                )}
                <button
                  type="button"
                  className="brand-remove"
                  title={`Remove ${style.name}`}
                  aria-label={`Remove ${style.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch("set_design_system", { removeTextStyles: [style.name] });
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="design-field-row">
            <span className="design-field-label">Spacing</span>
            <input
              type="text"
              className="design-field-input"
              value={spacingStr}
              placeholder="4, 8, 16, 24"
              onChange={(e) => setSpacingStr(e.target.value)}
              onBlur={commitSpacing}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  commitSpacing();
                  e.currentTarget.blur();
                }
              }}
            />
          </div>

          <div className="design-field-row">
            <span className="design-field-label">Corners</span>
            <input
              type="text"
              className="design-field-input"
              value={cornersStr}
              placeholder="4, 8, 16, 24"
              onChange={(e) => setCornersStr(e.target.value)}
              onBlur={commitCorners}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  commitCorners();
                  e.currentTarget.blur();
                }
              }}
            />
          </div>

          <div className="design-section">
            <div className="brand-assets-label">UI components</div>
            {uiComponents.length === 0 && (
              <div className="hint2 brand-empty-hint">None</div>
            )}
            {uiComponents.map((id) => {
              const el = doc.elements[id];
              if (!el) return null;
              return (
                <div
                  key={id}
                  className="skill asset design-comp-row"
                  onClick={() => place(id)}
                  title="Click to place a copy"
                >
                  <Icon name="component" size={14} className="ico" />
                  <div className="grow">
                    <div>{el.name}</div>
                    <div className="hint2">
                      {Math.round(el.width)} by {Math.round(el.height)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="brand-remove"
                    title={`Remove ${el.name}`}
                    aria-label={`Remove ${el.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch("set_design_system", {
                        components: uiComponents.filter((c) => c !== id),
                      });
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              );
            })}
            {sel.length === 1 && !uiComponents.includes(sel[0]) && (
              <button
                type="button"
                className="mini wide brand-comp-btn"
                onClick={() =>
                  dispatch("set_design_system", {
                    components: [...uiComponents, sel[0]],
                  })
                }
              >
                Make picked a UI component
              </button>
            )}
          </div>

          <SaveKitRow defaultName="My design system" withSystem={true} />
        </>
      )}

      <div className="h brand-comp-head">Components</div>
      {list.length === 0 && (
        <div className="empty">
          Select anything, such as a logo, a picture, a button or a whole frame, and press Cmd Option K to make it a component. Then you can place as many copies as you like, and changing the original changes them all.
        </div>
      )}
      {list.map((c) => (
        <div key={c.id} className="skill asset" onClick={() => place(c.id)} title="Click to place a copy">
          <Icon name="component" size={14} className="ico" />
          <div className="grow">
            <div>{c.name}</div>
            <div className="hint2">
              {Math.round(c.width)} by {Math.round(c.height)}
            </div>
          </div>
          <span className="add-copy">Place</span>
        </div>
      ))}

      {savedKits.length > 0 && (
        <>
          <div className="h brand-comp-head">Use a kit</div>
          {savedKits.map((k) => (
            <div key={k.id} className="skill asset kit-use-row">
              <div className="grow">
                <div>{k.kit.name}</div>
                <div className="hint2">{k.kit.system ? "Design system" : "Brand kit"}</div>
              </div>
              <button
                type="button"
                className="mini primary kit-use-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch("use_kit", { kit: k.kit });
                }}
              >
                Use
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
