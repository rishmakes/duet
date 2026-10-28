//! Photoshop files. A PSD comes in as pictures in layers, and a design goes out as one.
//! The reading and writing is done by photocraft-psd (MIT); this file only turns its layers
//! into what Duet draws, and Duet's drawn layers back into a file Photoshop opens.

use base64::Engine;
use photocraft_psd::descriptor::{Descriptor, Value, VersionedDescriptor};
use photocraft_psd::filter_effects::FilterEffects;
use photocraft_psd::tree::LayerNode;
use photocraft_psd::{
    BlendMode, GroupSpec, LayerRecord, LayerSpec, PixelData, PsdBuilder, PsdFile, RgbaImage, TaggedBlock,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// A drop shadow behind a picture layer.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PsdShadow {
    pub x: f32,
    pub y: f32,
    pub blur: f32,
    pub color: String,
}

/// Tone curves: light, red, green, blue. Each point is [input, output], 0 to 1.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PsdCurves {
    pub light: Vec<[f32; 2]>,
    pub red: Vec<[f32; 2]>,
    pub green: Vec<[f32; 2]>,
    pub blue: Vec<[f32; 2]>,
    pub hue_hue: Vec<[f32; 2]>,
    pub hue_sat: Vec<[f32; 2]>,
    pub hue_light: Vec<[f32; 2]>,
    pub light_sat: Vec<[f32; 2]>,
}

/// The colour of a picture: exposure, contrast, vibrance, hue, curves.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PsdGrade {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub temperature: f32,
    pub tint: f32,
    pub saturation: f32,
    pub vibrance: f32,
    pub look: String,
    pub look_amount: f32,
    pub hue: f32,
    pub vignette: f32,
    pub curves: PsdCurves,
    pub skin_keep: f32,
    pub skin_tone: f32,
    pub skin_light: f32,
}

impl PsdGrade {
    pub fn is_neutral(&self) -> bool {
        self.exposure == 0.0
            && self.contrast == 0.0
            && self.highlights == 0.0
            && self.shadows == 0.0
            && self.whites == 0.0
            && self.blacks == 0.0
            && self.temperature == 0.0
            && self.tint == 0.0
            && self.saturation == 0.0
            && self.vibrance == 0.0
            && (self.look.is_empty() || self.look_amount == 0.0)
            && self.hue == 0.0
            && self.vignette == 0.0
            && self.curves.light.is_empty()
            && self.curves.red.is_empty()
            && self.curves.green.is_empty()
            && self.curves.blue.is_empty()
    }
}

/// A live effect on a picture (blur, sharpen, grain, pixelate).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PsdEffect {
    pub id: String,
    pub kind: String,
    pub on: bool,
    pub values: BTreeMap<String, f32>,
}

/// One layer as Duet sees it. A group holds others; anything else is a picture.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PsdLayer {
    pub name: String,
    pub group: bool,
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
    /// 0 to 1.
    pub opacity: f32,
    /// Duet's name for how it mixes with what is under it.
    pub blend: String,
    pub hidden: bool,
    /// The picture as PNG, base64. Empty for a group.
    #[serde(default)]
    pub png: String,
    /// Bottom first, as Photoshop keeps them.
    #[serde(default)]
    pub children: Vec<PsdLayer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<PsdShadow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade: Option<PsdGrade>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<PsdEffect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect_mask_png: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PsdRead {
    pub width: u32,
    pub height: u32,
    /// Bottom first.
    pub layers: Vec<PsdLayer>,
    /// What came in as a picture but can only be changed in Photoshop: text, smart objects.
    pub flattened: Vec<String>,
    /// What Duet cannot show yet and left out: adjustment layers, layer effects, clipping.
    pub left_out: Vec<String>,
}

const DUET_BLENDS: [(&str, BlendMode); 8] = [
    ("normal", BlendMode::Normal),
    ("multiply", BlendMode::Multiply),
    ("screen", BlendMode::Screen),
    ("overlay", BlendMode::Overlay),
    ("soft-light", BlendMode::SoftLight),
    ("darken", BlendMode::Darken),
    ("lighten", BlendMode::Lighten),
    ("add", BlendMode::LinearDodge),
];

fn to_duet_blend(m: BlendMode) -> String {
    DUET_BLENDS.iter().find(|(_, b)| *b == m).map_or("normal", |(n, _)| n).to_string()
}

fn to_psd_blend(name: &str) -> BlendMode {
    DUET_BLENDS.iter().find(|(n, _)| *n == name).map_or(BlendMode::Normal, |(_, b)| *b)
}

const ADJUSTMENTS: [&[u8; 4]; 20] = [
    b"brit", b"CgEd", b"levl", b"curv", b"expA", b"vibA", b"hue2", b"blnc", b"blwh", b"phfl", b"mixr", b"clrL",
    b"nvrt", b"post", b"thrs", b"grdm", b"selc", b"SoCo", b"GdFl", b"PtFl",
];

fn be16(d: &[u8], at: usize) -> Option<u16> {
    d.get(at..at + 2).map(|b| u16::from_be_bytes([b[0], b[1]]))
}

fn bei16(d: &[u8], at: usize) -> Option<i16> {
    be16(d, at).map(|v| v as i16)
}

fn bef32(d: &[u8], at: usize) -> Option<f32> {
    d.get(at..at + 4).map(|b| f32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Integer(i) => Some(*i as f64),
        Value::Double(d) => Some(*d),
        Value::UnitFloat { value, .. } => Some(*value),
        _ => None,
    }
}

fn get_desc<'a>(d: &'a Descriptor, key: &str) -> Option<&'a Descriptor> {
    match d.get(key)? {
        Value::Descriptor(sub) => Some(sub),
        _ => None,
    }
}

fn text_of(d: &Descriptor, key: &str) -> Option<String> {
    match d.get(key)? {
        Value::Text(t) => Some(t.to_string_lossy()),
        _ => None,
    }
}

fn is_effect_enabled(d: &Descriptor) -> bool {
    d.get("enab") != Some(&Value::Boolean(false)) && d.get("present") != Some(&Value::Boolean(false))
}

fn parse_shadow_desc(d: &Descriptor) -> Option<PsdShadow> {
    let lagl = num(d.get("lagl")).unwrap_or(120.0);
    let dstn = num(d.get("Dstn")).unwrap_or(5.0);
    let blur = num(d.get("blur")).unwrap_or(5.0) as f32;
    let opct = num(d.get("Opct")).unwrap_or(75.0);

    let rad = (lagl as f64) * std::f64::consts::PI / 180.0;
    let x = (-dstn * rad.cos()).round() as f32;
    let y = (dstn * rad.sin()).round() as f32;

    let (r, g, b) = if let Some(clr) = get_desc(d, "Clr ") {
        if let Some(rf) = num(clr.get("redFloat")) {
            let gf = num(clr.get("greenFloat")).unwrap_or(0.0);
            let bf = num(clr.get("blueFloat")).unwrap_or(0.0);
            ((rf * 255.0).round() as u8, (gf * 255.0).round() as u8, (bf * 255.0).round() as u8)
        } else {
            let rd = num(clr.get("Rd  ")).unwrap_or(0.0).round().clamp(0.0, 255.0) as u8;
            let grn = num(clr.get("Grn ")).unwrap_or(0.0).round().clamp(0.0, 255.0) as u8;
            let bl = num(clr.get("Bl  ")).unwrap_or(0.0).round().clamp(0.0, 255.0) as u8;
            (rd, grn, bl)
        }
    } else {
        (0, 0, 0)
    };

    let alpha = (opct / 100.0).clamp(0.0, 1.0);
    let alpha_str = format!("{:.3}", alpha);
    let alpha_clean = alpha_str.trim_end_matches('0').trim_end_matches('.');
    let alpha_final = if alpha_clean.is_empty() { "0" } else { alpha_clean };
    let color = format!("rgba({r}, {g}, {b}, {alpha_final})");

    Some(PsdShadow { x, y, blur, color })
}

/// Extract first enabled Drop Shadow from `lfx2` / `lmfx`, and check if other styles exist.
fn extract_shadow(rec: &LayerRecord) -> (Option<PsdShadow>, bool) {
    let mut has_other_effects = rec.block(b"lrFX").is_some();
    let single = rec.block(b"lfx2").or_else(|| rec.block(b"lfxs"));
    let fx_block = rec.block(b"lmfx").or(single);
    let Some(block) = fx_block else {
        return (None, has_other_effects);
    };
    if block.data.len() < 4 {
        return (None, has_other_effects);
    }
    let Ok((vd, _)) = VersionedDescriptor::parse_prefix(&block.data[4..]) else {
        return (None, has_other_effects);
    };
    let d = &vd.descriptor;
    if d.get("masterFXSwitch") == Some(&Value::Boolean(false)) {
        return (None, false);
    }

    let mut first_shadow = None;
    let mut extra_shadows = false;

    if let Some(Value::List(list)) = d.get("dropShadowMulti") {
        for it in list {
            if let Value::Descriptor(sd) = it {
                if is_effect_enabled(sd) {
                    if first_shadow.is_none() {
                        first_shadow = parse_shadow_desc(sd);
                    } else {
                        extra_shadows = true;
                    }
                }
            }
        }
    }

    if first_shadow.is_none() {
        if let Some(Value::Descriptor(sd)) = d.get("DrSh") {
            if is_effect_enabled(sd) {
                first_shadow = parse_shadow_desc(sd);
            }
        }
    } else if let Some(Value::Descriptor(sd)) = d.get("DrSh") {
        if is_effect_enabled(sd) {
            extra_shadows = true;
        }
    }

    if extra_shadows {
        has_other_effects = true;
    }

    const OTHER_EFFECT_KEYS: [&str; 13] = [
        "FrFX", "frameFXMulti", "SoFi", "solidFillMulti", "GrFl", "gradientFillMulti", "OrGl", "IrSh",
        "innerShadowMulti", "IrGl", "ebbl", "ChFX", "patternFill",
    ];

    for key in OTHER_EFFECT_KEYS {
        if let Some(val) = d.get(key) {
            match val {
                Value::Descriptor(sub) => {
                    if is_effect_enabled(sub) {
                        has_other_effects = true;
                    }
                }
                Value::List(list) => {
                    for it in list {
                        if let Value::Descriptor(sub) = it {
                            if is_effect_enabled(sub) {
                                has_other_effects = true;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    (first_shadow, has_other_effects)
}

fn parse_hue_sat(data: &[u8]) -> Option<(f32, f32, f32)> {
    if data.len() < 16 {
        return None;
    }
    let version = be16(data, 0)?;
    if version != 2 {
        return None;
    }
    let colorize = *data.get(2)? != 0;
    if colorize {
        return None;
    }
    for i in 0..6 {
        let at = 16 + i * 14;
        let h = bei16(data, at + 8).unwrap_or(0);
        let s = bei16(data, at + 10).unwrap_or(0);
        let l = bei16(data, at + 12).unwrap_or(0);
        if h != 0 || s != 0 || l != 0 {
            return None;
        }
    }
    let hue = bei16(data, 10)? as f32;
    let sat = bei16(data, 12)? as f32;
    let light = bei16(data, 14)? as f32;
    Some((hue, sat, light))
}

fn parse_brightness_contrast(brit: Option<&TaggedBlock>, cged: Option<&TaggedBlock>) -> Option<(f32, f32, bool)> {
    if let Some(cged) = cged {
        if let Ok((vd, _)) = VersionedDescriptor::parse_prefix(&cged.data) {
            let d = &vd.descriptor;
            let cntr = num(d.get("Cntr")).unwrap_or(0.0) as f32;
            let brgh = num(d.get("Brgh")).unwrap_or(0.0) as f32;
            let legacy = matches!(d.get("useLegacy"), Some(Value::Boolean(true)));
            return Some((brgh, cntr, legacy));
        }
    }
    if let Some(brit) = brit {
        if brit.data.len() >= 4 {
            let brgh = bei16(&brit.data, 0)? as f32;
            let cntr = bei16(&brit.data, 2)? as f32;
            return Some((brgh, cntr, true));
        }
    }
    None
}

fn parse_exposure(data: &[u8]) -> Option<(f32, f32, f32)> {
    if data.len() < 14 {
        return None;
    }
    let version = be16(data, 0)?;
    if version != 1 {
        return None;
    }
    let exposure = bef32(data, 2)?;
    let offset = bef32(data, 6)?;
    let gamma = bef32(data, 10)?;
    Some((exposure, offset, gamma))
}

fn parse_vibrance(data: &[u8]) -> Option<(f32, f32)> {
    let (vd, _) = VersionedDescriptor::parse_prefix(data).ok()?;
    let d = &vd.descriptor;
    let vibrance = num(d.get("vibrance")).unwrap_or(0.0) as f32;
    let sat = num(d.get("Strt")).unwrap_or(0.0) as f32;
    Some((vibrance, sat))
}

fn parse_curves(data: &[u8]) -> Option<(Vec<[f32; 2]>, Vec<[f32; 2]>, Vec<[f32; 2]>, Vec<[f32; 2]>)> {
    let pencil = *data.first()? != 0;
    if pencil {
        return None;
    }
    let version = be16(data, 1)?;
    if version != 1 && version != 4 {
        return None;
    }
    let bits = u32::from_be_bytes(data.get(3..7)?.try_into().ok()?);
    let mut at = 7;
    let mut light = Vec::new();
    let mut red = Vec::new();
    let mut green = Vec::new();
    let mut blue = Vec::new();

    for bit in 0..32usize {
        if bits & (1 << bit) == 0 {
            continue;
        }
        let count = be16(data, at)? as usize;
        at += 2;
        let mut pts = Vec::with_capacity(count.min(16));
        for _ in 0..count {
            let out_y = be16(data, at)? as f32 / 255.0;
            let in_x = be16(data, at + 2)? as f32 / 255.0;
            at += 4;
            pts.push([in_x, out_y]);
        }
        match bit {
            0 => light = pts,
            1 => red = pts,
            2 => green = pts,
            3 => blue = pts,
            _ => return None,
        }
    }
    Some((light, red, green, blue))
}

fn try_apply_clipped_adjustment(
    rec: &LayerRecord,
    name: &str,
    target: &mut PsdLayer,
    out: &mut PsdRead,
) -> bool {
    let mut mapped = false;
    let grade = target.grade.get_or_insert_with(Default::default);

    if let Some(b) = rec.block(b"hue2") {
        if let Some((hue, sat, lightness)) = parse_hue_sat(&b.data) {
            grade.hue = (grade.hue + hue).clamp(-180.0, 180.0);
            grade.saturation = (grade.saturation + sat).clamp(-100.0, 100.0);
            if lightness != 0.0 {
                out.left_out.push(format!("{name} (Hue/Saturation lightness)"));
            }
            mapped = true;
        }
    } else if rec.block(b"brit").is_some() || rec.block(b"CgEd").is_some() {
        if let Some((brgh, cntr, legacy)) = parse_brightness_contrast(rec.block(b"brit"), rec.block(b"CgEd")) {
            grade.contrast = (grade.contrast + cntr).clamp(-100.0, 100.0);
            if legacy && brgh != 0.0 {
                out.left_out.push(format!("{name} (legacy brightness)"));
            } else {
                grade.exposure = (grade.exposure + brgh / 50.0).clamp(-5.0, 5.0);
            }
            mapped = true;
        }
    } else if let Some(b) = rec.block(b"expA") {
        if let Some((exp, off, gam)) = parse_exposure(&b.data) {
            grade.exposure = (grade.exposure + exp).clamp(-5.0, 5.0);
            if off != 0.0 || (gam - 1.0).abs() > 0.001 {
                out.left_out.push(format!("{name} (exposure offset or gamma)"));
            }
            mapped = true;
        }
    } else if let Some(b) = rec.block(b"vibA") {
        if let Some((vib, sat)) = parse_vibrance(&b.data) {
            grade.vibrance = (grade.vibrance + vib).clamp(-100.0, 100.0);
            grade.saturation = (grade.saturation + sat).clamp(-100.0, 100.0);
            mapped = true;
        }
    } else if let Some(b) = rec.block(b"curv") {
        if let Some((l, r, g, bl)) = parse_curves(&b.data) {
            if !l.is_empty() {
                grade.curves.light = l;
            }
            if !r.is_empty() {
                grade.curves.red = r;
            }
            if !g.is_empty() {
                grade.curves.green = g;
            }
            if !bl.is_empty() {
                grade.curves.blue = bl;
            }
            mapped = true;
        }
    }

    if mapped {
        if grade.is_neutral() {
            target.grade = None;
        }
        true
    } else {
        if grade.is_neutral() {
            target.grade = None;
        }
        false
    }
}

fn find_embedded_file(file: &PsdFile, target_uuid: &str) -> Option<Vec<u8>> {
    for block in file.global_blocks.iter().filter(|b| matches!(&b.key, b"lnk2" | b"lnk3" | b"lnkD")) {
        let data = &block.data;
        let mut at = 0;
        while at + 8 <= data.len() {
            let item_len = u64::from_be_bytes(data[at..at + 8].try_into().ok()?) as usize;
            at += 8;
            if at + item_len > data.len() {
                break;
            }
            let item = &data[at..at + item_len];
            at += item_len;
            at = at.next_multiple_of(4);

            if item.len() < 9 {
                continue;
            }
            if &item[..4] != b"liFD" {
                continue;
            }
            let uuid_len = item[8] as usize;
            if item.len() < 9 + uuid_len + 4 {
                continue;
            }
            let uuid = String::from_utf8_lossy(&item[9..9 + uuid_len]);
            let mut p = 9 + uuid_len;
            let file_name_len = u32::from_be_bytes(item[p..p + 4].try_into().ok()?) as usize;
            p += 4 + file_name_len * 2;
            p += 8; // file type + creator
            if p + 8 + 1 > item.len() {
                continue;
            }
            let data_len = u64::from_be_bytes(item[p..p + 8].try_into().ok()?) as usize;
            p += 8;
            let has_open_desc = item[p];
            p += 1;
            if has_open_desc != 0 {
                if let Ok((_, used)) = VersionedDescriptor::parse_prefix(&item[p..]) {
                    p += used;
                }
            }
            if p + data_len <= item.len() && uuid == target_uuid {
                return Some(item[p..p + data_len].to_vec());
            }
        }
    }
    None
}

fn gray_png_of(width: u32, height: u32, data: &[u8]) -> Result<String, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Grayscale);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().map_err(|e| e.to_string())?;
        w.write_image_data(data).map_err(|e| e.to_string())?;
    }
    Ok(b64().encode(out))
}

fn try_map_smart_filters(
    file: &PsdFile,
    rec: &LayerRecord,
    name: &str,
    out: &mut PsdRead,
) -> Option<(RgbaImage, i32, i32, u32, u32, Vec<PsdEffect>, Option<String>)> {
    let Some(sold_block) = rec.block(b"SoLd").or_else(|| rec.block(b"SoLE")) else {
        return None;
    };
    if !sold_block.data.starts_with(b"soLD") || sold_block.data.len() < 8 {
        out.flattened.push(format!("{name} (smart object: descriptor could not be read)"));
        return None;
    }
    let Ok((vd, _)) = VersionedDescriptor::parse_prefix(&sold_block.data[8..]) else {
        out.flattened.push(format!("{name} (smart object: descriptor could not be read)"));
        return None;
    };
    let d = &vd.descriptor;
    let Some(fx) = get_desc(d, "filterFX") else {
        out.flattened.push(format!("{name} (smart object: no smart filters)"));
        return None;
    };
    if fx.get("enab") == Some(&Value::Boolean(false)) {
        out.flattened.push(format!("{name} (smart object: smart filters turned off)"));
        return None;
    }
    let Some(Value::List(list)) = fx.get("filterFXList") else {
        out.flattened.push(format!("{name} (smart object: missing filter list)"));
        return None;
    };
    if list.is_empty() {
        out.flattened.push(format!("{name} (smart object: empty filter list)"));
        return None;
    }

    // Check transform: plain scale + move
    let Some(Value::List(trnf_pts)) = d.get("Trnf") else {
        out.flattened.push(format!("{name} (smart object: missing transform)"));
        return None;
    };
    if trnf_pts.len() != 8 {
        out.flattened.push(format!("{name} (smart object: corrupt transform)"));
        return None;
    }
    let p: Vec<f64> = trnf_pts.iter().filter_map(|v| num(Some(v))).collect();
    if p.len() != 8 {
        out.flattened.push(format!("{name} (smart object: corrupt transform points)"));
        return None;
    }

    let tol = 0.5;
    let axis_aligned = (p[3] - p[1]).abs() < tol
        && (p[5] - p[7]).abs() < tol
        && (p[6] - p[0]).abs() < tol
        && (p[4] - p[2]).abs() < tol
        && (p[2] - p[0]) > 0.0
        && (p[7] - p[1]) > 0.0;
    if !axis_aligned {
        out.flattened.push(format!("{name} (smart object: rotated or sheared)"));
        return None;
    }
    if let Some(non_aff) = d.get("nonAffineTransform") {
        let Value::List(pts) = non_aff else {
            out.flattened.push(format!("{name} (smart object: perspective transform)"));
            return None;
        };
        let np: Vec<f64> = pts.iter().filter_map(|v| num(Some(v))).collect();
        if np.len() != 8 || np.iter().zip(&p).any(|(a, b)| (a - b).abs() >= tol) {
            out.flattened.push(format!("{name} (smart object: perspective transform)"));
            return None;
        }
    }
    if let Some(warp) = get_desc(d, "quiltWarp").or_else(|| get_desc(d, "warp")) {
        if let Some(Value::Enumerated { value, .. }) = warp.get("warpStyle") {
            if !value.is("warpNone") {
                out.flattened.push(format!("{name} (smart object: warped)"));
                return None;
            }
        }
    }

    let left = p[0].round() as i32;
    let top = p[1].round() as i32;
    let width = (p[2] - p[0]).round().max(1.0) as u32;
    let height = (p[7] - p[1]).round().max(1.0) as u32;

    // Check filter mask
    let mut effect_mask_png = None;
    let mask_enabled = fx.get("filterMaskEnable") != Some(&Value::Boolean(false));
    if mask_enabled {
        if let Some(fe_block) = file.global_block(b"FEid").or_else(|| file.global_block(b"FXid")) {
            if let Ok(fe) = FilterEffects::parse(&fe_block.data) {
                let placed_id = text_of(d, "placed").unwrap_or_default();
                if let Some(item) = fe.items.iter().find(|it| it.id == placed_id) {
                    if let Some((mrect, mask_data)) = item.decoded_mask() {
                        let mw = (mrect.right - mrect.left).max(1) as usize;
                        let mh = (mrect.bottom - mrect.top).max(1) as usize;
                        let mut cropped = vec![255u8; (width * height) as usize];
                        let mut has_non_white = false;
                        for y in 0..height {
                            for x in 0..width {
                                let doc_x = left + x as i32;
                                let doc_y = top + y as i32;
                                let mx = doc_x - mrect.left;
                                let my = doc_y - mrect.top;
                                let val = if mx >= 0 && (mx as usize) < mw && my >= 0 && (my as usize) < mh {
                                    mask_data[(my as usize) * mw + (mx as usize)]
                                } else {
                                    255
                                };
                                if val < 255 {
                                    has_non_white = true;
                                }
                                cropped[(y * width + x) as usize] = val;
                            }
                        }
                        if has_non_white {
                            effect_mask_png = gray_png_of(width, height, &cropped).ok();
                        }
                    }
                }
            }
        }
    }

    // Check filters
    let mut effects = Vec::new();
    for it in list {
        let Value::Descriptor(item_desc) = it else {
            out.flattened.push(format!("{name} (smart object: corrupt filter descriptor)"));
            return None;
        };
        if item_desc.get("enab") == Some(&Value::Boolean(false)) {
            continue;
        }
        if let Some(opts) = get_desc(item_desc, "blendOptions") {
            let opct = num(opts.get("Opct")).unwrap_or(100.0);
            if (opct - 100.0).abs() > 0.01 {
                out.flattened.push(format!("{name} (smart object: filter opacity not 100%)"));
                return None;
            }
            if let Some(Value::Enumerated { value, .. }) = opts.get("Md  ") {
                if !value.is("Nrml") && !value.is("normal") {
                    out.flattened.push(format!("{name} (smart object: filter blend mode not supported)"));
                    return None;
                }
            }
        }
        let fltr = get_desc(item_desc, "Fltr");
        let class = fltr.map(|f| f.class_id.as_bytes()).unwrap_or(b"");
        let filter_id = num(item_desc.get("filterID")).unwrap_or(0.0) as i32;

        if class == b"GsnB" || filter_id == 1198747202 /* b"GsnB" */ {
            let rds = fltr.and_then(|f| num(f.get("Rds "))).unwrap_or(0.0) as f32;
            let amount = (rds / 0.4).round().clamp(0.0, 200.0);
            let mut vals = BTreeMap::new();
            vals.insert("amount".into(), amount);
            effects.push(PsdEffect { id: format!("effect-blur-{}", effects.len()), kind: "blur".into(), on: true, values: vals });
        } else if class == b"boxblur" || filter_id == 840 || filter_id == 628 {
            let rds = fltr.and_then(|f| num(f.get("Rds "))).unwrap_or(0.0) as f32;
            let amount = (rds / 0.4).round().clamp(0.0, 200.0);
            let mut vals = BTreeMap::new();
            vals.insert("amount".into(), amount);
            effects.push(PsdEffect { id: format!("effect-blur-{}", effects.len()), kind: "blur".into(), on: true, values: vals });
        } else if class == b"UnsM" || filter_id == 1433293645 /* b"UnsM" */ {
            let amnt = fltr.and_then(|f| num(f.get("Amnt "))).or_else(|| fltr.and_then(|f| num(f.get("Amnt")))).unwrap_or(50.0) as f32;
            let rds = fltr.and_then(|f| num(f.get("Rds "))).unwrap_or(1.0) as f32;
            let mut vals = BTreeMap::new();
            vals.insert("amount".into(), amnt.clamp(0.0, 100.0));
            vals.insert("radius".into(), rds.clamp(0.5, 10.0));
            effects.push(PsdEffect { id: format!("effect-sharpen-{}", effects.len()), kind: "sharpen".into(), on: true, values: vals });
        } else if class == b"smartSharpen" || filter_id == 1131 {
            let amnt = fltr.and_then(|f| num(f.get("Amnt"))).unwrap_or(50.0) as f32;
            let rds = fltr.and_then(|f| num(f.get("Rds "))).unwrap_or(1.0) as f32;
            let mut vals = BTreeMap::new();
            vals.insert("amount".into(), amnt.clamp(0.0, 100.0));
            vals.insert("radius".into(), rds.clamp(0.5, 10.0));
            effects.push(PsdEffect { id: format!("effect-sharpen-{}", effects.len()), kind: "sharpen".into(), on: true, values: vals });
        } else if class == b"AdNs" || filter_id == 1097092723 /* b"AdNs" */ {
            let noise = fltr.and_then(|f| num(f.get("Nose"))).unwrap_or(25.0) as f32;
            let mut vals = BTreeMap::new();
            vals.insert("amount".into(), noise.clamp(0.0, 100.0));
            vals.insert("size".into(), 1.0);
            effects.push(PsdEffect { id: format!("effect-grain-{}", effects.len()), kind: "grain".into(), on: true, values: vals });
        } else if class == b"Msc " || filter_id == 1299407648 /* b"Msc " */ {
            let clsz = fltr.and_then(|f| num(f.get("ClSz"))).unwrap_or(10.0) as f32;
            let mut vals = BTreeMap::new();
            vals.insert("size".into(), clsz.clamp(1.0, 100.0));
            effects.push(PsdEffect { id: format!("effect-pixelate-{}", effects.len()), kind: "pixelate".into(), on: true, values: vals });
        } else {
            let filter_name = text_of(item_desc, "Nm  ").unwrap_or_else(|| String::from_utf8_lossy(class).to_string());
            out.flattened.push(format!("{name} (smart object: unsupported filter {filter_name})"));
            return None;
        }
    }

    if effects.is_empty() {
        out.flattened.push(format!("{name} (smart object: no active filters)"));
        return None;
    }

    // Decode embedded file
    let Some(uuid) = text_of(d, "Idnt") else {
        out.flattened.push(format!("{name} (smart object: missing embedded link id)"));
        return None;
    };
    let Some(raw_bytes) = find_embedded_file(file, &uuid) else {
        out.flattened.push(format!("{name} (smart object: embedded file not found)"));
        return None;
    };
    let img = if raw_bytes.starts_with(b"8BPS") {
        let Some(emb) = PsdFile::from_bytes(&raw_bytes).ok() else {
            out.flattened.push(format!("{name} (smart object: embedded file corrupt)"));
            return None;
        };
        let Some(comp) = emb.composite_rgba8().ok() else {
            out.flattened.push(format!("{name} (smart object: embedded composite could not be decoded)"));
            return None;
        };
        comp
    } else if raw_bytes.starts_with(b"\x89PNG") {
        let Some(png) = decode_png_bytes(&raw_bytes).ok() else {
            out.flattened.push(format!("{name} (smart object: embedded PNG could not be decoded)"));
            return None;
        };
        png
    } else {
        out.flattened.push(format!("{name} (smart object: embedded file format not supported)"));
        return None;
    };

    Some((img, left, top, width, height, effects, effect_mask_png))
}

fn png_of(img: &RgbaImage) -> Result<String, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, img.width, img.height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().map_err(|e| e.to_string())?;
        w.write_image_data(&img.data).map_err(|e| e.to_string())?;
    }
    Ok(b64().encode(out))
}

/// A layer's own mask, folded into its see-through, so it looks as it did in Photoshop.
fn apply_mask(img: &mut RgbaImage, mask: &photocraft_psd::GrayImage) {
    for y in 0..img.height as i32 {
        for x in 0..img.width as i32 {
            let (dx, dy) = (img.left + x - mask.left, img.top + y - mask.top);
            let m = if dx >= 0 && dy >= 0 && (dx as u32) < mask.width && (dy as u32) < mask.height {
                mask.data[(dy as u32 * mask.width + dx as u32) as usize]
            } else {
                mask.default_value
            };
            let a = &mut img.data[((y as u32 * img.width + x as u32) * 4 + 3) as usize];
            *a = ((*a as u16 * m as u16 + 127) / 255) as u8;
        }
    }
}

fn read_nodes(file: &PsdFile, nodes: &[LayerNode], out: &mut PsdRead) -> Vec<PsdLayer> {
    let mut result = Vec::new();
    for node in nodes {
        match node {
            LayerNode::Group { children, .. } => {
                let rec = &file.layers()[node.index()];
                let layer = file.layer(node.index());
                let name = layer.map_or_else(String::new, |l| l.name());
                let base = PsdLayer {
                    name: name.clone(),
                    opacity: rec.opacity as f32 / 255.0,
                    blend: to_duet_blend(rec.blend_mode),
                    hidden: !rec.is_visible(),
                    ..Default::default()
                };
                let kids = read_nodes(file, children, out);
                if !kids.is_empty() {
                    result.push(PsdLayer { group: true, children: kids, ..base });
                }
            }
            LayerNode::Layer { .. } => {
                let rec = &file.layers()[node.index()];
                let Some(layer) = file.layer(node.index()) else { continue; };
                let name = layer.name();
                let base = PsdLayer {
                    name: name.clone(),
                    opacity: rec.opacity as f32 / 255.0,
                    blend: to_duet_blend(rec.blend_mode),
                    hidden: !rec.is_visible(),
                    ..Default::default()
                };

                let is_adj = ADJUSTMENTS.iter().any(|k| rec.block(k).is_some());
                if is_adj {
                    if rec.clipping != 0 {
                        let mapped = if let Some(prev) = result.last_mut().filter(|p| !p.group) {
                            try_apply_clipped_adjustment(rec, &name, prev, out)
                        } else {
                            false
                        };
                        if !mapped {
                            out.left_out.push(format!("{name} (adjustment or fill layer)"));
                        }
                    } else {
                        out.left_out.push(format!("{name} (adjustment or fill layer)"));
                    }
                    continue;
                }

                if rec.clipping != 0 {
                    out.left_out.push(format!("{name} (clipped to the layer below; it comes in unclipped)"));
                }

                let (shadow, has_other_effects) = extract_shadow(rec);
                if has_other_effects {
                    out.left_out.push(format!("{name} (layer effects)"));
                }

                if rec.block(b"TySh").is_some() || rec.block(b"tySh").is_some() {
                    out.flattened.push(format!("{name} (text)"));
                }

                let is_smart = rec.block(b"SoLd").is_some() || rec.block(b"PlLd").is_some() || rec.block(b"SoLE").is_some();
                let mut mapped_smart = None;
                if is_smart {
                    mapped_smart = try_map_smart_filters(file, rec, &name, out);
                    if mapped_smart.is_none() {
                        let already_noted_mask = out.flattened.iter().any(|s| s.starts_with(&format!("{name} (smart object")));
                        if !already_noted_mask {
                            out.flattened.push(format!("{name} (smart object)"));
                        }
                    }
                }

                let fill = rec.fill_opacity() as f32 / 255.0;

                if let Some((mut img, left, top, width, height, effects, effect_mask_png)) = mapped_smart {
                    if let Some(Ok(mask)) = layer.user_mask() {
                        apply_mask(&mut img, &mask);
                    }
                    let Ok(png) = png_of(&img) else { continue; };
                    result.push(PsdLayer {
                        left,
                        top,
                        width,
                        height,
                        opacity: base.opacity * fill,
                        png,
                        shadow,
                        effects,
                        effect_mask_png,
                        ..base
                    });
                } else {
                    let Some(mut img) = layer.rgba8().ok() else { continue; };
                    if img.width == 0 || img.height == 0 {
                        continue;
                    }
                    if let Some(Ok(mask)) = layer.user_mask() {
                        apply_mask(&mut img, &mask);
                    }
                    let Ok(png) = png_of(&img) else { continue; };
                    result.push(PsdLayer {
                        left: img.left,
                        top: img.top,
                        width: img.width,
                        height: img.height,
                        opacity: base.opacity * fill,
                        png,
                        shadow,
                        ..base
                    });
                }
            }
        }
    }
    result
}

pub fn read(bytes: &[u8]) -> Result<PsdRead, String> {
    let file = PsdFile::from_bytes(bytes).map_err(|e| format!("This Photoshop file could not be read: {e}"))?;
    let mut out = PsdRead {
        width: file.header.width,
        height: file.header.height,
        layers: Vec::new(),
        flattened: Vec::new(),
        left_out: Vec::new(),
    };
    let tree = file.layer_tree();
    out.layers = read_nodes(&file, &tree, &mut out);
    if out.layers.is_empty() {
        // a flat file, or one whose layers could not be read: the finished picture alone
        let img = file.composite_rgba8().map_err(|e| format!("This Photoshop file could not be read: {e}"))?;
        out.layers.push(PsdLayer {
            name: "Background".into(),
            width: img.width,
            height: img.height,
            opacity: 1.0,
            blend: "normal".into(),
            png: png_of(&img)?,
            ..Default::default()
        });
    }
    Ok(out)
}

fn decode_png_bytes(bytes: &[u8]) -> Result<RgbaImage, String> {
    let mut dec = png::Decoder::new(std::io::Cursor::new(bytes));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf.chunks(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf.chunks(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("Unexpected picture kind".into()),
    };
    Ok(RgbaImage { left: 0, top: 0, width: info.width, height: info.height, data: rgba })
}

fn decode_png(b: &str) -> Result<(u32, u32, Vec<u8>), String> {
    let bytes = b64().decode(b.trim()).map_err(|e| e.to_string())?;
    let img = decode_png_bytes(&bytes)?;
    Ok((img.width, img.height, img.data))
}

fn write_node(b: &mut PsdBuilder, l: &PsdLayer) -> Result<(), String> {
    let opacity = (l.opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
    if l.group {
        let mut g = GroupSpec::new(l.name.clone());
        // a group in Duet mixes as one picture only when it says so; otherwise what is inside mixes on its own
        g.blend_mode = if l.blend == "normal" { BlendMode::PassThrough } else { to_psd_blend(&l.blend) };
        g.opacity = opacity;
        g.visible = !l.hidden;
        b.begin_group(g);
        for c in &l.children {
            write_node(b, c)?;
        }
        b.end_group().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let (w, h, rgba) = decode_png(&l.png)?;
    let mut s = LayerSpec::new(l.name.clone(), l.left, l.top, w, h, PixelData::Rgba8(rgba));
    s.blend_mode = to_psd_blend(&l.blend);
    s.opacity = opacity;
    s.visible = !l.hidden;
    b.push_layer(s);
    Ok(())
}

/// Build a Photoshop file from layers, bottom first, and the finished picture Photoshop shows before it reads them.
pub fn write(width: u32, height: u32, layers: &[PsdLayer], composite_png: &str) -> Result<Vec<u8>, String> {
    let mut b = PsdBuilder::new(width, height).depth(8).resolution(72.0);
    for l in layers {
        write_node(&mut b, l)?;
    }
    if !composite_png.is_empty() {
        let (cw, ch, rgba) = decode_png(composite_png)?;
        if cw == width && ch == height {
            b.composite(PixelData::Rgba8(rgba));
        }
    }
    b.to_bytes().map_err(|e| format!("The Photoshop file could not be made: {e}"))
}

#[tauri::command(async)]
pub fn psd_read(path: String) -> Result<PsdRead, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    read(&bytes)
}

/// A Photoshop file dropped on the canvas, handed in as its bytes.
#[tauri::command(async)]
pub fn psd_read_bytes(request: tauri::ipc::Request<'_>) -> Result<PsdRead, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("That was not a Photoshop file.".into());
    };
    read(bytes)
}

#[tauri::command(async)]
pub fn psd_write(path: String, width: u32, height: u32, layers: Vec<PsdLayer>, composite: String) -> Result<(), String> {
    let bytes = write(width, height, &layers, &composite)?;
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Could not write {path}: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Could not save {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(name: &str, left: i32, rgba: [u8; 4], blend: &str) -> PsdLayer {
        let img = RgbaImage { left: 0, top: 0, width: 4, height: 4, data: rgba.repeat(16) };
        PsdLayer {
            name: name.into(),
            left,
            top: 2,
            width: 4,
            height: 4,
            opacity: 0.5,
            blend: blend.into(),
            png: png_of(&img).unwrap(),
            ..Default::default()
        }
    }

    #[test]
    fn a_design_goes_out_and_comes_back_as_the_same_layers() {
        let inner = PsdLayer {
            name: "Shapes".into(),
            group: true,
            opacity: 1.0,
            blend: "normal".into(),
            hidden: true,
            children: vec![square("Red", 1, [255, 0, 0, 255], "multiply"), square("Blue", 5, [0, 0, 255, 128], "screen")],
            ..Default::default()
        };
        let bg = RgbaImage { left: 0, top: 0, width: 10, height: 8, data: [255, 255, 255, 255].repeat(80) };
        let bytes = write(10, 8, &[square("Under", 0, [0, 255, 0, 255], "normal"), inner], &png_of(&bg).unwrap()).unwrap();

        let back = read(&bytes).unwrap();
        assert_eq!((back.width, back.height), (10, 8));
        assert_eq!(back.layers.len(), 2);
        assert_eq!(back.layers[0].name, "Under");
        let g = &back.layers[1];
        assert!(g.group && g.hidden);
        assert_eq!(g.name, "Shapes");
        let names: Vec<_> = g.children.iter().map(|c| (c.name.as_str(), c.blend.as_str(), c.left)).collect();
        assert_eq!(names, [("Red", "multiply", 1), ("Blue", "screen", 5)]);
        assert!((g.children[0].opacity - 0.5).abs() < 0.01);
        let (_, _, px) = decode_png(&g.children[1].png).unwrap();
        assert_eq!(&px[..4], &[0, 0, 255, 128]);
        assert!(back.flattened.is_empty() && back.left_out.is_empty());
    }

    #[test]
    fn drop_shadow_angle_convention_and_sign() {
        // Photoshop lagl angle is clockwise from negative X (light pointing towards element from angle)
        // lagl = 120 deg: light from top-left, shadow casts bottom-right (x > 0, y > 0).
        let px = |v: f64| Value::UnitFloat { unit: *b"#Pxl", value: v };
        let clr = Descriptor::new("RGBC").with("Rd  ", Value::Double(0.0)).with("Grn ", Value::Double(0.0)).with("Bl  ", Value::Double(0.0));
        let make_drsh = |angle: f64, dist: f64| {
            Descriptor::new("DrSh")
                .with("enab", Value::Boolean(true))
                .with("Clr ", Value::Descriptor(clr.clone()))
                .with("Opct", Value::UnitFloat { unit: *b"#Prc", value: 75.0 })
                .with("lagl", Value::UnitFloat { unit: *b"#Ang", value: angle })
                .with("Dstn", px(dist))
                .with("blur", px(4.0))
        };

        // 120 degrees: x = -10 * cos(120) = 5, y = 10 * sin(120) = 9
        let s120 = parse_shadow_desc(&make_drsh(120.0, 10.0)).unwrap();
        assert_eq!(s120.x, 5.0);
        assert_eq!(s120.y, 9.0);
        assert_eq!(s120.blur, 4.0);
        assert_eq!(s120.color, "rgba(0, 0, 0, 0.75)");

        // 90 degrees: light from directly above, shadow straight down (x = 0, y = 10)
        let s90 = parse_shadow_desc(&make_drsh(90.0, 10.0)).unwrap();
        assert_eq!(s90.x, 0.0);
        assert_eq!(s90.y, 10.0);

        // 0 degrees: light from 3 o'clock (right), shadow casts left (x = -10, y = 0)
        let s0 = parse_shadow_desc(&make_drsh(0.0, 10.0)).unwrap();
        assert_eq!(s0.x, -10.0);
        assert_eq!(s0.y, 0.0);

        // 180 degrees: light from 9 o'clock (left), shadow casts right (x = 10, y = 0)
        let s180 = parse_shadow_desc(&make_drsh(180.0, 10.0)).unwrap();
        assert_eq!(s180.x, 10.0);
        assert_eq!(s180.y, 0.0);

        // -90 degrees: light from 6 o'clock (below), shadow straight up (x = 0, y = -10)
        let s_minus90 = parse_shadow_desc(&make_drsh(-90.0, 10.0)).unwrap();
        assert_eq!(s_minus90.x, 0.0);
        assert_eq!(s_minus90.y, -10.0);
    }

    #[test]
    fn drop_shadow_parsed_live_from_lfx2_and_other_styles_noted() {
        let px = |v: f64| Value::UnitFloat { unit: *b"#Pxl", value: v };
        let clr = Descriptor::new("RGBC").with("Rd  ", Value::Double(255.0)).with("Grn ", Value::Double(0.0)).with("Bl  ", Value::Double(128.0));
        let shadow = Descriptor::new("DrSh")
            .with("enab", Value::Boolean(true))
            .with("Clr ", Value::Descriptor(clr))
            .with("Opct", Value::UnitFloat { unit: *b"#Prc", value: 50.0 })
            .with("lagl", Value::UnitFloat { unit: *b"#Ang", value: 120.0 })
            .with("Dstn", px(6.0))
            .with("blur", px(8.0));

        let root_only_shadow = Descriptor::new("null")
            .with("masterFXSwitch", Value::Boolean(true))
            .with("DrSh", Value::Descriptor(shadow.clone()));
        let mut lfx2_data = 0u32.to_be_bytes().to_vec();
        lfx2_data.extend(VersionedDescriptor::new(root_only_shadow).to_bytes());

        let mut spec1 = LayerSpec::new("ShadowOnly", 0, 0, 4, 4, PixelData::Rgba8(vec![255; 64]));
        spec1.extra_blocks.push(TaggedBlock::new(*b"lfx2", lfx2_data));

        // Layer with shadow AND stroke (FrFX)
        let stroke = Descriptor::new("FrFX")
            .with("enab", Value::Boolean(true))
            .with("Sz  ", px(2.0));
        let root_with_stroke = Descriptor::new("null")
            .with("masterFXSwitch", Value::Boolean(true))
            .with("DrSh", Value::Descriptor(shadow))
            .with("FrFX", Value::Descriptor(stroke));
        let mut lmfx_data = 0u32.to_be_bytes().to_vec();
        lmfx_data.extend(VersionedDescriptor::new(root_with_stroke).to_bytes());

        let mut spec2 = LayerSpec::new("ShadowAndStroke", 5, 0, 4, 4, PixelData::Rgba8(vec![255; 64]));
        spec2.extra_blocks.push(TaggedBlock::new(*b"lmfx", lmfx_data));

        let mut b = PsdBuilder::new(10, 10);
        b.push_layer(spec1);
        b.push_layer(spec2);
        let bytes = b.to_bytes().unwrap();

        let read_result = read(&bytes).unwrap();
        assert_eq!(read_result.layers.len(), 2);

        // Layer 1: shadow live, NO note in left_out
        let l1 = &read_result.layers[0];
        assert_eq!(l1.name, "ShadowOnly");
        assert_eq!(l1.shadow, Some(PsdShadow { x: 3.0, y: 5.0, blur: 8.0, color: "rgba(255, 0, 128, 0.5)".into() }));

        // Layer 2: shadow live, AND left_out contains layer effects note
        let l2 = &read_result.layers[1];
        assert_eq!(l2.name, "ShadowAndStroke");
        assert_eq!(l2.shadow, Some(PsdShadow { x: 3.0, y: 5.0, blur: 8.0, color: "rgba(255, 0, 128, 0.5)".into() }));
        assert_eq!(read_result.left_out, vec!["ShadowAndStroke (layer effects)"]);
    }

    #[test]
    fn clipped_adjustments_mapped_to_picture_grade() {
        let base_spec = LayerSpec::new("Picture", 0, 0, 4, 4, PixelData::Rgba8(vec![128; 64]));

        // Clipped Exposure: exp = 1.5
        let mut exp_data = vec![0, 1];
        exp_data.extend(1.5f32.to_be_bytes());
        exp_data.extend(0.0f32.to_be_bytes()); // offset
        exp_data.extend(1.0f32.to_be_bytes()); // gamma
        let mut exp_spec = LayerSpec::new("Exposure 1", 0, 0, 0, 0, PixelData::Rgba8(vec![]));
        exp_spec.clipping = true;
        exp_spec.extra_blocks.push(TaggedBlock::new(*b"expA", exp_data));

        // Clipped Vibrance: vib = 30.0, sat = -10.0
        let vib_desc = Descriptor::new("null")
            .with("vibrance", Value::Double(30.0))
            .with("Strt", Value::Double(-10.0));
        let vib_data = VersionedDescriptor::new(vib_desc).to_bytes();
        let mut vib_spec = LayerSpec::new("Vibrance 1", 0, 0, 0, 0, PixelData::Rgba8(vec![]));
        vib_spec.clipping = true;
        vib_spec.extra_blocks.push(TaggedBlock::new(*b"vibA", vib_data));

        // Clipped Brightness/Contrast: contrast = 25.0, brightness = 50.0 (50 brightness = 1 stop exposure)
        let cged_desc = Descriptor::new("null")
            .with("Cntr", Value::Double(25.0))
            .with("Brgh", Value::Double(50.0))
            .with("useLegacy", Value::Boolean(false));
        let cged_data = VersionedDescriptor::new(cged_desc).to_bytes();
        let mut brit_spec = LayerSpec::new("Brightness 1", 0, 0, 0, 0, PixelData::Rgba8(vec![]));
        brit_spec.clipping = true;
        brit_spec.extra_blocks.push(TaggedBlock::new(*b"brit", vec![0, 0, 0, 0]));
        brit_spec.extra_blocks.push(TaggedBlock::new(*b"CgEd", cged_data));

        let mut b = PsdBuilder::new(10, 10);
        b.push_layer(base_spec);
        b.push_layer(exp_spec);
        b.push_layer(vib_spec);
        b.push_layer(brit_spec);
        let bytes = b.to_bytes().unwrap();

        let read_result = read(&bytes).unwrap();
        assert_eq!(read_result.layers.len(), 1);
        let pic = &read_result.layers[0];
        assert_eq!(pic.name, "Picture");

        let grade = pic.grade.as_ref().expect("Picture should have a grade");
        // Exposure 1.5 + 50/50 brightness (1.0) = 2.5 exposure
        assert!((grade.exposure - 2.5).abs() < 1e-4);
        assert!((grade.contrast - 25.0).abs() < 1e-4);
        assert!((grade.vibrance - 30.0).abs() < 1e-4);
        assert!((grade.saturation - -10.0).abs() < 1e-4);
        assert!(read_result.left_out.is_empty());
    }

    #[test]
    fn clipped_curves_and_hue_sat() {
        let base_spec = LayerSpec::new("Base", 0, 0, 4, 4, PixelData::Rgba8(vec![128; 64]));

        // Clipped Curves: composite light curve and red channel curve
        let mut curv_data = vec![0, 0, 1]; // pencil=0, version=1
        curv_data.extend(0b0011u32.to_be_bytes()); // bits 0 (master) and 1 (red)
        // Master curve: 2 points: (0, 0) and (255, 200)
        curv_data.extend(2u16.to_be_bytes());
        curv_data.extend(0u16.to_be_bytes()); // out 0
        curv_data.extend(0u16.to_be_bytes()); // in 0
        curv_data.extend(200u16.to_be_bytes()); // out 200
        curv_data.extend(255u16.to_be_bytes()); // in 255
        // Red curve: 2 points: (0, 20) and (255, 255)
        curv_data.extend(2u16.to_be_bytes());
        curv_data.extend(20u16.to_be_bytes()); // out 20
        curv_data.extend(0u16.to_be_bytes()); // in 0
        curv_data.extend(255u16.to_be_bytes()); // out 255
        curv_data.extend(255u16.to_be_bytes()); // in 255
        let mut curv_spec = LayerSpec::new("Curves 1", 0, 0, 0, 0, PixelData::Rgba8(vec![]));
        curv_spec.clipping = true;
        curv_spec.extra_blocks.push(TaggedBlock::new(*b"curv", curv_data));

        // Clipped Hue/Saturation: master hue = 40, sat = -15, lightness = 10 (lightness should be noted)
        let mut hue_data = vec![0, 2, 0, 0]; // version 2, colorize 0, pad 0
        hue_data.extend(&[0; 6]); // colorize h/s/l
        hue_data.extend(40i16.to_be_bytes());
        hue_data.extend((-15i16).to_be_bytes());
        hue_data.extend(10i16.to_be_bytes());
        hue_data.extend(&[0; 6 * 14]); // 6 clean zero ranges
        let mut hue_spec = LayerSpec::new("HueSat 1", 0, 0, 0, 0, PixelData::Rgba8(vec![]));
        hue_spec.clipping = true;
        hue_spec.extra_blocks.push(TaggedBlock::new(*b"hue2", hue_data));

        let mut b = PsdBuilder::new(10, 10);
        b.push_layer(base_spec);
        b.push_layer(curv_spec);
        b.push_layer(hue_spec);
        let bytes = b.to_bytes().unwrap();

        let read_result = read(&bytes).unwrap();
        assert_eq!(read_result.layers.len(), 1);
        let pic = &read_result.layers[0];
        let grade = pic.grade.as_ref().unwrap();
        assert_eq!(grade.hue, 40.0);
        assert_eq!(grade.saturation, -15.0);
        assert_eq!(grade.curves.light.len(), 2);
        assert_eq!(grade.curves.red.len(), 2);
        // Lightness had no clean exposure mapping, so it is noted
        assert_eq!(read_result.left_out, vec!["HueSat 1 (Hue/Saturation lightness)"]);
    }

    #[test]
    fn unclipped_or_unclean_adjustments_remain_left_out() {
        let base_spec = LayerSpec::new("Photo", 0, 0, 4, 4, PixelData::Rgba8(vec![128; 64]));

        // Unclipped Exposure (clipping = false)
        let mut exp_data = vec![0, 1];
        exp_data.extend(1.0f32.to_be_bytes());
        exp_data.extend(0.0f32.to_be_bytes());
        exp_data.extend(1.0f32.to_be_bytes());
        let mut exp_spec = LayerSpec::new("UnclippedExp", 0, 0, 0, 0, PixelData::Rgba8(vec![]));
        exp_spec.clipping = false;
        exp_spec.extra_blocks.push(TaggedBlock::new(*b"expA", exp_data));

        // Clipped Hue/Sat with Colorize (no clean mapping)
        let mut colorize_data = vec![0, 2, 1, 0]; // colorize = 1
        colorize_data.extend(&[0; 6]);
        colorize_data.extend(50i16.to_be_bytes());
        colorize_data.extend(30i16.to_be_bytes());
        colorize_data.extend(0i16.to_be_bytes());
        colorize_data.extend(&[0; 6 * 14]);
        let mut col_spec = LayerSpec::new("ColorizeLayer", 0, 0, 0, 0, PixelData::Rgba8(vec![]));
        col_spec.clipping = true;
        col_spec.extra_blocks.push(TaggedBlock::new(*b"hue2", colorize_data));

        let mut b = PsdBuilder::new(10, 10);
        b.push_layer(base_spec);
        b.push_layer(exp_spec);
        b.push_layer(col_spec);
        let bytes = b.to_bytes().unwrap();

        let read_result = read(&bytes).unwrap();
        assert_eq!(read_result.layers.len(), 1);
        let pic = &read_result.layers[0];
        assert!(pic.grade.is_none());
        assert_eq!(
            read_result.left_out,
            vec!["UnclippedExp (adjustment or fill layer)", "ColorizeLayer (adjustment or fill layer)"]
        );
    }

    fn make_test_lnk2(uuid: &str, file_name: &str, file_bytes: &[u8]) -> Vec<u8> {
        let mut item = Vec::new();
        item.extend_from_slice(b"liFD");
        item.extend_from_slice(&7u32.to_be_bytes()); // version
        item.push(uuid.len() as u8);
        item.extend_from_slice(uuid.as_bytes());
        let name_units: Vec<u16> = file_name.encode_utf16().collect();
        item.extend_from_slice(&(name_units.len() as u32).to_be_bytes());
        for u in name_units {
            item.extend_from_slice(&u.to_be_bytes());
        }
        item.extend_from_slice(b"8BPS8BIM"); // file type + creator
        item.extend_from_slice(&(file_bytes.len() as u64).to_be_bytes());
        item.push(0); // no open descriptor
        item.extend_from_slice(file_bytes);

        let item_len = item.len() as u64;
        let mut out = Vec::new();
        out.extend_from_slice(&item_len.to_be_bytes());
        out.extend_from_slice(&item);
        let pad = (4 - (out.len() % 4)) % 4;
        out.extend(std::iter::repeat_n(0u8, pad));
        out
    }

    #[test]
    fn smart_filters_live_effects_with_unfiltered_picture() {
        let embedded_psd = {
            let mut eb = PsdBuilder::new(8, 8);
            eb.push_layer(LayerSpec::new("SourceLayer", 0, 0, 8, 8, PixelData::Rgba8(vec![100; 256])));
            eb.composite(PixelData::Rgba8(vec![100; 256]));
            eb.to_bytes().unwrap()
        };

        let uuid = "test-smart-uuid-1";
        let lnk2_data = make_test_lnk2(uuid, "embedded.psd", &embedded_psd);

        let px = |v: f64| Value::UnitFloat { unit: *b"#Pxl", value: v };
        let gsn_filter = Descriptor::new("GsnB").with("Rds ", px(4.0));
        let filter_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Gaussian Blur...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(1198747202))
            .with("Fltr", Value::Descriptor(gsn_filter));

        let fx_style = Descriptor::new("filterFXStyle")
            .with("enab", Value::Boolean(true))
            .with("filterMaskEnable", Value::Boolean(true))
            .with("filterFXList", Value::List(vec![Value::Descriptor(filter_item)]));

        // Scale 100%, placed at x=5, y=10
        let trnf = Value::List(vec![
            Value::Double(5.0),
            Value::Double(10.0),
            Value::Double(13.0),
            Value::Double(10.0),
            Value::Double(13.0),
            Value::Double(18.0),
            Value::Double(5.0),
            Value::Double(18.0),
        ]);

        let sold_desc = Descriptor::new("null")
            .with("Idnt", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul(uuid)))
            .with("placed", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("instance-1")))
            .with("Trnf", trnf)
            .with("filterFX", Value::Descriptor(fx_style));

        let mut sold_data = b"soLD".to_vec();
        sold_data.extend(16u32.to_be_bytes());
        sold_data.extend(VersionedDescriptor::new(sold_desc).to_bytes());

        let mut smart_layer = LayerSpec::new("SmartBlur", 5, 10, 8, 8, PixelData::Rgba8(vec![200; 256]));
        smart_layer.extra_blocks.push(TaggedBlock::new(*b"SoLd", sold_data));

        let mut b = PsdBuilder::new(20, 20);
        b.push_layer(smart_layer);
        let mut file = PsdFile::from_bytes(&b.to_bytes().unwrap()).unwrap();
        file.global_blocks.push(TaggedBlock::new(*b"lnk2", lnk2_data));
        let final_bytes = file.to_bytes().unwrap();

        let read_result = read(&final_bytes).unwrap();
        assert_eq!(read_result.layers.len(), 1);
        let layer = &read_result.layers[0];
        assert_eq!(layer.name, "SmartBlur");
        assert_eq!(layer.left, 5);
        assert_eq!(layer.top, 10);
        assert_eq!(layer.width, 8);
        assert_eq!(layer.height, 8);
        assert_eq!(layer.effects.len(), 1);
        assert_eq!(layer.effects[0].kind, "blur");
        // radius 4.0 / 0.4 = 10.0 amount
        assert_eq!(layer.effects[0].values.get("amount"), Some(&10.0));
        // Source pixels decoded from unfiltered composite (value ~100), not baked layer (value 200)
        let (_, _, px) = decode_png(&layer.png).unwrap();
        assert!((px[0] as i32 - 100).abs() <= 1);
        assert!(read_result.flattened.is_empty());
    }

    #[test]
    fn smart_filters_all_supported_kinds() {
        let embedded_psd = {
            let mut eb = PsdBuilder::new(8, 8);
            eb.push_layer(LayerSpec::new("Src", 0, 0, 8, 8, PixelData::Rgba8(vec![100; 256])));
            eb.composite(PixelData::Rgba8(vec![100; 256]));
            eb.to_bytes().unwrap()
        };
        let uuid = "test-all-fx-uuid";
        let lnk2_data = make_test_lnk2(uuid, "embedded.psd", &embedded_psd);

        let px = |v: f64| Value::UnitFloat { unit: *b"#Pxl", value: v };
        let pct = |v: f64| Value::UnitFloat { unit: *b"#Prc", value: v };

        // Box Blur (840): radius 6.0 -> blur amount = 6.0 / 0.4 = 15.0
        let box_filter = Descriptor::new("boxblur").with("Rds ", px(6.0));
        let box_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Box Blur...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(840))
            .with("Fltr", Value::Descriptor(box_filter));

        // Unsharp Mask (1433293645): amount 80%, radius 1.5px -> sharpen amount=80, radius=1.5
        let unsm_filter = Descriptor::new("UnsM").with("Amnt", pct(80.0)).with("Rds ", px(1.5)).with("Thsh", Value::Integer(0));
        let unsm_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Unsharp Mask...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(1433293645))
            .with("Fltr", Value::Descriptor(unsm_filter));

        // Smart Sharpen (1131): amount 60%, radius 2.0px -> sharpen amount=60, radius=2.0
        let smt_filter = Descriptor::new("smartSharpen").with("Amnt", pct(60.0)).with("Rds ", px(2.0));
        let smt_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Smart Sharpen...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(1131))
            .with("Fltr", Value::Descriptor(smt_filter));

        // Add Noise (1097092723): amount 20% -> grain amount=20, size=1
        let noise_filter = Descriptor::new("AdNs").with("Nose", pct(20.0));
        let noise_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Add Noise...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(1097092723))
            .with("Fltr", Value::Descriptor(noise_filter));

        // Mosaic (1299407648): cell size 12px -> pixelate size=12
        let msc_filter = Descriptor::new("Msc ").with("ClSz", px(12.0));
        let msc_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Mosaic...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(1299407648))
            .with("Fltr", Value::Descriptor(msc_filter));

        let fx_style = Descriptor::new("filterFXStyle")
            .with("enab", Value::Boolean(true))
            .with("filterMaskEnable", Value::Boolean(true))
            .with("filterFXList", Value::List(vec![
                Value::Descriptor(box_item),
                Value::Descriptor(unsm_item),
                Value::Descriptor(smt_item),
                Value::Descriptor(noise_item),
                Value::Descriptor(msc_item),
            ]));

        let trnf = Value::List(vec![
            Value::Double(0.0), Value::Double(0.0),
            Value::Double(8.0), Value::Double(0.0),
            Value::Double(8.0), Value::Double(8.0),
            Value::Double(0.0), Value::Double(8.0),
        ]);

        let sold_desc = Descriptor::new("null")
            .with("Idnt", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul(uuid)))
            .with("placed", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("inst-all")))
            .with("Trnf", trnf)
            .with("filterFX", Value::Descriptor(fx_style));

        let mut sold_data = b"soLD".to_vec();
        sold_data.extend(16u32.to_be_bytes());
        sold_data.extend(VersionedDescriptor::new(sold_desc).to_bytes());

        let mut smart_layer = LayerSpec::new("SmartAll", 0, 0, 8, 8, PixelData::Rgba8(vec![255; 256]));
        smart_layer.extra_blocks.push(TaggedBlock::new(*b"SoLd", sold_data));

        let mut b = PsdBuilder::new(10, 10);
        b.push_layer(smart_layer);
        let mut file = PsdFile::from_bytes(&b.to_bytes().unwrap()).unwrap();
        file.global_blocks.push(TaggedBlock::new(*b"lnk2", lnk2_data));
        let bytes = file.to_bytes().unwrap();

        let read_result = read(&bytes).unwrap();
        assert_eq!(read_result.layers.len(), 1);
        let l = &read_result.layers[0];
        assert_eq!(l.effects.len(), 5);
        assert_eq!(l.effects[0].kind, "blur");
        assert_eq!(l.effects[0].values["amount"], 15.0);
        assert_eq!(l.effects[1].kind, "sharpen");
        assert_eq!(l.effects[1].values["amount"], 80.0);
        assert_eq!(l.effects[1].values["radius"], 1.5);
        assert_eq!(l.effects[2].kind, "sharpen");
        assert_eq!(l.effects[2].values["amount"], 60.0);
        assert_eq!(l.effects[2].values["radius"], 2.0);
        assert_eq!(l.effects[3].kind, "grain");
        assert_eq!(l.effects[3].values["amount"], 20.0);
        assert_eq!(l.effects[3].values["size"], 1.0);
        assert_eq!(l.effects[4].kind, "pixelate");
        assert_eq!(l.effects[4].values["size"], 12.0);
        assert!(read_result.flattened.is_empty());
    }

    #[test]
    fn smart_filters_with_mask_notes_cannot_mask_effects_yet() {
        use photocraft_psd::filter_effects::{EffectsPlane, FilterEffectsItem};
        use photocraft_psd::{Compression, Rect};

        let embedded_psd = {
            let mut eb = PsdBuilder::new(8, 8);
            eb.push_layer(LayerSpec::new("Src", 0, 0, 8, 8, PixelData::Rgba8(vec![100; 256])));
            eb.composite(PixelData::Rgba8(vec![100; 256]));
            eb.to_bytes().unwrap()
        };
        let uuid = "test-mask-uuid";
        let lnk2_data = make_test_lnk2(uuid, "embedded.psd", &embedded_psd);

        let px = |v: f64| Value::UnitFloat { unit: *b"#Pxl", value: v };
        let gsn_filter = Descriptor::new("GsnB").with("Rds ", px(4.0));
        let filter_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Gaussian Blur...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(1198747202))
            .with("Fltr", Value::Descriptor(gsn_filter));

        let fx_style = Descriptor::new("filterFXStyle")
            .with("enab", Value::Boolean(true))
            .with("filterMaskEnable", Value::Boolean(true))
            .with("filterFXList", Value::List(vec![Value::Descriptor(filter_item)]));

        let trnf = Value::List(vec![
            Value::Double(0.0), Value::Double(0.0),
            Value::Double(8.0), Value::Double(0.0),
            Value::Double(8.0), Value::Double(8.0),
            Value::Double(0.0), Value::Double(8.0),
        ]);

        let sold_desc = Descriptor::new("null")
            .with("Idnt", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul(uuid)))
            .with("placed", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("inst-mask")))
            .with("Trnf", trnf)
            .with("filterFX", Value::Descriptor(fx_style));

        let mut sold_data = b"soLD".to_vec();
        sold_data.extend(16u32.to_be_bytes());
        sold_data.extend(VersionedDescriptor::new(sold_desc).to_bytes());

        let mut smart_layer = LayerSpec::new("MaskedSmart", 0, 0, 8, 8, PixelData::Rgba8(vec![255; 256]));
        smart_layer.extra_blocks.push(TaggedBlock::new(*b"SoLd", sold_data));

        // Create an FEid block with a non-white mask (value 128)
        let fe = FilterEffects {
            version: 1,
            items: vec![FilterEffectsItem {
                id: "inst-mask".into(),
                version: 1,
                rect: Rect::from_xywh(0, 0, 8, 8),
                depth: 8,
                max_channels: 3,
                slots: vec![None; 5],
                mask: Some((Rect::from_xywh(0, 0, 8, 8), EffectsPlane { compression: Compression::Raw, data: vec![128; 64] })),
            }],
        };

        let mut b = PsdBuilder::new(10, 10);
        b.push_layer(smart_layer);
        let mut file = PsdFile::from_bytes(&b.to_bytes().unwrap()).unwrap();
        file.global_blocks.push(TaggedBlock::new(*b"lnk2", lnk2_data));
        file.global_blocks.push(TaggedBlock::new(*b"FEid", fe.to_bytes()));
        let bytes = file.to_bytes().unwrap();

        let read_result = read(&bytes).unwrap();
        assert_eq!(read_result.layers.len(), 1);
        let l = &read_result.layers[0];
        assert_eq!(l.effects.len(), 1);
        assert_eq!(l.effects[0].kind, "blur");
        assert!(l.effect_mask_png.is_some());
        assert!(read_result.flattened.is_empty());
    }

    #[test]
    fn smart_filters_accepts_non_affine_transform_matching_trnf() {
        let embedded_psd = {
            let mut eb = PsdBuilder::new(8, 8);
            eb.push_layer(LayerSpec::new("Src", 0, 0, 8, 8, PixelData::Rgba8(vec![100; 256])));
            eb.composite(PixelData::Rgba8(vec![100; 256]));
            eb.to_bytes().unwrap()
        };
        let uuid = "test-nonaff-match-uuid";
        let lnk2_data = make_test_lnk2(uuid, "embedded.psd", &embedded_psd);

        let px = |v: f64| Value::UnitFloat { unit: *b"#Pxl", value: v };
        let gsn_filter = Descriptor::new("GsnB").with("Rds ", px(4.0));
        let filter_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Gaussian Blur...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(1198747202))
            .with("Fltr", Value::Descriptor(gsn_filter));

        let fx_style = Descriptor::new("filterFXStyle")
            .with("enab", Value::Boolean(true))
            .with("filterFXList", Value::List(vec![Value::Descriptor(filter_item)]));

        let trnf = Value::List(vec![
            Value::Double(0.0), Value::Double(0.0),
            Value::Double(8.0), Value::Double(0.0),
            Value::Double(8.0), Value::Double(8.0),
            Value::Double(0.0), Value::Double(8.0),
        ]);
        let non_aff = Value::List(vec![
            Value::Double(0.1), Value::Double(0.1),
            Value::Double(8.1), Value::Double(0.1),
            Value::Double(8.1), Value::Double(8.1),
            Value::Double(0.1), Value::Double(8.1),
        ]);

        let sold_desc = Descriptor::new("null")
            .with("Idnt", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul(uuid)))
            .with("Trnf", trnf)
            .with("nonAffineTransform", non_aff)
            .with("filterFX", Value::Descriptor(fx_style));

        let mut sold_data = b"soLD".to_vec();
        sold_data.extend(16u32.to_be_bytes());
        sold_data.extend(VersionedDescriptor::new(sold_desc).to_bytes());

        let mut smart_layer = LayerSpec::new("NonAffMatch", 0, 0, 8, 8, PixelData::Rgba8(vec![255; 256]));
        smart_layer.extra_blocks.push(TaggedBlock::new(*b"SoLd", sold_data));

        let mut b = PsdBuilder::new(10, 10);
        b.push_layer(smart_layer);
        let mut file = PsdFile::from_bytes(&b.to_bytes().unwrap()).unwrap();
        file.global_blocks.push(TaggedBlock::new(*b"lnk2", lnk2_data));
        let bytes = file.to_bytes().unwrap();

        let read_result = read(&bytes).unwrap();
        assert_eq!(read_result.layers.len(), 1);
        let l = &read_result.layers[0];
        assert_eq!(l.effects.len(), 1);
        assert!(read_result.flattened.is_empty());
    }

    #[test]
    fn smart_filters_rejects_non_affine_transform_mismatch_with_reason() {
        let embedded_psd = {
            let mut eb = PsdBuilder::new(8, 8);
            eb.push_layer(LayerSpec::new("Src", 0, 0, 8, 8, PixelData::Rgba8(vec![100; 256])));
            eb.composite(PixelData::Rgba8(vec![100; 256]));
            eb.to_bytes().unwrap()
        };
        let uuid = "test-nonaff-mismatch-uuid";
        let lnk2_data = make_test_lnk2(uuid, "embedded.psd", &embedded_psd);

        let px = |v: f64| Value::UnitFloat { unit: *b"#Pxl", value: v };
        let gsn_filter = Descriptor::new("GsnB").with("Rds ", px(4.0));
        let filter_item = Descriptor::new("filterFX")
            .with("Nm  ", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul("Gaussian Blur...")))
            .with("enab", Value::Boolean(true))
            .with("filterID", Value::Integer(1198747202))
            .with("Fltr", Value::Descriptor(gsn_filter));

        let fx_style = Descriptor::new("filterFXStyle")
            .with("enab", Value::Boolean(true))
            .with("filterFXList", Value::List(vec![Value::Descriptor(filter_item)]));

        let trnf = Value::List(vec![
            Value::Double(0.0), Value::Double(0.0),
            Value::Double(8.0), Value::Double(0.0),
            Value::Double(8.0), Value::Double(8.0),
            Value::Double(0.0), Value::Double(8.0),
        ]);
        // Perspective quad (very different from rectangle)
        let non_aff = Value::List(vec![
            Value::Double(2.0), Value::Double(1.0),
            Value::Double(7.0), Value::Double(0.0),
            Value::Double(9.0), Value::Double(8.0),
            Value::Double(1.0), Value::Double(7.0),
        ]);

        let sold_desc = Descriptor::new("null")
            .with("Idnt", Value::Text(photocraft_psd::descriptor::UnicodeString::new_nul(uuid)))
            .with("Trnf", trnf)
            .with("nonAffineTransform", non_aff)
            .with("filterFX", Value::Descriptor(fx_style));

        let mut sold_data = b"soLD".to_vec();
        sold_data.extend(16u32.to_be_bytes());
        sold_data.extend(VersionedDescriptor::new(sold_desc).to_bytes());

        let mut smart_layer = LayerSpec::new("PerspectiveSmart", 0, 0, 8, 8, PixelData::Rgba8(vec![255; 256]));
        smart_layer.extra_blocks.push(TaggedBlock::new(*b"SoLd", sold_data));

        let mut b = PsdBuilder::new(10, 10);
        b.push_layer(smart_layer);
        let mut file = PsdFile::from_bytes(&b.to_bytes().unwrap()).unwrap();
        file.global_blocks.push(TaggedBlock::new(*b"lnk2", lnk2_data));
        let bytes = file.to_bytes().unwrap();

        let read_result = read(&bytes).unwrap();
        assert_eq!(read_result.layers.len(), 1);
        let l = &read_result.layers[0];
        assert!(l.effects.is_empty());
        assert_eq!(read_result.flattened, vec!["PerspectiveSmart (smart object: perspective transform)"]);
    }

    fn print_layer_summary(l: &PsdLayer, indent: usize) {
        let pad = "  ".repeat(indent);
        let mut details = Vec::new();
        if let Some(s) = &l.shadow {
            details.push(format!("shadow({}px blur, [{}, {}], {})", s.blur, s.x, s.y, s.color));
        }
        if let Some(g) = &l.grade {
            details.push(format!(
                "grade(exp={}, cntr={}, vib={}, sat={}, hue={})",
                g.exposure, g.contrast, g.vibrance, g.saturation, g.hue
            ));
        }
        if !l.effects.is_empty() {
            let eff_names: Vec<_> = l.effects.iter().map(|e| e.kind.as_str()).collect();
            details.push(format!("effects({:?})", eff_names));
            if l.effect_mask_png.is_some() {
                details.push("mask(yes)".into());
            } else {
                details.push("mask(no)".into());
            }
        }
        let desc = if details.is_empty() { "picture".to_string() } else { details.join(", ") };
        if l.group {
            println!("{pad}- Group: {} ({} children)", l.name, l.children.len());
            for c in &l.children {
                print_layer_summary(c, indent + 1);
            }
        } else {
            println!("{pad}- Layer: {} [{}x{} at {},{}] -> {desc}", l.name, l.width, l.height, l.left, l.top);
        }
    }

    /// Real files: `DUET_PSD_LIST=list.txt cargo test real_files -- --ignored --nocapture`, one path per line.
    #[test]
    #[ignore]
    fn real_files() {
        let list = std::fs::read_to_string(std::env::var("DUET_PSD_LIST").unwrap()).unwrap();
        let (mut ok, mut bad) = (0, 0);
        for path in list.lines().filter(|l| !l.is_empty()) {
            let t = std::time::Instant::now();
            match read(&std::fs::read(path).unwrap()) {
                Ok(r) => {
                    println!("{:>6} ms  {}x{}  {path}", t.elapsed().as_millis(), r.width, r.height);
                    ok += 1;
                    for l in &r.layers {
                        print_layer_summary(l, 1);
                    }
                    if !r.flattened.is_empty() {
                        println!("    Flattened: {:?}", r.flattened);
                    }
                    if !r.left_out.is_empty() {
                        println!("    Left out: {:?}", r.left_out);
                    }
                    let count = r.layers.len();
                    let again = write(r.width, r.height, &r.layers, "");
                    assert!(again.is_ok(), "{path}: {:?}", again.err());
                    let back = read(&again.unwrap()).unwrap();
                    assert_eq!(back.layers.len(), count, "{path}");
                }
                Err(e) => {
                    bad += 1;
                    println!("{path}: {e}");
                }
            }
        }
        println!("read {ok}, failed {bad}");
        assert_eq!(bad, 0);
    }
}
