//! Clips filmed in HDR (most new phones film HLG; some cameras PQ) hold brighter light and wider colour
//! than an ordinary video can. Read as if they were ordinary, they come out pale and grey. The ffmpeg that
//! ships with Duet has no HDR conversion of its own, so Duet makes the conversion as a colour table that
//! ffmpeg applies: HLG shown on its own screen curve as it was made to be, PQ light brought down, colours brought into Rec.709.

use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Hdr {
    Hlg,
    Pq,
}

/// How a clip's picture is stored, read from ffmpeg's description of the file.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct Look {
    /// Its colours are stored the Rec.2020 way.
    pub wide: bool,
    pub hdr: Option<Hdr>,
}

/// Read the look from the picture line of ffmpeg's description, such as `yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67)`.
pub fn parse(text: &str) -> Look {
    let Some(line) = text.lines().find(|l| l.contains("Stream #") && l.contains("Video:") && !l.contains("attached pic")) else {
        return Look::default();
    };
    let hdr = if line.contains("arib-std-b67") {
        Some(Hdr::Hlg)
    } else if line.contains("smpte2084") {
        Some(Hdr::Pq)
    } else {
        None
    };
    Look { wide: line.contains("bt2020nc") || line.contains("bt2020c") || hdr.is_some(), hdr }
}

/// For PQ, the light in nits that becomes the top of an ordinary picture.
const WHITE: f64 = 300.0;
/// HLG is read on a curve a little steeper than the screen it is shown on, which is how a Mac shows it: the same
/// curve for every clip, so shade stays shade and bright stays bright. Measured against Duet's own preview of a phone
/// clip; reading it on the screen's curve alone came out pale, and a fixed level of light made shade far too dark.
const READ: f64 = 3.0;
const SCREEN: f64 = 2.4;
/// Light above this part of white is eased in, so bright skies keep some shape instead of clipping.
const KNEE: f64 = 0.75;
/// Points along each side of the colour table.
const SIZE: usize = 33;

/// PQ's signal to the light it stands for, in nits.
fn pq_nits(e: f64) -> f64 {
    let (m1, m2, c1, c2, c3) = (0.1593017578125, 78.84375, 0.8359375, 18.8515625, 18.6875);
    let p = e.max(0.0).powf(1.0 / m2);
    10000.0 * ((p - c1).max(0.0) / (c2 - c3 * p)).powf(1.0 / m1)
}

/// The colour table for one kind of HDR, as a .cube file.
pub fn cube(kind: Hdr) -> String {
    const TO_709: [[f64; 3]; 3] = [[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]];
    let peak = 10000.0 / WHITE;
    let ease = |x: f64| {
        if x <= KNEE {
            return x;
        }
        let t = (x - KNEE) / (1.0 - KNEE);
        let p = ((peak - KNEE) / (1.0 - KNEE)).max(1.0);
        KNEE + (1.0 - KNEE) * t * (1.0 + t / (p * p)) / (1.0 + t)
    };
    let rec709 = |v: f64| {
        let v = v.clamp(0.0, 1.0);
        if v < 0.018 { 4.5 * v } else { 1.099 * v.powf(0.45) - 0.099 }
    };
    let mut out = format!("LUT_3D_SIZE {SIZE}\n");
    let step = (SIZE - 1) as f64;
    for bi in 0..SIZE {
        for gi in 0..SIZE {
            for ri in 0..SIZE {
                let e = [ri as f64 / step, gi as f64 / step, bi as f64 / step];
                // HLG is read on its steeper curve, its colours brought into Rec.709, and shown on the screen's curve
                if kind == Hdr::Hlg {
                    let l = e.map(|v| v.powf(READ));
                    let l = [0, 1, 2].map(|i| (TO_709[i][0] * l[0] + TO_709[i][1] * l[1] + TO_709[i][2] * l[2]).clamp(0.0, 1.0).powf(1.0 / SCREEN));
                    out.push_str(&format!("{:.6} {:.6} {:.6}\n", l[0], l[1], l[2]));
                    continue;
                }
                // PQ: light on a screen, as a part of white
                let mut l = e.map(|v| pq_nits(v) / WHITE);
                l = [0, 1, 2].map(|i| (TO_709[i][0] * l[0] + TO_709[i][1] * l[1] + TO_709[i][2] * l[2]).max(0.0));
                let top = l[0].max(l[1]).max(l[2]);
                if top > KNEE {
                    let s = ease(top) / top;
                    l = l.map(|v| v * s);
                }
                out.push_str(&format!("{:.6} {:.6} {:.6}\n", rec709(l[0]), rec709(l[1]), rec709(l[2])));
            }
        }
    }
    out
}

/// The colour table's file, made once in the computer's temporary folder.
fn cube_file(kind: Hdr) -> Option<PathBuf> {
    let name = match kind {
        Hdr::Hlg => "duet-hlg-to-sdr-3.cube",
        Hdr::Pq => "duet-pq-to-sdr-2.cube",
    };
    let path = std::env::temp_dir().join(name);
    if !path.is_file() {
        let part = path.with_extension("part");
        std::fs::write(&part, cube(kind)).ok()?;
        std::fs::rename(&part, &path).ok()?;
    }
    Some(path)
}

/// A path written so ffmpeg's filter settings read it whole, colons and backslashes included.
fn filter_path(p: &std::path::Path) -> String {
    p.to_string_lossy().replace('\\', "/").replace(':', "\\:").replace('\'', "\\'")
}

/// What to add to a reader's picture filters after its scale, which reads the colours as `matrix`.
/// Returns the matrix to read with and the filters to add after (empty for an ordinary clip).
pub fn reading(look: &Look, sd: bool) -> (&'static str, String) {
    if let Some(kind) = look.hdr {
        if let Some(file) = cube_file(kind) {
            return ("bt2020", format!(",format=rgb48le,lut3d=file={}:interp=tetrahedral", filter_path(&file)));
        }
    }
    (if look.wide { "bt2020" } else if sd { "bt601" } else { "bt709" }, String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_hdr_from_the_description() {
        let phone = "  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, 30 fps";
        assert_eq!(parse(phone), Look { wide: true, hdr: Some(Hdr::Hlg) });
        let pq = "  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160";
        assert_eq!(parse(pq).hdr, Some(Hdr::Pq));
        let plain = "  Stream #0:0: Video: h264 (High), yuv420p(tv, bt709), 1920x1080, 30 fps";
        assert_eq!(parse(plain), Look::default());
    }

    #[test]
    fn the_table_keeps_black_black_and_white_white() {
        let text = cube(Hdr::Hlg);
        let rows: Vec<&str> = text.lines().skip(1).collect();
        assert_eq!(rows.len(), SIZE * SIZE * SIZE);
        assert_eq!(rows[0], "0.000000 0.000000 0.000000");
        let top: Vec<f64> = rows[rows.len() - 1].split(' ').map(|v| v.parse().unwrap()).collect();
        assert!(top.iter().all(|v| *v > 0.97 && *v <= 1.0));
        // grey stays grey
        let mid = SIZE / 2;
        let grey: Vec<f64> = rows[mid * SIZE * SIZE + mid * SIZE + mid].split(' ').map(|v| v.parse().unwrap()).collect();
        assert!((grey[0] - grey[1]).abs() < 0.002 && (grey[1] - grey[2]).abs() < 0.002);
    }

    #[test]
    fn an_ordinary_clip_reads_as_before() {
        assert_eq!(reading(&Look::default(), false), ("bt709", String::new()));
        assert_eq!(reading(&Look::default(), true), ("bt601", String::new()));
    }

    #[test]
    fn paths_with_colons_are_kept_whole() {
        assert_eq!(filter_path(std::path::Path::new("C:\\Users\\a b\\x.cube")), "C\\:/Users/a b/x.cube");
    }
}
