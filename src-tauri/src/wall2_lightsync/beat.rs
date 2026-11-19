//! Beat (kick) detection from the low bands of the audio frame: a port of `wall/src/audio/beat.ts`
//! with the same constants and the same rules. `tests/fixtures/beat-frames.json` is read by both
//! detectors, so a change to one that the other does not follow fails a test on each side.
//!
//! Bands arrive normalised to 0..1 over -70 to -10 dB. The low 12 are summed into one power level in
//! dB; an onset is a frame that rises above the previous one and clears the median of the last second
//! plus `ONSET_DB`; it counts once the next `CONFIRM_FRAMES` frames stay `HOLD_DB` above that median.
//! Beats are at least `MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS` apart and never more than three in any
//! second, on both the source clock (`now`) and the arrival clock (`arrival`).

pub(crate) const BEAT_BANDS: usize = 12;
pub(crate) const BASS_BANDS: usize = 6;
pub(crate) const MIN_BEAT_GAP_MS: f64 = 340.0;
pub(crate) const BEAT_GAP_TOLERANCE_MS: f64 = 66.0;
pub(crate) const CALM_WINDOW_MS: f64 = 1000.0;
pub(crate) const CALM_MAX_BEATS: usize = 3;
pub(crate) const MEDIAN_WINDOW_MS: f64 = 1000.0;
pub(crate) const ONSET_DB: f64 = 9.0;
pub(crate) const HOLD_DB: f64 = 4.0;
pub(crate) const CONFIRM_FRAMES: u32 = 2;
pub(crate) const WARMUP_FRAMES: usize = 10;
pub(crate) const GAP_RESET_MS: f64 = 500.0;
pub(crate) const BEAT_HISTORY: usize = 8;

const BAND_DB_FLOOR: f64 = -70.0;
const BAND_DB_RANGE: f64 = 60.0;
const SLOTS: usize = 96;

pub(crate) struct BeatDetector {
    times: [f64; SLOTS],
    levels: [f64; SLOTS],
    window: [f64; SLOTS],
    scratch: [f64; SLOTS],
    head: usize,
    size: usize,
    prev_level: f64,
    prev_at: f64,
    pending_at: Option<f64>,
    pending_held: u32,
    arrivals: [f64; CALM_MAX_BEATS],
    stamps: [f64; BEAT_HISTORY],
    count: u64,
    last_beat_at: f64,
    bass: f64,
}

/// Median of the first `n` entries of `src`, sorted in `scratch`.
fn median(src: &[f64], n: usize, scratch: &mut [f64]) -> f64 {
    for i in 0..n {
        let v = src[i];
        let mut j = i as isize - 1;
        while j >= 0 && scratch[j as usize] > v {
            scratch[(j + 1) as usize] = scratch[j as usize];
            j -= 1;
        }
        scratch[(j + 1) as usize] = v;
    }
    if n % 2 == 1 { scratch[(n - 1) >> 1] } else { (scratch[n / 2 - 1] + scratch[n / 2]) / 2.0 }
}

impl BeatDetector {
    pub(crate) fn new() -> BeatDetector {
        BeatDetector {
            times: [0.0; SLOTS],
            levels: [0.0; SLOTS],
            window: [0.0; SLOTS],
            scratch: [0.0; SLOTS],
            head: 0,
            size: 0,
            prev_level: f64::NAN,
            prev_at: f64::NEG_INFINITY,
            pending_at: None,
            pending_held: 0,
            arrivals: [f64::NEG_INFINITY; CALM_MAX_BEATS],
            stamps: [0.0; BEAT_HISTORY],
            count: 0,
            last_beat_at: f64::NEG_INFINITY,
            bass: 0.0,
        }
    }

    /// Forget the history (silence, a new device). The beat count and stamps stay.
    pub(crate) fn clear(&mut self) {
        self.head = 0;
        self.size = 0;
        self.prev_level = f64::NAN;
        self.prev_at = f64::NEG_INFINITY;
        self.pending_at = None;
        self.pending_held = 0;
        self.bass = 0.0;
    }

    /// The plain low level of the newest frame, 0 to 1 (kept for the fixture and tests).
    #[cfg(test)]
    pub(crate) fn bass(&self) -> f64 {
        self.bass
    }

    /// Feed one frame of normalised bands (0 to 1) at source time `now` ms, which arrived at `arrival` ms
    /// on the real clock. True when a beat was confirmed by this frame.
    pub(crate) fn push(&mut self, bands: &[f64], now: f64, arrival: f64) -> bool {
        if now - self.prev_at > GAP_RESET_MS {
            self.clear();
        }
        self.prev_at = now;

        let mut power = 0.0;
        let mut bass = 0.0;
        let nb = BEAT_BANDS.min(bands.len());
        for (i, band) in bands.iter().take(nb).enumerate() {
            let v = if band.is_finite() { band.clamp(0.0, 1.0) } else { 0.0 };
            power += 10f64.powf((BAND_DB_FLOOR + v * BAND_DB_RANGE) / 10.0);
            if i < BASS_BANDS {
                bass += v;
            }
        }
        self.bass = if nb > 0 { bass / BASS_BANDS.min(nb) as f64 } else { 0.0 };
        let level = 10.0 * power.max(1e-12).log10();

        while self.size > 0 && self.times[self.head] < now - MEDIAN_WINDOW_MS {
            self.head = (self.head + 1) % SLOTS;
            self.size -= 1;
        }
        for i in 0..self.size {
            self.window[i] = self.levels[(self.head + i) % SLOTS];
        }
        let base = if self.size > 0 { median(&self.window, self.size, &mut self.scratch) } else { level };
        let above = level - base;

        let mut beat = false;
        if let Some(pending_at) = self.pending_at {
            if above >= HOLD_DB {
                self.pending_held += 1;
                if self.pending_held >= CONFIRM_FRAMES
                    && (arrival - self.arrivals[CALM_MAX_BEATS - 1] < MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS || arrival - self.arrivals[0] < CALM_WINDOW_MS)
                {
                    // Too soon after the last beat on the real clock: refused.
                    self.pending_at = None;
                } else if self.pending_held >= CONFIRM_FRAMES {
                    self.count += 1;
                    self.last_beat_at = pending_at;
                    for i in 1..CALM_MAX_BEATS {
                        self.arrivals[i - 1] = self.arrivals[i];
                    }
                    self.arrivals[CALM_MAX_BEATS - 1] = arrival;
                    for i in 1..BEAT_HISTORY {
                        self.stamps[i - 1] = self.stamps[i];
                    }
                    self.stamps[BEAT_HISTORY - 1] = pending_at;
                    self.pending_at = None;
                    beat = true;
                }
            } else {
                self.pending_at = None;
            }
        } else if self.size >= WARMUP_FRAMES
            && above >= ONSET_DB
            && level > self.prev_level
            && now - self.last_beat_at >= MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS
            && (self.count < CALM_MAX_BEATS as u64 || now - self.stamps[BEAT_HISTORY - CALM_MAX_BEATS] >= CALM_WINDOW_MS)
        {
            self.pending_at = Some(now);
            self.pending_held = 0;
        }

        self.prev_level = level;
        if self.size == SLOTS {
            self.head = (self.head + 1) % SLOTS;
            self.size -= 1;
        }
        let tail = (self.head + self.size) % SLOTS;
        self.times[tail] = now;
        self.levels[tail] = level;
        self.size += 1;
        beat
    }
}

/// Band bytes (0..255 over -70..-10 dB) as the 0..1 the detector takes. An empty frame (silence) is all zeros.
pub(crate) fn unit_bands(bytes: &[u8]) -> [f64; 32] {
    let mut out = [0.0; 32];
    for (o, b) in out.iter_mut().zip(bytes) {
        *o = f64::from(*b) / 255.0;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/beat-frames.json");

    fn run(frames: &[Vec<f64>], frame_ms: f64) -> Vec<usize> {
        let mut d = BeatDetector::new();
        let mut beats = Vec::new();
        for (i, f) in frames.iter().enumerate() {
            let t = i as f64 * frame_ms;
            if d.push(f, t, t) {
                beats.push(i);
            }
        }
        beats
    }

    /// The same file the web detector's test reads: both must find exactly these beat frames.
    #[test]
    fn beat_fixture_parity() {
        let v: serde_json::Value = serde_json::from_str(&FIXTURE.replace("\r\n", "\n")).unwrap();
        assert_eq!(v["bands"].as_u64(), Some(BEAT_BANDS as u64));
        let cases = v["cases"].as_array().unwrap();
        assert!(cases.len() >= 5);
        for c in cases {
            let frame_ms = c["frameMs"].as_f64().unwrap();
            let frames: Vec<Vec<f64>> = c["frames"].as_array().unwrap().iter().map(|f| f.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()).collect();
            let want: Vec<usize> = c["beats"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as usize).collect();
            assert_eq!(run(&frames, frame_ms), want, "{}", c["name"]);
        }
    }

    #[test]
    fn silence_gives_no_beat_and_zero_bass() {
        let mut d = BeatDetector::new();
        for i in 0..60 {
            assert!(!d.push(&[0.0; 32], f64::from(i) * 33.0, f64::from(i) * 33.0));
        }
        assert_eq!(d.bass(), 0.0);
    }

    #[test]
    fn a_gap_in_frames_starts_afresh() {
        let mut d = BeatDetector::new();
        for i in 0..20 {
            d.push(&[0.3; 12], f64::from(i) * 33.0, f64::from(i) * 33.0);
        }
        assert!(d.size > 0);
        d.push(&[0.9; 12], 5000.0, 5000.0);
        assert_eq!(d.size, 1, "history restarted by the 500 ms gap");
    }

    #[test]
    fn unit_bands_scales_bytes_and_pads_silence() {
        let u = unit_bands(&[255, 0, 51]);
        assert_eq!((u[0], u[1]), (1.0, 0.0));
        assert!((u[2] - 0.2).abs() < 1e-12);
        assert!(unit_bands(&[]).iter().all(|v| *v == 0.0));
    }

    #[test]
    fn constants_match_the_web_detector() {
        let ts = include_str!("../../../wall/src/audio/beat.ts").replace("\r\n", "\n");
        for (name, value) in [
            ("BEAT_BANDS", "12"),
            ("BASS_BANDS", "6"),
            ("MIN_BEAT_GAP_MS", "340"),
            ("BEAT_GAP_TOLERANCE_MS", "66"),
            ("CALM_WINDOW_MS", "1000"),
            ("CALM_MAX_BEATS", "3"),
            ("MEDIAN_WINDOW_MS", "1000"),
            ("ONSET_DB", "9"),
            ("HOLD_DB", "4"),
            ("CONFIRM_FRAMES", "2"),
            ("WARMUP_FRAMES", "10"),
            ("GAP_RESET_MS", "500"),
            ("BEAT_HISTORY", "8"),
        ] {
            assert!(ts.contains(&format!("export const {name} = {value};")), "{name}");
        }
        assert_eq!(
            (BEAT_BANDS, BASS_BANDS, CALM_MAX_BEATS, CONFIRM_FRAMES, WARMUP_FRAMES, BEAT_HISTORY),
            (12, 6, 3, 2, 10, 8)
        );
        assert_eq!((MIN_BEAT_GAP_MS, BEAT_GAP_TOLERANCE_MS, CALM_WINDOW_MS, MEDIAN_WINDOW_MS, ONSET_DB, HOLD_DB, GAP_RESET_MS), (340.0, 66.0, 1000.0, 1000.0, 9.0, 4.0, 500.0));
    }
}
