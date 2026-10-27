//! Photoshop files. A PSD comes in as pictures in layers, and a design goes out as one.
//! The reading and writing is done by photocraft-psd (MIT); this file only turns its layers
//! into what Duet draws, and Duet's drawn layers back into a file Photoshop opens.

use base64::Engine;
use photocraft_psd::tree::LayerNode;
use photocraft_psd::{BlendMode, GroupSpec, LayerSpec, PixelData, PsdBuilder, PsdFile, RgbaImage};
use serde::{Deserialize, Serialize};

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
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

const ADJUSTMENTS: [&[u8; 4]; 19] = [
    b"brit", b"levl", b"curv", b"expA", b"vibA", b"hue2", b"blnc", b"blwh", b"phfl", b"mixr", b"clrL",
    b"nvrt", b"post", b"thrs", b"grdm", b"selc", b"SoCo", b"GdFl", b"PtFl",
];

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

fn read_node(file: &PsdFile, node: &LayerNode, out: &mut PsdRead) -> Option<PsdLayer> {
    let rec = &file.layers()[node.index()];
    let layer = file.layer(node.index())?;
    let name = layer.name();
    let base = PsdLayer {
        name: name.clone(),
        opacity: rec.opacity as f32 / 255.0,
        blend: to_duet_blend(rec.blend_mode),
        hidden: !rec.is_visible(),
        ..Default::default()
    };
    if let LayerNode::Group { children, .. } = node {
        let kids: Vec<PsdLayer> = children.iter().filter_map(|c| read_node(file, c, out)).collect();
        if kids.is_empty() {
            return None;
        }
        return Some(PsdLayer { group: true, children: kids, ..base });
    }
    if ADJUSTMENTS.iter().any(|k| rec.block(k).is_some()) {
        out.left_out.push(format!("{name} (adjustment or fill layer)"));
        return None;
    }
    if rec.clipping != 0 {
        out.left_out.push(format!("{name} (clipped to the layer below; it comes in unclipped)"));
    }
    if rec.block(b"lfx2").is_some() || rec.block(b"lrFX").is_some() || rec.block(b"lmfx").is_some() {
        out.left_out.push(format!("{name} (layer effects)"));
    }
    if rec.block(b"TySh").is_some() || rec.block(b"tySh").is_some() {
        out.flattened.push(format!("{name} (text)"));
    } else if rec.block(b"SoLd").is_some() || rec.block(b"PlLd").is_some() || rec.block(b"SoLE").is_some() {
        out.flattened.push(format!("{name} (smart object)"));
    }
    let mut img = layer.rgba8().ok()?;
    if img.width == 0 || img.height == 0 {
        return None;
    }
    if let Some(Ok(mask)) = layer.user_mask() {
        apply_mask(&mut img, &mask);
    }
    // fill opacity fades the pixels but not the effects, and the effects are left out
    let fill = rec.fill_opacity() as f32 / 255.0;
    Some(PsdLayer {
        left: img.left,
        top: img.top,
        width: img.width,
        height: img.height,
        opacity: base.opacity * fill,
        png: png_of(&img).ok()?,
        ..base
    })
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
    out.layers = tree.iter().filter_map(|n| read_node(&file, n, &mut out)).collect();
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

fn decode_png(b: &str) -> Result<(u32, u32, Vec<u8>), String> {
    let bytes = b64().decode(b.trim()).map_err(|e| e.to_string())?;
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
    Ok((info.width, info.height, rgba))
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
