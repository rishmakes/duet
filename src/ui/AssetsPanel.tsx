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
import { CUT_MOVE_NAMES } from "../document/moves";
import { CUT_MOVES } from "../document/types";
import type { CutMoveKind } from "../document/types";
import { sameLook } from "../document/captions";
import { CustomTile, applyStyle, useCaptionFonts, useCaptionStyle, useYourStyles } from "./CaptionLooks";
import Shelf from "./Shelf";
import { ASSETS_CHIPS, finds, shelfOn } from "./assetsFind";
import type { AssetsChip } from "./assetsFind";

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


/** Kits saved on this computer, to use in this project: brand kits under Brand kit, design systems under Design system. */
function UseKits({ system }: { system: boolean }) {
  const kits = useKits().filter((k) => !!k.kit.system === system);
  if (!kits.length) return null;
  return (
    <div className="brand-assets-section">
      <div className="brand-assets-label">Use a saved {system ? "design system" : "brand kit"}</div>
      {kits.map((k) => (
        <div key={k.id} className="skill asset kit-use-row">
          <div className="grow">{k.kit.name}</div>
          <button type="button" className="mini primary kit-use-btn" onClick={() => dispatch("use_kit", { kit: k.kit })}>
            Use
          </button>
        </div>
      ))}
    </div>
  );
}

/** This project's colours, fonts, logo, brand assets and voice. */
function BrandKit() {
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
  const brandAssets = liveAssets(doc);

  return (
    <>
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
          <div className="brand-palette">
            {brand.colours.map((c) => (
              <div key={c.id} className="brand-chip">
                <button
                  type="button"
                  className={`brand-swatch ${picker?.id === c.id ? "open" : ""}`}
                  data-cp={`brand-${c.id}`}
                  style={{ background: c.hex }}
                  title={`Change ${c.name}`}
                  aria-label={`Change ${c.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setPicker(picker?.id === c.id ? null : { id: c.id, at: r });
                  }}
                />
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
              className="brand-chip brand-add-colour"
              title="Add a colour"
              aria-label="Add colour"
              onClick={() => {
                dispatch("add_brand_colour", {
                  name: `Colour ${brand.colours.length + 1}`,
                  hex: hexToAdd,
                });
              }}
            >
              <span className="brand-swatch brand-swatch-add">+</span>
              <span className="hint2">Add colour</span>
            </button>
          </div>

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
      <UseKits system={false} />
    </>
  );
}

/** How this project's screens are built: text styles, spacing, corners and UI components. */
function DesignSystem() {
  const sel = useStore((s) => s.selection);
  const doc = currentDoc();
  const pickedEl = sel.length === 1 ? doc.elements[sel[0]] : null;
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
    <>
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
      <UseKits system={true} />
    </>
  );
}

/** The components in this design, each placed as a copy with a click. */
function Components({ list }: { list: ReturnType<typeof componentsIn> }) {
  return (
    <>
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
    </>
  );
}

/** A transition as a tile: it plays while the pointer is on it. */
function TransitionTile({ kind }: { kind: CutMoveKind }) {
  return (
    <div className="asset-tile" data-name={`asset-transition-${kind}`} title={CUT_MOVE_NAMES[kind]}>
      <span className={`asset-tile-face cut-preview cut-preview-${kind}`} aria-hidden="true" />
      <span className="asset-tile-name">{CUT_MOVE_NAMES[kind]}</span>
    </div>
  );
}

/**
 * Assets (#338): one library for everything ready-made. A search and chips at the top narrow it down;
 * below, shelves that fold shut: Transitions, Effects (coming soon, said only when opened), Your styles
 * (the same ones as in Captions), Brand kit, Design system and Components.
 */
export default function AssetsPanel() {
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  useCaptionFonts();
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<AssetsChip>("all");
  const { count, style } = useCaptionStyle();
  const yours = useYourStyles();

  useEffect(() => {
    void loadKits();
  }, []);

  const doc = currentDoc();
  const moves = CUT_MOVES.filter((k) => finds(query, CUT_MOVE_NAMES[k]));
  const styles = yours.filter((l) => finds(query, l.name));
  const comps = componentsIn(doc).filter((c) => finds(query, c.name));
  const brandFound = finds(query, "Brand kit", "colours", "fonts", "logo", ...(doc.brand?.colours.map((c) => c.name) ?? []), ...(doc.brand?.fonts ?? []));
  const systemFound = finds(query, "Design system", "text styles", "spacing", "corners", ...Object.values(doc.styles ?? {}).map((t) => t.name));
  const shown = {
    transitions: shelfOn("transitions", chip) && moves.length > 0,
    effects: shelfOn("effects", chip) && finds(query, "Effects"),
    yours: shelfOn("yours", chip) && (styles.length > 0 || !query.trim()),
    brand: shelfOn("brand", chip) && brandFound,
    system: shelfOn("system", chip) && systemFound,
    components: shelfOn("components", chip) && (comps.length > 0 || !query.trim()),
  };

  return (
    <div className="skills assets-panel" data-name="assets-panel">
      <label className="cut-find assets-find">
        <Icon name="search" size={13} />
        <input
          placeholder="Find transitions, styles, components…"
          value={query}
          data-name="assets-find"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>
      <div className="assets-chips">
        {ASSETS_CHIPS.map(([key, name]) => (
          <button key={key} type="button" className={`assets-chip${chip === key ? " on" : ""}`} data-name={`assets-chip-${key}`} aria-pressed={chip === key} onClick={() => setChip(key)}>
            {name}
          </button>
        ))}
      </div>
      {shown.transitions && (
        <Shelf name="assets-transitions" title="Transitions" count={moves.length}>
          <div className="asset-tiles">
            {moves.map((k) => (
              <TransitionTile key={k} kind={k} />
            ))}
          </div>
        </Shelf>
      )}
      {shown.effects && (
        <Shelf name="assets-effects" title="Effects" startsShut>
          <div className="assets-soon">Effects are coming soon.</div>
        </Shelf>
      )}
      {shown.yours && (
        <Shelf name="assets-yours" title="Your styles" count={styles.length}>
          {styles.length ? (
            <div className="asset-tiles">
              {styles.map((l) => (
                <CustomTile key={l.id} look={l} on={!!style && sameLook(style, l.props)} off={!count} apply={() => applyStyle(l)} />
              ))}
            </div>
          ) : (
            <div className="empty">Styles you save in Captions show here.</div>
          )}
        </Shelf>
      )}
      {shown.brand && (
        <Shelf name="assets-brand" title="Brand kit">
          <BrandKit />
        </Shelf>
      )}
      {shown.system && (
        <Shelf name="assets-system" title="Design system">
          <DesignSystem />
        </Shelf>
      )}
      {shown.components && (
        <Shelf name="assets-components" title="Components" count={comps.length}>
          <Components list={comps} />
        </Shelf>
      )}
      {!Object.values(shown).some(Boolean) && <div className="empty">Nothing here is called that.</div>}
    </div>
  );
}
