//! The frame function of the music light sync: sound levels, the beat, the palette and the settings
//! in, one colour per Play (left to right) and one per panel out. Nothing here touches a clock, a
//! socket or a global; the stream thread owns those. Rust holds no palette table and no defaults that
//! matter: the page sends `{ palette, settings }` and every value is validated and clamped here.

use serde::Deserialize;

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
    pub kick_flash: Option<f64>,
    pub attack_ms: Option<f64>,
    pub release_ms: Option<f64>,
    pub beat_step: Option<bool>,
    pub ripple_ms: Option<f64>,
    pub plays: Option<bool>,
    pub panels: Option<bool>,
    pub send_hz: Option<f64>,
    /// Bars between palette steps (1 to 8) when `beat_step` is on; absent keeps one step per beat.
    pub colour_bars: Option<f64>,
    /// `{ plays: [band; up to 4], panels: band }`, band "bass", "highs" or "both". Read leniently in `Follow::from_in`.
    pub follow: Option<serde_json::Value>,
    /// Panels ring out from the centre on a kick (default true); false pulses them whole.
    pub ripple: Option<bool>,
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
    /// The louder of the two envelopes.
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
    pub brightness: f64,
    pub floor: f64,
    pub bass_gain: f64,
    pub high_gain: f64,
    pub kick_flash: f64,
    pub attack_ms: f64,
    pub release_ms: f64,
    pub beat_step: bool,
    pub ripple_ms: f64,
    pub plays: bool,
    pub panels: bool,
    pub send_hz: f64,
    /// Beats between palette steps (`colourBars * 4`, rounded) with `beat_step` on; None is one per beat.
    pub step_beats: Option<u32>,
    pub follow: Follow,
    pub ripple: bool,
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
    /// Every value clamped to its range; a missing or non-finite one takes the default.
    pub(crate) fn from_in(s: &SettingsIn) -> Settings {
        let brightness = clamp_or(s.brightness, 0.1, 1.0, 0.85);
        Settings {
            brightness,
            floor: clamp_or(s.floor, 0.0, 0.5, 0.06).min(brightness),
            bass_gain: clamp_or(s.bass_gain, 0.0, 2.0, 1.0),
            high_gain: clamp_or(s.high_gain, 0.0, 2.0, 1.0),
            kick_flash: clamp_or(s.kick_flash, 0.0, 1.0, 0.8),
            attack_ms: clamp_or(s.attack_ms, 20.0, 200.0, 50.0),
            release_ms: clamp_or(s.release_ms, 100.0, 1500.0, 380.0),
            beat_step: s.beat_step.unwrap_or(true),
            ripple_ms: clamp_or(s.ripple_ms, 200.0, 1500.0, 600.0),
            plays: s.plays.unwrap_or(true),
            panels: s.panels.unwrap_or(true),
            send_hz: clamp_or(s.send_hz, 25.0, 60.0, 50.0),
            step_beats: s.colour_bars.filter(|b| b.is_finite()).map(|b| (b.clamp(1.0, 8.0) * 4.0).round() as u32),
            follow: Follow::from_in(s.follow.as_ref()),
            ripple: s.ripple.unwrap_or(true),
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

/// How long the Plays' kick flash takes to fade.
pub(crate) const KICK_FLASH_MS: f64 = 220.0;
/// The palette drifts one colour this often when `beatStep` is off.
const DRIFT_MS: f64 = 4000.0;
/// The band level where sound starts to count, and the span above it that fills the range.
const LEVEL_LO: f64 = 0.2;
const LEVEL_SPAN: f64 = 0.7;

pub(crate) struct Engine {
    bass_env: f64,
    high_env: f64,
    kick_age_ms: f64,
    colour_pos: usize,
    drift_ms: f64,
    /// Beats since the palette last stepped (only counted with `step_beats`).
    beats: u32,
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
        Engine { bass_env: floor, high_env: floor, kick_age_ms: f64::INFINITY, colour_pos: 0, drift_ms: 0.0, beats: 0 }
    }

    /// A one-pole follower: fast up, slow down.
    fn follow(env: f64, target: f64, dt_ms: f64, attack_ms: f64, release_ms: f64) -> f64 {
        let tau = if target > env { attack_ms } else { release_ms };
        env + (target - env) * (1.0 - (-dt_ms / tau).exp())
    }

    fn target(level: f64, gain: f64, s: &Settings) -> f64 {
        let shaped = ((level - LEVEL_LO) / LEVEL_SPAN).clamp(0.0, 1.0);
        s.floor + (s.brightness - s.floor) * (shaped * gain).clamp(0.0, 1.0)
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
        self.bass_env = Self::follow(self.bass_env, Self::target(level(input.bass), s.bass_gain, s), dt, s.attack_ms, s.release_ms);
        self.high_env = Self::follow(self.high_env, Self::target(level(input.high), s.high_gain, s), dt, s.attack_ms, s.release_ms);

        let colours = t.palette.colors.len();
        if input.beat {
            self.kick_age_ms = 0.0;
            if s.beat_step {
                self.beats += 1;
                if self.beats >= s.step_beats.unwrap_or(1) {
                    self.beats = 0;
                    self.colour_pos = (self.colour_pos + 1) % colours;
                }
            }
        }
        if !s.beat_step {
            self.drift_ms += dt;
            while self.drift_ms >= DRIFT_MS {
                self.drift_ms -= DRIFT_MS;
                self.colour_pos = (self.colour_pos + 1) % colours;
            }
        }
        let kick_amt = if self.kick_age_ms < KICK_FLASH_MS { (1.0 - self.kick_age_ms / KICK_FLASH_MS) * s.kick_flash } else { 0.0 };
        let span = (s.brightness - s.floor).max(1e-6);
        let ceiling = scale(t.palette.kick, s.brightness);

        let plays = if s.plays { self.plays(t, n_plays, kick_amt, span, ceiling) } else { vec![[0.0; 3]; n_plays] };
        let panels = if s.panels { self.panels(t, panel_xy, span, ceiling, kick_amt) } else { Vec::new() };
        if self.kick_age_ms.is_finite() {
            self.kick_age_ms += dt;
        }
        Output { plays, panels }
    }

    fn band_env(&self, b: Band) -> f64 {
        match b {
            Band::Bass => self.bass_env,
            Band::Highs => self.high_env,
            Band::Both => self.bass_env.max(self.high_env),
        }
    }

    fn plays(&self, t: &Tuning, n: usize, kick_amt: f64, span: f64, ceiling: Rgb) -> Vec<Rgb> {
        let s = &t.settings;
        let base = t.palette.colors[self.colour_pos % t.palette.colors.len()];
        (0..n)
            .map(|i| {
                let d = (i as f64 - (n as f64 - 1.0) / 2.0).abs();
                let inner = d < (n as f64 - 1.0) / 4.0 + 0.5;
                let env = match s.follow.plays.get(i).copied().flatten() {
                    Some(b) => self.band_env(b),
                    None if inner => self.bass_env,
                    None => self.high_env,
                };
                let m = (env - s.floor) / span;
                let rgb = scale(lerp(t.palette.rest, base, m), env);
                unit(lerp(rgb, ceiling, kick_amt * if inner { 1.0 } else { 0.5 }))
            })
            .collect()
    }

    fn panels(&self, t: &Tuning, xy: &[(f64, f64)], span: f64, ceiling: Rgb, kick_amt: f64) -> Vec<[u8; 4]> {
        if xy.is_empty() {
            return Vec::new();
        }
        let s = &t.settings;
        let n = xy.len() as f64;
        let (cx, cy) = (xy.iter().map(|p| p.0).sum::<f64>() / n, xy.iter().map(|p| p.1).sum::<f64>() / n);
        let dist: Vec<f64> = xy.iter().map(|p| ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt()).collect();
        let far = dist.iter().cloned().fold(0.0_f64, f64::max).max(1.0);
        let env = match s.follow.panels {
            None => (self.bass_env + self.high_env) / 2.0,
            Some(b) => self.band_env(b),
        };
        let m = (env - s.floor) / span;
        let front = self.ring_front(s);
        dist.iter()
            .enumerate()
            .map(|(i, d)| {
                let base = t.palette.colors[(self.colour_pos + i) % t.palette.colors.len()];
                let rgb = scale(lerp(t.palette.rest, base, m), env);
                // Ripple off: the whole set pulses with the Plays' kick flash, no ring.
                let ring = if s.ripple { front.map_or(0.0, |f| (-((d / far - f) / 0.2).powi(2)).exp() * s.kick_flash) } else { kick_amt };
                let c = unit(lerp(rgb, ceiling, ring));
                [(c[0] * 255.0).round() as u8, (c[1] * 255.0).round() as u8, (c[2] * 255.0).round() as u8, 0]
            })
            .collect()
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

    const XY: [(f64, f64); 5] = [(0.0, 0.0), (100.0, 0.0), (-100.0, 0.0), (0.0, 100.0), (0.0, -100.0)];

    #[test]
    fn silence_gives_the_floor_in_the_rest_colour() {
        let t = tuning(SettingsIn { floor: Some(0.2), ..Default::default() });
        let mut e = Engine::new(0.2);
        let mut out = e.step(&t, quiet(33.0), 4, &XY);
        for _ in 0..200 {
            out = e.step(&t, quiet(33.0), 4, &XY);
        }
        let rest = t.palette.rest;
        for p in &out.plays {
            for k in 0..3 {
                assert!((p[k] - rest[k] * 0.2).abs() < 1e-6, "{p:?}");
            }
        }
        assert!(out.plays.iter().all(|p| p.iter().any(|v| *v > 0.0)), "never black");
        assert_eq!(out.panels.len(), 5);
    }

    #[test]
    fn a_kick_flashes_the_plays_then_fades() {
        let t = tuning(SettingsIn { kick_flash: Some(1.0), ..Default::default() });
        let mut e = Engine::new(0.06);
        let quiet_out = e.step(&t, quiet(33.0), 4, &XY);
        let hit = e.step(&t, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 4, &XY);
        assert!(hit.plays[1][0] > quiet_out.plays[1][0] + 0.5, "inner Play flashes");
        let mut late = hit.clone();
        for _ in 0..12 {
            late = e.step(&t, quiet(33.0), 4, &XY);
        }
        assert!(late.plays[1][0] < hit.plays[1][0] - 0.4, "flash gone after about 400 ms");
    }

    #[test]
    fn the_kick_ring_moves_outward_over_ripple_ms() {
        let t = tuning(SettingsIn { ripple_ms: Some(600.0), floor: Some(0.0), ..Default::default() });
        let mut e = Engine::new(0.0);
        let first = e.step(&t, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 0, &XY);
        // At the start the ring sits at the centre panel (index 0).
        assert!(first.panels[0][0] > first.panels[1][0], "{:?}", first.panels);
        let mut mid = first.clone();
        for _ in 0..16 {
            mid = e.step(&t, quiet(33.0), 0, &XY);
        }
        // About 530 ms in the ring is at the outer panels, past the centre one.
        assert!(mid.panels[1][0] > mid.panels[0][0], "{:?}", mid.panels);
        let mut done = mid;
        for _ in 0..30 {
            done = e.step(&t, quiet(33.0), 0, &XY);
        }
        assert!(done.panels.iter().all(|p| p[0] < 8), "ring gone after ripple_ms: {:?}", done.panels);
    }

    #[test]
    fn bass_lands_on_the_inner_pair_and_highs_on_the_outer_pair() {
        let t = tuning(SettingsIn::default());
        let mut e = Engine::new(0.06);
        let mut out = e.step(&t, quiet(33.0), 4, &[]);
        for _ in 0..40 {
            out = e.step(&t, Input { bass: 1.0, high: 0.0, beat: false, dt_ms: 33.0 }, 4, &[]);
        }
        let lum = |p: &Rgb| p[0] + p[1] + p[2];
        assert!(lum(&out.plays[1]) > lum(&out.plays[0]) * 2.0 && lum(&out.plays[2]) > lum(&out.plays[3]) * 2.0, "{:?}", out.plays);
        let mut e = Engine::new(0.06);
        for _ in 0..40 {
            out = e.step(&t, Input { bass: 0.0, high: 1.0, beat: false, dt_ms: 33.0 }, 4, &[]);
        }
        assert!(lum(&out.plays[0]) > lum(&out.plays[1]) * 2.0 && lum(&out.plays[3]) > lum(&out.plays[2]) * 2.0, "{:?}", out.plays);
    }

    #[test]
    fn beat_step_moves_one_colour_per_beat_and_only_then() {
        let beat = Input { bass: 1.0, high: 1.0, beat: true, dt_ms: 33.0 };
        let hold = Input { bass: 1.0, high: 1.0, beat: false, dt_ms: 33.0 };
        let on = tuning(SettingsIn { beat_step: Some(true), ..Default::default() });
        let mut e = Engine::new(0.06);
        e.step(&on, hold, 4, &[]);
        assert_eq!(e.colour_pos, 0);
        e.step(&on, beat, 4, &[]);
        assert_eq!(e.colour_pos, 1);
        e.step(&on, hold, 4, &[]);
        assert_eq!(e.colour_pos, 1);
        e.step(&on, beat, 4, &[]);
        e.step(&on, beat, 4, &[]);
        assert_eq!(e.colour_pos, 0, "three colours: 1, 2, 0");
        let off = tuning(SettingsIn { beat_step: Some(false), ..Default::default() });
        let mut e = Engine::new(0.06);
        for _ in 0..5 {
            e.step(&off, beat, 4, &[]);
        }
        assert_eq!(e.colour_pos, 0, "beats do not step it; only the slow drift does");
    }

    #[test]
    fn drift_steps_when_beat_step_is_off() {
        let off = tuning(SettingsIn { beat_step: Some(false), ..Default::default() });
        let mut e = Engine::new(0.06);
        for _ in 0..130 {
            e.step(&off, quiet(33.0), 4, &[]);
        }
        assert_eq!(e.colour_pos, 1, "one step after about 4 s");
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
            beat_step: None,
            ripple_ms: Some(0.0),
            plays: Some(false),
            panels: None,
            send_hz: Some(1000.0),
            colour_bars: Some(99.0),
            follow: None,
            ripple: None,
        });
        assert_eq!((s.brightness, s.floor, s.bass_gain, s.high_gain), (1.0, 0.0, 2.0, 1.0));
        assert_eq!((s.kick_flash, s.attack_ms, s.release_ms, s.ripple_ms, s.send_hz), (1.0, 20.0, 1500.0, 200.0, 60.0));
        assert_eq!((s.beat_step, s.plays, s.panels), (true, false, true));
        let low = Settings::from_in(&SettingsIn { brightness: Some(0.0), send_hz: Some(f64::INFINITY), floor: Some(0.5), ..Default::default() });
        assert_eq!((low.brightness, low.send_hz), (0.1, 50.0));
        assert!(low.floor <= low.brightness, "floor never above the ceiling");
        let d = Settings::from_in(&SettingsIn::default());
        assert_eq!((d.brightness, d.floor, d.attack_ms, d.release_ms, d.send_hz), (0.85, 0.06, 50.0, 380.0, 50.0));
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
    fn an_old_payload_with_none_of_the_new_fields_gives_todays_frames() {
        // Absent fields: one palette step per beat, the inner and outer rule, ripple on, panels the mean.
        let old = Settings::from_in(&js(serde_json::json!({ "brightness": 0.9, "beatStep": true })));
        assert_eq!((old.step_beats, old.follow.clone(), old.ripple), (None, Follow::default(), true));
        let a = tuning(js(serde_json::json!({})));
        let b = tuning(js(serde_json::json!({ "follow": null, "colourBars": null, "ripple": null })));
        let (mut ea, mut eb) = (Engine::new(0.06), Engine::new(0.06));
        for i in 0..40 {
            let input = Input { bass: if i % 7 == 0 { 1.0 } else { 0.3 }, high: 0.5, beat: i % 5 == 0, dt_ms: 33.0 };
            assert_eq!(ea.step(&a, input, 4, &XY), eb.step(&b, input, 4, &XY));
        }
    }

    #[test]
    fn colour_bars_steps_the_palette_every_four_beats_per_bar() {
        let t = tuning(js(serde_json::json!({ "colourBars": 1 })));
        assert_eq!(t.settings.step_beats, Some(4));
        let beat = Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 };
        let mut e = Engine::new(0.06);
        for _ in 0..3 {
            e.step(&t, beat, 4, &[]);
        }
        assert_eq!(e.colour_pos, 0, "three beats: no step yet");
        e.step(&t, beat, 4, &[]);
        assert_eq!(e.colour_pos, 1, "the fourth beat steps once");
        for _ in 0..4 {
            e.step(&t, beat, 4, &[]);
        }
        assert_eq!(e.colour_pos, 2);
        // Two bars is eight beats.
        let two = tuning(js(serde_json::json!({ "colourBars": 2 })));
        let mut e = Engine::new(0.06);
        for _ in 0..7 {
            e.step(&two, beat, 4, &[]);
        }
        assert_eq!(e.colour_pos, 0);
        e.step(&two, beat, 4, &[]);
        assert_eq!(e.colour_pos, 1);
    }

    #[test]
    fn colour_bars_is_clamped_and_ignored_with_beat_step_off() {
        assert_eq!(Settings::from_in(&js(serde_json::json!({ "colourBars": 0.0 }))).step_beats, Some(4), "1 bar at least");
        assert_eq!(Settings::from_in(&js(serde_json::json!({ "colourBars": 50 }))).step_beats, Some(32), "8 bars at most");
        let off = tuning(js(serde_json::json!({ "colourBars": 1, "beatStep": false })));
        let beat = Input { bass: 1.0, high: 1.0, beat: true, dt_ms: 33.0 };
        let mut e = Engine::new(0.06);
        for _ in 0..8 {
            e.step(&off, beat, 4, &[]);
        }
        assert_eq!(e.colour_pos, 0, "beatStep off keeps its meaning: only the drift steps it");
    }

    #[test]
    fn follow_replaces_the_inner_outer_rule_for_the_lights_named() {
        // Bass only sounding. Default: Plays 1 and 2 (inner) light, 0 and 3 stay at the floor.
        let d = run(&tuning(SettingsIn::default()), 1.0, 0.0, 40, 4, &[]);
        assert!(lum(&d.plays[1]) > lum(&d.plays[0]) * 2.0);
        // Far Left set to bass, Left to highs: the pair swaps their roles.
        let t = tuning(js(serde_json::json!({ "follow": { "plays": ["bass", "highs", "bass", "highs"], "panels": "bass" } })));
        let f = run(&t, 1.0, 0.0, 40, 4, &[]);
        assert!(lum(&f.plays[0]) > lum(&f.plays[1]) * 2.0, "far left follows the bass now: {:?}", f.plays);
        assert!(lum(&f.plays[2]) > lum(&f.plays[3]) * 2.0);
        // Both takes the louder envelope: highs only sounding still lights an inner Play.
        let b = tuning(js(serde_json::json!({ "follow": { "plays": ["both", "both", "both", "both"] } })));
        let hi = run(&b, 0.0, 1.0, 40, 4, &[]);
        assert!(hi.plays.iter().all(|p| lum(p) > 1.0), "{:?}", hi.plays);
    }

    #[test]
    fn follow_panels_band_picks_the_envelope_the_panels_use() {
        let bass = tuning(js(serde_json::json!({ "follow": { "panels": "bass" }, "floor": 0.0, "kickFlash": 0.0 })));
        let highs = tuning(js(serde_json::json!({ "follow": { "panels": "highs" }, "floor": 0.0, "kickFlash": 0.0 })));
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
    fn ripple_off_pulses_the_panels_whole_with_no_ring() {
        let off = tuning(js(serde_json::json!({ "ripple": false, "floor": 0.0, "kickFlash": 1.0 })));
        assert!(!off.settings.ripple);
        let mut e = Engine::new(0.0);
        let first = e.step(&off, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 0, &XY);
        // Whole set at one level on the kick: every panel the same red channel (the colour step is per panel but the flash is shared).
        let flash: Vec<u8> = first.panels.iter().map(|p| p[0]).collect();
        assert!(flash.iter().all(|v| *v > 100), "every panel flashes at once: {flash:?}");
        let mut late = first.clone();
        for _ in 0..12 {
            late = e.step(&off, quiet(33.0), 0, &XY);
        }
        assert!(late.panels.iter().all(|p| p[0] < 8), "flash gone after about 220 ms: {:?}", late.panels);
        // Ripple on (the default) still rings: at the start only the centre panel is lit.
        let on = tuning(js(serde_json::json!({ "floor": 0.0, "kickFlash": 1.0 })));
        assert!(on.settings.ripple);
        let mut e = Engine::new(0.0);
        let ring = e.step(&on, Input { bass: 0.0, high: 0.0, beat: true, dt_ms: 33.0 }, 0, &XY);
        assert!(ring.panels[0][0] > ring.panels[1][0], "{:?}", ring.panels);
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
        assert_eq!((t.settings.brightness, t.settings.beat_step, t.settings.send_hz), (0.5, false, 30.0));
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
}
