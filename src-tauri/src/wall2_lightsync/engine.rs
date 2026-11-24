//! The frame function of the music light sync: sound levels, the beat, the palette and the settings
//! in, one colour per Play (left to right) and one per panel out. Nothing here touches a clock, a
//! socket or a global; the stream thread owns those. Rust holds no palette table and no defaults that
//! matter: the page sends `{ palette, settings }` and every value is validated and clamped here.

use serde::Deserialize;
use std::collections::VecDeque;

/// A word the commands answer when the palette is unusable.
pub(crate) const BAD_PALETTE: &str = "bad-palette";

type Rgb = [f64; 3];

/// The palette as the page sends it. Unknown fields (`id`, `name`) are ignored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaletteIn {
    pub colors: Vec<String>,
    pub kick: String,
    pub rest: String,
}

/// The settings as the page sends them: any may be missing or odd; `Settings::from_in` clamps.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct SettingsIn {
    pub brightness: Option<f64>,
    pub floor: Option<f64>,
    pub bass_gain: Option<f64>,
    pub high_gain: Option<f64>,
    /// The pulse lift a beat adds (0..1).
    pub kick_flash: Option<f64>,
    pub attack_ms: Option<f64>,
    pub release_ms: Option<f64>,
    /// Accepted for old saved pages and ignored: the palette now drifts on its own clock (`drift_ms`).
    pub beat_step: Option<bool>,
    pub ripple_ms: Option<f64>,
    pub plays: Option<bool>,
    pub panels: Option<bool>,
    pub send_hz: Option<f64>,
    /// Accepted for old saved pages and ignored (see `drift_ms`). Read leniently: a wrong type is the same as absent.
    pub colour_bars: Option<serde_json::Value>,
    /// `{ plays: [band; up to 4], panels: band }`, band "bass", "highs" or "both". Read leniently in `Follow::from_in`.
    pub follow: Option<serde_json::Value>,
    /// Panels ring out from the centre on a kick (default true); false pulses them whole. Read leniently: a wrong type is the default.
    pub ripple: Option<serde_json::Value>,
    pub energy_depth: Option<f64>,
    pub kick_white: Option<f64>,
    pub kick_rise_ms: Option<f64>,
    pub kick_decay_ms: Option<f64>,
    pub level_window: Option<f64>,
    pub drift_ms: Option<f64>,
    pub beat_nudge: Option<f64>,
    pub min_pulse_gap_ms: Option<f64>,
    pub slew_down: Option<f64>,
}

/// What `start` and `tune` take.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TuneIn {
    pub palette: PaletteIn,
    #[serde(default)]
    pub settings: SettingsIn,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Palette {
    pub colors: Vec<Rgb>,
    pub kick: Rgb,
    pub rest: Rgb,
}

/// Which sound band a light follows.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Band {
    Bass,
    Highs,
    /// The mean of the two envelopes (what the panels always followed).
    Both,
}

impl Band {
    fn parse(v: &serde_json::Value) -> Option<Band> {
        match v.as_str()? {
            "bass" => Some(Band::Bass),
            "highs" => Some(Band::Highs),
            "both" => Some(Band::Both),
            _ => None,
        }
    }
}

/// Who follows what. A light with no entry (`None`) keeps the default rule: the inner Plays follow the
/// bass, the outer Plays the highs, the panels the mean of both.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Follow {
    /// Up to four, left to right.
    pub plays: Vec<Option<Band>>,
    pub panels: Option<Band>,
}

impl Follow {
    /// Never fails: a missing, wrong-typed or oversized value, or an unknown band, leaves that light on the default.
    pub(crate) fn from_in(v: Option<&serde_json::Value>) -> Follow {
        let Some(obj) = v.and_then(|v| v.as_object()) else { return Follow::default() };
        let plays = obj.get("plays").and_then(|p| p.as_array()).map(|a| a.iter().take(4).map(Band::parse).collect()).unwrap_or_default();
        Follow { plays, panels: obj.get("panels").and_then(Band::parse) }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Settings {
    /// The peak brightness.
    pub brightness: f64,
    pub floor: f64,
    pub bass_gain: f64,
    pub high_gain: f64,
    /// The pulse lift of a beat above the sound's own level.
    pub kick_flash: f64,
    pub attack_ms: f64,
    pub release_ms: f64,
    pub ripple_ms: f64,
    pub plays: bool,
    pub panels: bool,
    pub send_hz: f64,
    pub follow: Follow,
    pub ripple: bool,
    /// How much of the span the sound's level moves (0..1).
    pub energy_depth: f64,
    /// How far a pulse mixes toward the palette's kick colour (0 is no white at all).
    pub kick_white: f64,
    pub kick_rise_ms: f64,
    pub kick_decay_ms: f64,
    /// Frames of 33 ms the band levels are averaged over before they are followed.
    pub level_window: f64,
    /// Milliseconds the palette takes to move one colour.
    pub drift_ms: f64,
    /// Colours a beat nudges the palette along.
    pub beat_nudge: f64,
    pub min_pulse_gap_ms: f64,
    /// The fastest brightness fall, per second.
    pub slew_down: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Tuning {
    pub palette: Palette,
    pub settings: Settings,
}

/// `#rrggbb` only.
pub(crate) fn parse_hex(s: &str) -> Option<Rgb> {
    let h = s.trim().strip_prefix('#')?;
    if h.len() != 6 || !h.is_ascii() {
        return None;
    }
    let ch = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok().map(|v| f64::from(v) / 255.0);
    Some([ch(0)?, ch(2)?, ch(4)?])
}

impl Palette {
    /// 2 to 6 colours, a kick colour and a rest colour, all `#rrggbb`.
    pub(crate) fn from_in(p: &PaletteIn) -> Option<Palette> {
        if !(2..=6).contains(&p.colors.len()) {
            return None;
        }
        let colors = p.colors.iter().map(|c| parse_hex(c)).collect::<Option<Vec<_>>>()?;
        Some(Palette { colors, kick: parse_hex(&p.kick)?, rest: parse_hex(&p.rest)? })
    }
}

fn clamp_or(v: Option<f64>, lo: f64, hi: f64, default: f64) -> f64 {
    match v {
        Some(x) if x.is_finite() => x.clamp(lo, hi),
        _ => default,
    }
}

impl Settings {
    /// Every value clamped to its range; a missing or non-finite one takes the default. The defaults are the
    /// page's Subtle intensity, so a page that sends nothing new gets the gentle look.
    pub(crate) fn from_in(s: &SettingsIn) -> Settings {
        let brightness = clamp_or(s.brightness, 0.2, 1.0, 0.8);
        Settings {
            brightness,
            floor: clamp_or(s.floor, 0.05, 0.6, 0.35).min(brightness - 0.1),
            bass_gain: clamp_or(s.bass_gain, 0.0, 2.0, 1.0),
            high_gain: clamp_or(s.high_gain, 0.0, 2.0, 1.0),
            kick_flash: clamp_or(s.kick_flash, 0.0, 1.0, 0.25),
            attack_ms: clamp_or(s.attack_ms, 40.0, 400.0, 150.0),
            release_ms: clamp_or(s.release_ms, 200.0, 2000.0, 900.0),
            ripple_ms: clamp_or(s.ripple_ms, 200.0, 1500.0, 600.0),
            plays: s.plays.unwrap_or(true),
            panels: s.panels.unwrap_or(true),
            send_hz: clamp_or(s.send_hz, 25.0, 60.0, 50.0),
            follow: Follow::from_in(s.follow.as_ref()),
            ripple: s.ripple.as_ref().and_then(|v| v.as_bool()).unwrap_or(true),
            energy_depth: clamp_or(s.energy_depth, 0.0, 1.0, 0.35),
            kick_white: clamp_or(s.kick_white, 0.0, 0.5, 0.0),
            kick_rise_ms: clamp_or(s.kick_rise_ms, 30.0, 200.0, 80.0),
            kick_decay_ms: clamp_or(s.kick_decay_ms, 150.0, 1000.0, 450.0),
            level_window: clamp_or(s.level_window, 1.0, 12.0, 8.0).round(),
            drift_ms: clamp_or(s.drift_ms, 2000.0, 30000.0, 10000.0),
            beat_nudge: clamp_or(s.beat_nudge, 0.0, 0.25, 0.04),
            min_pulse_gap_ms: clamp_or(s.min_pulse_gap_ms, 340.0, 1000.0, 500.0),
            slew_down: clamp_or(s.slew_down, 0.3, 5.0, 0.8),
        }
    }
}

impl Tuning {
    pub(crate) fn from_in(t: &TuneIn) -> Result<Tuning, &'static str> {
        Ok(Tuning { palette: Palette::from_in(&t.palette).ok_or(BAD_PALETTE)?, settings: Settings::from_in(&t.settings) })
    }
}

/// One tick of input: levels 0..1 (low and high bands), whether the beat detector fired, and the time
/// since the last tick.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Input {
    pub bass: f64,
    pub high: f64,
    pub beat: bool,
    pub dt_ms: f64,
}

/// One frame: a colour per Play in order of `x` (0..1 per component), and a colour per panel in the
/// order given (R, G, B, W bytes). `panels` is empty when the panels are off.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Output {
    pub plays: Vec<Rgb>,
    pub panels: Vec<[u8; 4]>,
}

/// One light-sync frame is about this long; `level_window` counts these.
const FRAME_MS: f64 = 33.0;
/// The band level where sound starts to count, and the span above it that fills the range.
const LEVEL_LO: f64 = 0.2;
const LEVEL_SPAN: f64 = 0.7;

/// Hard cap under WCAG 2.3.1 (three general flashes in a second), on every intensity and slider position:
/// a swing of `GUARD_DELTA` against the last extreme, in the opposite direction to the previous one, counts as
/// a transition; no light may make more than `GUARD_MAX_TRANSITIONS` in `GUARD_WINDOW_MS`. Not settable from the page.
pub(crate) const GUARD_DELTA: f64 = 0.10;
pub(crate) const GUARD_WINDOW_MS: f64 = 1000.0;
pub(crate) const GUARD_MAX_TRANSITIONS: usize = 5;

/// Tracks the swings of one light's luminance: `limit` is the guard, `commit` the counter (also used by the
/// stream stats and the tests).
#[derive(Debug, Clone, Default)]
pub(crate) struct Swing {
    extreme: f64,
    dir: i8,
    started: bool,
    times: VecDeque<f64>,
}

impl Swing {
    fn pop(&mut self, now: f64) {
        while self.times.front().is_some_and(|t| *t <= now - GUARD_WINDOW_MS) {
            self.times.pop_front();
        }
    }

    /// The luminance a light may show at `now` when it wants `y`: `y` itself, unless it would make a swing past
    /// `max` in the window, in which case it holds just under `GUARD_DELTA` from the last extreme. Changes nothing
    /// else; the caller reports what it really showed with `commit`.
    pub(crate) fn limit(&mut self, now: f64, y: f64, max: usize) -> f64 {
        self.pop(now);
        let along = (y - self.extreme) * f64::from(self.dir);
        if !self.started || self.dir == 0 || along >= 0.0 || -along < GUARD_DELTA || self.times.len() < max {
            return y;
        }
        self.extreme - f64::from(self.dir) * (GUARD_DELTA - 0.01)
    }

    /// Record the luminance really shown at `now` (ms); a swing of `GUARD_DELTA` against the last extreme, the
    /// other way to the one before, counts as a transition.
    pub(crate) fn commit(&mut self, now: f64, y: f64) {
        self.pop(now);
        if !self.started {
            self.started = true;
            self.extreme = y;
            return;
        }
        let d = y - self.extreme;
        if self.dir == 0 {
            if d.abs() >= GUARD_DELTA {
                self.dir = if d > 0.0 { 1 } else { -1 };
                self.extreme = y;
                self.times.push_back(now);
            }
            return;
        }
        let along = d * f64::from(self.dir);
        if along >= 0.0 {
            self.extreme = y;
        } else if -along >= GUARD_DELTA {
            self.dir = -self.dir;
            self.extreme = y;
            self.times.push_back(now);
        }
    }

    pub(crate) fn transitions(&self) -> usize {
        self.times.len()
    }
}

/// The 0..1 shape of one pulse `t` ms after its beat: a raised cosine rise, then an exponential fall.
pub(crate) fn kick_shape(t: f64, rise: f64, tau: f64) -> f64 {
    if !t.is_finite() || t < 0.0 || t > rise + 5.0 * tau {
        0.0
    } else if t < rise {
        0.5 - 0.5 * (std::f64::consts::PI * t / rise).cos()
    } else {
        (-(t - rise) / tau).exp()
    }
}

fn smoothstep(lo: f64, hi: f64, x: f64) -> f64 {
    let t = ((x - lo) / (hi - lo)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The palette colour at position `p` (in colours): each colour holds through the outer 30 % of its slot and
/// crossfades with the next through the middle 30 %.
pub(crate) fn palette_colour(colors: &[Rgb], p: f64) -> Rgb {
    let n = colors.len();
    let p = if p.is_finite() { p.rem_euclid(n as f64) } else { 0.0 };
    let a = (p.floor() as usize) % n;
    lerp(colors[a], colors[(a + 1) % n], smoothstep(0.35, 0.65, p - p.floor()))
}

fn lum(c: Rgb) -> f64 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/// What one light remembers between frames.
#[derive(Debug, Clone, Default)]
struct LightState {
    b: f64,
    swing: Swing,
}

pub(crate) struct Engine {
    bass_env: f64,
    high_env: f64,
    kick_age_ms: f64,
    /// Palette position in colours; always moving.
    pos: f64,
    clock_ms: f64,
    floor0: f64,
    /// (dt, bass, high) of recent frames, for the level window.
    recent: VecDeque<(f64, f64, f64)>,
    play_state: Vec<LightState>,
    panel_state: Vec<LightState>,
}

fn lerp(a: Rgb, b: Rgb, t: f64) -> Rgb {
    let t = t.clamp(0.0, 1.0);
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

fn scale(c: Rgb, k: f64) -> Rgb {
    [c[0] * k, c[1] * k, c[2] * k]
}

fn unit(c: Rgb) -> Rgb {
    [c[0].clamp(0.0, 1.0), c[1].clamp(0.0, 1.0), c[2].clamp(0.0, 1.0)]
}

impl Engine {
    pub(crate) fn new(floor: f64) -> Engine {
        Engine { bass_env: 0.0, high_env: 0.0, kick_age_ms: f64::INFINITY, pos: 0.0, clock_ms: 0.0, floor0: floor, recent: VecDeque::new(), play_state: Vec::new(), panel_state: Vec::new() }
    }

    /// A one-pole follower: fast up, slow down.
    fn follow(env: f64, target: f64, dt_ms: f64, attack_ms: f64, release_ms: f64) -> f64 {
        let tau = if target > env { attack_ms } else { release_ms };
        env + (target - env) * (1.0 - (-dt_ms / tau).exp())
    }

    fn shaped(level: f64, gain: f64) -> f64 {
        let shaped = ((level - LEVEL_LO) / LEVEL_SPAN).clamp(0.0, 1.0);
        (shaped * gain).clamp(0.0, 1.0)
    }

    /// The mean of the recent band levels over `level_window` frames, weighted by the time each lasted.
    fn windowed(&mut self, dt: f64, bass: f64, high: f64, window: f64) -> (f64, f64) {
        self.recent.push_back((dt.max(1.0), bass, high));
        let span = window * FRAME_MS;
        let mut total: f64 = self.recent.iter().map(|r| r.0).sum();
        while self.recent.len() > 1 && total - self.recent[0].0 >= span {
            total -= self.recent[0].0;
            self.recent.pop_front();
        }
        let (b, h) = self.recent.iter().fold((0.0, 0.0), |acc, r| (acc.0 + r.0 * r.1, acc.1 + r.0 * r.2));
        (b / total, h / total)
    }

    /// How far into the ring the kick is, 0 (not started) to above 1 (done), or None when there is no kick.
    fn ring_front(&self, s: &Settings) -> Option<f64> {
        (self.kick_age_ms < s.ripple_ms).then(|| self.kick_age_ms / s.ripple_ms)
    }

    /// Advance by one tick and make the frame. `n_plays` Plays are counted left to right; the inner ones
    /// follow the bass, the outer ones the highs. `panel_xy` are the panel positions.
    pub(crate) fn step(&mut self, t: &Tuning, input: Input, n_plays: usize, panel_xy: &[(f64, f64)]) -> Output {
        let s = &t.settings;
        let dt = if input.dt_ms.is_finite() { input.dt_ms.clamp(0.0, 500.0) } else { 0.0 };
        let level = |v: f64| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
        let (wb, wh) = self.windowed(dt, level(input.bass), level(input.high), s.level_window);
        self.bass_env = Self::follow(self.bass_env, Self::shaped(wb, s.bass_gain), dt, s.attack_ms, s.release_ms);
        self.high_env = Self::follow(self.high_env, Self::shaped(wh, s.high_gain), dt, s.attack_ms, s.release_ms);
        self.clock_ms += dt;

        if input.beat {
            self.pos += s.beat_nudge;
            if !(self.kick_age_ms < s.min_pulse_gap_ms) {
                self.kick_age_ms = 0.0;
            }
        }
        self.pos = (self.pos + dt / s.drift_ms).rem_euclid(t.palette.colors.len() as f64);
        let pulse = kick_shape(self.kick_age_ms, s.kick_rise_ms, s.kick_decay_ms);

        let plays = if s.plays { self.plays(t, n_plays, pulse, dt) } else { vec![[0.0; 3]; n_plays] };
        let panels = if s.panels { self.panels(t, panel_xy, pulse, dt) } else { Vec::new() };
        if self.kick_age_ms.is_finite() {
            self.kick_age_ms += dt;
        }
        Output { plays, panels }
    }

    fn band_env(&self, b: Band) -> f64 {
        match b {
            Band::Bass => self.bass_env,
            Band::Highs => self.high_env,
            Band::Both => (self.bass_env + self.high_env) / 2.0,
        }
    }

    /// One light's colour: the brightness target from the sound and the pulse, the fall rate limit, the
    /// white mix, then the flash guard on the luminance.
    fn light(clock: f64, dt: f64, st: &mut LightState, s: &Settings, colour: Rgb, kick: Rgb, env: f64, lift: f64) -> Rgb {
        let target = s.floor + (s.brightness - s.floor) * (s.energy_depth * env + s.kick_flash * lift).clamp(0.0, 1.0);
        let b = if target < st.b { target.max(st.b - s.slew_down * dt / 1000.0) } else { target };
        st.b = b;
        let mixed = lerp(colour, kick, s.kick_white * lift);
        let out = scale(mixed, b);
        let y = lum(out);
        let held = st.swing.limit(clock, y, GUARD_MAX_TRANSITIONS);
        let shown = unit(if y > 1e-6 { scale(out, held / y) } else { out });
        st.swing.commit(clock, lum(shown));
        shown
    }

    fn plays(&mut self, t: &Tuning, n: usize, pulse: f64, dt: f64) -> Vec<Rgb> {
        let s = &t.settings;
        while self.play_state.len() < n {
            self.play_state.push(LightState { b: self.floor0.max(s.floor), ..Default::default() });
        }
        let mut states = std::mem::take(&mut self.play_state);
        let out = (0..n)
            .map(|i| {
                let d = (i as f64 - (n as f64 - 1.0) / 2.0).abs();
                let inner = d < (n as f64 - 1.0) / 4.0 + 0.5;
                let env = match s.follow.plays.get(i).copied().flatten() {
                    Some(b) => self.band_env(b),
                    None if inner => self.bass_env,
                    None => self.high_env,
                };
                let colour = palette_colour(&t.palette.colors, self.pos + i as f64 * 0.25);
                Self::light(self.clock_ms, dt, &mut states[i], s, colour, t.palette.kick, env, pulse * if inner { 1.0 } else { 0.5 })
            })
            .collect();
        self.play_state = states;
        out
    }

    fn panels(&mut self, t: &Tuning, xy: &[(f64, f64)], pulse: f64, dt: f64) -> Vec<[u8; 4]> {
        if xy.is_empty() {
            return Vec::new();
        }
        let s = &t.settings;
        let n = xy.len() as f64;
        while self.panel_state.len() < xy.len() {
            self.panel_state.push(LightState { b: self.floor0.max(s.floor), ..Default::default() });
        }
        let mut states = std::mem::take(&mut self.panel_state);
        let (cx, cy) = (xy.iter().map(|p| p.0).sum::<f64>() / n, xy.iter().map(|p| p.1).sum::<f64>() / n);
        let dist: Vec<f64> = xy.iter().map(|p| ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt()).collect();
        let far = dist.iter().cloned().fold(0.0_f64, f64::max).max(1.0);
        let env = match s.follow.panels {
            None => (self.bass_env + self.high_env) / 2.0,
            Some(b) => self.band_env(b),
        };
        let front = self.ring_front(s);
        let out = dist
            .iter()
            .enumerate()
            .map(|(i, d)| {
                let colour = palette_colour(&t.palette.colors, self.pos + i as f64 / n);
                // Ripple off: the whole set takes the same pulse as the Plays, no ring.
                let lift = if s.ripple { front.map_or(0.0, |f| (-((d / far - f) / 0.2).powi(2)).exp() * (1.0 - f * f)) } else { pulse };
                let c = Self::light(self.clock_ms, dt, &mut states[i], s, colour, t.palette.kick, env, lift);
                [(c[0] * 255.0).round() as u8, (c[1] * 255.0).round() as u8, (c[2] * 255.0).round() as u8, 0]
            })
            .collect();
        self.panel_state = states;
        out
    }
}

/// The per-stream numbers the log line reports: beats per second, the most swings a light made in a second
/// (flashes are half of that), and the lowest luminance a Play showed.
pub(crate) struct Stats {
    swings: Vec<Swing>,
    beats: VecDeque<f64>,
    beat_total: u32,
    max_beats: usize,
    max_swings: usize,
    min_lum: f64,
    start_ms: Option<f64>,
    last_ms: f64,
}

impl Stats {
    pub(crate) fn new() -> Stats {
        Stats { swings: Vec::new(), beats: VecDeque::new(), beat_total: 0, max_beats: 0, max_swings: 0, min_lum: f64::INFINITY, start_ms: None, last_ms: 0.0 }
    }

    pub(crate) fn observe(&mut self, now_ms: f64, beat: bool, plays: &[Rgb]) {
        self.start_ms.get_or_insert(now_ms);
        self.last_ms = now_ms;
        if beat {
            self.beat_total += 1;
            self.beats.push_back(now_ms);
        }
        while self.beats.front().is_some_and(|t| *t <= now_ms - 1000.0) {
            self.beats.pop_front();
        }
        self.max_beats = self.max_beats.max(self.beats.len());
        while self.swings.len() < plays.len() {
            self.swings.push(Swing::default());
        }
        for (sw, c) in self.swings.iter_mut().zip(plays) {
            let y = lum(*c);
            sw.commit(now_ms, y);
            self.max_swings = self.max_swings.max(sw.transitions());
            self.min_lum = self.min_lum.min(y);
        }
    }

    pub(crate) fn line(&self) -> String {
        let secs = ((self.last_ms - self.start_ms.unwrap_or(self.last_ms)) / 1000.0).max(1.0);
        let min = if self.min_lum.is_finite() { self.min_lum } else { 0.0 };
        format!("lightsync: beats/s avg {:.1} max {}, flashes/s max {:.1}, min luminance {:.3}", f64::from(self.beat_total) / secs, self.max_beats, self.max_swings as f64 / 2.0, min)
    }
}

/// The two levels the engine wants from the 32 band bytes: the mean of the lowest six (bass) and of
/// bands 20 to 31 (highs), each 0..1. An empty slice (silence) is zero.
pub(crate) fn levels_from_bands(bands: &[u8]) -> (f64, f64) {
    let mean = |from: usize, to: usize| {
        let part: Vec<f64> = bands.iter().skip(from).take(to - from).map(|b| f64::from(*b) / 255.0).collect();
        if part.is_empty() { 0.0 } else { part.iter().sum::<f64>() / (to - from) as f64 }
    };
    (mean(0, 6), mean(20, 32))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(c: Rgb) -> String {
        format!("#{:02x}{:02x}{:02x}", (c[0] * 255.0).round() as u8, (c[1] * 255.0).round() as u8, (c[2] * 255.0).round() as u8)
    }

    fn pal_in() -> PaletteIn {
        PaletteIn { colors: vec!["#ff00aa".into(), "#35e6ea".into(), "#9a7bff".into()], kick: "#ffffff".into(), rest: "#301060".into() }
    }

    fn tuning(s: SettingsIn) -> Tuning {
        Tuning::from_in(&TuneIn { palette: pal_in(), settings: s }).unwrap()
    }

    fn quiet(dt: f64) -> Input {
        Input { bass: 0.0, high: 0.0, beat: false, dt_ms: dt }
    }

    /// Every colour the same grey, so lights compare by brightness alone.
    fn flat(s: SettingsIn) -> Tuning {
        let p = PaletteIn { colors: vec!["#808080".into(), "#808080".into()], kick: "#ffffff".into(), rest: "#301060".into() };
        Tuning::from_in(&TuneIn { palette: p, settings: s }).unwrap()
    }

    const XY: [(f64, f64); 5] = [(0.0, 0.0), (100.0, 0.0), (-100.0, 0.0), (0.0, 100.0), (0.0, -100.0)];

    #[test]
    fn bass_lands_on_the_inner_pair_and_highs_on_the_outer_pair() {
        let t = flat(SettingsIn { energy_depth: Some(1.0), ..Default::default() });
        let mut e = Engine::new(0.06);
        let mut out = e.step(&t, quiet(33.0), 4, &[]);
        for _ in 0..40 {
            out = e.step(&t, Input { bass: 1.0, high: 0.0, beat: false, dt_ms: 33.0 }, 4, &[]);
        }
        let lum = |p: &Rgb| p[0] + p[1] + p[2];
        assert!(lum(&out.plays[1]) > lum(&out.plays[0]) * 1.2 && lum(&out.plays[2]) > lum(&out.plays[3]) * 1.2, "{:?}", out.plays);
        let mut e = Engine::new(0.06);
        for _ in 0..40 {
            out = e.step(&t, Input { bass: 0.0, high: 1.0, beat: false, dt_ms: 33.0 }, 4, &[]);
        }
        assert!(lum(&out.plays[0]) > lum(&out.plays[1]) * 1.2 && lum(&out.plays[3]) > lum(&out.plays[2]) * 1.2, "{:?}", out.plays);
    }

    #[test]
    fn settings_are_clamped_and_odd_values_take_defaults() {
        let s = Settings::from_in(&SettingsIn {
            brightness: Some(9.0),
            floor: Some(-3.0),
            bass_gain: Some(50.0),
            high_gain: Some(f64::NAN),
            kick_flash: Some(2.0),
            attack_ms: Some(1.0),
            release_ms: Some(1e9),
            ripple_ms: Some(0.0),
            plays: Some(false),
            send_hz: Some(1000.0),
            energy_depth: Some(7.0),
            kick_white: Some(9.0),
            kick_rise_ms: Some(1.0),
            kick_decay_ms: Some(1e9),
            level_window: Some(99.0),
            drift_ms: Some(1.0),
            beat_nudge: Some(5.0),
            min_pulse_gap_ms: Some(1.0),
            slew_down: Some(f64::NAN),
            ..Default::default()
        });
        assert_eq!((s.brightness, s.floor, s.bass_gain, s.high_gain), (1.0, 0.05, 2.0, 1.0));
        assert_eq!((s.kick_flash, s.attack_ms, s.release_ms, s.ripple_ms, s.send_hz), (1.0, 40.0, 2000.0, 200.0, 60.0));
        assert_eq!((s.plays, s.panels), (false, true));
        assert_eq!((s.energy_depth, s.kick_white, s.kick_rise_ms, s.kick_decay_ms, s.level_window), (1.0, 0.5, 30.0, 1000.0, 12.0));
        assert_eq!((s.drift_ms, s.beat_nudge, s.min_pulse_gap_ms, s.slew_down), (2000.0, 0.25, 340.0, 0.8));
        let low = Settings::from_in(&SettingsIn { brightness: Some(0.0), send_hz: Some(f64::INFINITY), floor: Some(0.6), ..Default::default() });
        assert_eq!((low.brightness, low.send_hz), (0.2, 50.0));
        assert!(low.floor <= low.brightness - 0.1 + 1e-9, "floor stays under the peak");
        let d = Settings::from_in(&SettingsIn::default());
        assert_eq!((d.brightness, d.floor, d.attack_ms, d.release_ms, d.send_hz), (0.8, 0.35, 150.0, 900.0, 50.0));
    }

    fn lum(c: &Rgb) -> f64 {
        c[0] + c[1] + c[2]
    }

    fn js(v: serde_json::Value) -> SettingsIn {
        serde_json::from_value(v).unwrap()
    }

    /// Runs `n` ticks of constant input and returns the last frame.
    fn run(t: &Tuning, bass: f64, high: f64, n: usize, plays: usize, xy: &[(f64, f64)]) -> Output {
        let mut e = Engine::new(0.06);
        let mut out = e.step(t, quiet(33.0), plays, xy);
        for _ in 0..n {
            out = e.step(t, Input { bass, high, beat: false, dt_ms: 33.0 }, plays, xy);
        }
        out
    }

    #[test]
    fn follow_replaces_the_inner_outer_rule_for_the_lights_named() {
        // Bass only sounding. Default: Plays 1 and 2 (inner) light, 0 and 3 stay at the floor.
        let deep = serde_json::json!({ "energyDepth": 1 });
        let d = run(&flat(js(deep.clone())), 1.0, 0.0, 40, 4, &[]);
        assert!(lum(&d.plays[1]) > lum(&d.plays[0]) * 1.2);
        // Far Left set to bass, Left to highs: the pair swaps their roles.
        let t = flat(js(serde_json::json!({ "energyDepth": 1, "follow": { "plays": ["bass", "highs", "bass", "highs"], "panels": "bass" } })));
        let f = run(&t, 1.0, 0.0, 40, 4, &[]);
        assert!(lum(&f.plays[0]) > lum(&f.plays[1]) * 1.2, "far left follows the bass now: {:?}", f.plays);
        assert!(lum(&f.plays[2]) > lum(&f.plays[3]) * 1.2);
        // Both is the mean of the two envelopes: with highs only sounding it lights a bass-following Play less than
        // a highs-following one, and more than a bass-following one.
        let m = flat(js(serde_json::json!({ "energyDepth": 1, "follow": { "plays": ["both", "highs", "bass", "both"] } })));
        let hi = run(&m, 0.0, 1.0, 40, 4, &[]);
        assert!(lum(&hi.plays[0]) > lum(&hi.plays[2]), "both beats bass-only when highs sound: {:?}", hi.plays);
        assert!(lum(&hi.plays[0]) < lum(&hi.plays[1]), "both is the mean, not the louder: {:?}", hi.plays);
    }

    #[test]
    fn panels_both_is_the_mean_the_default_always_was() {
        // Bass loud, highs quiet. The default panels (no follow) and panels set to "both" are the same frame.
        let d = tuning(js(serde_json::json!({ "energyDepth": 1 })));
        let b = tuning(js(serde_json::json!({ "energyDepth": 1, "follow": { "panels": "both" } })));
        let (pd, pb) = (run(&d, 1.0, 0.2, 40, 0, &XY), run(&b, 1.0, 0.2, 40, 0, &XY));
        assert_eq!(pd.panels, pb.panels);
        // And the mean sits between the bass-only and highs-only panels.
        let lo = tuning(js(serde_json::json!({ "energyDepth": 1, "follow": { "panels": "highs" } })));
        let hi = tuning(js(serde_json::json!({ "energyDepth": 1, "follow": { "panels": "bass" } })));
        let (pl, ph) = (run(&lo, 1.0, 0.2, 40, 0, &XY), run(&hi, 1.0, 0.2, 40, 0, &XY));
        assert!(pl.panels[0][0] < pd.panels[0][0] && pd.panels[0][0] < ph.panels[0][0], "{:?} {:?} {:?}", pl.panels, pd.panels, ph.panels);
    }

    #[test]
    fn follow_panels_band_picks_the_envelope_the_panels_use() {
        let bass = tuning(js(serde_json::json!({ "follow": { "panels": "bass" }, "energyDepth": 1, "kickFlash": 0.0 })));
        let highs = tuning(js(serde_json::json!({ "follow": { "panels": "highs" }, "energyDepth": 1, "kickFlash": 0.0 })));
        let (pb, ph) = (run(&bass, 1.0, 0.0, 40, 0, &XY), run(&highs, 1.0, 0.0, 40, 0, &XY));
        assert!(pb.panels[0][0] > ph.panels[0][0] + 20, "bass-following panels are brighter on bass: {:?} {:?}", pb.panels, ph.panels);
    }

    #[test]
    fn follow_falls_back_per_light_and_never_fails_the_payload() {
        // Too many entries are cut to four; an unknown band and a non-string leave that light on the default.
        let f = Follow::from_in(Some(&serde_json::json!({ "plays": ["bass", "loud", 7, "highs", "both"], "panels": "nope" })));
        assert_eq!(f.plays, vec![Some(Band::Bass), None, None, Some(Band::Highs)]);
        assert_eq!(f.panels, None);
        // Short list: the rest default. Wrong types anywhere: all default.
        assert_eq!(Follow::from_in(Some(&serde_json::json!({ "plays": ["both"] }))).plays, vec![Some(Band::Both)]);
        for odd in [serde_json::json!("bass"), serde_json::json!(5), serde_json::json!({ "plays": "bass" }), serde_json::json!([1, 2])] {
            assert_eq!(Follow::from_in(Some(&odd)), Follow::default());
        }
        assert_eq!(Follow::from_in(None), Follow::default());
        // The whole payload still parses with a bad follow, and the rest of the settings apply.
        let v = serde_json::json!({
            "palette": { "colors": ["#ff00aa", "#35e6ea"], "kick": "#ffffff", "rest": "#200040" },
            "settings": { "brightness": 0.5, "follow": 12 }
        });
        let t = Tuning::from_in(&serde_json::from_value::<TuneIn>(v).unwrap()).unwrap();
        assert_eq!((t.settings.brightness, t.settings.follow), (0.5, Follow::default()));
    }

    #[test]
    fn palette_needs_two_to_six_hex_colours() {
        let mut p = pal_in();
        assert!(Palette::from_in(&p).is_some());
        assert_eq!(hex(Palette::from_in(&p).unwrap().colors[1]), "#35e6ea");
        p.colors.truncate(1);
        assert!(Palette::from_in(&p).is_none());
        p.colors = vec!["#000000".into(); 7];
        assert!(Palette::from_in(&p).is_none());
        p.colors = vec!["#000000".into(), "red".into()];
        assert!(Palette::from_in(&p).is_none());
        p.colors = vec!["#000000".into(), "#12345".into()];
        assert!(Palette::from_in(&p).is_none());
        p.colors = vec!["#000000".into(), "#ffffff".into()];
        p.kick = "nope".into();
        assert!(Palette::from_in(&p).is_none());
        assert_eq!(Tuning::from_in(&TuneIn { palette: p, settings: SettingsIn::default() }), Err(BAD_PALETTE));
    }

    #[test]
    fn parse_hex_handles_non_ascii_without_panicking() {
        assert!(parse_hex("#\u{e9}\u{e9}\u{e9}").is_none());
        assert_eq!(parse_hex(" #FF0000 "), Some([1.0, 0.0, 0.0]));
    }

    #[test]
    fn tune_input_reads_the_pages_json() {
        let v = serde_json::json!({
            "palette": { "id": "synthwave", "name": "Synthwave", "colors": ["#ff00aa", "#35e6ea"], "kick": "#ffffff", "rest": "#200040" },
            "settings": { "brightness": 0.5, "beatStep": false, "sendHz": 30 }
        });
        let t = Tuning::from_in(&serde_json::from_value::<TuneIn>(v).unwrap()).unwrap();
        assert_eq!((t.settings.brightness, t.settings.send_hz), (0.5, 30.0));
    }

    #[test]
    fn plays_off_sends_black_and_panels_off_sends_none() {
        let t = tuning(SettingsIn { plays: Some(false), panels: Some(false), ..Default::default() });
        let mut e = Engine::new(0.06);
        let out = e.step(&t, Input { bass: 1.0, high: 1.0, beat: true, dt_ms: 33.0 }, 4, &XY);
        assert_eq!(out.plays, vec![[0.0; 3]; 4]);
        assert!(out.panels.is_empty());
    }

    #[test]
    fn odd_input_never_breaks_the_frame() {
        let t = tuning(SettingsIn::default());
        let mut e = Engine::new(0.06);
        let out = e.step(&t, Input { bass: f64::NAN, high: 9.0, beat: false, dt_ms: f64::INFINITY }, 4, &XY);
        assert!(out.plays.iter().flatten().all(|v| (0.0..=1.0).contains(v)));
    }

    #[test]
    fn levels_split_bass_and_highs() {
        let mut b = [0u8; 32];
        for v in b.iter_mut().take(6) {
            *v = 255;
        }
        assert_eq!(levels_from_bands(&b), (1.0, 0.0));
        for v in b.iter_mut().skip(20) {
            *v = 255;
        }
        assert_eq!(levels_from_bands(&b), (1.0, 1.0));
        assert_eq!(levels_from_bands(&[]), (0.0, 0.0));
    }

    fn tuned(v: serde_json::Value) -> Tuning {
        tuning(js(v))
    }

    /// The three intensities, the same columns the page's table sends.
    fn intensity(name: &str) -> serde_json::Value {
        match name {
            "subtle" => serde_json::json!({ "floor": 0.35, "brightness": 0.8, "energyDepth": 0.35, "kickFlash": 0.25, "kickWhite": 0.0, "kickRiseMs": 80, "kickDecayMs": 450, "attackMs": 150, "releaseMs": 900, "levelWindow": 8, "driftMs": 10000, "beatNudge": 0.04, "minPulseGapMs": 500, "slewDown": 0.8 }),
            "moderate" => serde_json::json!({ "floor": 0.25, "brightness": 0.9, "energyDepth": 0.55, "kickFlash": 0.45, "kickWhite": 0.15, "kickRiseMs": 60, "kickDecayMs": 320, "attackMs": 100, "releaseMs": 650, "levelWindow": 4, "driftMs": 6000, "beatNudge": 0.08, "minPulseGapMs": 400, "slewDown": 1.5 }),
            "high" => serde_json::json!({ "floor": 0.15, "brightness": 1.0, "energyDepth": 0.75, "kickFlash": 0.7, "kickWhite": 0.35, "kickRiseMs": 40, "kickDecayMs": 220, "attackMs": 60, "releaseMs": 420, "levelWindow": 2, "driftMs": 4000, "beatNudge": 0.15, "minPulseGapMs": 340, "slewDown": 3.0 }),
            // Every control at the harshest the native clamps allow.
            _ => serde_json::json!({ "floor": 0.05, "brightness": 1.0, "energyDepth": 1.0, "kickFlash": 1.0, "kickWhite": 0.5, "kickRiseMs": 30, "kickDecayMs": 150, "attackMs": 40, "releaseMs": 200, "levelWindow": 1, "driftMs": 2000, "beatNudge": 0.25, "minPulseGapMs": 340, "slewDown": 5.0 }),
        }
    }

    const FIXTURE: &str = include_str!("../../tests/fixtures/lightsync-frames.json");

    /// The synthetic track: 3 s of silence, 14 s at 128 BPM with an 8 Hz hi hat, 3 s of silence (33 ms frames).
    fn fixture_frames() -> Vec<(f64, f64, bool)> {
        let v: serde_json::Value = serde_json::from_str(&FIXTURE.replace("\r\n", "\n")).unwrap();
        v["frames"].as_array().unwrap().iter().map(|f| (f[0].as_f64().unwrap(), f[1].as_f64().unwrap(), f[2].as_i64().unwrap() != 0)).collect()
    }

    fn fixture_tuning(settings: serde_json::Value) -> Tuning {
        let v: serde_json::Value = serde_json::from_str(&FIXTURE.replace("\r\n", "\n")).unwrap();
        let palette: PaletteIn = serde_json::from_value(serde_json::json!({ "colors": v["palette"]["colors"], "kick": v["palette"]["kick"], "rest": "#2a0f5a" })).unwrap();
        Tuning::from_in(&TuneIn { palette, settings: js(settings) }).unwrap()
    }

    #[test]
    fn silence_holds_the_floor_in_a_palette_colour() {
        let t = tuning(js(intensity("subtle")));
        let mut e = Engine::new(0.35);
        let mut out = e.step(&t, quiet(33.0), 4, &XY);
        for _ in 0..200 {
            out = e.step(&t, quiet(33.0), 4, &XY);
        }
        for (i, p) in out.plays.iter().enumerate() {
            let want = palette_colour(&t.palette.colors, e.pos + i as f64 * 0.25);
            let top = p.iter().cloned().fold(0.0, f64::max);
            assert!(top >= 0.35 * 0.95 * want.iter().cloned().fold(0.0, f64::max), "never off: {p:?}");
            // Same hue as the palette colour: the channels keep their ratios.
            for k in 0..3 {
                assert!((p[k] / top - want[k] / want.iter().cloned().fold(0.0, f64::max)).abs() < 0.02, "{p:?} vs {want:?}");
            }
        }
    }

    #[test]
    fn a_kick_pulses_without_white_on_subtle() {
        let t = tuning(js(intensity("subtle")));
        let mut e = Engine::new(0.35);
        let mut peak = 0.0_f64;
        for i in 0..60 {
            let out = e.step(&t, Input { bass: 0.0, high: 0.0, beat: i == 5, dt_ms: 33.0 }, 4, &[]);
            for (k, p) in out.plays.iter().enumerate() {
                peak = peak.max(p.iter().cloned().fold(0.0, f64::max));
                let want = palette_colour(&t.palette.colors, e.pos + k as f64 * 0.25);
                let (top, wtop) = (p.iter().cloned().fold(0.0, f64::max), want.iter().cloned().fold(0.0, f64::max));
                for c in 0..3 {
                    assert!((p[c] / top - want[c] / wtop).abs() < 0.05, "no white: {p:?} vs {want:?}");
                }
            }
        }
        assert!(peak <= 0.8 + 1e-9, "never above the peak: {peak}");
    }

    #[test]
    fn a_kick_lifts_the_plays_and_lets_them_settle() {
        let t = flat(js(intensity("subtle")));
        let mut e = Engine::new(0.35);
        let quiet_out = e.step(&t, quiet(33.0), 4, &[]);
        let mut top = 0.0_f64;
        e.step(&t, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 4, &[]);
        for _ in 0..6 {
            top = top.max(e.step(&t, quiet(33.0), 4, &[]).plays[1][0]);
        }
        assert!(top > quiet_out.plays[1][0] + 0.03, "the beat is a visible swell");
        let mut late = quiet_out.clone();
        for _ in 0..80 {
            late = e.step(&t, quiet(33.0), 4, &[]);
        }
        assert!((late.plays[1][0] - quiet_out.plays[1][0]).abs() < 0.01, "back at the floor after about 2.6 s");
    }

    #[test]
    fn the_kick_ring_moves_outward_over_ripple_ms() {
        let t = tuned(serde_json::json!({ "rippleMs": 600, "floor": 0.05, "kickFlash": 1.0, "kickRiseMs": 30, "slewDown": 5 }));
        let mut e = Engine::new(0.05);
        let base = e.step(&t, quiet(33.0), 0, &XY).panels;
        let mut first = e.step(&t, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 0, &XY);
        for _ in 0..3 {
            first = e.step(&t, quiet(33.0), 0, &XY);
        }
        // Early the ring sits at the centre panel (index 0), well above its neighbours' lift.
        let lift = |now: &Vec<[u8; 4]>, i: usize| i32::from(now[i][0]) - i32::from(base[i][0]);
        assert!(lift(&first.panels, 0) > lift(&first.panels, 1) + 5, "{:?} vs {:?}", first.panels, base);
        let mut mid = first.clone();
        for _ in 0..10 {
            mid = e.step(&t, quiet(33.0), 0, &XY);
        }
        assert!(lift(&mid.panels, 1) > lift(&mid.panels, 0), "the ring has moved out: {:?}", mid.panels);
        let mut done = mid;
        for _ in 0..60 {
            done = e.step(&t, quiet(33.0), 0, &XY);
        }
        for i in 0..5 {
            assert!(lift(&done.panels, i).abs() < 12, "ring gone: {:?} vs {:?}", done.panels, base);
        }
    }

    #[test]
    fn ripple_off_pulses_the_panels_whole() {
        let off = tuned(serde_json::json!({ "ripple": false, "kickFlash": 1.0, "kickRiseMs": 30 }));
        assert!(!off.settings.ripple);
        let mut e = Engine::new(0.35);
        let base = e.step(&off, quiet(33.0), 0, &XY).panels;
        e.step(&off, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 0, &XY);
        let mut hit = e.step(&off, quiet(33.0), 0, &XY);
        for _ in 0..2 {
            hit = e.step(&off, quiet(33.0), 0, &XY);
        }
        assert!(hit.panels.iter().zip(&base).all(|(a, b)| a[0] > b[0] || a[1] > b[1] || a[2] > b[2]), "every panel lifts at once: {:?} vs {base:?}", hit.panels);
    }

    #[test]
    fn pulse_rises_smoothly() {
        for name in ["subtle", "moderate"] {
            let t = tuning(js(intensity(name)));
            let mut e = Engine::new(0.35);
            let mut prev: Option<Output> = None;
            let frames = fixture_frames();
            for (bass, high, beat) in frames {
                // 50 Hz steps, each with the 33 ms frame's levels held.
                for k in 0..2 {
                    let out = e.step(&t, Input { bass, high, beat: beat && k == 0, dt_ms: 20.0 }, 4, &[]);
                    if let Some(p) = &prev {
                        for (a, b) in p.plays.iter().zip(&out.plays) {
                            let (ya, yb) = (a.iter().cloned().fold(0.0, f64::max), b.iter().cloned().fold(0.0, f64::max));
                            let limit = if name == "subtle" { 0.12 } else { 0.2 };
                            assert!((yb - ya).abs() < limit, "{name}: step {} on a frame", (yb - ya).abs());
                        }
                    }
                    prev = Some(out);
                }
            }
        }
    }

    #[test]
    fn flash_guard_holds_under_three_per_second() {
        for name in ["subtle", "moderate", "high", "harshest"] {
            let t = fixture_tuning(intensity(name));
            let mut e = Engine::new(t.settings.floor);
            let n = XY.len();
            let mut plays: Vec<Swing> = vec![Swing::default(); 4];
            let mut panels: Vec<Swing> = vec![Swing::default(); n];
            let mut now = 0.0;
            let mut worst = 0;
            // The fixture, then a fast track: bass and highs pounding with a beat every 274 ms.
            let mut input: Vec<(f64, f64, bool)> = fixture_frames();
            for i in 0..600 {
                let loud = (i / 4) % 2 == 0;
                input.push((if loud { 1.0 } else { 0.0 }, if i % 2 == 0 { 1.0 } else { 0.0 }, i % 8 == 0));
            }
            for (bass, high, beat) in input {
                now += 33.0;
                let out = e.step(&t, Input { bass, high, beat, dt_ms: 33.0 }, 4, &XY);
                for (sw, c) in plays.iter_mut().zip(&out.plays) {
                    sw.commit(now, super::lum(*c));
                    worst = worst.max(sw.transitions());
                }
                for (sw, c) in panels.iter_mut().zip(&out.panels) {
                    sw.commit(now, super::lum([f64::from(c[0]) / 255.0, f64::from(c[1]) / 255.0, f64::from(c[2]) / 255.0]));
                    // Panel bytes are rounded, which can add a transition only at the margin.
                    assert!(sw.transitions() <= GUARD_MAX_TRANSITIONS + 2, "{name}: {} panel swings in a second", sw.transitions());
                }
            }
            // The guard holds brightness at 5 swings a second. With every control at its harshest the palette's
            // own colour changes (a nudge of 0.25 colours on every beat) can add one more by shifting a light's
            // luminance, which is still 3 flashes, the WCAG ceiling.
            let cap = if name == "harshest" { GUARD_MAX_TRANSITIONS + 1 } else { GUARD_MAX_TRANSITIONS };
            assert!(worst <= cap, "{name}: {worst} swings in a second is over the cap");
        }
    }

    #[test]
    fn the_swing_guard_holds_a_square_wave_back() {
        let mut g = Swing::default();
        let mut out = Swing::default();
        let mut worst = 0;
        for i in 0..200 {
            let now = f64::from(i) * 20.0;
            let y = if (i / 2) % 2 == 0 { 0.2 } else { 0.8 };
            let held = g.limit(now, y, GUARD_MAX_TRANSITIONS);
            g.commit(now, held);
            out.commit(now, held);
            worst = worst.max(out.transitions());
        }
        assert!(worst <= GUARD_MAX_TRANSITIONS, "{worst}");
        assert!(worst >= 3, "the guard lets real swings through up to the cap: {worst}");
    }

    #[test]
    fn drift_is_continuous() {
        let t = tuning(js(intensity("subtle")));
        let mut e = Engine::new(0.35);
        let mut prev = e.step(&t, quiet(20.0), 4, &[]);
        let mut worst = 0.0_f64;
        for _ in 0..1000 {
            let out = e.step(&t, quiet(20.0), 4, &[]);
            for (a, b) in prev.plays.iter().zip(&out.plays) {
                for k in 0..3 {
                    worst = worst.max((a[k] - b[k]).abs());
                }
            }
            prev = out;
        }
        assert!(worst <= 0.02, "colour moved by {worst} in one frame");
        assert!(e.pos > 1.5, "the palette keeps moving without any beat: {}", e.pos);
    }

    #[test]
    fn old_pages_still_parse() {
        // A page from before this change: only the old fields, plus colourBars and beatStep.
        let old = Settings::from_in(&js(serde_json::json!({ "brightness": 0.9, "floor": 0.15, "kickFlash": 0.8, "attackMs": 50, "releaseMs": 380, "beatStep": true, "colourBars": 2 })));
        let sub = Settings::from_in(&js(intensity("subtle")));
        assert_eq!((old.energy_depth, old.kick_white, old.kick_rise_ms, old.kick_decay_ms), (sub.energy_depth, sub.kick_white, sub.kick_rise_ms, sub.kick_decay_ms));
        assert_eq!((old.level_window, old.drift_ms, old.beat_nudge, old.min_pulse_gap_ms, old.slew_down), (sub.level_window, sub.drift_ms, sub.beat_nudge, sub.min_pulse_gap_ms, sub.slew_down));
        // Wrong-typed colourBars and ripple never fail the payload.
        for odd in [serde_json::json!("x"), serde_json::json!(true), serde_json::json!([1, 2]), serde_json::json!({ "a": 1 }), serde_json::json!(null)] {
            let s = Settings::from_in(&js(serde_json::json!({ "brightness": 0.5, "colourBars": odd.clone(), "ripple": odd.clone() })));
            assert_eq!((s.brightness, s.ripple), (0.5, true), "{odd}");
        }
        assert!(!Settings::from_in(&js(serde_json::json!({ "ripple": false }))).ripple);
    }

    #[test]
    fn the_palette_holds_each_colour_then_crossfades() {
        let c = vec![[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        assert_eq!(palette_colour(&c, 0.0), c[0]);
        assert_eq!(palette_colour(&c, 0.3), c[0], "holds through the first third");
        let mid = palette_colour(&c, 0.5);
        assert!((mid[0] - 0.5).abs() < 1e-9 && (mid[1] - 0.5).abs() < 1e-9);
        assert_eq!(palette_colour(&c, 0.7), c[1]);
        assert_eq!(palette_colour(&c, 2.5)[2] + palette_colour(&c, 2.5)[0], 1.0, "wraps from the last colour to the first");
        assert_eq!(palette_colour(&c, 3.0), c[0]);
    }

    #[test]
    fn the_kick_shape_rises_then_falls_to_nothing() {
        assert_eq!(kick_shape(0.0, 80.0, 450.0), 0.0);
        assert!((kick_shape(40.0, 80.0, 450.0) - 0.5).abs() < 1e-9);
        assert!((kick_shape(80.0, 80.0, 450.0) - 1.0).abs() < 1e-9);
        assert!(kick_shape(530.0, 80.0, 450.0) < 0.38);
        assert_eq!(kick_shape(80.0 + 5.0 * 450.0 + 1.0, 80.0, 450.0), 0.0);
        assert_eq!(kick_shape(f64::INFINITY, 80.0, 450.0), 0.0);
    }

    #[test]
    fn pulses_closer_than_the_gap_do_not_restart_the_brightness() {
        let t = tuning(js(intensity("subtle")));
        let mut e = Engine::new(0.35);
        e.step(&t, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 4, &[]);
        for _ in 0..4 {
            e.step(&t, quiet(33.0), 4, &[]);
        }
        let pos = e.pos;
        e.step(&t, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 4, &[]);
        assert!(e.kick_age_ms > 100.0, "the second beat at about 170 ms did not restart the pulse");
        assert!(e.pos - pos > 0.04, "but it still nudged the colour");
    }

    #[test]
    fn fixture_parity() {
        let v: serde_json::Value = serde_json::from_str(&FIXTURE.replace("\r\n", "\n")).unwrap();
        let t = fixture_tuning(intensity("subtle"));
        let dt = v["dtMs"].as_f64().unwrap();
        let want = v["plays"].as_array().unwrap();
        let frames = fixture_frames();
        assert_eq!(want.len(), frames.len());
        let mut e = Engine::new(t.settings.floor);
        for (i, (bass, high, beat)) in frames.into_iter().enumerate() {
            let out = e.step(&t, Input { bass, high, beat, dt_ms: dt }, 4, &[]);
            let flat: Vec<f64> = out.plays.iter().flatten().copied().collect();
            for (k, got) in flat.iter().enumerate() {
                let exp = want[i][k].as_f64().unwrap();
                assert!((got - exp).abs() < 2e-6, "frame {i} channel {k}: {got} vs {exp}");
            }
        }
    }

    /// Writes the expected frames into the fixture. Run by hand after an engine change:
    /// `LIGHTSYNC_FIXTURE_OUT=path cargo test regenerate_fixture -- --ignored`.
    #[test]
    #[ignore]
    fn regenerate_fixture() {
        let mut v: serde_json::Value = serde_json::from_str(&FIXTURE.replace("\r\n", "\n")).unwrap();
        let t = fixture_tuning(intensity("subtle"));
        let dt = v["dtMs"].as_f64().unwrap();
        let mut e = Engine::new(t.settings.floor);
        let mut plays = Vec::new();
        for (bass, high, beat) in fixture_frames() {
            let out = e.step(&t, Input { bass, high, beat, dt_ms: dt }, 4, &[]);
            plays.push(out.plays.iter().flatten().map(|x| (x * 1e6).round() / 1e6).collect::<Vec<f64>>());
        }
        v["plays"] = serde_json::json!(plays);
        std::fs::write(std::env::var("LIGHTSYNC_FIXTURE_OUT").unwrap(), serde_json::to_string(&v).unwrap()).unwrap();
    }
}
