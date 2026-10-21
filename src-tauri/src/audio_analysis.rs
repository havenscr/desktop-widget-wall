/*
  ========================================================================
  WIDGET WALL DESKTOP - Audio spectrum analysis for the visualizer
  Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
  Fingerprint: AE-WWD-9F7C3E2A | analyticendeavors.com
  ========================================================================

  Turns the interleaved samples drained from the capture ring into the
  `audio-levels` payload: bass / mid / high from a real FFT, 32 log-spaced
  bands, and a 128-point mono waveform.

  The previous version banded by *time*: it split the drained interleaved
  buffer into three positional slices and took the mean absolute value of
  each, so bass, mid and high were three looks at the same loudness and moved
  together. This one mixes to mono, applies a Hann window and runs a 1024-point
  real FFT, so a kick drum and a hi-hat land in different bands.

  Everything is allocated once per capture format (`configure`). Per event the
  only allocations are the two small Vecs serde ships to the frontend.
*/

use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};
use serde::Serialize;
use std::sync::Arc;

pub const FFT_SIZE: usize = 1024;
pub const BAND_COUNT: usize = 32;
pub const WAVEFORM_POINTS: usize = 128;
/// Mono samples the waveform is decimated from. 256 frames at step 2 keeps the
/// ring looking like it did when it read 512 interleaved stereo samples.
const WAVEFORM_SPAN: usize = WAVEFORM_POINTS * 2;

const BASS_HZ: (f32, f32) = (20.0, 250.0);
const MID_HZ: (f32, f32) = (250.0, 4000.0);
const HIGH_HZ: (f32, f32) = (4000.0, 16000.0);
const BANDS_LOW_HZ: f32 = 20.0;
const BANDS_HIGH_HZ: f32 = 16000.0;

/// Linear gains on each band's RMS. Mastered music sits around -13 dBFS in
/// the bass band, -15 in the mids and -25 in the highs; these put each of them
/// near the 0.6 to 0.8 the old time-slice levels produced, so existing modes
/// keep their overall feel.
const BASS_GAIN: f32 = 3.5;
const MID_GAIN: f32 = 3.5;
const HIGH_GAIN: f32 = 9.0;

/// dB window the 0..255 band bytes cover.
const BAND_DB_FLOOR: f32 = -70.0;
const BAND_DB_CEIL: f32 = -10.0;

/// Audio levels, spectrum bands and waveform for the visualizer.
#[derive(Debug, Clone, Serialize)]
pub struct AudioLevels {
    pub bass: f32,
    pub mid: f32,
    pub high: f32,
    /// Up to 128 mono samples for the circular waveform ring. Empty when the
    /// endpoint produced no samples since the last read (silence/no capture).
    pub waveform: Vec<f32>,
    /// 32 log-spaced bands from 20 Hz to 16 kHz, 0..255 over -70..-10 dB.
    /// Empty together with `waveform`.
    pub bands: Vec<u8>,
}

impl AudioLevels {
    pub fn silent() -> Self {
        Self {
            bass: 0.0,
            mid: 0.0,
            high: 0.0,
            waveform: Vec::new(),
            bands: Vec::new(),
        }
    }
}

/// Inclusive-exclusive FFT bin range for one band, plus a scale applied to its
/// summed power. The scale is below 1 only for bands narrower than one bin
/// (the lowest few at 1024 points), which borrow the nearest bin's power and
/// must not report a whole bin's worth of energy.
#[derive(Debug, Clone, Copy)]
struct BinRange {
    start: usize,
    end: usize,
    scale: f32,
}

pub struct AudioAnalyzer {
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    /// 2 / (N * sum(w^2)): turns a sum of |X[k]|^2 into the mean square of the
    /// un-windowed signal's content in those bins.
    power_norm: f32,
    /// Newest FFT_SIZE mono samples, oldest first.
    history: Vec<f32>,
    /// How many history slots hold real audio (the rest are zero padding).
    filled: usize,
    fft_in: Vec<f32>,
    spectrum: Vec<Complex<f32>>,
    fft_scratch: Vec<Complex<f32>>,
    mono: Vec<f32>,
    channels: usize,
    sample_rate: u32,
    bass_bins: BinRange,
    mid_bins: BinRange,
    high_bins: BinRange,
    band_bins: Vec<BinRange>,
}

impl Default for AudioAnalyzer {
    fn default() -> Self {
        Self::new(2, 48_000)
    }
}

impl AudioAnalyzer {
    pub fn new(channels: usize, sample_rate: u32) -> Self {
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
        let spectrum = fft.make_output_vec();
        let fft_scratch = fft.make_scratch_vec();
        let fft_in = fft.make_input_vec();
        // Periodic Hann, the usual choice for spectral analysis.
        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|i| {
                let x = (std::f32::consts::TAU * i as f32) / FFT_SIZE as f32;
                0.5 - 0.5 * x.cos()
            })
            .collect();
        let window_power: f32 = window.iter().map(|w| w * w).sum();
        let mut analyzer = Self {
            fft,
            window,
            power_norm: 2.0 / (FFT_SIZE as f32 * window_power),
            history: vec![0.0; FFT_SIZE],
            filled: 0,
            fft_in,
            spectrum,
            fft_scratch,
            mono: Vec::with_capacity(FFT_SIZE),
            channels: 2,
            sample_rate: 48_000,
            bass_bins: BinRange { start: 0, end: 0, scale: 1.0 },
            mid_bins: BinRange { start: 0, end: 0, scale: 1.0 },
            high_bins: BinRange { start: 0, end: 0, scale: 1.0 },
            band_bins: Vec::with_capacity(BAND_COUNT),
        };
        analyzer.configure(channels, sample_rate);
        analyzer
    }

    /// Set the capture format. Recomputes the bin tables (cheap) and clears the
    /// history so a new device never shows the previous device's audio. The
    /// FFT plan depends only on FFT_SIZE and is kept.
    pub fn configure(&mut self, channels: usize, sample_rate: u32) {
        self.channels = channels.max(1);
        self.sample_rate = if sample_rate == 0 { 48_000 } else { sample_rate };
        let bin_hz = self.sample_rate as f32 / FFT_SIZE as f32;
        let nyquist_bin = FFT_SIZE / 2;

        let range = |lo_hz: f32, hi_hz: f32| -> BinRange {
            // Bin k covers k * bin_hz. Skip DC: it is offset, not bass.
            let start = ((lo_hz / bin_hz).ceil() as usize).clamp(1, nyquist_bin);
            let end = ((hi_hz / bin_hz).ceil() as usize).clamp(1, nyquist_bin + 1);
            if end > start {
                BinRange { start, end, scale: 1.0 }
            } else {
                // Band narrower than one bin: use the bin its centre falls in,
                // scaled down to the fraction of that bin the band covers.
                let centre = ((lo_hz * hi_hz).sqrt() / bin_hz).round() as usize;
                let bin = centre.clamp(1, nyquist_bin);
                BinRange {
                    start: bin,
                    end: bin + 1,
                    scale: ((hi_hz - lo_hz) / bin_hz).min(1.0),
                }
            }
        };

        self.bass_bins = range(BASS_HZ.0, BASS_HZ.1);
        self.mid_bins = range(MID_HZ.0, MID_HZ.1);
        // Above Nyquist (a 22.05 kHz cap still covers 16 kHz, but be safe for
        // odd rates) the range simply clamps.
        self.high_bins = range(HIGH_HZ.0, HIGH_HZ.1.min(self.sample_rate as f32 / 2.0));

        self.band_bins.clear();
        let ratio = (BANDS_HIGH_HZ / BANDS_LOW_HZ).powf(1.0 / BAND_COUNT as f32);
        let mut lo = BANDS_LOW_HZ;
        for _ in 0..BAND_COUNT {
            let hi = lo * ratio;
            self.band_bins.push(range(lo, hi));
            lo = hi;
        }

        self.reset();
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    /// Forget buffered audio (silence or device change).
    pub fn reset(&mut self) {
        self.history.iter_mut().for_each(|s| *s = 0.0);
        self.filled = 0;
    }

    /// Analyze freshly drained interleaved samples (oldest first). An empty
    /// slice means the endpoint delivered nothing, which returns the silent
    /// payload and clears the history so stale audio is not replayed later.
    pub fn process(&mut self, interleaved: &[f32]) -> AudioLevels {
        let ch = self.channels;
        // Keep the newest whole frames. The ring hands back whole frames in
        // practice; trimming from the front keeps the tail aligned regardless.
        let usable = interleaved.len() - interleaved.len() % ch;
        let frames = &interleaved[interleaved.len() - usable..];
        if frames.is_empty() {
            self.reset();
            return AudioLevels::silent();
        }

        // Mix to mono, dropping NaN/inf so one bad packet cannot poison the
        // FFT, and keep only what fits in the history.
        let frame_count = frames.len() / ch;
        let keep = frame_count.min(FFT_SIZE);
        let skip = frame_count - keep;
        self.mono.clear();
        let inv = 1.0 / ch as f32;
        for frame in frames.chunks_exact(ch).skip(skip) {
            let mut sum = 0.0f32;
            for &s in frame {
                if s.is_finite() {
                    sum += s.clamp(-1.0, 1.0);
                }
            }
            self.mono.push(sum * inv);
        }

        // Roll the history left and append.
        let n = self.mono.len();
        self.history.copy_within(n.., 0);
        self.history[FFT_SIZE - n..].copy_from_slice(&self.mono);
        self.filled = (self.filled + n).min(FFT_SIZE);

        // Windowed FFT over the newest FFT_SIZE samples. Slots before `filled`
        // are zeros, which is the zero padding for a short first read.
        for ((dst, &s), &w) in self.fft_in.iter_mut().zip(&self.history).zip(&self.window) {
            *dst = s * w;
        }
        if self
            .fft
            .process_with_scratch(&mut self.fft_in, &mut self.spectrum, &mut self.fft_scratch)
            .is_err()
        {
            return AudioLevels::silent();
        }

        let band_rms = |r: BinRange, spectrum: &[Complex<f32>], norm: f32| -> f32 {
            let power: f32 = spectrum[r.start..r.end].iter().map(|c| c.norm_sqr()).sum();
            let rms = (power * norm * r.scale).sqrt();
            if rms.is_finite() { rms } else { 0.0 }
        };

        let norm = self.power_norm;
        let bass = (band_rms(self.bass_bins, &self.spectrum, norm) * BASS_GAIN).min(1.0);
        let mid = (band_rms(self.mid_bins, &self.spectrum, norm) * MID_GAIN).min(1.0);
        let high = (band_rms(self.high_bins, &self.spectrum, norm) * HIGH_GAIN).min(1.0);

        let bands: Vec<u8> = self
            .band_bins
            .iter()
            .map(|&r| {
                let rms = band_rms(r, &self.spectrum, norm);
                let db = 20.0 * rms.max(1e-9).log10();
                let t = (db - BAND_DB_FLOOR) / (BAND_DB_CEIL - BAND_DB_FLOOR);
                (t.clamp(0.0, 1.0) * 255.0).round() as u8
            })
            .collect();

        // Waveform: newest real samples only, decimated to 128 points.
        let span = self.filled.min(WAVEFORM_SPAN);
        let recent = &self.history[FFT_SIZE - span..];
        let waveform: Vec<f32> = if span <= WAVEFORM_POINTS {
            recent.to_vec()
        } else {
            let step = span as f32 / WAVEFORM_POINTS as f32;
            (0..WAVEFORM_POINTS)
                .map(|i| recent[((i as f32) * step) as usize])
                .collect()
        };

        AudioLevels {
            bass,
            mid,
            high,
            waveform,
            bands,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, rate: u32, amp: f32, frames: usize, channels: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(frames * channels);
        for i in 0..frames {
            let v = amp * (std::f32::consts::TAU * freq * i as f32 / rate as f32).sin();
            for _ in 0..channels {
                out.push(v);
            }
        }
        out
    }

    #[test]
    fn bass_tone_lands_in_bass() {
        for rate in [44_100u32, 48_000] {
            let mut a = AudioAnalyzer::new(2, rate);
            let l = a.process(&sine(60.0, rate, 0.3, 1500, 2));
            assert!(l.bass > 0.5, "rate {rate}: bass {}", l.bass);
            assert!(l.high < 0.05, "rate {rate}: high {}", l.high);
            assert_eq!(l.bands.len(), BAND_COUNT);
            assert_eq!(l.waveform.len(), WAVEFORM_POINTS);
        }
    }

    #[test]
    fn hihat_tone_lands_in_high() {
        let mut a = AudioAnalyzer::new(2, 48_000);
        let l = a.process(&sine(8000.0, 48_000, 0.1, 1500, 2));
        assert!(l.high > 0.4, "high {}", l.high);
        assert!(l.bass < 0.05, "bass {}", l.bass);
    }

    #[test]
    fn mono_and_surround_and_short_reads() {
        let mut mono = AudioAnalyzer::new(1, 48_000);
        let l = mono.process(&sine(1000.0, 48_000, 0.2, 300, 1));
        assert!(l.mid > 0.1);
        assert!(l.waveform.len() == WAVEFORM_POINTS);
        let mut six = AudioAnalyzer::new(6, 44_100);
        // 100 frames plus a stray partial frame.
        let mut data = sine(100.0, 44_100, 0.3, 100, 6);
        data.push(0.5);
        let l = six.process(&data);
        assert!(l.waveform.len() <= WAVEFORM_POINTS && !l.waveform.is_empty());
        assert!(l.bass.is_finite());
    }

    #[test]
    fn non_finite_samples_are_ignored() {
        let mut a = AudioAnalyzer::new(2, 48_000);
        let mut data = sine(200.0, 48_000, 0.2, 1024, 2);
        data[10] = f32::NAN;
        data[11] = f32::INFINITY;
        let l = a.process(&data);
        assert!(l.bass.is_finite() && l.mid.is_finite() && l.high.is_finite());
        assert!(l.waveform.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn empty_read_is_silent_and_resets() {
        let mut a = AudioAnalyzer::new(2, 48_000);
        a.process(&sine(60.0, 48_000, 0.3, 1500, 2));
        let l = a.process(&[]);
        assert!(l.waveform.is_empty() && l.bands.is_empty() && l.bass == 0.0);
        assert_eq!(a.filled, 0);
    }
}
