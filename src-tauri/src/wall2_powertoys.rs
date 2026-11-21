//! What PowerToys itself says about its modules, so the wall can mark a PowerToys key as off and
//! send the shortcut the owner really set, instead of asking him to check it.
//!
//! Read only: `%LOCALAPPDATA%\Microsoft\PowerToys\settings.json` (which modules are on) and each
//! module's own `settings.json` (its activation shortcut). Every file is read up to 256 KB; a
//! file that is missing, too big or not valid JSON counts as not found, and nothing is logged.
//! The shortcut is turned into a chord of the `wall2_keys` vocabulary here, in Rust; the page
//! only ever gets state words (see `wall2_keylib::library_info_with`).

use crate::wall2_keys::parse_chord;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

/// The most bytes read from any one settings file.
const MAX_BYTES: u64 = 256 * 1024;

/// One PowerToys library key: its id, the module's name in the `enabled` list, the module's
/// settings folder, and the property that holds its activation shortcut (empty: not read).
struct Module {
    id: &'static str,
    enabled_name: &'static str,
    dir: &'static str,
    shortcut: &'static str,
}

const MODULES: [Module; 5] = [
    Module { id: "pt-run", enabled_name: "PowerToys Run", dir: "PowerToys Run", shortcut: "open_powerlauncher" },
    Module { id: "pt-color", enabled_name: "ColorPicker", dir: "ColorPicker", shortcut: "ActivationShortcut" },
    Module { id: "pt-ocr", enabled_name: "TextExtractor", dir: "TextExtractor", shortcut: "ActivationShortcut" },
    Module { id: "pt-top", enabled_name: "AlwaysOnTop", dir: "AlwaysOnTop", shortcut: "hotkey" },
    Module { id: "pt-plain", enabled_name: "AdvancedPaste", dir: "AdvancedPaste", shortcut: "" },
];

/// What PowerToys says about one key: whether its module is on, and the chord it was set to,
/// when one could be read and mapped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct KeyState {
    pub on: bool,
    pub chord: Option<String>,
}

/// The state of every PowerToys library key, from PowerToys' own files.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct PtState {
    keys: HashMap<&'static str, KeyState>,
}

impl PtState {
    pub(crate) fn get(&self, id: &str) -> Option<&KeyState> {
        self.keys.get(id)
    }
}

/// A name with case, spaces, underscores and hyphens dropped, so "PowerToys Run" and
/// "PowerToysRun" are the same module.
fn norm(name: &str) -> String {
    name.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

/// A JSON file of at most `MAX_BYTES`; None when it is missing, too big or not valid JSON.
fn read_json(path: &Path) -> Option<Value> {
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_BYTES {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

/// The name of a Windows virtual-key code in the chord vocabulary: letters, digits, Space, the
/// function keys, and the few other keys the vocabulary has. None for anything else.
pub(crate) fn vk_name(code: u64) -> Option<String> {
    let name = match code {
        0x41..=0x5A | 0x30..=0x39 => (code as u8 as char).to_string(),
        0x70..=0x87 => format!("F{}", code - 0x70 + 1),
        0x20 => "Space".to_string(),
        0x0D => "Enter".to_string(),
        0x09 => "Tab".to_string(),
        0x1B => "Esc".to_string(),
        0x08 => "Backspace".to_string(),
        0x2E => "Delete".to_string(),
        0x2D => "Insert".to_string(),
        0x24 => "Home".to_string(),
        0x23 => "End".to_string(),
        0x21 => "PageUp".to_string(),
        0x22 => "PageDown".to_string(),
        0x25 => "Left".to_string(),
        0x26 => "Up".to_string(),
        0x27 => "Right".to_string(),
        0x28 => "Down".to_string(),
        0xBE => ".".to_string(),
        0xC0 => "`".to_string(),
        0xBB => "=".to_string(),
        _ => return None,
    };
    Some(name)
}

/// A PowerToys shortcut object (`win`, `ctrl`, `alt`, `shift`, `code`; sometimes inside a
/// `value` object) as a chord such as `Win+Shift+C`. None when there is no modifier, the key
/// has no name in the vocabulary, or the chord is one the wall refuses to send.
pub(crate) fn chord_from(shortcut: &Value) -> Option<String> {
    let obj = match shortcut.get("value") {
        Some(inner) if inner.is_object() => inner,
        _ => shortcut,
    };
    let held = |name: &str| obj.get(name).and_then(Value::as_bool).unwrap_or(false);
    let mut parts: Vec<String> = Vec::new();
    for (flag, word) in [("win", "Win"), ("ctrl", "Ctrl"), ("alt", "Alt"), ("shift", "Shift")] {
        if held(flag) {
            parts.push(word.to_string());
        }
    }
    if parts.is_empty() {
        return None;
    }
    parts.push(vk_name(obj.get("code")?.as_u64()?)?);
    let chord = parts.join("+");
    parse_chord(&chord).map(|_| chord)
}

/// The state of every PowerToys key from the main settings and a way to read a module's own
/// settings by its folder name. A module the main file does not list counts as on; a module
/// file that is not found keeps the default shortcut.
pub(crate) fn state_from(global: &Value, module_file: &dyn Fn(&str) -> Option<Value>) -> PtState {
    let enabled = global.get("enabled").and_then(Value::as_object);
    let mut keys = HashMap::new();
    for m in &MODULES {
        let on = enabled
            .and_then(|list| list.iter().find(|(name, _)| norm(name) == norm(m.enabled_name)))
            .and_then(|(_, v)| v.as_bool())
            .unwrap_or(true);
        let chord = if on && !m.shortcut.is_empty() {
            module_file(m.dir).and_then(|file| file.get("properties").and_then(|p| p.get(m.shortcut)).and_then(chord_from))
        } else {
            None
        };
        keys.insert(m.id, KeyState { on, chord });
    }
    PtState { keys }
}

/// The state read from a PowerToys settings folder; None when its `settings.json` is not found.
pub(crate) fn read_state(root: &Path) -> Option<PtState> {
    let global = read_json(&root.join("settings.json"))?;
    Some(state_from(&global, &|dir| read_json(&root.join(dir).join("settings.json"))))
}

/// The state from this PC's PowerToys folder, kept for a minute. None when PowerToys has no
/// settings file for this user.
pub(crate) fn current() -> Option<PtState> {
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, Option<PtState>)>> = std::sync::Mutex::new(None);
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, state)) = &*cache {
        if at.elapsed() < std::time::Duration::from_secs(60) {
            return state.clone();
        }
    }
    let state = std::env::var_os("LOCALAPPDATA").and_then(|local| read_state(&Path::new(&local).join("Microsoft").join("PowerToys")));
    *cache = Some((std::time::Instant::now(), state.clone()));
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn no_modules(_: &str) -> Option<Value> {
        None
    }

    #[test]
    fn enabled_and_disabled_modules_come_from_the_main_settings() {
        let global = json!({ "enabled": { "PowerToys Run": true, "ColorPicker": false, "TextExtractor": true, "AlwaysOnTop": false } });
        let state = state_from(&global, &no_modules);
        assert!(state.get("pt-run").unwrap().on);
        assert!(!state.get("pt-color").unwrap().on);
        assert!(state.get("pt-ocr").unwrap().on);
        assert!(!state.get("pt-top").unwrap().on);
        // Not listed: counts as on, with no chord read.
        assert_eq!(state.get("pt-plain"), Some(&KeyState { on: true, chord: None }));
        assert_eq!(state.get("pt-nope"), None);
    }

    #[test]
    fn module_names_are_read_with_or_without_spaces() {
        let global = json!({ "enabled": { "PowerToysRun": false, "Color_Picker": false, "text-extractor": false } });
        let state = state_from(&global, &no_modules);
        assert!(!state.get("pt-run").unwrap().on);
        assert!(!state.get("pt-color").unwrap().on);
        assert!(!state.get("pt-ocr").unwrap().on);
    }

    #[test]
    fn a_custom_shortcut_replaces_the_default_chord() {
        let global = json!({ "enabled": { "PowerToys Run": true, "ColorPicker": true, "AlwaysOnTop": true } });
        let module = |dir: &str| match dir {
            "PowerToys Run" => Some(json!({ "properties": { "open_powerlauncher": { "win": false, "ctrl": true, "alt": true, "shift": false, "code": 32 } } })),
            "ColorPicker" => Some(json!({ "properties": { "ActivationShortcut": { "win": true, "ctrl": false, "alt": false, "shift": true, "code": 81 } } })),
            "AlwaysOnTop" => Some(json!({ "properties": { "hotkey": { "value": { "win": true, "ctrl": true, "alt": false, "shift": false, "code": 117 } } } })),
            _ => None,
        };
        let state = state_from(&global, &module);
        assert_eq!(state.get("pt-run").unwrap().chord.as_deref(), Some("Ctrl+Alt+Space"));
        assert_eq!(state.get("pt-color").unwrap().chord.as_deref(), Some("Win+Shift+Q"));
        assert_eq!(state.get("pt-top").unwrap().chord.as_deref(), Some("Win+Ctrl+F6"));
        // Its module file is missing: the default stays.
        assert_eq!(state.get("pt-ocr").unwrap().chord, None);
    }

    #[test]
    fn a_disabled_module_reads_no_shortcut() {
        let global = json!({ "enabled": { "ColorPicker": false } });
        let module = |_: &str| Some(json!({ "properties": { "ActivationShortcut": { "win": true, "code": 81 } } }));
        assert_eq!(state_from(&global, &module).get("pt-color"), Some(&KeyState { on: false, chord: None }));
    }

    #[test]
    fn a_shortcut_that_cannot_be_mapped_keeps_the_default() {
        for bad in [
            json!({ "win": true, "code": 0xE8 }),
            json!({ "win": false, "ctrl": false, "alt": false, "shift": false, "code": 65 }),
            json!({ "win": true }),
            json!({ "win": true, "code": "A" }),
            json!({ "win": true, "code": 76 }),
            json!("Win+A"),
            json!(null),
        ] {
            assert_eq!(chord_from(&bad), None, "{bad}");
        }
    }

    #[test]
    fn virtual_keys_map_to_the_chord_vocabulary() {
        for (code, name) in [(0x41u64, "A"), (0x5A, "Z"), (0x30, "0"), (0x39, "9"), (0x20, "Space"), (0x70, "F1"), (0x75, "F6"), (0x87, "F24")] {
            assert_eq!(vk_name(code).as_deref(), Some(name));
        }
        for code in [0x00u64, 0x10, 0x5B, 0x88, 0xE8, 70000] {
            assert_eq!(vk_name(code), None, "{code}");
        }
        // Every name it gives is one the chord parser accepts.
        for code in 0u64..0x100 {
            if let Some(name) = vk_name(code) {
                assert!(parse_chord(&format!("Ctrl+{name}")).is_some(), "{name}");
            }
        }
    }

    #[test]
    fn settings_files_are_read_from_a_folder_and_bad_ones_count_as_not_found() {
        let root = std::env::temp_dir().join(format!("wall-ptset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("ColorPicker")).unwrap();
        std::fs::create_dir_all(root.join("TextExtractor")).unwrap();
        assert_eq!(read_state(&root), None, "no settings file");
        std::fs::write(root.join("settings.json"), r#"{ "enabled": { "ColorPicker": true, "TextExtractor": true } }"#).unwrap();
        std::fs::write(root.join("ColorPicker").join("settings.json"), r#"{ "properties": { "ActivationShortcut": { "win": true, "shift": true, "code": 67 } } }"#).unwrap();
        std::fs::write(root.join("TextExtractor").join("settings.json"), "{ not json").unwrap();
        let state = read_state(&root).expect("read");
        assert_eq!(state.get("pt-color").unwrap().chord.as_deref(), Some("Win+Shift+C"));
        assert_eq!(state.get("pt-ocr"), Some(&KeyState { on: true, chord: None }), "bad JSON keeps the default");
        // Bad main file, and a main file over the cap, are both not found.
        std::fs::write(root.join("settings.json"), "[").unwrap();
        assert_eq!(read_state(&root), None);
        std::fs::write(root.join("settings.json"), format!("{{ \"pad\": \"{}\" }}", "x".repeat(MAX_BYTES as usize))).unwrap();
        assert_eq!(read_state(&root), None);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
