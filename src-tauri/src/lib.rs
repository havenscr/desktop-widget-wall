/*
  ========================================================================
  WIDGET WALL DESKTOP - Tauri Backend Entry Point
  Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
  Fingerprint: AE-WWD-9F7C3E2A | analyticendeavors.com
  ========================================================================
*/

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{
    Manager, State,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

// Windows Media Session API imports
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use windows::Foundation::TimeSpan;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Media::MediaPlaybackAutoRepeatMode;

// Windows Core Audio API imports
use windows::Win32::Media::Audio::{
    eCapture, eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IAudioSessionControl,
    IAudioSessionControl2, IAudioSessionEnumerator, IAudioSessionManager2, IMMDevice,
    IMMDeviceCollection, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};

// Windows Shell Link imports for Recent Files
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::BOOL;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::UI::Shell::{
    IShellLinkW, SHGetFileInfoW, ShellLink, SHFILEINFOW, SHGFI_ICON, SHGFI_SMALLICON,
    SHGFI_USEFILEATTRIBUTES,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

// File system
use std::fs;
use std::path::PathBuf;

// Audio device info for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_input: bool,
    pub is_loopback: bool,
}

// ================================================================
// NOW PLAYING - Windows Media Session API
// ================================================================

/// Playback status enum matching Windows Media Session states
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
    Changing,
    Unknown,
}

/// Repeat mode enum matching Windows Media Session states
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    None,
    Track,
    List,
}

/// Now playing information from Windows Media Session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NowPlayingInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_art_base64: Option<String>,
    pub album_art_mime: Option<String>,
    pub playback_status: PlaybackStatus,
    pub source_app: Option<String>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub shuffle_active: Option<bool>,
    pub repeat_mode: Option<RepeatMode>,
    /// True when the track is unchanged since the previous poll. In that case
    /// album_art_* are omitted and the frontend keeps the art it already has.
    #[serde(default)]
    pub art_unchanged: bool,
}

impl Default for NowPlayingInfo {
    fn default() -> Self {
        Self {
            title: None,
            artist: None,
            album: None,
            album_art_base64: None,
            album_art_mime: None,
            playback_status: PlaybackStatus::Unknown,
            source_app: None,
            position_seconds: None,
            duration_seconds: None,
            shuffle_active: None,
            repeat_mode: None,
            art_unchanged: false,
        }
    }
}

// Shared audio buffer - only this crosses thread boundaries
pub struct SharedAudioBuffer {
    samples: Mutex<Vec<f32>>,
    is_capturing: AtomicBool,
    current_device: Mutex<Option<String>>,
    stop_signal: AtomicBool,
    // Capture ID to prevent race conditions - each capture gets a unique ID
    // Threads only respond to stop signals if their ID matches current_capture_id
    current_capture_id: AtomicU64,
}

impl Default for SharedAudioBuffer {
    fn default() -> Self {
        Self {
            samples: Mutex::new(Vec::with_capacity(4096)),
            is_capturing: AtomicBool::new(false),
            current_device: Mutex::new(None),
            stop_signal: AtomicBool::new(false),
            current_capture_id: AtomicU64::new(0),
        }
    }
}

/// Response from Google Maps Distance Matrix API
#[derive(Debug, Clone, serde::Serialize)]
pub struct DriveTimeResponse {
    pub duration_seconds: u64,
    pub duration_text: String,
    pub duration_in_traffic_seconds: Option<u64>,
    pub duration_in_traffic_text: Option<String>,
    pub traffic_delay_seconds: Option<i64>,
}

/// Get drive time from origin to destination using Google Maps Distance Matrix API
#[tauri::command]
async fn get_drive_time(
    api_key: String,
    origin_lat: f64,
    origin_lng: f64,
    destination: String,
) -> Result<DriveTimeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<DriveTimeResponse, String> {
        let url = format!(
            "https://maps.googleapis.com/maps/api/distancematrix/json?origins={},{}&destinations={}&departure_time=now&key={}",
            origin_lat,
            origin_lng,
            urlencoding::encode(&destination),
            api_key
        );

        let http_response = ureq::get(&url)
            .timeout(std::time::Duration::from_secs(10))
            .call()
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        let body = http_response.into_string()
            .map_err(|e| format!("Failed to read response: {}", e))?;

        let response: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("JSON parse failed: {}", e))?;

        // Check API status
        let status = response["status"].as_str().unwrap_or("UNKNOWN");
        if status != "OK" {
            return Err(format!("API error: {}", status));
        }

        // Get the first element from the response
        let element = &response["rows"][0]["elements"][0];
        let element_status = element["status"].as_str().unwrap_or("UNKNOWN");
        if element_status != "OK" {
            return Err(format!("Route error: {}", element_status));
        }

        // Extract duration (without traffic)
        let duration = &element["duration"];
        let duration_seconds = duration["value"].as_u64().unwrap_or(0);
        let duration_text = duration["text"].as_str().unwrap_or("").to_string();

        // Extract duration in traffic (if available)
        let duration_in_traffic = &element["duration_in_traffic"];
        let (duration_in_traffic_seconds, duration_in_traffic_text): (Option<u64>, Option<String>) =
            if duration_in_traffic.is_object() {
                (
                    duration_in_traffic["value"].as_u64(),
                    duration_in_traffic["text"].as_str().map(|s: &str| s.to_string()),
                )
            } else {
                (None, None)
            };

        // Calculate traffic delay
        let traffic_delay_seconds = match (duration_in_traffic_seconds, duration_seconds) {
            (Some(traffic), base) if base > 0 => Some(traffic as i64 - base as i64),
            _ => None,
        };

        Ok(DriveTimeResponse {
            duration_seconds,
            duration_text,
            duration_in_traffic_seconds,
            duration_in_traffic_text,
            traffic_delay_seconds,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Response from address validation via Google Maps Geocoding API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressValidationResponse {
    pub is_valid: bool,
    pub formatted_address: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

/// Validate an address using Google Maps Geocoding API
#[tauri::command]
async fn validate_address(
    api_key: String,
    address: String,
) -> Result<AddressValidationResponse, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<AddressValidationResponse, String> {
        let url = format!(
            "https://maps.googleapis.com/maps/api/geocode/json?address={}&key={}",
            urlencoding::encode(&address),
            api_key
        );

        let http_response = ureq::get(&url)
            .timeout(std::time::Duration::from_secs(10))
            .call()
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        let body = http_response
            .into_string()
            .map_err(|e| format!("Failed to read response: {}", e))?;

        let response: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("JSON parse failed: {}", e))?;

        let status = response["status"].as_str().unwrap_or("UNKNOWN");

        if status == "OK" {
            if let Some(results) = response["results"].as_array() {
                if let Some(result) = results.first() {
                    let formatted = result["formatted_address"].as_str().map(String::from);
                    let location = &result["geometry"]["location"];
                    let lat = location["lat"].as_f64();
                    let lng = location["lng"].as_f64();

                    return Ok(AddressValidationResponse {
                        is_valid: true,
                        formatted_address: formatted,
                        lat,
                        lng,
                    });
                }
            }
        }

        // Address not found or API error - return invalid
        Ok(AddressValidationResponse {
            is_valid: false,
            formatted_address: None,
            lat: None,
            lng: None,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// List all available audio devices (async to avoid blocking main thread)
#[tauri::command]
async fn list_audio_devices() -> Vec<AudioDeviceInfo> {
    // Run device enumeration in a blocking thread pool
    tauri::async_runtime::spawn_blocking(|| {
        let mut devices = Vec::new();
        let host = cpal::default_host();

        // Get input devices (microphones)
        if let Ok(input_devices) = host.input_devices() {
            for device in input_devices {
                if let Ok(name) = device.name() {
                    devices.push(AudioDeviceInfo {
                        id: format!("input:{}", name),
                        name: name.clone(),
                        is_input: true,
                        is_loopback: false,
                    });
                }
            }
        }

        // Get output devices (for loopback capture)
        if let Ok(output_devices) = host.output_devices() {
            for device in output_devices {
                if let Ok(name) = device.name() {
                    devices.push(AudioDeviceInfo {
                        id: format!("loopback:{}", name),
                        name: format!("{} (Loopback)", name),
                        is_input: false,
                        is_loopback: true,
                    });
                }
            }
        }

        devices
    })
    .await
    .unwrap_or_default()
}

// Start audio capture from specified device
#[tauri::command]
fn start_audio_capture(
    device_id: String,
    state: State<Arc<SharedAudioBuffer>>,
) -> Result<String, String> {
    // Generate new capture ID FIRST - this invalidates any running capture
    let new_capture_id = state.current_capture_id.fetch_add(1, Ordering::SeqCst) + 1;
    println!("Starting new capture session, ID={}", new_capture_id);

    // Signal any existing capture to stop
    state.stop_signal.store(true, Ordering::SeqCst);
    thread::sleep(std::time::Duration::from_millis(150)); // Give old thread time to notice
    state.stop_signal.store(false, Ordering::SeqCst);

    let parts: Vec<&str> = device_id.splitn(2, ':').collect();
    if parts.len() != 2 {
        return Err("Invalid device ID format".to_string());
    }

    let device_type = parts[0].to_string();
    let device_name = parts[1].to_string();

    // Update current device
    if let Ok(mut dev) = state.current_device.lock() {
        *dev = Some(device_id.clone());
    }

    // Clone the Arc for the audio thread
    let buffer = Arc::clone(&state.inner());

    // Spawn audio capture on a dedicated thread
    let device_name_clone = device_name.clone();
    let device_type_clone = device_type.clone();
    thread::spawn(move || {
        println!(
            "Starting audio capture: type={}, device={}, capture_id={}",
            device_type_clone, device_name_clone, new_capture_id
        );
        match run_audio_capture(
            &device_type_clone,
            &device_name_clone,
            buffer,
            new_capture_id,
        ) {
            Ok(_) => println!("Audio capture ended normally (ID={})", new_capture_id),
            Err(e) => eprintln!("Audio capture error (ID={}): {}", new_capture_id, e),
        }
    });

    Ok(format!(
        "Started capturing from: {} (type: {}) [capture_id={}]",
        device_name, device_type, new_capture_id
    ))
}

fn run_audio_capture(
    device_type: &str,
    device_name: &str,
    buffer: Arc<SharedAudioBuffer>,
    capture_id: u64,
) -> Result<(), String> {
    let host = cpal::default_host();

    println!("Looking for {} device: '{}'", device_type, device_name);

    let device = if device_type == "input" {
        host.input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().map(|n| n == device_name).unwrap_or(false))
            .ok_or_else(|| format!("Input device not found: {}", device_name))?
    } else if device_type == "loopback" {
        // For WASAPI loopback, we get an output device and use it for input
        // CPAL will automatically enable loopback mode when we call build_input_stream
        let output_device = host
            .output_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().map(|n| n == device_name).unwrap_or(false))
            .ok_or_else(|| format!("Output device not found for loopback: {}", device_name))?;
        println!(
            "Found output device for loopback: {:?}",
            output_device.name()
        );
        output_device
    } else {
        return Err("Unknown device type".to_string());
    };

    // For loopback on Windows, we use the default output config since we're capturing from an output device
    let config = if device_type == "input" {
        device.default_input_config().map_err(|e| e.to_string())?
    } else {
        // For loopback on WASAPI, use the output device's default output config
        // CPAL will detect this is an output device and enable loopback mode automatically
        device
            .default_output_config()
            .map_err(|e| format!("Failed to get output config for loopback: {}", e))?
    };

    let sample_format = config.sample_format();
    println!(
        "Audio config: sample_format={:?}, channels={}, sample_rate={}",
        sample_format,
        config.channels(),
        config.sample_rate().0
    );
    let config: cpal::StreamConfig = config.into();

    let buffer_clone = Arc::clone(&buffer);
    let sample_counter = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter_clone = sample_counter.clone();
    let err_fn = |err| eprintln!("Audio stream error: {}", err);

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let counter = counter_clone.clone();
            device.build_input_stream(
                &config,
                move |data: &[f32], _: &_| {
                    let prev = counter.fetch_add(data.len(), std::sync::atomic::Ordering::SeqCst);
                    // Log first few batches to confirm we're receiving data
                    if prev == 0 {
                        let max_val = data.iter().map(|x| x.abs()).fold(0.0f32, f32::max);
                        println!(
                            "First audio batch: {} samples, max={:.4}",
                            data.len(),
                            max_val
                        );
                    }
                    if let Ok(mut samples) = buffer_clone.samples.lock() {
                        // Keep buffer at reasonable size
                        if samples.len() > 8192 {
                            samples.drain(0..4096);
                        }
                        samples.extend_from_slice(data);
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _: &_| {
                if let Ok(mut samples) = buffer_clone.samples.lock() {
                    if samples.len() > 8192 {
                        samples.drain(0..4096);
                    }
                    for &sample in data.iter() {
                        samples.push(sample as f32 / i16::MAX as f32);
                    }
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _: &_| {
                if let Ok(mut samples) = buffer_clone.samples.lock() {
                    if samples.len() > 8192 {
                        samples.drain(0..4096);
                    }
                    for &sample in data.iter() {
                        let normalized = (sample as f32 / u16::MAX as f32) * 2.0 - 1.0;
                        samples.push(normalized);
                    }
                }
            },
            err_fn,
            None,
        ),
        _ => return Err("Unsupported sample format".to_string()),
    }
    .map_err(|e| {
        eprintln!("Failed to build input stream: {}", e);
        e.to_string()
    })?;

    stream.play().map_err(|e| {
        eprintln!("Failed to play stream: {}", e);
        e.to_string()
    })?;

    println!(
        "Audio stream started successfully, capturing from: {} (ID={})",
        device_name, capture_id
    );
    buffer.is_capturing.store(true, Ordering::SeqCst);

    // Keep stream alive until stop signal AND we're no longer the current capture
    // This prevents race conditions where a new capture starts before we fully exit
    let start_time = std::time::Instant::now();
    let startup_immunity_ms = 500; // Ignore stop signals for first 500ms

    loop {
        thread::sleep(std::time::Duration::from_millis(50));

        let current_id = buffer.current_capture_id.load(Ordering::SeqCst);
        let stop_requested = buffer.stop_signal.load(Ordering::SeqCst);
        let elapsed_ms = start_time.elapsed().as_millis();

        // During startup immunity, only exit if we're replaced by a newer capture
        if elapsed_ms < startup_immunity_ms as u128 {
            if current_id != capture_id {
                println!(
                    "Audio capture (ID={}) superseded by newer capture (ID={}), exiting",
                    capture_id, current_id
                );
                break;
            }
            // Ignore stop_signal during immunity period
            continue;
        }

        // After immunity period, exit on stop signal OR if superseded
        if stop_requested || current_id != capture_id {
            if current_id != capture_id {
                println!(
                    "Audio capture (ID={}) superseded by newer capture (ID={})",
                    capture_id, current_id
                );
            } else {
                println!("Audio capture (ID={}) received stop signal", capture_id);
            }
            break;
        }
    }

    buffer.is_capturing.store(false, Ordering::SeqCst);
    println!("Audio capture thread exiting (ID={})", capture_id);
    Ok(())
}

// Stop audio capture
#[tauri::command]
fn stop_audio_capture(state: State<Arc<SharedAudioBuffer>>) -> Result<String, String> {
    state.stop_signal.store(true, Ordering::SeqCst);

    if let Ok(mut dev) = state.current_device.lock() {
        *dev = None;
    }

    Ok("Audio capture stopped".to_string())
}

/// Audio levels + downsampled waveform for the visualizer.
///
/// Computed here instead of shipping raw samples over IPC: the previous
/// get_audio_samples command returned up to 512 floats as JSON ~62x/sec while
/// the renderer only runs at 30fps. The banding mirrors the old JS
/// processNativeSamples() exactly (positional split of the drained buffer:
/// first 15% -> bass, to 35% -> mid, rest -> high; abs-mean scaled by
/// 3.0 / 2.5 / 2.0, clamped to 1.0) so the visuals are unchanged.
#[derive(Debug, Clone, Serialize)]
pub struct AudioLevels {
    pub bass: f32,
    pub mid: f32,
    pub high: f32,
    /// Up to 128 raw samples for the circular waveform ring. Empty when the
    /// endpoint produced no samples since the last poll (silence/no capture).
    pub waveform: Vec<f32>,
}

#[tauri::command]
fn get_audio_levels(state: State<Arc<SharedAudioBuffer>>) -> AudioLevels {
    let samples: Vec<f32> = match state.samples.lock() {
        Ok(mut s) => {
            let len = s.len().min(512);
            s.drain(0..len).collect()
        }
        Err(_) => Vec::new(),
    };

    if samples.is_empty() {
        return AudioLevels {
            bass: 0.0,
            mid: 0.0,
            high: 0.0,
            waveform: Vec::new(),
        };
    }

    let len = samples.len();
    let bass_end = ((len as f32) * 0.15) as usize;
    let mid_end = ((len as f32) * 0.35) as usize;

    fn abs_mean(slice: &[f32]) -> f32 {
        if slice.is_empty() {
            return 0.0;
        }
        slice.iter().map(|v| v.abs()).sum::<f32>() / slice.len() as f32
    }

    let bass = (abs_mean(&samples[..bass_end]) * 3.0).min(1.0);
    let mid = (abs_mean(&samples[bass_end..mid_end]) * 2.5).min(1.0);
    let high = (abs_mean(&samples[mid_end..]) * 2.0).min(1.0);

    const WAVEFORM_POINTS: usize = 128;
    let waveform = if len <= WAVEFORM_POINTS {
        samples
    } else {
        let step = len as f32 / WAVEFORM_POINTS as f32;
        (0..WAVEFORM_POINTS)
            .map(|i| samples[((i as f32) * step) as usize])
            .collect()
    };

    AudioLevels {
        bass,
        mid,
        high,
        waveform,
    }
}

// Get current capture status
#[tauri::command]
fn get_audio_status(state: State<Arc<SharedAudioBuffer>>) -> (bool, Option<String>) {
    let is_capturing = state.is_capturing.load(Ordering::SeqCst);
    let device = state.current_device.lock().ok().and_then(|d| d.clone());
    (is_capturing, device)
}

// Get the current Windows default audio output device name
// This uses the Windows Core Audio API to get the actual system default
#[tauri::command]
async fn get_default_output_device() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        // Use cpal to get the default output device name - this is the simplest approach
        // and matches what list_audio_devices returns
        let host = cpal::default_host();
        if let Some(device) = host.default_output_device() {
            if let Ok(name) = device.name() {
                println!("Default output device: {}", name);
                return Some(name);
            }
        }
        None
    })
    .await
    .unwrap_or(None)
}

// Get the loopback device ID for the current Windows default audio output
// Returns the device ID that can be passed directly to start_audio_capture
#[tauri::command]
async fn get_default_loopback_device() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let host = cpal::default_host();
        if let Some(device) = host.default_output_device() {
            if let Ok(name) = device.name() {
                // Return the loopback device ID format used by list_audio_devices
                let loopback_id = format!("loopback:{}", name);
                println!("Default loopback device: {}", loopback_id);
                return Some(loopback_id);
            }
        }
        None
    })
    .await
    .unwrap_or(None)
}

// ================================================================
// NOW PLAYING COMMANDS - Windows Media Session
// ================================================================

/// Convert Windows playback status to our enum
fn convert_playback_status(
    status: GlobalSystemMediaTransportControlsSessionPlaybackStatus,
) -> PlaybackStatus {
    match status {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => PlaybackStatus::Playing,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => PlaybackStatus::Paused,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => PlaybackStatus::Stopped,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => {
            PlaybackStatus::Changing
        }
        _ => PlaybackStatus::Unknown,
    }
}

/// Extract friendly app name from AppUserModelId
fn extract_app_name(app_id: &str) -> String {
    if app_id.contains("Spotify") {
        return "Spotify".to_string();
    }
    if app_id.contains("ZuneMusic") || app_id.contains("Groove") {
        return "Groove Music".to_string();
    }
    if app_id.contains("VLC") {
        return "VLC".to_string();
    }
    if app_id.contains("Chrome") {
        return "Chrome".to_string();
    }
    if app_id.contains("Edge") || app_id.contains("MSEdge") {
        return "Edge".to_string();
    }
    if app_id.contains("Firefox") {
        return "Firefox".to_string();
    }
    if app_id.contains("iTunes") || app_id.contains("Apple") {
        return "Apple Music".to_string();
    }
    // Fallback: extract last part of path
    app_id
        .split(['\\', '!'])
        .filter(|s| !s.is_empty())
        .last()
        .unwrap_or(app_id)
        .replace(".exe", "")
        .to_string()
}

/// Read album art thumbnail and return as base64
fn read_thumbnail_sync(
    thumbnail_ref: &windows::Storage::Streams::IRandomAccessStreamReference,
) -> Option<(String, String)> {
    use windows::Storage::Streams::DataReader;

    let stream = thumbnail_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 {
        return None;
    }

    let content_type = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_else(|_| "image/jpeg".to_string());

    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;

    let mut buffer = vec![0u8; size as usize];
    reader.ReadBytes(&mut buffer).ok()?;

    Some((BASE64.encode(&buffer), content_type))
}

/// Last (title|artist|album|app) we shipped album art for. The 2s
/// now-playing poll skips the thumbnail stream read + base64 encode (often
/// 100KB+ per poll) while this key is unchanged.
static LAST_ART_TRACK_KEY: Mutex<Option<String>> = Mutex::new(None);

/// Get current now playing information from Windows Media Session (async to avoid blocking main thread)
#[tauri::command]
async fn get_now_playing() -> NowPlayingInfo {
    // Run Windows Media Session API calls in a blocking thread pool
    tauri::async_runtime::spawn_blocking(|| {
        // Try to get session manager
        let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
            Ok(async_op) => match async_op.get() {
                Ok(m) => m,
                Err(_) => return NowPlayingInfo::default(),
            },
            Err(_) => return NowPlayingInfo::default(),
        };

        // Get current session
        let session = match manager.GetCurrentSession() {
            Ok(s) => s,
            Err(_) => {
                // No active session: forget the art key so the art is re-sent
                // when playback resumes (the frontend shows a placeholder in
                // the meantime and needs the bytes again).
                if let Ok(mut key) = LAST_ART_TRACK_KEY.lock() {
                    *key = None;
                }
                return NowPlayingInfo::default();
            }
        };

        let mut info = NowPlayingInfo::default();

        // Get source app
        if let Ok(app_id) = session.SourceAppUserModelId() {
            info.source_app = Some(extract_app_name(&app_id.to_string()));
        }

        // Get playback info (includes shuffle and repeat)
        if let Ok(playback_info) = session.GetPlaybackInfo() {
            if let Ok(status) = playback_info.PlaybackStatus() {
                info.playback_status = convert_playback_status(status);
            }
            // Get shuffle state
            if let Ok(shuffle_result) = playback_info.IsShuffleActive() {
                if let Ok(shuffle) = shuffle_result.Value() {
                    info.shuffle_active = Some(shuffle);
                }
            }
            // Get repeat mode
            if let Ok(repeat_result) = playback_info.AutoRepeatMode() {
                if let Ok(repeat) = repeat_result.Value() {
                    info.repeat_mode = Some(match repeat {
                        MediaPlaybackAutoRepeatMode::Track => RepeatMode::Track,
                        MediaPlaybackAutoRepeatMode::List => RepeatMode::List,
                        _ => RepeatMode::None,
                    });
                }
            }
        }

        // Get timeline info
        if let Ok(timeline) = session.GetTimelineProperties() {
            if let Ok(pos) = timeline.Position() {
                info.position_seconds = Some(pos.Duration as f64 / 10_000_000.0);
            }
            if let Ok(end) = timeline.EndTime() {
                info.duration_seconds = Some(end.Duration as f64 / 10_000_000.0);
            }
        }

        // Get media properties
        if let Ok(props_async) = session.TryGetMediaPropertiesAsync() {
            if let Ok(props) = props_async.get() {
                if let Ok(title) = props.Title() {
                    let title_str = title.to_string();
                    if !title_str.is_empty() {
                        info.title = Some(title_str);
                    }
                }
                if let Ok(artist) = props.Artist() {
                    let artist_str = artist.to_string();
                    if !artist_str.is_empty() {
                        info.artist = Some(artist_str);
                    }
                }
                if let Ok(album) = props.AlbumTitle() {
                    let album_str = album.to_string();
                    if !album_str.is_empty() {
                        info.album = Some(album_str);
                    }
                }

                // Album art is the heavy part of this poll (WinRT stream read
                // + base64 of often 100KB+, every 2s). Skip it while the
                // track key is unchanged; the frontend keeps the art it has.
                let track_key = format!(
                    "{}|{}|{}|{}",
                    info.title.as_deref().unwrap_or(""),
                    info.artist.as_deref().unwrap_or(""),
                    info.album.as_deref().unwrap_or(""),
                    info.source_app.as_deref().unwrap_or("")
                );
                let unchanged = LAST_ART_TRACK_KEY
                    .lock()
                    .map(|key| key.as_deref() == Some(track_key.as_str()))
                    .unwrap_or(false);

                if unchanged {
                    info.art_unchanged = true;
                } else {
                    if let Ok(thumbnail) = props.Thumbnail() {
                        if let Some((data, mime)) = read_thumbnail_sync(&thumbnail) {
                            info.album_art_base64 = Some(data);
                            info.album_art_mime = Some(mime);
                        }
                    }
                    if let Ok(mut key) = LAST_ART_TRACK_KEY.lock() {
                        *key = Some(track_key);
                    }
                }
            }
        }

        info
    })
    .await
    .unwrap_or_default()
}

/// Toggle play/pause (async to avoid blocking main thread)
#[tauri::command]
async fn media_play_pause() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
        session
            .TryTogglePlayPauseAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Skip to next track (async to avoid blocking main thread)
#[tauri::command]
async fn media_next() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
        session
            .TrySkipNextAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Skip to previous track (async to avoid blocking main thread)
#[tauri::command]
async fn media_previous() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
        session
            .TrySkipPreviousAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Seek to a specific position in seconds (async to avoid blocking main thread)
#[tauri::command]
async fn media_seek(position_seconds: f64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;

        // Convert seconds to 100-nanosecond intervals (TimeSpan duration)
        let ticks = (position_seconds * 10_000_000.0) as i64;
        let position = TimeSpan { Duration: ticks };

        session
            .TryChangePlaybackPositionAsync(position.Duration)
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Toggle shuffle mode (async to avoid blocking main thread)
#[tauri::command]
async fn media_toggle_shuffle() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;

        // Get current shuffle state
        let playback_info = session.GetPlaybackInfo().map_err(|e| e.to_string())?;
        let current_shuffle = playback_info
            .IsShuffleActive()
            .ok()
            .and_then(|r| r.Value().ok())
            .unwrap_or(false);

        // Toggle it
        let new_shuffle = !current_shuffle;
        session
            .TryChangeShuffleActiveAsync(new_shuffle)
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        Ok(new_shuffle)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Set repeat mode (async to avoid blocking main thread)
/// mode: "none", "track", or "list"
#[tauri::command]
async fn media_set_repeat_mode(mode: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;

        let repeat_mode = match mode.to_lowercase().as_str() {
            "track" => MediaPlaybackAutoRepeatMode::Track,
            "list" => MediaPlaybackAutoRepeatMode::List,
            _ => MediaPlaybackAutoRepeatMode::None,
        };

        session
            .TryChangeAutoRepeatModeAsync(repeat_mode)
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cycle through repeat modes: none -> list -> track -> none
#[tauri::command]
async fn media_cycle_repeat() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;

        // Get current repeat mode
        let playback_info = session.GetPlaybackInfo().map_err(|e| e.to_string())?;
        let current_mode = playback_info
            .AutoRepeatMode()
            .ok()
            .and_then(|r| r.Value().ok())
            .unwrap_or(MediaPlaybackAutoRepeatMode::None);

        // Cycle to next mode: none -> list -> track -> none
        let (new_mode, mode_name) = match current_mode {
            MediaPlaybackAutoRepeatMode::None => (MediaPlaybackAutoRepeatMode::List, "list"),
            MediaPlaybackAutoRepeatMode::List => (MediaPlaybackAutoRepeatMode::Track, "track"),
            MediaPlaybackAutoRepeatMode::Track => (MediaPlaybackAutoRepeatMode::None, "none"),
            _ => (MediaPlaybackAutoRepeatMode::None, "none"),
        };

        session
            .TryChangeAutoRepeatModeAsync(new_mode)
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        Ok(mode_name.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ================================================================
// RECENT FILES - Windows Recent Folder Access
// ================================================================

/// Recent file info for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFileInfo {
    pub name: String,
    pub path: String,
    pub modified: String,
}

/// Resolve a .lnk shortcut to its target path
fn resolve_shortcut(lnk_path: &std::path::Path) -> Option<PathBuf> {
    unsafe {
        // Initialize COM
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        // Create ShellLink instance
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_ALL).ok()?;
        let persist_file: IPersistFile = shell_link.cast().ok()?;

        // Convert path to wide string
        let wide_path: Vec<u16> = lnk_path
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        // Load the shortcut file
        persist_file
            .Load(PCWSTR(wide_path.as_ptr()), STGM_READ)
            .ok()?;

        // Get the target path using the correct API
        let mut target_path = [0u16; 260];
        let mut find_data: WIN32_FIND_DATAW = std::mem::zeroed();
        shell_link
            .GetPath(&mut target_path, &mut find_data, 0)
            .ok()?;

        // Convert to String
        let end = target_path
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(target_path.len());
        let path_string = String::from_utf16_lossy(&target_path[..end]);

        if path_string.is_empty() {
            None
        } else {
            Some(PathBuf::from(path_string))
        }
    }
}

/// Get recent files from Windows Recent folder
#[tauri::command]
async fn get_recent_files(limit: Option<usize>) -> Vec<RecentFileInfo> {
    let limit = limit.unwrap_or(15);

    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();

        // Get Recent folder path
        let recent_path = dirs::data_local_dir()
            .map(|p| {
                p.join("..")
                    .join("Roaming")
                    .join("Microsoft")
                    .join("Windows")
                    .join("Recent")
            })
            .or_else(|| {
                std::env::var("APPDATA").ok().map(|p| {
                    PathBuf::from(p)
                        .join("Microsoft")
                        .join("Windows")
                        .join("Recent")
                })
            });

        let recent_path = match recent_path {
            Some(p) => p,
            None => return files,
        };

        // Read directory entries
        let entries: Vec<_> = match fs::read_dir(&recent_path) {
            Ok(entries) => entries.filter_map(|e| e.ok()).collect(),
            Err(_) => return files,
        };

        // Collect .lnk files with metadata
        let mut lnk_files: Vec<(PathBuf, std::time::SystemTime)> = entries
            .iter()
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("lnk") {
                    entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .map(|modified| (path, modified))
                } else {
                    None
                }
            })
            .collect();

        // Sort by modification time (newest first)
        lnk_files.sort_by(|a, b| b.1.cmp(&a.1));

        // Resolve shortcuts and build result
        for (lnk_path, modified) in lnk_files.into_iter().take(limit * 2) {
            if let Some(target_path) = resolve_shortcut(&lnk_path) {
                // Skip if target doesn't exist or is a directory
                if !target_path.exists() || target_path.is_dir() {
                    continue;
                }

                let name = target_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();

                // Format modified time
                let modified_str = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| {
                        let secs = d.as_secs() as i64;
                        chrono_lite_format(secs)
                    })
                    .unwrap_or_else(|_| String::new());

                files.push(RecentFileInfo {
                    name,
                    path: target_path.to_string_lossy().to_string(),
                    modified: modified_str,
                });

                if files.len() >= limit {
                    break;
                }
            }
        }

        files
    })
    .await
    .unwrap_or_default()
}

/// Simple date formatting without external crate
fn chrono_lite_format(unix_secs: i64) -> String {
    // Convert unix timestamp to ISO 8601 format
    let days_since_epoch = unix_secs / 86400;
    let time_of_day = unix_secs % 86400;

    // Calculate date components (simplified algorithm)
    let z = days_since_epoch + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hours, minutes, seconds
    )
}

/// Open Windows Task Manager
#[tauri::command]
async fn open_task_manager() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        std::process::Command::new("taskmgr")
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open a file using the system default application
#[tauri::command]
async fn open_file(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copy a file to the Windows clipboard (like right-click -> Copy in Explorer)
#[tauri::command]
async fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    use std::ptr;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_HDROP;

    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            // DROPFILES structure header (20 bytes) + file path (wide) + double null terminator
            let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let path_bytes = wide_path.len() * 2;

            // DROPFILES structure: 20 bytes header + path + null terminator
            let total_size = 20 + path_bytes + 2; // +2 for final null terminator

            // Allocate global memory
            let hglobal = GlobalAlloc(GMEM_MOVEABLE, total_size)
                .map_err(|e| format!("GlobalAlloc failed: {}", e))?;

            let ptr = GlobalLock(hglobal) as *mut u8;
            if ptr.is_null() {
                return Err("GlobalLock failed".to_string());
            }

            // Fill DROPFILES structure
            // pFiles offset (4 bytes) - offset to file list
            *(ptr as *mut u32) = 20;
            // pt.x (4 bytes)
            *(ptr.add(4) as *mut i32) = 0;
            // pt.y (4 bytes)
            *(ptr.add(8) as *mut i32) = 0;
            // fNC (4 bytes)
            *(ptr.add(12) as *mut u32) = 0;
            // fWide (4 bytes) - TRUE for Unicode
            *(ptr.add(16) as *mut u32) = 1;

            // Copy wide string path after header
            ptr::copy_nonoverlapping(wide_path.as_ptr() as *const u8, ptr.add(20), path_bytes);

            // Double null terminator at end
            *(ptr.add(20 + path_bytes) as *mut u16) = 0;

            GlobalUnlock(hglobal).ok();

            // Open clipboard and set data
            if OpenClipboard(None).is_err() {
                return Err("Failed to open clipboard".to_string());
            }

            let _ = EmptyClipboard();

            let result = SetClipboardData(
                CF_HDROP.0 as u32,
                windows::Win32::Foundation::HANDLE(hglobal.0),
            );

            let _ = CloseClipboard();

            if result.is_err() {
                return Err("Failed to set clipboard data".to_string());
            }

            Ok(())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open File Explorer showing the folder containing a file, centered on main monitor
#[tauri::command]
async fn open_folder_in_explorer(path: String) -> Result<(), String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow, SetWindowPos, ShowWindow,
        HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
    };

    tauri::async_runtime::spawn_blocking(move || {
        // Get parent folder path
        let file_path = std::path::Path::new(&path);
        let folder_path = file_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());

        // Open explorer with /select to highlight the file
        std::process::Command::new("explorer.exe")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;

        // Wait for window to appear
        std::thread::sleep(std::time::Duration::from_millis(800));

        // Find the new Explorer window
        static mut FOUND_HWND: Option<HWND> = None;
        static mut SEARCH_PATH: String = String::new();

        unsafe {
            FOUND_HWND = None;
            SEARCH_PATH = folder_path.clone();
        }

        unsafe extern "system" fn explorer_enum_callback(hwnd: HWND, _: LPARAM) -> BOOL {
            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }
            let mut title = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut title);
            if len > 0 {
                let title_str = String::from_utf16_lossy(&title[..len as usize]);
                // Explorer windows show folder name in title
                let folder_name = std::path::Path::new(&SEARCH_PATH)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                if !folder_name.is_empty() && title_str.contains(&folder_name) {
                    FOUND_HWND = Some(hwnd);
                    return BOOL(0);
                }
            }
            BOOL(1)
        }

        unsafe {
            let _ = EnumWindows(Some(explorer_enum_callback), LPARAM(0));
        }

        if let Some(hwnd) = unsafe { FOUND_HWND } {
            unsafe {
                // Get primary monitor (at point 0,0)
                let monitor = MonitorFromPoint(
                    windows::Win32::Foundation::POINT { x: 0, y: 0 },
                    MONITOR_DEFAULTTOPRIMARY,
                );
                let mut monitor_info = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };

                if GetMonitorInfoW(monitor, &mut monitor_info).as_bool() {
                    // Center on primary monitor with a reasonable size
                    let work_width = monitor_info.rcWork.right - monitor_info.rcWork.left;
                    let work_height = monitor_info.rcWork.bottom - monitor_info.rcWork.top;
                    let window_width = 900;
                    let window_height = 600;
                    let x = monitor_info.rcWork.left + (work_width / 2) - (window_width / 2);
                    let y = monitor_info.rcWork.top + (work_height / 2) - (window_height / 2);

                    // Position the window
                    let _ = SetWindowPos(
                        hwnd,
                        HWND_TOPMOST,
                        x,
                        y,
                        window_width,
                        window_height,
                        SWP_SHOWWINDOW,
                    );

                    // Attach to foreground thread to allow focus stealing
                    let foreground_hwnd = GetForegroundWindow();
                    let foreground_thread = GetWindowThreadProcessId(foreground_hwnd, None);
                    let current_thread = GetCurrentThreadId();

                    if foreground_thread != current_thread {
                        let _ = AttachThreadInput(current_thread, foreground_thread, true);
                    }

                    // Force to front
                    let _ = ShowWindow(hwnd, SW_RESTORE);
                    let _ = ShowWindow(hwnd, SW_SHOW);
                    let _ = BringWindowToTop(hwnd);
                    let _ = SetForegroundWindow(hwnd);

                    // Detach thread input
                    if foreground_thread != current_thread {
                        let _ = AttachThreadInput(current_thread, foreground_thread, false);
                    }

                    // Remove topmost flag so it behaves normally after
                    let _ = SetWindowPos(
                        hwnd,
                        HWND_NOTOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOACTIVATE
                            | windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
                            | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE,
                    );
                }
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Get file icon as base64-encoded PNG
#[tauri::command]
async fn get_file_icon(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            // Convert path to wide string
            let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();

            // Get file info with icon
            let mut shfi: SHFILEINFOW = std::mem::zeroed();
            let mut result = SHGetFileInfoW(
                PCWSTR(wide_path.as_ptr()),
                windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL,
                Some(&mut shfi),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_SMALLICON,
            );

            if result == 0 || shfi.hIcon.is_invalid() {
                // Direct extraction fails for cloud placeholders (OneDrive/
                // SharePoint files-on-demand) and some shell paths. Fall back
                // to the extension's generic type icon, which is derived from
                // the path string alone and never touches the file.
                shfi = std::mem::zeroed();
                result = SHGetFileInfoW(
                    PCWSTR(wide_path.as_ptr()),
                    windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL,
                    Some(&mut shfi),
                    std::mem::size_of::<SHFILEINFOW>() as u32,
                    SHGFI_ICON | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES,
                );
            }

            if result == 0 || shfi.hIcon.is_invalid() {
                return Err("Failed to get file icon".to_string());
            }

            let hicon = shfi.hIcon;

            // Get icon info to access the bitmap
            let mut icon_info: ICONINFO = std::mem::zeroed();
            if GetIconInfo(hicon, &mut icon_info).is_err() {
                DestroyIcon(hicon).ok();
                return Err("Failed to get icon info".to_string());
            }

            // Create a device context
            let hdc = CreateCompatibleDC(None);
            if hdc.is_invalid() {
                if !icon_info.hbmColor.is_invalid() {
                    let _ = DeleteObject(icon_info.hbmColor);
                }
                if !icon_info.hbmMask.is_invalid() {
                    let _ = DeleteObject(icon_info.hbmMask);
                }
                DestroyIcon(hicon).ok();
                return Err("Failed to create DC".to_string());
            }

            // Use the color bitmap
            let hbitmap = if !icon_info.hbmColor.is_invalid() {
                icon_info.hbmColor
            } else {
                icon_info.hbmMask
            };

            // Icon size (small icons are typically 16x16)
            let icon_size = 16i32;

            // Set up bitmap info header
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: icon_size,
                    biHeight: -icon_size, // Top-down DIB
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0 as u32,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [Default::default()],
            };

            // Allocate buffer for pixel data (BGRA)
            let pixel_count = (icon_size * icon_size) as usize;
            let mut pixels: Vec<u8> = vec![0u8; pixel_count * 4];

            // Select bitmap into DC and get pixels
            let old_bitmap = SelectObject(hdc, hbitmap);
            let scan_lines = GetDIBits(
                hdc,
                hbitmap,
                0,
                icon_size as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            );

            SelectObject(hdc, old_bitmap);
            let _ = DeleteDC(hdc);

            // Clean up GDI objects
            if !icon_info.hbmColor.is_invalid() {
                let _ = DeleteObject(icon_info.hbmColor);
            }
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask);
            }
            DestroyIcon(hicon).ok();

            if scan_lines == 0 {
                return Err("Failed to get bitmap bits".to_string());
            }

            // Convert BGRA to RGBA for PNG
            for i in 0..pixel_count {
                let offset = i * 4;
                pixels.swap(offset, offset + 2); // Swap B and R
            }

            // Create PNG image using the image crate
            let img = image::RgbaImage::from_raw(icon_size as u32, icon_size as u32, pixels)
                .ok_or("Failed to create image")?;

            // Encode as PNG
            let mut png_data = Vec::new();
            {
                use image::ImageEncoder;
                let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
                encoder
                    .write_image(
                        &img,
                        icon_size as u32,
                        icon_size as u32,
                        image::ExtendedColorType::Rgba8,
                    )
                    .map_err(|e| format!("PNG encoding failed: {}", e))?;
            }

            // Return base64 encoded PNG
            Ok(BASE64.encode(&png_data))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open volume mixer on specified monitor with configurable size
#[tauri::command]
async fn open_volume_mixer(
    monitor: Option<u32>,
    width: Option<i32>,
    height: Option<i32>,
) -> Result<(), String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, IsWindowVisible, SetWindowPos, HWND_TOP, SWP_SHOWWINDOW,
    };

    // Default: monitor 1 (primary), 230x65
    let target_monitor_num = monitor.unwrap_or(1) as usize;
    let window_width = width.unwrap_or(230);
    let window_height = height.unwrap_or(65);

    println!(
        "[VolumeMixer] Requested: monitor={}, width={}, height={}",
        target_monitor_num, window_width, window_height
    );

    tauri::async_runtime::spawn_blocking(move || {
        // Launch SndVol.exe
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "SndVol.exe"])
            .spawn()
            .map_err(|e| e.to_string())?;

        unsafe {
            // Find Volume Mixer window by enumerating all windows (with retries)
            static mut FOUND_HWND: Option<HWND> = None;

            unsafe extern "system" fn enum_callback(hwnd: HWND, _: LPARAM) -> BOOL {
                if !IsWindowVisible(hwnd).as_bool() {
                    return BOOL(1); // Continue
                }
                let mut title = [0u16; 256];
                let len = GetWindowTextW(hwnd, &mut title);
                if len > 0 {
                    let title_str = String::from_utf16_lossy(&title[..len as usize]);
                    // Match both "Volume Mixer" and "Volume mixer" (Windows 11 variant)
                    if title_str.to_lowercase().contains("volume mixer") {
                        println!("[VolumeMixer] Found window: '{}'", title_str);
                        FOUND_HWND = Some(hwnd);
                        return BOOL(0); // Stop enumeration
                    }
                }
                BOOL(1) // Continue
            }

            // Retry up to 10 times with 200ms delay (2 seconds total)
            for attempt in 1..=10 {
                std::thread::sleep(std::time::Duration::from_millis(200));
                FOUND_HWND = None;
                let _ = EnumWindows(Some(enum_callback), LPARAM(0));
                if FOUND_HWND.is_some() {
                    println!("[VolumeMixer] Found on attempt {}", attempt);
                    break;
                }
            }

            if let Some(hwnd) = FOUND_HWND {
                println!("[VolumeMixer] Found Volume Mixer window: {:?}", hwnd);
                // Enumerate monitors
                static mut MONITOR_LIST: Vec<HMONITOR> = Vec::new();
                MONITOR_LIST.clear();

                unsafe extern "system" fn volume_mixer_monitor_callback(
                    hmonitor: HMONITOR,
                    _hdc: HDC,
                    _lprect: *mut RECT,
                    _lparam: LPARAM,
                ) -> BOOL {
                    MONITOR_LIST.push(hmonitor);
                    BOOL(1) // Continue
                }

                let _ =
                    EnumDisplayMonitors(None, None, Some(volume_mixer_monitor_callback), LPARAM(0));

                println!("[VolumeMixer] Found {} monitors", MONITOR_LIST.len());

                // Find PRIMARY monitor (not by index - by MONITORINFOF_PRIMARY flag)
                let mut primary_monitor: Option<HMONITOR> = None;
                for (idx, &mon) in MONITOR_LIST.iter().enumerate() {
                    let mut mi = MONITORINFO {
                        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                        ..Default::default()
                    };
                    if GetMonitorInfoW(mon, &mut mi).as_bool() {
                        let is_primary = mi.dwFlags & 1 != 0; // MONITORINFOF_PRIMARY = 1
                        println!(
                            "[VolumeMixer] Monitor {}: work area ({},{}) to ({},{}) primary={}",
                            idx + 1,
                            mi.rcWork.left,
                            mi.rcWork.top,
                            mi.rcWork.right,
                            mi.rcWork.bottom,
                            is_primary
                        );
                        if is_primary && target_monitor_num == 1 {
                            primary_monitor = Some(mon);
                        }
                    }
                }

                // Use primary monitor if requested (monitor=1), otherwise use index
                let target_monitor = if target_monitor_num == 1 {
                    if let Some(pm) = primary_monitor {
                        println!("[VolumeMixer] Using PRIMARY monitor");
                        pm
                    } else if !MONITOR_LIST.is_empty() {
                        println!("[VolumeMixer] Primary not found, falling back to first");
                        MONITOR_LIST[0]
                    } else {
                        println!("[VolumeMixer] No monitors found!");
                        return Ok(());
                    }
                } else {
                    let monitor_index = target_monitor_num - 1;
                    if monitor_index < MONITOR_LIST.len() {
                        MONITOR_LIST[monitor_index]
                    } else if !MONITOR_LIST.is_empty() {
                        MONITOR_LIST[0]
                    } else {
                        return Ok(());
                    }
                };

                let mut monitor_info = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };

                if GetMonitorInfoW(target_monitor, &mut monitor_info).as_bool() {
                    // Center on target monitor
                    let work_width = monitor_info.rcWork.right - monitor_info.rcWork.left;
                    let work_height = monitor_info.rcWork.bottom - monitor_info.rcWork.top;
                    let x = monitor_info.rcWork.left + (work_width / 2) - (window_width / 2);
                    let y = monitor_info.rcWork.top + (work_height / 2) - (window_height / 2);

                    println!(
                        "[VolumeMixer] Positioning window at ({}, {}) with size {}x{}",
                        x, y, window_width, window_height
                    );

                    let _ = SetWindowPos(
                        hwnd,
                        HWND_TOP,
                        x,
                        y,
                        window_width,
                        window_height,
                        SWP_SHOWWINDOW,
                    );
                }
            } else {
                println!("[VolumeMixer] Volume Mixer window NOT found after 500ms wait");
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Bring Outlook desktop app to front (no repositioning, no URL opening)
#[tauri::command]
async fn open_in_outlook(_url: String) -> Result<(), String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            // Find existing Outlook window
            static mut OUTLOOK_HWND: Option<HWND> = None;
            OUTLOOK_HWND = None;

            unsafe extern "system" fn find_outlook(hwnd: HWND, _: LPARAM) -> BOOL {
                if !IsWindowVisible(hwnd).as_bool() {
                    return BOOL(1);
                }
                let mut title = [0u16; 256];
                let len = GetWindowTextW(hwnd, &mut title);
                if len > 0 {
                    let title_str = String::from_utf16_lossy(&title[..len as usize]);
                    // New Outlook window titles contain "Outlook"
                    if title_str.contains("Outlook") && title_str.len() > 10 {
                        OUTLOOK_HWND = Some(hwnd);
                        return BOOL(0);
                    }
                }
                BOOL(1)
            }

            let _ = EnumWindows(Some(find_outlook), LPARAM(0));

            // If Outlook window exists, just bring it to front
            if let Some(hwnd) = OUTLOOK_HWND {
                println!("Found Outlook window, bringing to front");
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            } else {
                // No Outlook window found, launch Outlook (without URL)
                println!("No Outlook window found, launching Outlook");
                let _ = std::process::Command::new("cmd")
                    .args(["/C", "start", "ms-outlook:"])
                    .spawn();
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open a URL in Microsoft Edge as a popup-style window
#[tauri::command]
async fn open_edge_popup(url: String, width: i32, height: i32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Launch Edge with --app flag for popup-style window and specific size
        let result = std::process::Command::new("cmd")
            .args([
                "/C",
                "start",
                "msedge",
                &format!("--app={}", url),
                &format!("--window-size={},{}", width, height),
                "--new-window",
            ])
            .spawn();

        match result {
            Ok(_) => {
                println!("Opened Edge popup: {}", url);
                Ok(())
            }
            Err(e) => {
                eprintln!("Failed to open Edge: {}", e);
                // Fallback: try opening with default browser
                let _ = std::process::Command::new("cmd")
                    .args(["/C", "start", "", &url])
                    .spawn();
                Ok(())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open Windows Focus Sessions (ms-clock: protocol)
/// Temporarily disables always-on-top and opens centered on primary monitor
#[tauri::command]
async fn open_focus_sessions(window: tauri::Window) -> Result<(), String> {
    // Temporarily disable always-on-top so Focus Sessions appears in front
    let _ = window.set_always_on_top(false);

    // Open Focus Sessions and move to primary monitor center using PowerShell
    let script = r#"
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

# Open Focus Sessions
Start-Process "ms-clock://focussessions"

# Wait for window to appear
Start-Sleep -Milliseconds 800

# Get primary monitor dimensions
Add-Type -AssemblyName System.Windows.Forms
$primary = [System.Windows.Forms.Screen]::PrimaryScreen
$workArea = $primary.WorkingArea

# Window size for Clock app (larger to show full sidebar)
$winWidth = 1000
$winHeight = 750

# Calculate center position on primary monitor
$x = $workArea.X + ($workArea.Width - $winWidth) / 2
$y = $workArea.Y + ($workArea.Height - $winHeight) / 2

# Find the Clock window (Windows Clock app)
$hwnd = [WinAPI]::FindWindow("ApplicationFrameWindow", "Clock")
if ($hwnd -ne [IntPtr]::Zero) {
    # Move window: SWP_NOZORDER = 0x0004, SWP_NOSIZE = 0x0001
    [WinAPI]::SetWindowPos($hwnd, [IntPtr]::Zero, [int]$x, [int]$y, $winWidth, $winHeight, 0x0000)
    [WinAPI]::SetForegroundWindow($hwnd)
}
"#;

    let result = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .spawn();

    match result {
        Ok(_) => {
            println!("Opened Windows Focus Sessions on primary monitor");
        }
        Err(e) => {
            eprintln!("Failed to open Focus Sessions: {}", e);
        }
    }

    // Re-enable always-on-top after a delay
    let window_clone = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let _ = window_clone.set_always_on_top(true);
        println!("Restored always-on-top");
    });

    Ok(())
}

/// Enable Do Not Disturb (suppress Windows notifications)
/// Uses PowerShell to toggle Focus Assist via WNF state
#[tauri::command]
async fn enable_do_not_disturb() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        // Use PowerShell to enable Focus Assist (Priority Only mode = 1, Alarms Only = 2)
        let script = r#"
$code = @'
using System;
using System.Runtime.InteropServices;
public class FocusAssist {
    [DllImport("ntdll.dll")]
    public static extern int NtUpdateWnfStateData(ref ulong StateName, IntPtr Buffer, uint Length, IntPtr TypeId, IntPtr ExplicitScope, uint MatchingChangeStamp, uint CheckChangeStamp);

    public static void SetMode(int mode) {
        ulong WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF5075;
        byte[] buffer = BitConverter.GetBytes(mode);
        IntPtr ptr = Marshal.AllocHGlobal(4);
        Marshal.Copy(buffer, 0, ptr, 4);
        NtUpdateWnfStateData(ref WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED, ptr, 4, IntPtr.Zero, IntPtr.Zero, 0, 0);
        Marshal.FreeHGlobal(ptr);
    }
}
'@
Add-Type -TypeDefinition $code
[FocusAssist]::SetMode(2)
"#;
        let result = std::process::Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .output();

        match result {
            Ok(out) => {
                if out.status.success() {
                    println!("Do Not Disturb enabled (Focus Assist: Alarms Only)");
                } else {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    eprintln!("DND enable error: {}", stderr);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("PowerShell not available: {}", e);
                Ok(())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Disable Do Not Disturb (restore Windows notifications)
/// Uses PowerShell to modify registry keys for Focus Assist
#[tauri::command]
async fn disable_do_not_disturb() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        // Use PowerShell with registry + WNF approach to disable Focus Assist/DND
        let script = r#"
# Registry Method - Create keys if they don't exist and set to disabled
$notifPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings"
$faPath = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\FocusAssist"

# Create Notifications\Settings if needed
if (!(Test-Path $notifPath)) {
    New-Item -Path $notifPath -Force | Out-Null
}
New-ItemProperty -Path $notifPath -Name "NOC_GLOBAL_SETTING_DND" -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue | Out-Null

# Create FocusAssist if needed
if (!(Test-Path $faPath)) {
    New-Item -Path $faPath -Force | Out-Null
}
New-ItemProperty -Path $faPath -Name "QuietHoursActive" -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue | Out-Null
New-ItemProperty -Path $faPath -Name "QuietHoursEnabled" -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue | Out-Null

# WNF Method - same as enable but with mode 0
$code = @'
using System;
using System.Runtime.InteropServices;
public class FocusOff2 {
    [DllImport("ntdll.dll")]
    public static extern int NtUpdateWnfStateData(ref ulong StateName, IntPtr Buffer, uint Length, IntPtr TypeId, IntPtr ExplicitScope, uint MatchingChangeStamp, uint CheckChangeStamp);
    public static void SetMode(int mode) {
        ulong WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF5075;
        byte[] buffer = BitConverter.GetBytes(mode);
        IntPtr ptr = Marshal.AllocHGlobal(4);
        Marshal.Copy(buffer, 0, ptr, 4);
        NtUpdateWnfStateData(ref WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED, ptr, 4, IntPtr.Zero, IntPtr.Zero, 0, 0);
        Marshal.FreeHGlobal(ptr);
    }
}
'@
Add-Type -TypeDefinition $code
[FocusOff2]::SetMode(0)
"#;
        let result = std::process::Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .output();

        match result {
            Ok(out) => {
                if out.status.success() {
                    println!("Do Not Disturb disabled (registry + WNF)");
                } else {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    eprintln!("DND disable error: {}", stderr);
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("PowerShell not available: {}", e);
                Ok(())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Turn off all monitors (computer stays running)
#[tauri::command]
async fn turn_off_monitors() -> Result<(), String> {
    use windows::Win32::Foundation::WPARAM;
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageW, HWND_BROADCAST, SC_MONITORPOWER, WM_SYSCOMMAND,
    };

    tauri::async_runtime::spawn_blocking(|| {
        unsafe {
            // SC_MONITORPOWER with lParam = 2 turns off the monitor
            // lParam values: -1 = on, 1 = low power, 2 = off
            let result = SendMessageW(
                HWND_BROADCAST,
                WM_SYSCOMMAND,
                WPARAM(SC_MONITORPOWER as usize),
                windows::Win32::Foundation::LPARAM(2),
            );
            println!("Monitor power off sent, result: {:?}", result);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open a URL (Teams/Zoom meeting) and position the window on primary monitor
#[tauri::command]
async fn open_meeting_on_primary(url: String) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetForegroundWindow, SetWindowPos, HWND_TOP, SWP_ASYNCWINDOWPOS,
        SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    let url_clone = url.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // Open the URL using the default handler
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url_clone])
            .spawn()
            .map_err(|e| e.to_string())?;

        // Wait for window to appear and stabilize
        std::thread::sleep(std::time::Duration::from_millis(1500));

        unsafe {
            // Get the foreground window (should be the newly opened app)
            let hwnd = GetForegroundWindow();
            if hwnd.0 == std::ptr::null_mut() {
                return Ok(());
            }

            // Get primary monitor (at point 0,0)
            let monitor = MonitorFromPoint(
                windows::Win32::Foundation::POINT { x: 0, y: 0 },
                MONITOR_DEFAULTTOPRIMARY,
            );
            let mut monitor_info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };

            if GetMonitorInfoW(monitor, &mut monitor_info).as_bool() {
                // Center on primary monitor
                let work_width = monitor_info.rcWork.right - monitor_info.rcWork.left;
                let work_height = monitor_info.rcWork.bottom - monitor_info.rcWork.top;
                let x = monitor_info.rcWork.left + (work_width / 2) - 400;
                let y = monitor_info.rcWork.top + (work_height / 2) - 300;

                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOP,
                    x,
                    y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS,
                );

                // Bring to front
                let _ = SetForegroundWindow(hwnd);
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ================================================================
// AUDIO MIXER - Windows Core Audio API
// ================================================================

/// Audio session info for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioSessionInfo {
    pub id: String,
    pub name: String,
    pub volume: u32,
    pub muted: bool,
}

/// Master volume info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterVolumeInfo {
    pub volume: u32,
    pub muted: bool,
}

/// Full audio levels response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioLevelsResponse {
    pub master: MasterVolumeInfo,
    pub sessions: Vec<AudioSessionInfo>,
}

/// Get all audio sessions and their volume levels
#[tauri::command]
async fn get_audio_sessions() -> Result<AudioLevelsResponse, String> {
    tauri::async_runtime::spawn_blocking(|| {
        unsafe {
            // Initialize COM
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            // Get device enumerator
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("Failed to create device enumerator: {}", e))?;

            // Get default audio endpoint
            let device: IMMDevice = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| format!("Failed to get default audio endpoint: {}", e))?;

            // Get audio session manager
            let session_manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Failed to activate session manager: {}", e))?;

            // Get master volume (via endpoint volume)
            let endpoint_volume: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Failed to get endpoint volume: {}", e))?;

            let master_level = endpoint_volume.GetMasterVolumeLevelScalar().unwrap_or(1.0);
            let master_muted = endpoint_volume.GetMute().unwrap_or(BOOL(0)).as_bool();

            let master = MasterVolumeInfo {
                volume: (master_level * 100.0) as u32,
                muted: master_muted,
            };

            // Get session enumerator
            let session_enumerator: IAudioSessionEnumerator = session_manager
                .GetSessionEnumerator()
                .map_err(|e| format!("Failed to get session enumerator: {}", e))?;

            let session_count = session_enumerator.GetCount().unwrap_or(0);
            let mut sessions = Vec::new();

            for i in 0..session_count {
                if let Ok(session_control) = session_enumerator.GetSession(i) {
                    let session_control: IAudioSessionControl = session_control;

                    // Get extended session control for process info
                    if let Ok(session_control2) = session_control.cast::<IAudioSessionControl2>() {
                        // Get process ID
                        let pid = session_control2.GetProcessId().unwrap_or(0);
                        if pid == 0 {
                            continue; // Skip system sounds
                        }

                        // Get process name from PID
                        let process_name =
                            get_process_name(pid).unwrap_or_else(|| format!("PID:{}", pid));

                        // Get volume control
                        if let Ok(volume_control) = session_control.cast::<ISimpleAudioVolume>() {
                            let volume = volume_control.GetMasterVolume().unwrap_or(1.0);
                            let muted = volume_control.GetMute().unwrap_or(BOOL(0)).as_bool();

                            sessions.push(AudioSessionInfo {
                                id: format!("{}:{}", pid, process_name),
                                name: process_name,
                                volume: (volume * 100.0) as u32,
                                muted,
                            });
                        }
                    }
                }
            }

            Ok(AudioLevelsResponse { master, sessions })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Get process name from PID
fn get_process_name(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::ProcessStatus::K32GetModuleBaseNameW;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid).ok()?;
        let mut name = [0u16; 260];
        let len = K32GetModuleBaseNameW(handle, None, &mut name);
        let _ = CloseHandle(handle);

        if len > 0 {
            Some(String::from_utf16_lossy(&name[..len as usize]))
        } else {
            None
        }
    }
}

/// Set volume for a specific audio session
#[tauri::command]
async fn set_audio_session_volume(session_name: String, level: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| e.to_string())?;

            let device: IMMDevice = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| e.to_string())?;

            // Handle master volume specially
            if session_name.to_lowercase() == "master" {
                let endpoint_volume: IAudioEndpointVolume = device
                    .Activate(CLSCTX_ALL, None)
                    .map_err(|e: windows::core::Error| e.to_string())?;
                endpoint_volume
                    .SetMasterVolumeLevelScalar(level as f32 / 100.0, std::ptr::null())
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }

            let session_manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| e.to_string())?;

            let session_enumerator = session_manager
                .GetSessionEnumerator()
                .map_err(|e| e.to_string())?;

            let session_count = session_enumerator.GetCount().unwrap_or(0);
            let target_name = session_name.to_lowercase();

            for i in 0..session_count {
                if let Ok(session_control) = session_enumerator.GetSession(i) {
                    let session_control: IAudioSessionControl = session_control;
                    if let Ok(session_control2) = session_control.cast::<IAudioSessionControl2>() {
                        let pid = session_control2.GetProcessId().unwrap_or(0);
                        if pid == 0 {
                            continue;
                        }

                        let process_name = get_process_name(pid).unwrap_or_default().to_lowercase();
                        if process_name.contains(&target_name)
                            || target_name.contains(&process_name.replace(".exe", ""))
                        {
                            if let Ok(volume_control) = session_control.cast::<ISimpleAudioVolume>()
                            {
                                volume_control
                                    .SetMasterVolume(level as f32 / 100.0, std::ptr::null())
                                    .map_err(|e| e.to_string())?;
                            }
                        }
                    }
                }
            }

            Ok(())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Toggle mute for a specific audio session
#[tauri::command]
async fn toggle_audio_session_mute(session_name: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| e.to_string())?;

            let device: IMMDevice = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| e.to_string())?;

            // Handle master volume specially
            if session_name.to_lowercase() == "master" {
                let endpoint_volume: IAudioEndpointVolume = device
                    .Activate(CLSCTX_ALL, None)
                    .map_err(|e: windows::core::Error| e.to_string())?;
                let current_mute = endpoint_volume.GetMute().unwrap_or(BOOL(0)).as_bool();
                endpoint_volume
                    .SetMute(!current_mute, std::ptr::null())
                    .map_err(|e| e.to_string())?;
                return Ok(!current_mute);
            }

            let session_manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| e.to_string())?;

            let session_enumerator = session_manager
                .GetSessionEnumerator()
                .map_err(|e| e.to_string())?;

            let session_count = session_enumerator.GetCount().unwrap_or(0);
            let target_name = session_name.to_lowercase();
            let mut new_mute_state = false;

            for i in 0..session_count {
                if let Ok(session_control) = session_enumerator.GetSession(i) {
                    let session_control: IAudioSessionControl = session_control;
                    if let Ok(session_control2) = session_control.cast::<IAudioSessionControl2>() {
                        let pid = session_control2.GetProcessId().unwrap_or(0);
                        if pid == 0 {
                            continue;
                        }

                        let process_name = get_process_name(pid).unwrap_or_default().to_lowercase();
                        if process_name.contains(&target_name)
                            || target_name.contains(&process_name.replace(".exe", ""))
                        {
                            if let Ok(volume_control) = session_control.cast::<ISimpleAudioVolume>()
                            {
                                let current_mute =
                                    volume_control.GetMute().unwrap_or(BOOL(0)).as_bool();
                                new_mute_state = !current_mute;
                                let _ = volume_control.SetMute(new_mute_state, std::ptr::null());
                            }
                        }
                    }
                }
            }

            Ok(new_mute_state)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Toggle mute for ALL microphones/capture devices
/// Returns true if microphones are now muted, false if unmuted
#[tauri::command]
async fn toggle_all_microphones_mute() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("Failed to create device enumerator: {}", e))?;

            // Get ALL active capture (input) devices
            let device_collection: IMMDeviceCollection = enumerator
                .EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)
                .map_err(|e| format!("Failed to enumerate capture devices: {}", e))?;

            let device_count = device_collection.GetCount().unwrap_or(0);

            if device_count == 0 {
                return Err("No active microphones found".to_string());
            }

            println!("[MicMute] Found {} active capture device(s)", device_count);

            // First, check if ANY mic is unmuted to determine toggle direction
            let mut any_unmuted = false;
            for i in 0..device_count {
                if let Ok(device) = device_collection.Item(i) {
                    if let Ok(endpoint_volume) =
                        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                    {
                        let is_muted = endpoint_volume.GetMute().unwrap_or(BOOL(0)).as_bool();
                        if !is_muted {
                            any_unmuted = true;
                            break;
                        }
                    }
                }
            }

            // If any mic is unmuted, mute all. If all are muted, unmute all.
            let new_mute_state = any_unmuted;

            for i in 0..device_count {
                if let Ok(device) = device_collection.Item(i) {
                    if let Ok(endpoint_volume) =
                        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                    {
                        match endpoint_volume.SetMute(new_mute_state, std::ptr::null()) {
                            Ok(_) => println!(
                                "[MicMute] Device {}: {}",
                                i,
                                if new_mute_state { "MUTED" } else { "UNMUTED" }
                            ),
                            Err(e) => {
                                eprintln!("[MicMute] Failed to set mute on device {}: {}", i, e)
                            }
                        }
                    }
                }
            }

            Ok(new_mute_state)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ================================================================
// CLAUDE STATS - Local Analytics Reading
// ================================================================

/// Claude usage statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeStats {
    pub lifetime_cost: f64,
    pub today_cost: f64,
    pub today_input_tokens: i64,
    pub today_output_tokens: i64,
    pub today_cache_read_tokens: i64,
    pub today_cache_write_tokens: i64,
    pub today_messages: i64,
    pub daily_costs: Vec<f64>,
    pub models: std::collections::HashMap<String, f64>,
}

/// Get Claude usage stats from local files
#[tauri::command]
async fn get_claude_stats() -> Result<ClaudeStats, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
        let claude_dir = home_dir.join(".claude");

        let mut stats = ClaudeStats {
            lifetime_cost: 0.0,
            today_cost: 0.0,
            today_input_tokens: 0,
            today_output_tokens: 0,
            today_cache_read_tokens: 0,
            today_cache_write_tokens: 0,
            today_messages: 0,
            daily_costs: Vec::new(),
            models: std::collections::HashMap::new(),
        };

        // Try to read live-today-stats.json first (most up-to-date)
        let live_stats_path = claude_dir.join("live-today-stats.json");
        if live_stats_path.exists() {
            if let Ok(content) = fs::read_to_string(&live_stats_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    stats.today_cost = json["cost"].as_f64().unwrap_or(0.0);
                    stats.today_input_tokens = json["inputTokens"].as_i64().unwrap_or(0);
                    stats.today_output_tokens = json["outputTokens"].as_i64().unwrap_or(0);
                    stats.today_cache_read_tokens = json["cacheReadTokens"].as_i64().unwrap_or(0);
                    stats.today_cache_write_tokens = json["cacheWriteTokens"].as_i64().unwrap_or(0);
                    stats.today_messages = json["messages"].as_i64().unwrap_or(0);

                    // Extract model breakdown
                    if let Some(models) = json["models"].as_object() {
                        for (model_id, model_data) in models {
                            let cost = model_data["cost"].as_f64().unwrap_or(0.0);
                            let display_name = if model_id.contains("opus") {
                                "Opus"
                            } else if model_id.contains("sonnet") {
                                "Sonnet"
                            } else if model_id.contains("haiku") {
                                "Haiku"
                            } else {
                                model_id.as_str()
                            };
                            *stats.models.entry(display_name.to_string()).or_insert(0.0) += cost;
                        }
                    }
                }
            }
        }

        // Try to read from analytics.db for historical data
        let db_path = claude_dir.join("analytics.db");
        if db_path.exists() {
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                // Get lifetime cost
                if let Ok(total) = conn.query_row(
                    "SELECT COALESCE(SUM(cost), 0) FROM daily_snapshots",
                    [],
                    |row| row.get::<_, f64>(0),
                ) {
                    stats.lifetime_cost = total;
                }

                // Get daily costs for sparkline (last 14 days)
                if let Ok(mut stmt) = conn.prepare(
                    "SELECT cost FROM daily_snapshots ORDER BY date DESC LIMIT 14",
                ) {
                    if let Ok(rows) = stmt.query_map([], |row| row.get::<_, f64>(0)) {
                        let mut costs: Vec<f64> = rows.filter_map(|r| r.ok()).collect();
                        costs.reverse(); // Oldest first for sparkline
                        stats.daily_costs = costs;
                    }
                }

                // If we didn't get today's cost from live stats, try db
                if stats.today_cost == 0.0 {
                    let today = chrono_lite_today();
                    if let Ok(cost) = conn.query_row(
                        "SELECT cost FROM daily_snapshots WHERE date = ?1",
                        [&today],
                        |row| row.get::<_, f64>(0),
                    ) {
                        stats.today_cost = cost;
                    }
                }

                // Get model usage totals if not from live stats
                if stats.models.is_empty() {
                    if let Ok(mut stmt) = conn.prepare(
                        "SELECT model, SUM(input_tokens + output_tokens) as total_tokens FROM model_usage GROUP BY model",
                    ) {
                        if let Ok(rows) = stmt.query_map([], |row| {
                            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                        }) {
                            for row in rows.filter_map(|r| r.ok()) {
                                let display_name = if row.0.contains("opus") {
                                    "Opus"
                                } else if row.0.contains("sonnet") {
                                    "Sonnet"
                                } else if row.0.contains("haiku") {
                                    "Haiku"
                                } else {
                                    &row.0
                                };
                                *stats.models.entry(display_name.to_string()).or_insert(0.0) += row.1 as f64;
                            }
                        }
                    }
                }
            }
        }

        // Add today's cost to lifetime if not already included
        if stats.lifetime_cost > 0.0 && !stats.daily_costs.is_empty() {
            // Lifetime is from db, add today's live cost
            stats.lifetime_cost += stats.today_cost;
        }

        Ok(stats)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Get today's date in YYYY-MM-DD format
fn chrono_lite_today() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    chrono_lite_format(now)
        .split('T')
        .next()
        .unwrap_or("")
        .to_string()
}

// ================================================================
// LIBRE HARDWARE MONITOR PROXY
// Fetches data from local LibreHardwareMonitor HTTP server
// Needed because HTTPS page can't fetch HTTP (mixed content)
//
// The full sensor tree (often 100s of KB) used to be shipped to JS and
// traversed there every 2s just to extract four numbers; the traversal now
// happens here and only the summary crosses the IPC boundary. The matching
// rules mirror the old JS parseHardwareData exactly.
// ================================================================

#[derive(Debug, Clone, Serialize, Default)]
pub struct SystemStatsSummary {
    pub cpu: f32,
    pub gpu: f32,
    pub ram: f32,
    pub drives: Vec<DriveUsage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DriveUsage {
    pub name: String,
    pub used_percent: f32,
}

/// Parse the leading float out of a sensor value like "12.5 %" (mirrors the
/// old JS /([\d.]+)/ match).
fn leading_float(s: &str) -> Option<f32> {
    let t = s.trim_start();
    let end = t
        .char_indices()
        .take_while(|(_, c)| c.is_ascii_digit() || *c == '.')
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0);
    if end == 0 {
        None
    } else {
        t[..end].parse::<f32>().ok()
    }
}

fn traverse_hardware_tree(
    node: &serde_json::Value,
    drive_ctx: Option<&str>,
    out: &mut SystemStatsSummary,
) {
    let text = node.get("Text").and_then(|t| t.as_str()).unwrap_or("");
    let value = node.get("Value").and_then(|v| v.as_str()).unwrap_or("");

    if text.contains("CPU Total") && !value.is_empty() {
        if let Some(v) = leading_float(value) {
            out.cpu = v;
        }
    }
    if text.contains("GPU Core") && value.contains('%') {
        if let Some(v) = leading_float(value) {
            out.gpu = v;
        }
    }
    if text == "Memory" && value.contains('%') {
        if let Some(v) = leading_float(value) {
            out.ram = v;
        }
    }

    // Storage devices are identified by their hdd.png node icon; their
    // "Used Space" sensors live somewhere in the subtree below.
    let is_drive = node
        .get("ImageURL")
        .and_then(|u| u.as_str())
        .map(|u| u.contains("hdd.png"))
        .unwrap_or(false);
    let ctx = if is_drive { Some(text) } else { drive_ctx };

    if text == "Used Space" && value.contains('%') {
        if let (Some(name), Some(v)) = (ctx, leading_float(value)) {
            if let Some(existing) = out.drives.iter_mut().find(|d| d.name == name) {
                existing.used_percent = v;
            } else {
                out.drives.push(DriveUsage {
                    name: name.to_string(),
                    used_percent: v,
                });
            }
        }
    }

    if let Some(children) = node.get("Children").and_then(|c| c.as_array()) {
        for child in children {
            traverse_hardware_tree(child, ctx, out);
        }
    }
}

#[tauri::command]
async fn get_system_stats() -> Result<SystemStatsSummary, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<SystemStatsSummary, String> {
        let response = ureq::get("http://localhost:8085/data.json")
            .timeout(std::time::Duration::from_secs(2))
            .call()
            .map_err(|e| format!("Failed to connect to LibreHardwareMonitor: {}", e))?;

        let body = response
            .into_string()
            .map_err(|e| format!("Failed to read response: {}", e))?;

        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse JSON: {}", e))?;

        let mut out = SystemStatsSummary::default();
        traverse_hardware_tree(&json, None, &mut out);
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ================================================================
// MICROSOFT OAUTH TOKEN EXCHANGE
// The webview cannot call the Azure token endpoint itself: WebView2 sends
// an Origin header, which Azure interprets as a SPA call and rejects for
// desktop-registered redirect URIs. These commands proxy the two
// token-endpoint calls; the raw response body is returned for the frontend
// to parse - including Azure's error JSON on 4xx, which the frontend
// classifies as permanent vs transient. Only genuine transport failures
// surface as Err (the frontend's "network error, retry later" path).
// ================================================================

const MS_TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

fn post_token_request(form: &[(&str, &str)]) -> Result<String, String> {
    let result = ureq::post(MS_TOKEN_ENDPOINT)
        .timeout(std::time::Duration::from_secs(15))
        .send_form(form);

    match result {
        Ok(response) => response
            .into_string()
            .map_err(|e| format!("Failed to read token response: {}", e)),
        Err(ureq::Error::Status(_code, response)) => response
            .into_string()
            .map_err(|e| format!("Failed to read token error response: {}", e)),
        Err(e) => Err(format!("Token request failed: {}", e)),
    }
}

#[tauri::command]
async fn exchange_oauth_code(
    client_id: String,
    code: String,
    code_verifier: String,
    redirect_uri: String,
    scope: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        post_token_request(&[
            ("client_id", client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", code_verifier.as_str()),
            ("scope", scope.as_str()),
        ])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn refresh_oauth_token(
    client_id: String,
    refresh_token: String,
    scope: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        post_token_request(&[
            ("client_id", client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("scope", scope.as_str()),
        ])
    })
    .await
    .map_err(|e| e.to_string())?
}

// ================================================================
// OAUTH CALLBACK SERVER
// Temporary HTTP server to catch OAuth redirects in production builds
// ================================================================

use std::sync::atomic::AtomicBool as OAuthAtomicBool;

/// Global flag to control OAuth server shutdown
static OAUTH_SERVER_RUNNING: OAuthAtomicBool = OAuthAtomicBool::new(false);

/// HTML content for the OAuth callback page
const OAUTH_CALLBACK_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Widget Wall - Authentication</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .icon { width: 64px; height: 64px; margin-bottom: 20px; }
    .icon.success { color: #4ade80; }
    .icon.error { color: #f87171; }
    h1 { font-size: 24px; margin-bottom: 16px; }
    p { color: rgba(255, 255, 255, 0.8); line-height: 1.6; margin-bottom: 20px; }
    .code-box {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      padding: 16px;
      margin: 20px 0;
      font-family: monospace;
      font-size: 12px;
      word-break: break-all;
      color: #fbbf24;
      max-height: 100px;
      overflow-y: auto;
    }
    .btn {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: #2563eb; }
    .btn.copied { background: #22c55e; }
    .instructions {
      background: rgba(59, 130, 246, 0.2);
      border-radius: 8px;
      padding: 16px;
      margin-top: 20px;
      text-align: left;
    }
    .instructions ol { margin-left: 20px; }
    .instructions li { margin: 8px 0; color: rgba(255, 255, 255, 0.9); }
  </style>
</head>
<body>
  <div class="container" id="container">
    <div id="loading">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      <h1>Processing...</h1>
      <p>Please wait while we complete authentication.</p>
    </div>
  </div>
  <script>
    (function() {
      const container = document.getElementById('container');
      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error') || hashParams.get('error');
      const errorDescription = params.get('error_description') || hashParams.get('error_description');

      if (accessToken) {
        localStorage.setItem('twitch-access-token', accessToken);
        localStorage.setItem('twitch-logged-in', 'true');
        container.innerHTML = `
          <svg class="icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M8 12l2 2 4-4"/>
          </svg>
          <h1>Twitch Connected!</h1>
          <p>Your Twitch account has been linked. This window will close automatically.</p>
        `;
        setTimeout(() => window.close(), 1500);
        return;
      }

      if (error) {
        container.innerHTML = `
          <svg class="icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <h1>Authentication Failed</h1>
          <p>${errorDescription || error}</p>
          <p style="margin-top: 20px;">Please close this window and try again in Widget Wall Desktop.</p>
        `;
        return;
      }

      if (code) {
        container.innerHTML = `
          <svg class="icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M8 12l2 2 4-4"/>
          </svg>
          <h1>Authentication Successful!</h1>
          <p>Your Microsoft account has been authenticated. Copy the code below and paste it in Widget Wall Desktop.</p>
          <div class="code-box" id="code-box">${code}</div>
          <button class="btn" id="copy-btn" onclick="copyCode()">Copy Code to Clipboard</button>
          <div class="instructions">
            <strong>Next steps:</strong>
            <ol>
              <li>Click "Copy Code to Clipboard" above</li>
              <li>Return to Widget Wall Desktop</li>
              <li>Open Settings and click "Paste Auth Code"</li>
              <li>Close this browser tab</li>
            </ol>
          </div>
        `;
        setTimeout(() => copyCode(), 500);
      } else {
        container.innerHTML = `
          <svg class="icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/>
          </svg>
          <h1>Unexpected Response</h1>
          <p>No authentication code was received. Please close this window and try signing in again.</p>
        `;
      }
    })();

    function copyCode() {
      const codeBox = document.getElementById('code-box');
      const copyBtn = document.getElementById('copy-btn');
      if (codeBox && copyBtn) {
        navigator.clipboard.writeText(codeBox.textContent).then(() => {
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = 'Copy Code to Clipboard';
            copyBtn.classList.remove('copied');
          }, 2000);
        }).catch(() => {
          const range = document.createRange();
          range.selectNode(codeBox);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
          copyBtn.textContent = 'Select All (Ctrl+C to copy)';
        });
      }
    }
  </script>
</body>
</html>"##;

/// Start the OAuth callback server on port 8420
/// This is used to catch OAuth redirects when running the production build
/// Uses HTTP on port 8420 to avoid conflicts with Tauri dev server
#[tauri::command]
async fn start_oauth_server() -> Result<String, String> {
    use std::time::Duration;

    // Check if already running
    if OAUTH_SERVER_RUNNING.load(Ordering::SeqCst) {
        return Ok("OAuth server already running".to_string());
    }

    // Start the server in a background thread
    thread::spawn(move || {
        // Use HTTP for localhost OAuth (allowed by RFC 8252 for native apps)
        // Port 8420 to avoid conflicts with dev server on 1420
        let server = match tiny_http::Server::http("127.0.0.1:8420") {
            Ok(s) => s,
            Err(e) => {
                println!("[OAuth Server] Failed to start: {}", e);
                return;
            }
        };

        OAUTH_SERVER_RUNNING.store(true, Ordering::SeqCst);
        println!("[OAuth Server] Started on port 8420");

        // Server loop with timeout
        let timeout = Duration::from_secs(300); // 5 minute timeout
        let start = std::time::Instant::now();

        while OAUTH_SERVER_RUNNING.load(Ordering::SeqCst) && start.elapsed() < timeout {
            // Non-blocking receive with short timeout
            match server.recv_timeout(Duration::from_millis(500)) {
                Ok(Some(request)) => {
                    let url = request.url().to_string();
                    println!("[OAuth Server] Request: {}", url);

                    // Serve the callback HTML for auth-callback requests
                    if url.starts_with("/auth-callback")
                        || url.contains("code=")
                        || url.contains("access_token=")
                    {
                        let response = tiny_http::Response::from_string(OAUTH_CALLBACK_HTML)
                            .with_header(
                                tiny_http::Header::from_bytes(
                                    &b"Content-Type"[..],
                                    &b"text/html; charset=utf-8"[..],
                                )
                                .unwrap(),
                            );
                        let _ = request.respond(response);

                        // Stop server after serving callback (success case)
                        println!("[OAuth Server] Served callback, shutting down...");
                        OAUTH_SERVER_RUNNING.store(false, Ordering::SeqCst);
                        break;
                    } else {
                        // 404 for other requests
                        let response =
                            tiny_http::Response::from_string("Not Found").with_status_code(404);
                        let _ = request.respond(response);
                    }
                }
                Ok(None) => {
                    // Timeout, continue waiting
                }
                Err(e) => {
                    println!("[OAuth Server] Error: {}", e);
                    break;
                }
            }
        }

        OAUTH_SERVER_RUNNING.store(false, Ordering::SeqCst);
        println!("[OAuth Server] Stopped");
    });

    // Wait a moment for the server to start
    thread::sleep(std::time::Duration::from_millis(100));

    if OAUTH_SERVER_RUNNING.load(Ordering::SeqCst) {
        Ok("OAuth server started on port 8420".to_string())
    } else {
        Err("Failed to start OAuth server".to_string())
    }
}

/// Stop the OAuth callback server
#[tauri::command]
async fn stop_oauth_server() -> Result<String, String> {
    OAUTH_SERVER_RUNNING.store(false, Ordering::SeqCst);
    Ok("OAuth server stopped".to_string())
}

/// Check if OAuth server is running
#[tauri::command]
async fn is_oauth_server_running() -> bool {
    OAUTH_SERVER_RUNNING.load(Ordering::SeqCst)
}

// ================================================================
// PERSISTENT CONFIG STORAGE
// Saves widget config to app data directory (survives reinstalls)
// ================================================================

/// Get the config directory path, creating it if needed
fn get_config_dir() -> Result<PathBuf, String> {
    let app_data = std::env::var("APPDATA").map_err(|_| "Failed to get APPDATA directory")?;
    let config_dir = PathBuf::from(app_data).join("Widget Wall").join("config");

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    Ok(config_dir)
}

/// Save widget configuration to persistent storage
#[tauri::command]
async fn save_widget_config(key: String, value: String) -> Result<(), String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join(format!("{}.json", key));

    fs::write(&file_path, value).map_err(|e| format!("Failed to save config '{}': {}", key, e))?;

    Ok(())
}

/// Load widget configuration from persistent storage
#[tauri::command]
async fn load_widget_config(key: String) -> Result<Option<String>, String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join(format!("{}.json", key));

    if !file_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to load config '{}': {}", key, e))?;

    Ok(Some(content))
}

pub fn run() {
    // Create shared audio buffer
    let audio_buffer = Arc::new(SharedAudioBuffer::default());

    // Disable WebView2 tracking prevention so embedded players (Spotify, YouTube) can access storage.
    // Must be set before WebView2 is initialized.
    #[allow(deprecated)]
    {
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-features=msTrackingProtection \
             --autoplay-policy=no-user-gesture-required \
             --enable-gpu-rasterization \
             --ignore-gpu-blocklist \
             --enable-zero-copy \
             --enable-hardware-overlays \
             --disable-background-timer-throttling \
             --disable-renderer-backgrounding");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(audio_buffer)
        .invoke_handler(tauri::generate_handler![
            list_audio_devices,
            start_audio_capture,
            stop_audio_capture,
            get_audio_levels,
            get_audio_status,
            get_default_output_device,
            get_default_loopback_device,
            // Now Playing commands
            get_now_playing,
            media_play_pause,
            media_next,
            media_previous,
            media_seek,
            media_toggle_shuffle,
            media_set_repeat_mode,
            media_cycle_repeat,
            // Recent Files commands
            get_recent_files,
            open_file,
            // System Stats commands
            open_task_manager,
            open_folder_in_explorer,
            copy_file_to_clipboard,
            get_file_icon,
            open_volume_mixer,
            open_meeting_on_primary,
            open_in_outlook,
            open_edge_popup,
            open_focus_sessions,
            turn_off_monitors,
            // Do Not Disturb commands
            enable_do_not_disturb,
            disable_do_not_disturb,
            // Audio Mixer commands
            get_audio_sessions,
            set_audio_session_volume,
            toggle_audio_session_mute,
            toggle_all_microphones_mute,
            // Claude Stats command
            get_claude_stats,
            // LibreHardwareMonitor proxy
            get_system_stats,
            // OAuth callback server commands
            start_oauth_server,
            stop_oauth_server,
            is_oauth_server_running,
            // Microsoft OAuth token exchange (Origin-header-free proxy)
            exchange_oauth_code,
            refresh_oauth_token,
            // Google Maps commands
            get_drive_time,
            validate_address,
            // Persistent config storage
            save_widget_config,
            load_widget_config
        ])
        .setup(|app| {
            // === SYSTEM TRAY ===
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let fullscreen_item = MenuItem::with_id(app, "fullscreen", "Toggle Fullscreen", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[
                &show_item,
                &fullscreen_item,
                &separator,
                &quit_item,
            ])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "fullscreen" => {
                            if let Some(window) = app.get_webview_window("main") {
                                if let Ok(is_fullscreen) = window.is_fullscreen() {
                                    let _ = window.set_fullscreen(!is_fullscreen);
                                    let _ = window.set_decorations(is_fullscreen);
                                    // Hide from taskbar when fullscreen (show only in system tray)
                                    let _ = window.set_skip_taskbar(!is_fullscreen);
                                }
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // === POSITION WINDOW ON MONITOR 2 ===
            use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
            use windows::Win32::Graphics::Gdi::{
                EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
            };

            if let Some(window) = app.get_webview_window("main") {
                // Enumerate monitors
                static mut MONITOR_LIST: Vec<HMONITOR> = Vec::new();

                unsafe {
                    MONITOR_LIST.clear();
                }

                unsafe extern "system" fn startup_monitor_callback(
                    hmonitor: HMONITOR,
                    _hdc: HDC,
                    _lprect: *mut RECT,
                    _lparam: LPARAM,
                ) -> BOOL {
                    MONITOR_LIST.push(hmonitor);
                    BOOL(1)
                }

                unsafe {
                    let _ =
                        EnumDisplayMonitors(None, None, Some(startup_monitor_callback), LPARAM(0));
                }

                unsafe {
                    println!("[Startup] Found {} monitors", MONITOR_LIST.len());

                    // Target monitor 2 (index 1)
                    let target_index = 1;
                    if target_index < MONITOR_LIST.len() {
                        let mut monitor_info = MONITORINFO {
                            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                            ..Default::default()
                        };

                        if GetMonitorInfoW(MONITOR_LIST[target_index], &mut monitor_info).as_bool()
                        {
                            let x = monitor_info.rcWork.left;
                            let y = monitor_info.rcWork.top;
                            println!(
                                "[Startup] Positioning window on monitor 2 at ({}, {})",
                                x, y
                            );
                            let _ = window.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition { x, y },
                            ));
                        }
                    } else {
                        println!("[Startup] Monitor 2 not found, using default position");
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Minimize to tray instead of closing
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
