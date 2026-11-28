//! Beat (kick) detection from the low bands of the audio frame: a port of `wall/src/audio/beat.ts`
//! with the same constants and the same rules. `tests/fixtures/beat-frames.json` is read by both
//! detectors, so a change to one that the other does not follow fails a test on each side.
//!
//! Bands arrive normalised to 0..1 over -70 to -10 dB. The low 12 are summed into one power level in
//! dB; an onset is a frame that rises above the previous one and clears the median of the last second
//! plus `ONSET_DB`; it counts once the next `CONFIRM_FRAMES` frames stay `HOLD_DB` above that median.
//! Beats are at least `MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS` apart and never more than three in any
//! second, on both the source clock (`now`) and the arrival clock (`arrival`).
//!
//! The tempo lock adds beats a loud sustained bass bed hides: rising frames `TEMPO_CAND_DB` over the median
//! are kept as candidates, the period comes from their weighted interval histogram refined on the phase
//! circle, and a candidate under the onset bar becomes a beat when the lock is confident and the candidate
//! sits on the learned pattern (see the long comment in `beat.ts`, which this follows step for step).

pub(crate) const BEAT_BANDS: usize = 12;
pub(crate) const BASS_BANDS: usize = 6;
pub(crate) const MIN_BEAT_GAP_MS: f64 = 340.0;
pub(crate) const BEAT_GAP_TOLERANCE_MS: f64 = 66.0;
pub(crate) const CALM_WINDOW_MS: f64 = 1000.0;
pub(crate) const CALM_MAX_BEATS: usize = 3;
pub(crate) const MEDIAN_WINDOW_MS: f64 = 1000.0;
pub(crate) const ONSET_DB: f64 = 7.0;
pub(crate) const HOLD_DB: f64 = 4.0;
pub(crate) const CONFIRM_FRAMES: u32 = 2;
pub(crate) const WARMUP_FRAMES: usize = 10;
pub(crate) const GAP_RESET_MS: f64 = 500.0;
pub(crate) const BEAT_HISTORY: usize = 8;

pub(crate) const TEMPO_CAND_DB: f64 = 3.0;
pub(crate) const TEMPO_HORIZON_MS: f64 = 8000.0;
pub(crate) const TEMPO_MIN_PERIOD_MS: f64 = 300.0;
pub(crate) const TEMPO_MAX_PERIOD_MS: f64 = 2000.0;
pub(crate) const TEMPO_TOL_MS: f64 = 60.0;
pub(crate) const TEMPO_MERGE_MS: f64 = 100.0;
pub(crate) const TEMPO_FINE_SPAN: f64 = 0.03;
pub(crate) const TEMPO_HOLD_BIAS: f64 = 1.0;
pub(crate) const TEMPO_HOLD_SPAN: f64 = 0.01;
pub(crate) const TEMPO_MIN_Z: f64 = 6.0;
pub(crate) const TEMPO_RESTART_ECHOES: u32 = 2;
pub(crate) const TEMPO_FAST_Z: f64 = 3.0;
pub(crate) const TEMPO_MIN_R: f64 = 0.35;
pub(crate) const TEMPO_PEAK_FLAT: f64 = 2.5;
pub(crate) const TEMPO_SLOT_SHARE: f64 = 0.6;
pub(crate) const TEMPO_CONFIRM_FRAMES: u32 = 1;
pub(crate) const TEMPO_HOLD_DB: f64 = 1.0;
const TEMPO_SLOTS: usize = 48;
const TEMPO_BIN_MS: f64 = 10.0;
const TEMPO_BINS: usize = 201;
const PHASE_BINS: usize = 100;
const TEMPO_PEAK_REACH: isize = 6;
const TEMPO_CORE_DIV: f64 = 5.0;

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
    pending_weak: bool,
    pending_fast: bool,
    c_times: [f64; TEMPO_SLOTS],
    c_above: [f64; TEMPO_SLOTS],
    c_head: usize,
    c_size: usize,
    hist: [f64; TEMPO_BINS + 7],
    phase: [f64; PHASE_BINS],
    period: f64,
    lock_z: f64,
    lock_r: f64,
    weak_beats: u64,
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
            pending_weak: false,
            pending_fast: false,
            c_times: [0.0; TEMPO_SLOTS],
            c_above: [0.0; TEMPO_SLOTS],
            c_head: 0,
            c_size: 0,
            hist: [0.0; TEMPO_BINS + 7],
            phase: [0.0; PHASE_BINS],
            period: f64::NAN,
            lock_z: 0.0,
            lock_r: 0.0,
            weak_beats: 0,
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
        self.pending_weak = false;
        self.pending_fast = false;
        self.bass = 0.0;
        self.c_head = 0;
        self.c_size = 0;
        self.period = f64::NAN;
        self.lock_z = 0.0;
        self.lock_r = 0.0;
    }

    /// Beats the tempo lock confirmed (tests).
    #[cfg(test)]
    pub(crate) fn weak_beats(&self) -> u64 {
        self.weak_beats
    }

    /// The tempo lock's period, Rayleigh statistic and resultant length (tests).
    #[cfg(test)]
    pub(crate) fn tempo(&self) -> (f64, f64, f64) {
        (self.period, self.lock_z, self.lock_r)
    }

    fn c_at(&self, i: usize) -> f64 {
        self.c_times[(self.c_head + i) % TEMPO_SLOTS]
    }

    fn c_w(&self, i: usize) -> f64 {
        self.c_above[(self.c_head + i) % TEMPO_SLOTS] - TEMPO_CAND_DB + 1.0
    }

    /// Resultant length of the candidates' phases at period `p`, weighted.
    fn resultant(&self, p: f64) -> f64 {
        let mut re = 0.0;
        let mut im = 0.0;
        for i in 0..self.c_size {
            let ang = (2.0 * std::f64::consts::PI * self.c_at(i)) / p;
            let w = self.c_w(i);
            re += w * ang.cos();
            im += w * ang.sin();
        }
        (re * re + im * im).sqrt()
    }

    /// Best integer period within `span` of `around`: (period, resultant).
    fn fine(&self, around: f64, span: f64) -> (f64, f64) {
        let mut best_res = -1.0;
        let mut best_p = around;
        let lo = TEMPO_MIN_PERIOD_MS.max((around * (1.0 - span)).floor());
        let hi = TEMPO_MAX_PERIOD_MS.min((around * (1.0 + span)).ceil());
        let mut p = lo;
        while p <= hi {
            let res = self.resultant(p);
            if res > best_res {
                best_res = res;
                best_p = p;
            }
            p += 1.0;
        }
        (best_p, best_res)
    }

    /// Add a candidate (or merge it into the newest) and re-estimate the period.
    fn add_candidate(&mut self, now: f64, above: f64) {
        while self.c_size > 0 && self.c_times[self.c_head] < now - TEMPO_HORIZON_MS {
            self.c_head = (self.c_head + 1) % TEMPO_SLOTS;
            self.c_size -= 1;
        }
        if self.c_size > 0 && now - self.c_at(self.c_size - 1) < TEMPO_MERGE_MS {
            let last = (self.c_head + self.c_size - 1) % TEMPO_SLOTS;
            if above > self.c_above[last] {
                self.c_above[last] = above;
            }
            return;
        }
        if self.c_size == TEMPO_SLOTS {
            self.c_head = (self.c_head + 1) % TEMPO_SLOTS;
            self.c_size -= 1;
        }
        let tail = (self.c_head + self.c_size) % TEMPO_SLOTS;
        self.c_times[tail] = now;
        self.c_above[tail] = above;
        self.c_size += 1;
        // Weighted histogram of every pair's interval.
        self.hist.fill(0.0);
        for i in 0..self.c_size {
            let ti = self.c_at(i);
            let wi = self.c_w(i);
            for j in (i + 1)..self.c_size {
                let d = self.c_at(j) - ti;
                if d < TEMPO_MIN_PERIOD_MS {
                    continue;
                }
                if d > TEMPO_MAX_PERIOD_MS {
                    break;
                }
                self.hist[(d / TEMPO_BIN_MS).round() as usize] += wi * self.c_w(j);
            }
        }
        let mut best = 0.0;
        let mut best_bin: isize = -1;
        let mut b = (TEMPO_MIN_PERIOD_MS / TEMPO_BIN_MS) as isize;
        while b <= TEMPO_BINS as isize - 1 {
            let mut sum = 0.0;
            for k in -TEMPO_PEAK_REACH..=TEMPO_PEAK_REACH {
                if b + k >= 0 {
                    sum += self.hist[(b + k) as usize];
                }
            }
            if sum > best {
                best = sum;
                best_bin = b;
            }
            b += 1;
        }
        if best_bin < 0 {
            self.period = f64::NAN;
            self.lock_z = 0.0;
            self.lock_r = 0.0;
            return;
        }
        // Centre on the weighted mean of the bins under the peak (the windowed sum is flat across it).
        let mut cn = 0.0;
        let mut cd = 0.0;
        for k in -TEMPO_PEAK_REACH..=TEMPO_PEAK_REACH {
            let bin = best_bin + k;
            if bin < 0 {
                continue;
            }
            cn += self.hist[bin as usize] * bin as f64 * TEMPO_BIN_MS;
            cd += self.hist[bin as usize];
        }
        let p0 = if cd > 0.0 { cn / cd } else { best_bin as f64 * TEMPO_BIN_MS };
        let (mut np, mut nres) = self.fine(p0, TEMPO_FINE_SPAN);
        if self.period.is_finite() {
            let (hp, hres) = self.fine(self.period, TEMPO_HOLD_SPAN);
            if hres * TEMPO_HOLD_BIAS >= nres {
                np = hp;
                nres = hres;
            }
        }
        self.period = np;
        let mut wsum = 0.0;
        let mut w2 = 0.0;
        for i in 0..self.c_size {
            let w = self.c_w(i);
            wsum += w;
            w2 += w * w;
        }
        self.lock_r = if wsum > 0.0 { nres / wsum } else { 0.0 };
        // Rayleigh statistic: effective candidate count times R squared (about 1 for random times).
        self.lock_z = if w2 > 0.0 { ((wsum * wsum) / w2) * self.lock_r * self.lock_r } else { 0.0 };
    }

    /// Whether `now` sits on a strong slot of the one-period pattern of the earlier candidates, on the predicted beat time.
    fn on_pattern(&mut self, now: f64) -> bool {
        self.phase.fill(0.0);
        let period = self.period;
        let bw = period / PHASE_BINS as f64;
        let mut total = 0.0;
        for i in 0..self.c_size {
            let c = self.c_at(i);
            if c >= now - 1.0 {
                continue;
            }
            let w = self.c_w(i);
            let idx = (((now - c) % period) / bw).floor();
            let idx = if idx > (PHASE_BINS - 1) as f64 { PHASE_BINS - 1 } else { idx as usize };
            self.phase[idx] += w;
            total += w;
        }
        if total <= 0.0 {
            return false;
        }
        let pb = PHASE_BINS as isize;
        let reach = ((TEMPO_TOL_MS / bw).round() as isize).max(1);
        let mut best = 0.0;
        let mut best_bin: isize = 0;
        let mut here = 0.0;
        for b in 0..pb {
            let mut sum = 0.0;
            for k in -reach..=reach {
                sum += self.phase[((b + k + pb) % pb) as usize];
            }
            if sum > best {
                best = sum;
                best_bin = b;
            }
            if b == 0 {
                here = sum;
            }
        }
        let flat = (total * (2 * reach + 1) as f64) / PHASE_BINS as f64;
        if best < TEMPO_PEAK_FLAT * flat || here < TEMPO_SLOT_SHARE * best {
            return false;
        }
        // The predicted beat time is the heaviest narrow stretch of the best slot; now must be within the tolerance of it.
        let nr = ((reach as f64 / TEMPO_CORE_DIV).round() as isize).max(1);
        let mut nbest = -1.0;
        let mut nbin = best_bin;
        for c in -reach..=reach {
            let mut sum = 0.0;
            for k in -nr..=nr {
                sum += self.phase[((best_bin + c + k + pb * 2) % pb) as usize];
            }
            if sum > nbest {
                nbest = sum;
                nbin = best_bin + c;
            }
        }
        let mut mean = 0.0;
        let mut weight = 0.0;
        for k in -nr..=nr {
            let w = self.phase[((nbin + k + pb * 2) % pb) as usize];
            mean += w * k as f64;
            weight += w;
        }
        let mut off = ((nbin as f64 + 0.5 + if weight > 0.0 { mean / weight } else { 0.0 }) % PHASE_BINS as f64) * bw;
        if off > period / 2.0 {
            off -= period;
        }
        off.abs() <= TEMPO_TOL_MS
    }

    /// Whether an earlier candidate sits `k` periods before `now`, within the tolerance.
    fn echo_at(&self, now: f64, k: f64) -> bool {
        let want = now - k * self.period;
        for i in (0..self.c_size).rev() {
            let c = self.c_at(i);
            if c >= now - 1.0 {
                continue;
            }
            if (c - want).abs() <= TEMPO_TOL_MS {
                return true;
            }
            if c < want - TEMPO_TOL_MS {
                break;
            }
        }
        false
    }

    fn locked(&self, min_z: f64) -> bool {
        self.lock_z >= min_z && self.lock_r >= TEMPO_MIN_R && self.period.is_finite()
    }

    /// Whether a weak onset at `now` is a beat of the lock.
    fn tempo_beat(&mut self, now: f64) -> bool {
        if !self.locked(TEMPO_MIN_Z) || !self.on_pattern(now) {
            return false;
        }
        let e1 = self.echo_at(now, 1.0);
        let e2 = self.echo_at(now, 2.0);
        if !(e1 || e2) {
            return false;
        }
        // A lock with no beat in the last two periods restarts only on a candidate with at least two echoes of three.
        if now - self.last_beat_at > 2.0 * self.period + TEMPO_TOL_MS {
            return u32::from(e1) + u32::from(e2) + u32::from(self.echo_at(now, 3.0)) >= TEMPO_RESTART_ECHOES;
        }
        true
    }

    /// The plain low level of the newest frame, 0 to 1 (kept for the fixture and tests).
    #[cfg(test)]
    pub(crate) fn bass(&self) -> f64 {
        self.bass
    }

    /// Feed one frame of normalised bands (0 to 1) at source time `now` ms, which arrived at `arrival` ms
    /// on the real clock. When a beat was confirmed by this frame, the ms from its onset to now.
    pub(crate) fn push(&mut self, bands: &[f64], now: f64, arrival: f64) -> Option<f64> {
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

        let mut beat = None;
        let need_held = if self.pending_weak {
            TEMPO_CONFIRM_FRAMES
        } else if self.pending_fast {
            1
        } else {
            CONFIRM_FRAMES
        };
        if let Some(pending_at) = self.pending_at {
            if above >= if self.pending_weak { TEMPO_HOLD_DB } else { HOLD_DB } {
                self.pending_held += 1;
                if self.pending_held >= need_held
                    && (arrival - self.arrivals[CALM_MAX_BEATS - 1] < MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS || arrival - self.arrivals[0] < CALM_WINDOW_MS)
                {
                    // Too soon after the last beat on the real clock: refused.
                    self.pending_at = None;
                } else if self.pending_held >= need_held {
                    if self.pending_weak {
                        self.weak_beats += 1;
                    }
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
                    beat = Some(now - pending_at);
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
            self.pending_weak = false;
            self.pending_fast = self.locked(TEMPO_FAST_Z) && self.on_pattern(now);
        } else if self.size >= WARMUP_FRAMES
            && above >= TEMPO_CAND_DB
            && level > self.prev_level
            && now - self.last_beat_at >= MIN_BEAT_GAP_MS - BEAT_GAP_TOLERANCE_MS
            && (self.count < CALM_MAX_BEATS as u64 || now - self.stamps[BEAT_HISTORY - CALM_MAX_BEATS] >= CALM_WINDOW_MS)
            && self.tempo_beat(now)
        {
            self.pending_at = Some(now);
            self.pending_held = 0;
            self.pending_weak = true;
            self.pending_fast = false;
        }
        if self.size >= WARMUP_FRAMES && above >= TEMPO_CAND_DB && level > self.prev_level {
            self.add_candidate(now, above);
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
            if d.push(f, t, t).is_some() {
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

    /// The tempo lock fires on the soft kick fixture and finds its 600 ms period.
    #[test]
    fn the_tempo_lock_finds_a_soft_kick_the_onset_bar_misses() {
        let v: serde_json::Value = serde_json::from_str(&FIXTURE.replace("\r\n", "\n")).unwrap();
        let c = v["cases"].as_array().unwrap().iter().find(|c| c["name"].as_str().unwrap().starts_with("soft kick")).unwrap();
        let frames: Vec<Vec<f64>> = c["frames"].as_array().unwrap().iter().map(|f| f.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()).collect();
        let mut d = BeatDetector::new();
        for (i, f) in frames.iter().enumerate() {
            let t = i as f64 * c["frameMs"].as_f64().unwrap();
            d.push(f, t, t);
        }
        assert!(d.weak_beats() >= 10, "weak beats {}", d.weak_beats());
        let (period, z, r) = d.tempo();
        assert_eq!(period, 600.0);
        assert!(z > 6.0 && r > 0.35);
    }

    #[test]
    fn silence_gives_no_beat_and_zero_bass() {
        let mut d = BeatDetector::new();
        for i in 0..60 {
            assert!(d.push(&[0.0; 32], f64::from(i) * 33.0, f64::from(i) * 33.0).is_none());
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
            ("ONSET_DB", "7"),
            ("HOLD_DB", "4"),
            ("CONFIRM_FRAMES", "2"),
            ("WARMUP_FRAMES", "10"),
            ("GAP_RESET_MS", "500"),
            ("BEAT_HISTORY", "8"),
            ("TEMPO_CAND_DB", "3"),
            ("TEMPO_HORIZON_MS", "8000"),
            ("TEMPO_MIN_PERIOD_MS", "300"),
            ("TEMPO_MAX_PERIOD_MS", "2000"),
            ("TEMPO_TOL_MS", "60"),
            ("TEMPO_MERGE_MS", "100"),
            ("TEMPO_FINE_SPAN", "0.03"),
            ("TEMPO_HOLD_BIAS", "1"),
            ("TEMPO_HOLD_SPAN", "0.01"),
            ("TEMPO_MIN_Z", "6"),
            ("TEMPO_RESTART_ECHOES", "2"),
            ("TEMPO_FAST_Z", "3"),
            ("TEMPO_MIN_R", "0.35"),
            ("TEMPO_PEAK_FLAT", "2.5"),
            ("TEMPO_SLOT_SHARE", "0.6"),
            ("TEMPO_CONFIRM_FRAMES", "1"),
            ("TEMPO_HOLD_DB", "1"),
        ] {
            assert!(ts.contains(&format!("export const {name} = {value};")), "{name}");
        }
        assert_eq!(
            (BEAT_BANDS, BASS_BANDS, CALM_MAX_BEATS, CONFIRM_FRAMES, WARMUP_FRAMES, BEAT_HISTORY),
            (12, 6, 3, 2, 10, 8)
        );
        assert_eq!((MIN_BEAT_GAP_MS, BEAT_GAP_TOLERANCE_MS, CALM_WINDOW_MS, MEDIAN_WINDOW_MS, ONSET_DB, HOLD_DB, GAP_RESET_MS), (340.0, 66.0, 1000.0, 1000.0, 7.0, 4.0, 500.0));
        assert_eq!(
            (TEMPO_CAND_DB, TEMPO_HORIZON_MS, TEMPO_MIN_PERIOD_MS, TEMPO_MAX_PERIOD_MS, TEMPO_TOL_MS, TEMPO_MERGE_MS, TEMPO_FINE_SPAN, TEMPO_HOLD_BIAS, TEMPO_HOLD_SPAN),
            (3.0, 8000.0, 300.0, 2000.0, 60.0, 100.0, 0.03, 1.0, 0.01)
        );
        assert_eq!(
            (TEMPO_MIN_Z, TEMPO_FAST_Z, TEMPO_MIN_R, TEMPO_PEAK_FLAT, TEMPO_SLOT_SHARE, TEMPO_HOLD_DB),
            (6.0, 3.0, 0.35, 2.5, 0.6, 1.0)
        );
        assert_eq!((TEMPO_RESTART_ECHOES, TEMPO_CONFIRM_FRAMES), (2, 1));
    }
}
