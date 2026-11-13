//! Zone sources and the pure rule that assigns recent windows to them.

use crate::wall2_winutil::{exe_file_part, Rect};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;

pub(crate) const MAX_FANCY_BYTES: u64 = 256 * 1024;
pub(crate) const MAX_FILE_ZONES: usize = 8;
const MAX_FANCY_ZONES: usize = 16;
const MAX_GRID_CELLS: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MonitorIdentity {
    pub monitor: String,
    pub monitor_instance: String,
    pub monitor_number: u32,
    /// Present when Windows can identify the current virtual desktop.
    pub virtual_desktop: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FractionZone {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl FractionZone {
    fn valid(self) -> bool {
        [self.x, self.y, self.w, self.h].iter().all(|n| n.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.w > 0.0
            && self.h > 0.0
            && self.x + self.w <= 1.0
            && self.y + self.h <= 1.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ZoneApp {
    pub exe: String,
    /// Reading-order zone number, starting at one.
    pub zone: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ZoneWindow {
    pub id: isize,
    pub image: String,
}

pub(crate) fn default_zones() -> Vec<FractionZone> {
    vec![
        FractionZone { x: 0.0, y: 0.0, w: 0.31, h: 1.0 },
        FractionZone { x: 0.31, y: 0.0, w: 0.49, h: 1.0 },
        FractionZone { x: 0.80, y: 0.0, w: 0.20, h: 0.5 },
        FractionZone { x: 0.80, y: 0.5, w: 0.20, h: 0.5 },
    ]
}

pub(crate) fn scale_zones(zones: &[FractionZone], work: Rect) -> Result<Vec<Rect>, usize> {
    if work.width() <= 0 || work.height() <= 0 {
        return Err(1);
    }
    let width = work.width() as f64;
    let height = work.height() as f64;
    zones
        .iter()
        .enumerate()
        .map(|(i, z)| {
            let target = Rect {
                left: (work.left + (z.x * width).round() as i32).clamp(work.left, work.right),
                top: (work.top + (z.y * height).round() as i32).clamp(work.top, work.bottom),
                right: (work.left + ((z.x + z.w) * width).round() as i32).clamp(work.left, work.right),
                bottom: (work.top + ((z.y + z.h) * height).round() as i32).clamp(work.top, work.bottom),
            };
            (target.left >= target.right || target.top >= target.bottom).then_some(Err(i + 1)).unwrap_or(Ok(target))
        })
        .collect()
}

pub(crate) fn reading_order(zones: &[Rect]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..zones.len()).collect();
    order.sort_by_key(|&i| (zones[i].left, zones[i].top, i));
    order
}

/// Rules take their named zones first. Free zones then take remaining windows in z order,
/// largest zone first. A repeated rule for a zone cannot displace the first assignment.
pub(crate) fn assign(zones: &[Rect], windows: &[ZoneWindow], rules: &[ZoneApp]) -> Vec<(isize, Rect)> {
    let numbered = reading_order(zones);
    let mut used_zones = HashSet::new();
    let mut used_windows = HashSet::new();
    let mut out = Vec::new();
    for rule in rules {
        let Some(&zone_index) = rule.zone.checked_sub(1).and_then(|i| numbered.get(i)) else { continue };
        if used_zones.contains(&zone_index) {
            continue;
        }
        let Some(window) = windows.iter().find(|w| !used_windows.contains(&w.id) && exe_file_part(&w.image).eq_ignore_ascii_case(&rule.exe)) else {
            continue;
        };
        used_zones.insert(zone_index);
        used_windows.insert(window.id);
        out.push((window.id, zones[zone_index]));
    }
    let mut free: Vec<usize> = (0..zones.len()).filter(|i| !used_zones.contains(i)).collect();
    free.sort_by_key(|&i| (std::cmp::Reverse(zones[i].width() as i64 * zones[i].height() as i64), i));
    for (zone_index, window) in free.into_iter().zip(windows.iter().filter(|w| !used_windows.contains(&w.id))) {
        out.push((window.id, zones[zone_index]));
    }
    out
}

fn number(v: &Value, names: &[&str]) -> Option<f64> {
    names.iter().find_map(|n| v.get(*n).and_then(Value::as_f64)).filter(|n| n.is_finite())
}

pub(crate) fn parse_fraction_zones(value: Option<&Value>) -> Result<Vec<FractionZone>, String> {
    let Some(value) = value else { return Ok(Vec::new()) };
    let list = value.as_array().ok_or_else(|| "zones must be a list".to_string())?;
    if list.is_empty() || list.len() > MAX_FILE_ZONES {
        return Err(format!("zones needs between 1 and {MAX_FILE_ZONES} rectangles"));
    }
    list.iter()
        .enumerate()
        .map(|(i, v)| {
            let z = FractionZone {
                x: number(v, &["x"]).ok_or_else(|| format!("zone {}: x must be a number", i + 1))?,
                y: number(v, &["y"]).ok_or_else(|| format!("zone {}: y must be a number", i + 1))?,
                w: number(v, &["w"]).ok_or_else(|| format!("zone {}: w must be a number", i + 1))?,
                h: number(v, &["h"]).ok_or_else(|| format!("zone {}: h must be a number", i + 1))?,
            };
            z.valid().then_some(z).ok_or_else(|| format!("zone {} must fit inside the work area", i + 1))
        })
        .collect()
}

pub(crate) fn parse_zone_apps(value: Option<&Value>, valid_exe: impl Fn(&str) -> bool) -> Result<Vec<ZoneApp>, String> {
    let Some(value) = value else { return Ok(Vec::new()) };
    let list = value.as_array().ok_or_else(|| "zoneApps must be a list".to_string())?;
    if list.len() > MAX_FILE_ZONES {
        return Err(format!("zoneApps has more than {MAX_FILE_ZONES} rules"));
    }
    list.iter().enumerate().map(|(i, v)| {
        let exe = v.get("exe").and_then(Value::as_str).filter(|s| valid_exe(s)).ok_or_else(|| format!("zoneApps rule {}: exe must be a file name ending in .exe", i + 1))?;
        let zone = v.get("zone").and_then(Value::as_u64).and_then(|n| usize::try_from(n).ok()).filter(|n| (1..=MAX_FANCY_ZONES).contains(n))
            .ok_or_else(|| format!("zoneApps rule {}: zone must be between 1 and {MAX_FANCY_ZONES}", i + 1))?;
        Ok(ZoneApp { exe: exe.to_string(), zone })
    }).collect()
}

pub(crate) fn validate_zone_apps(rules: &[ZoneApp], zone_count: usize) -> Result<(), String> {
    rules.iter().enumerate().find(|(_, rule)| rule.zone > zone_count)
        .map_or(Ok(()), |(i, _)| Err(format!("zoneApps rule {}: zone must name an existing zone", i + 1)))
}

fn canvas(info: &Value) -> Option<Vec<FractionZone>> {
    let rw = number(info, &["ref-width", "refWidth"])?;
    let rh = number(info, &["ref-height", "refHeight"])?;
    if rw <= 0.0 || rh <= 0.0 { return None; }
    let list = info.get("zones")?.as_array()?;
    if list.is_empty() || list.len() > MAX_FANCY_ZONES { return None; }
    list.iter().map(|v| {
        let x = number(v, &["X", "x"])?;
        let y = number(v, &["Y", "y"])?;
        let w = number(v, &["width", "Width"])?;
        let h = number(v, &["height", "Height"])?;
        let z = FractionZone { x: x / rw, y: y / rh, w: w / rw, h: h / rh };
        z.valid().then_some(z)
    }).collect()
}

fn grid(info: &Value) -> Option<Vec<FractionZone>> {
    let row_count = info.get("rows")?.as_u64().and_then(|n| usize::try_from(n).ok()).filter(|n| *n > 0)?;
    let col_count = info.get("columns")?.as_u64().and_then(|n| usize::try_from(n).ok()).filter(|n| *n > 0)?;
    if row_count.checked_mul(col_count)? > MAX_GRID_CELLS { return None; }
    let rows = info.get("rows-percentage").or_else(|| info.get("rowsPercentage"))?.as_array()?;
    let cols = info.get("columns-percentage").or_else(|| info.get("columnsPercentage"))?.as_array()?;
    let map = info.get("cell-child-map").or_else(|| info.get("cellChildMap"))?.as_array()?;
    if rows.len() != row_count || cols.len() != col_count || map.len() != row_count { return None; }
    let parts = |a: &[Value]| -> Option<Vec<f64>> {
        let out: Option<Vec<f64>> = a.iter().map(Value::as_f64).collect();
        let out = out?;
        (out.iter().all(|n| n.is_finite() && *n > 0.0) && (out.iter().sum::<f64>() - 10_000.0).abs() < 0.5).then_some(out)
    };
    let rows = parts(rows)?;
    let cols = parts(cols)?;
    let mut bounds: HashMap<i64, (usize, usize, usize, usize)> = HashMap::new();
    for (r, row) in map.iter().enumerate() {
        let row = row.as_array()?;
        if row.len() != col_count { return None; }
        for (c, cell) in row.iter().enumerate() {
            let id = cell.as_i64()?;
            if id < 0 { continue; }
            bounds.entry(id).and_modify(|b| { b.0 = b.0.min(r); b.1 = b.1.max(r); b.2 = b.2.min(c); b.3 = b.3.max(c); }).or_insert((r, r, c, c));
        }
    }
    if bounds.is_empty() || bounds.len() > MAX_FANCY_ZONES { return None; }
    let mut ids: Vec<i64> = bounds.keys().copied().collect();
    ids.sort_unstable();
    ids.into_iter().map(|id| {
        let (r0, r1, c0, c1) = bounds[&id];
        for r in r0..=r1 { for c in c0..=c1 { if map[r].as_array()?.get(c)?.as_i64()? != id { return None; } } }
        let z = FractionZone {
            x: cols[..c0].iter().sum::<f64>() / 10_000.0,
            y: rows[..r0].iter().sum::<f64>() / 10_000.0,
            w: cols[c0..=c1].iter().sum::<f64>() / 10_000.0,
            h: rows[r0..=r1].iter().sum::<f64>() / 10_000.0,
        };
        z.valid().then_some(z)
    }).collect()
}

/// Parse a custom-layouts file and return the named custom canvas or grid layout.
pub(crate) fn parse_custom(text: &[u8], uuid: &str) -> Option<Vec<FractionZone>> {
    if text.len() as u64 > MAX_FANCY_BYTES { return None; }
    let root: Value = serde_json::from_slice(text).ok()?;
    let list = root.get("custom-layouts")?.as_array()?;
    let layout = list.iter().find(|v| v.get("uuid").and_then(Value::as_str).is_some_and(|s| s.eq_ignore_ascii_case(uuid)))?;
    let info = layout.get("info")?;
    match layout.get("type")?.as_str()? {
        "canvas" => canvas(info),
        "grid" => grid(info),
        _ => None,
    }
}

/// Find the custom layout applied to the selected display. Built-in templates return none.
pub(crate) fn parse_applied(text: &[u8], identity: &MonitorIdentity) -> Option<String> {
    if text.len() as u64 > MAX_FANCY_BYTES { return None; }
    let root: Value = serde_json::from_slice(text).ok()?;
    let list = root.get("applied-layouts")?.as_array()?;
    let matches_device = |v: &&Value| {
        let Some(device) = v.get("device") else { return false };
        let monitor = device.get("monitor").and_then(Value::as_str);
        let instance = device.get("monitor-instance").or_else(|| device.get("monitorInstance")).and_then(Value::as_str);
        let number = device.get("monitor-number").or_else(|| device.get("monitorNumber")).and_then(Value::as_u64);
        let desktop = device.get("virtual-desktop").or_else(|| device.get("virtualDesktop")).and_then(Value::as_str);
        monitor.is_some_and(|s| s.eq_ignore_ascii_case(&identity.monitor))
            && instance.is_some_and(|s| s.eq_ignore_ascii_case(&identity.monitor_instance))
            && number == Some(identity.monitor_number as u64)
            && identity.virtual_desktop.as_ref().is_none_or(|wanted| desktop.is_some_and(|s| s.eq_ignore_ascii_case(wanted)))
    };
    let mut matches = list.iter().filter(matches_device);
    let entry = matches.next()?;
    if matches.next().is_some() { return None; }
    let applied = entry.get("applied-layout")?;
    (applied.get("type")?.as_str()? == "custom").then(|| applied.get("uuid")?.as_str().map(str::to_string)).flatten()
}

fn read_capped(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut out = Vec::new();
    file.take(MAX_FANCY_BYTES + 1).read_to_end(&mut out).ok()?;
    (out.len() as u64 <= MAX_FANCY_BYTES).then_some(out)
}

pub(crate) fn load_fancy(local_app_data: &Path, identity: &MonitorIdentity) -> Option<Vec<FractionZone>> {
    let dir = local_app_data.join("Microsoft").join("PowerToys").join("FancyZones");
    let applied = read_capped(&dir.join("applied-layouts.json"))?;
    let uuid = parse_applied(&applied, identity)?;
    let custom = read_capped(&dir.join("custom-layouts.json"))?;
    parse_custom(&custom, &uuid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(left: i32, top: i32, right: i32, bottom: i32) -> Rect { Rect { left, top, right, bottom } }
    fn w(id: isize, exe: &str) -> ZoneWindow { ZoneWindow { id, image: format!(r"C:\Apps\{exe}") } }
    fn identity() -> MonitorIdentity {
        MonitorIdentity { monitor: "MODEL1".into(), monitor_instance: "INSTANCE1".into(), monitor_number: 2, virtual_desktop: None }
    }

    #[test]
    fn corrected_default_has_four_measured_zones() {
        assert_eq!(default_zones(), vec![
            FractionZone { x: 0.0, y: 0.0, w: 0.31, h: 1.0 },
            FractionZone { x: 0.31, y: 0.0, w: 0.49, h: 1.0 },
            FractionZone { x: 0.8, y: 0.0, w: 0.2, h: 0.5 },
            FractionZone { x: 0.8, y: 0.5, w: 0.2, h: 0.5 },
        ]);
    }

    #[test]
    fn fractions_scale_inside_each_taskbar_edge() {
        let all = FractionZone { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
        for work in [r(40, 0, 2560, 1440), r(0, 0, 2520, 1440), r(0, 40, 2560, 1440), r(0, 0, 2560, 1400)] {
            assert_eq!(scale_zones(&[all], work), Ok(vec![work]));
        }
        assert_eq!(scale_zones(&default_zones(), r(37, 19, 1037, 519)), Ok(vec![r(37, 19, 347, 519), r(347, 19, 837, 519), r(837, 19, 1037, 269), r(837, 269, 1037, 519)]));
        let tiny = FractionZone { x: 0.99999, y: 0.0, w: 0.00001, h: 1.0 };
        assert_eq!(scale_zones(&[tiny], r(37, 19, 5157, 739)), Err(1));
    }

    #[test]
    fn reading_order_numbers_left_then_top() {
        let zones = [r(800, 300, 1000, 600), r(0, 0, 300, 600), r(800, 0, 1000, 300), r(300, 0, 800, 600)];
        assert_eq!(reading_order(&zones), vec![1, 3, 2, 0]);
    }

    #[test]
    fn rules_win_then_recency_takes_largest_free_zones() {
        let zones = [r(0, 0, 200, 100), r(200, 0, 700, 100), r(700, 0, 900, 50), r(700, 50, 900, 100)];
        let windows = [w(1, "browser.exe"), w(2, "mail.exe"), w(3, "notes.exe"), w(4, "chat.exe"), w(5, "extra.exe")];
        let rules = [ZoneApp { exe: "mail.exe".into(), zone: 3 }];
        assert_eq!(assign(&zones, &windows, &rules), vec![(2, zones[2]), (1, zones[1]), (3, zones[0]), (4, zones[3])]);
    }

    #[test]
    fn missing_program_and_second_rule_for_same_zone_do_not_consume_anything() {
        let zones = [r(0, 0, 100, 100), r(100, 0, 300, 100), r(300, 0, 400, 100)];
        let windows = [w(1, "a.exe"), w(2, "b.exe")];
        let rules = [
            ZoneApp { exe: "missing.exe".into(), zone: 1 },
            ZoneApp { exe: "b.exe".into(), zone: 2 },
            ZoneApp { exe: "a.exe".into(), zone: 2 },
        ];
        assert_eq!(assign(&zones, &windows, &rules), vec![(2, zones[1]), (1, zones[0])]);
        assert_eq!(assign(&zones, &[], &[]), Vec::<(isize, Rect)>::new());
        assert_eq!(assign(&zones, &windows[..1], &[]), vec![(1, zones[1])]);
        assert_eq!(assign(&zones[..1], &windows, &[]), vec![(1, zones[0])]);
        assert_eq!(validate_zone_apps(&[ZoneApp { exe: "a.exe".into(), zone: 4 }], zones.len()), Err("zoneApps rule 1: zone must name an existing zone".into()));
        assert_eq!(validate_zone_apps(&rules, 1), Err("zoneApps rule 2: zone must name an existing zone".into()));
    }

    #[test]
    fn canvas_and_grid_custom_layouts_parse_defensively() {
        let canvas_json = br#"{"custom-layouts":[{"uuid":"u","type":"canvas","extra":1,"info":{"ref-width":1000,"ref-height":500,"zones":[{"X":0,"Y":0,"width":300,"height":500},{"X":300,"Y":0,"width":700,"height":500}]}}]}"#;
        assert_eq!(parse_custom(canvas_json, "U").unwrap().len(), 2);
        let grid_json = br#"{"custom-layouts":[{"uuid":"g","type":"grid","info":{"rows":2,"columns":2,"rows-percentage":[5000,5000],"columns-percentage":[3000,7000],"cell-child-map":[[0,1],[0,2]]}}]}"#;
        let got = parse_custom(grid_json, "g").unwrap();
        assert_eq!(got, vec![FractionZone { x: 0.0, y: 0.0, w: 0.3, h: 1.0 }, FractionZone { x: 0.3, y: 0.0, w: 0.7, h: 0.5 }, FractionZone { x: 0.3, y: 0.5, w: 0.7, h: 0.5 }]);
        for bad in [b"garbage".as_slice(), br#"{"custom-layouts":{}}"#, br#"{"custom-layouts":[{"uuid":"u","type":"canvas","info":{"ref-width":100,"ref-height":100,"zones":[{"X":90,"Y":0,"width":20,"height":20}]}}]}"#] {
            assert!(parse_custom(bad, "u").is_none());
        }
        assert!(parse_custom(&vec![b' '; MAX_FANCY_BYTES as usize + 1], "u").is_none());
        for info in [
            r#"{"rows":"2","columns":2,"rows-percentage":[5000,5000],"columns-percentage":[5000,5000],"cell-child-map":[[0,1],[0,1]]}"#,
            r#"{"rows":3,"columns":2,"rows-percentage":[5000,5000],"columns-percentage":[5000,5000],"cell-child-map":[[0,1],[0,1]]}"#,
            r#"{"rows":2,"columns":3,"rows-percentage":[5000,5000],"columns-percentage":[5000,5000],"cell-child-map":[[0,1],[0,1]]}"#,
            r#"{"rows":2,"columns":2,"rows-percentage":[5000,5000],"columns-percentage":[5000,5000],"cell-child-map":[[0,1]]}"#,
            r#"{"rows":1000,"columns":1000,"rows-percentage":[],"columns-percentage":[],"cell-child-map":[]}"#,
        ] {
            let text = format!(r#"{{"custom-layouts":[{{"uuid":"g","type":"grid","info":{info}}}]}}"#);
            assert!(parse_custom(text.as_bytes(), "g").is_none(), "{info}");
        }
    }

    #[test]
    fn applied_file_accepts_only_a_custom_layout_for_the_display() {
        let json = br#"{"applied-layouts":[{"device":{"monitor":"MODEL1","monitor-instance":"INSTANCE1","monitor-number":2,"virtual-desktop":"desk-a"},"applied-layout":{"uuid":"a","type":"custom"}},{"device":{"monitor":"MODEL2","monitor-instance":"INSTANCE2","monitor-number":3},"applied-layout":{"uuid":"b","type":"custom"}}]}"#;
        assert_eq!(parse_applied(json, &identity()).as_deref(), Some("a"));
        let mut wrong = identity();
        wrong.monitor_number = 3;
        assert_eq!(parse_applied(json, &wrong), None, "a sole different device is never accepted");
        let duplicate = br#"{"applied-layouts":[{"device":{"monitor":"MODEL1","monitor-instance":"INSTANCE1","monitor-number":2,"virtual-desktop":"a"},"applied-layout":{"uuid":"a","type":"custom"}},{"device":{"monitor":"MODEL1","monitor-instance":"INSTANCE1","monitor-number":2,"virtual-desktop":"b"},"applied-layout":{"uuid":"b","type":"custom"}}]}"#;
        assert_eq!(parse_applied(duplicate, &identity()), None, "unknown current desktop makes two candidates ambiguous");
        let mut desktop = identity();
        desktop.virtual_desktop = Some("b".into());
        assert_eq!(parse_applied(duplicate, &desktop).as_deref(), Some("b"));
        assert_eq!(parse_applied(b"no", &identity()), None);
        assert_eq!(parse_applied(&vec![b' '; MAX_FANCY_BYTES as usize + 1], &identity()), None);
    }

    #[test]
    fn file_fraction_shapes_and_rules_are_bounded() {
        let value: Value = serde_json::from_str(r#"[{"x":0,"y":0,"w":0.31,"h":1}]"#).unwrap();
        assert_eq!(parse_fraction_zones(Some(&value)).unwrap().len(), 1);
        for bad in [r#"{}"#, r#"[]"#, r#"[{"x":0,"y":0,"w":2,"h":1}]"#, r#"[{"x":"0","y":0,"w":1,"h":1}]"#] {
            let value: Value = serde_json::from_str(bad).unwrap();
            assert!(parse_fraction_zones(Some(&value)).is_err());
        }
        let rules: Value = serde_json::from_str(r#"[{"exe":"MAIL.exe","zone":1}]"#).unwrap();
        assert_eq!(parse_zone_apps(Some(&rules), |s| s.ends_with(".exe")).unwrap()[0].zone, 1);
    }

    #[test]
    fn fancy_files_are_independently_capped_and_malformed_files_fall_through() {
        let root = std::env::temp_dir().join(format!("wall2-zones-{}", std::process::id()));
        let dir = root.join("Microsoft").join("PowerToys").join("FancyZones");
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(load_fancy(&root, &identity()), None, "absent files");
        std::fs::create_dir_all(&dir).unwrap();
        let applied = br#"{"applied-layouts":[{"device":{"monitor":"MODEL1","monitor-instance":"INSTANCE1","monitor-number":2},"applied-layout":{"uuid":"u","type":"custom"}}]}"#;
        let custom = br#"{"custom-layouts":[{"uuid":"u","type":"canvas","info":{"ref-width":10,"ref-height":10,"zones":[{"X":0,"Y":0,"width":10,"height":10}]}}]}"#;
        std::fs::write(dir.join("applied-layouts.json"), b"bad").unwrap();
        std::fs::write(dir.join("custom-layouts.json"), custom).unwrap();
        assert_eq!(load_fancy(&root, &identity()), None, "malformed applied file");
        std::fs::write(dir.join("applied-layouts.json"), vec![b' '; MAX_FANCY_BYTES as usize + 1]).unwrap();
        assert_eq!(load_fancy(&root, &identity()), None, "oversized applied file");
        std::fs::write(dir.join("applied-layouts.json"), applied).unwrap();
        std::fs::write(dir.join("custom-layouts.json"), b"bad").unwrap();
        assert_eq!(load_fancy(&root, &identity()), None, "malformed custom file");
        std::fs::write(dir.join("custom-layouts.json"), vec![b' '; MAX_FANCY_BYTES as usize + 1]).unwrap();
        assert_eq!(load_fancy(&root, &identity()), None, "oversized custom file");
        std::fs::write(dir.join("custom-layouts.json"), custom).unwrap();
        assert_eq!(load_fancy(&root, &identity()), Some(vec![FractionZone { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }]));
        std::fs::remove_dir_all(root).unwrap();
    }
}
