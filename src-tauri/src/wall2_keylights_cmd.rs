//! The key light commands: thin glue over `wall2_keylights.rs` (all the rules and tests live there).
//! Each command refuses any window but `wall2`, takes the side as a word and never an address, and
//! answers with the light's state or one fixed word. Blocking network work runs off the main thread.

use crate::wall2_keylights::{
    forget_in, parse_side, parse_which, read_config, read_light, save_allowed, set_address_in, test_light, with_real_env, Coalescer, Config, Light, Pair, Patch, Reading, Side, Status, Throttle, Which, Word,
};
use std::time::Instant;
use tauri::Manager;

static LEFT: Coalescer = Coalescer::new();
static RIGHT: Coalescer = Coalescer::new();

/// One gate per light for tests and reads (one request per half second, never waiting).
static GATE_LEFT: Throttle = Throttle::new();
static GATE_RIGHT: Throttle = Throttle::new();

fn gate_of(side: Side) -> &'static Throttle {
    match side {
        Side::Left => &GATE_LEFT,
        Side::Right => &GATE_RIGHT,
    }
}

fn queue(side: Side) -> &'static Coalescer {
    match side {
        Side::Left => &LEFT,
        Side::Right => &RIGHT,
    }
}

fn gate(window: &tauri::WebviewWindow) -> Result<(), String> {
    crate::wall2_meet::require_wall2(window.label()).map_err(|_| Word::Refused.as_str().to_string())
}

fn dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|_| Word::Failed.as_str().to_string())
}

fn word(w: Word) -> String {
    w.as_str().to_string()
}

async fn off_thread<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| Word::Failed.as_str().to_string())?
}

/// One side's read: the light, or `not-set-up` when no address is saved for it.
fn read_side(cfg: &Config, side: Side) -> Result<Light, Word> {
    let ip = cfg.get(side).ok_or(Word::NotSetUp)?;
    gate_of(side).run(Instant::now(), || with_real_env(|env| read_light(env, ip, side)))
}

fn write_side(cfg: &Config, side: Side, patch: Patch) -> Result<Light, Word> {
    let ip = cfg.get(side).ok_or(Word::NotSetUp)?;
    // A write changes the light: a read kept from before it is not given back, before or after.
    gate_of(side).forget();
    let answer = with_real_env(|env| queue(side).write(env, ip, side, patch));
    gate_of(side).forget();
    answer
}

/// Runs the two sides at once and gathers their answers.
fn both(f: impl Fn(Side) -> Result<Light, Word> + Sync) -> (Result<Light, Word>, Result<Light, Word>) {
    std::thread::scope(|s| {
        let right = s.spawn(|| f(Side::Right));
        let left = f(Side::Left);
        (left, right.join().unwrap_or(Err(Word::Failed)))
    })
}

/// Which sides are saved: `{ left: { set }, right: { set } }`. Never an address.
#[tauri::command]
pub async fn wall2_keylights_status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Status, String> {
    gate(&window)?;
    let dir = dir(&app)?;
    off_thread(move || Ok(read_config(&dir).status())).await
}

/// Validates and saves one side's address. Answers nothing but success or one word.
#[tauri::command]
pub async fn wall2_keylights_set_address(window: tauri::WebviewWindow, app: tauri::AppHandle, side: String, address: String) -> Result<(), String> {
    gate(&window)?;
    let side = parse_side(&side).map_err(word)?;
    // At most four tries a minute, whatever their answer: a loop of save and Test cannot probe the network.
    if !save_allowed(Instant::now()) {
        return Err(word(Word::SlowDown));
    }
    let dir = dir(&app)?;
    off_thread(move || set_address_in(&dir, side, &address).map_err(word)).await
}

#[tauri::command]
pub async fn wall2_keylights_forget(window: tauri::WebviewWindow, app: tauri::AppHandle, side: String) -> Result<(), String> {
    gate(&window)?;
    let side = parse_side(&side).map_err(word)?;
    let dir = dir(&app)?;
    off_thread(move || forget_in(&dir, side).map_err(word)).await
}

/// One read of one light, logged: the state, or a fixed word.
#[tauri::command]
pub async fn wall2_keylights_test(window: tauri::WebviewWindow, app: tauri::AppHandle, side: String) -> Result<Light, String> {
    gate(&window)?;
    let side = parse_side(&side).map_err(word)?;
    let dir = dir(&app)?;
    off_thread(move || {
        let ip = read_config(&dir).get(side).ok_or(Word::NotSetUp).map_err(word)?;
        gate_of(side).run(Instant::now(), || with_real_env(|env| test_light(env, ip, side))).map_err(word)
    })
    .await
}

/// Both lights' states, each a light or a fixed word.
#[tauri::command]
pub async fn wall2_keylights_read(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Pair, String> {
    gate(&window)?;
    let dir = dir(&app)?;
    off_thread(move || {
        let cfg = read_config(&dir);
        let (l, r) = both(|side| read_side(&cfg, side));
        Ok(Pair { left: Some(Reading::of(l)), right: Some(Reading::of(r)) })
    })
    .await
}

/// Sets one light or both (`left`, `right`, `both`): only the fields given are sent. The answer is
/// each light's state read back after the write, or a fixed word; a side not written is null.
#[tauri::command]
pub async fn wall2_keylights_set(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    side: String,
    on: Option<bool>,
    brightness: Option<i64>,
    kelvin: Option<i64>,
) -> Result<Pair, String> {
    gate(&window)?;
    let which = parse_which(&side).map_err(word)?;
    let patch = Patch::from_page(on, brightness, kelvin);
    if patch.is_empty() {
        return Err(word(Word::Failed));
    }
    let dir = dir(&app)?;
    off_thread(move || {
        let cfg = read_config(&dir);
        Ok(match which {
            Which::One(Side::Left) => Pair { left: Some(Reading::of(write_side(&cfg, Side::Left, patch))), right: None },
            Which::One(Side::Right) => Pair { left: None, right: Some(Reading::of(write_side(&cfg, Side::Right, patch))) },
            Which::Both => {
                let (l, r) = both(|side| write_side(&cfg, side, patch));
                Pair { left: Some(Reading::of(l)), right: Some(Reading::of(r)) }
            }
        })
    })
    .await
}

/// Starts the log next to the other wall logs.
pub fn start_log(dir: Option<std::path::PathBuf>) {
    crate::wall2_keylights::start_log(dir);
}
