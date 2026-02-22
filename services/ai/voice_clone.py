"""Voice synthesis and cloning for harmony parts."""

import os
import numpy as np
import soundfile as sf
from scipy import signal
from typing import List, Dict
import librosa
from pitch import midi_to_hz, hz_to_midi

# Attempt to import RVC
try:
    from rvc_python import RVC

    HAS_RVC = True
except ImportError:
    HAS_RVC = False

TEMP_DIR = os.environ.get("TEMP_AUDIO_DIR", "/tmp/audio")
os.makedirs(TEMP_DIR, exist_ok=True)

# Subtle timbre variations per voice type
VOICE_FORMANT_SHIFTS = {
    "soprano": 1.1,   # Slightly brighter
    "alto": 0.95,     # Slightly warmer
    "tenor": 1.05,    # Slightly brighter than neutral
    "bass": 0.85,     # Darker, fuller
}


def synthesize_voices(
    source_audio_path: str,
    harmony_parts: List[Dict],
    duration: float,
) -> List[str]:
    """
    Synthesize harmony voices from source audio.

    For each harmony part, pitch-shifts the source audio to match
    the harmony pitch contour and applies subtle timbre variations.

    Args:
        source_audio_path: Path to source vocal audio
        harmony_parts: List of harmony part dictionaries
        duration: Total duration in seconds

    Returns:
        List of file paths to synthesized audio files
    """
    # Load source audio
    source_audio, sr = librosa.load(source_audio_path, sr=44100, mono=True)

    audio_urls = []

    for part_data in harmony_parts:
        part_name = part_data["part"] if isinstance(part_data, dict) else part_data.part
        pitches = part_data["pitches"] if isinstance(part_data, dict) else part_data.pitches
        timestamps = part_data["timestamps"] if isinstance(part_data, dict) else part_data.timestamps

        output_path = os.path.join(TEMP_DIR, f"{part_name}_harmony.wav")

        if HAS_RVC:
            # Use RVC for high-quality voice cloning
            synthesized = _synthesize_with_rvc(
                source_audio, sr, pitches, timestamps, part_name
            )
        else:
            # Fallback: pitch shifting with phase vocoder
            synthesized = _synthesize_with_pitch_shift(
                source_audio, sr, pitches, timestamps, part_name
            )

        # Apply natural dynamics
        synthesized = _apply_dynamics(synthesized, sr, part_name)

        # Apply subtle vibrato
        synthesized = _apply_vibrato(synthesized, sr)

        # Normalize
        peak = np.max(np.abs(synthesized))
        if peak > 0:
            synthesized = synthesized * 0.85 / peak

        # Write output
        sf.write(output_path, synthesized, sr, subtype="PCM_16")
        audio_urls.append(output_path)

    return audio_urls


def _synthesize_with_rvc(
    source_audio: np.ndarray,
    sr: int,
    pitches: List[float],
    timestamps: List[float],
    part_name: str,
) -> np.ndarray:
    """Synthesize using RVC voice conversion."""
    try:
        rvc = RVC()
        # Calculate average pitch shift needed
        source_pitches = librosa.pyin(
            source_audio,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C7"),
            sr=sr,
        )[0]
        source_pitches = np.nan_to_num(source_pitches, nan=0.0)

        # Average semitone shift
        valid_source = source_pitches[source_pitches > 0]
        valid_target = [p for p in pitches if p > 0]

        if len(valid_source) > 0 and len(valid_target) > 0:
            avg_source = np.mean(valid_source)
            avg_target = np.mean(valid_target)
            semitone_shift = 12 * np.log2(avg_target / avg_source)
        else:
            semitone_shift = 0

        # Apply pitch shift via RVC
        output = rvc.convert(
            source_audio,
            sr=sr,
            pitch_shift=int(round(semitone_shift)),
        )
        return output
    except Exception:
        # Fallback
        return _synthesize_with_pitch_shift(
            source_audio, sr, pitches, timestamps, part_name
        )


def _synthesize_with_pitch_shift(
    source_audio: np.ndarray,
    sr: int,
    pitches: List[float],
    timestamps: List[float],
    part_name: str,
) -> np.ndarray:
    """Synthesize using librosa pitch shifting (fallback method)."""
    # Calculate average pitch shift from melody
    source_f0, _, _ = librosa.pyin(
        source_audio,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=sr,
    )
    source_f0 = np.nan_to_num(source_f0, nan=0.0)

    valid_source = source_f0[source_f0 > 0]
    valid_target = [p for p in pitches if p > 0]

    if len(valid_source) > 0 and len(valid_target) > 0:
        avg_source_midi = hz_to_midi(float(np.mean(valid_source)))
        avg_target_midi = hz_to_midi(float(np.mean(valid_target)))
        n_steps = avg_target_midi - avg_source_midi
    else:
        n_steps = {"soprano": 0, "alto": -4, "tenor": -7, "bass": -12}.get(
            part_name, 0
        )

    # Apply pitch shift
    shifted = librosa.effects.pitch_shift(
        y=source_audio,
        sr=sr,
        n_steps=float(n_steps),
    )

    # Apply formant shift for voice character
    formant_ratio = VOICE_FORMANT_SHIFTS.get(part_name, 1.0)
    if formant_ratio != 1.0:
        # Simple formant shifting via resampling trick
        n_samples = len(shifted)
        resampled = librosa.resample(
            shifted, orig_sr=sr, target_sr=int(sr * formant_ratio)
        )
        # Resize back to original length
        if len(resampled) > n_samples:
            resampled = resampled[:n_samples]
        else:
            resampled = np.pad(resampled, (0, n_samples - len(resampled)))
        shifted = resampled

    return shifted


def _apply_dynamics(audio: np.ndarray, sr: int, part_name: str) -> np.ndarray:
    """Apply natural-sounding dynamics to the audio."""
    # Gentle compression
    threshold = 0.5
    ratio = 3.0

    envelope = np.abs(audio)
    # Smooth envelope
    window = int(sr * 0.01)  # 10ms window
    if window > 0:
        envelope = np.convolve(envelope, np.ones(window) / window, mode="same")

    # Apply soft compression
    gain = np.where(
        envelope > threshold,
        threshold + (envelope - threshold) / ratio,
        envelope,
    )
    safe_envelope = np.where(envelope > 1e-10, envelope, 1.0)
    gain_factor = gain / safe_envelope
    audio = audio * gain_factor

    # Voice-specific volume adjustment
    voice_volumes = {
        "soprano": 0.85,
        "alto": 0.80,
        "tenor": 0.78,
        "bass": 0.75,
    }
    audio *= voice_volumes.get(part_name, 0.8)

    return audio


def _apply_vibrato(
    audio: np.ndarray,
    sr: int,
    rate: float = 5.0,
    depth: float = 0.002,
) -> np.ndarray:
    """Apply subtle vibrato to make the voice sound more natural."""
    n = len(audio)
    t = np.arange(n) / sr

    # Sinusoidal vibrato modulation
    modulation = depth * sr * np.sin(2 * np.pi * rate * t)

    # Apply via interpolation
    indices = np.arange(n) + modulation
    indices = np.clip(indices, 0, n - 1)

    # Linear interpolation
    idx_floor = np.floor(indices).astype(int)
    idx_ceil = np.minimum(idx_floor + 1, n - 1)
    frac = indices - idx_floor

    output = audio[idx_floor] * (1 - frac) + audio[idx_ceil] * frac

    return output.astype(np.float32)
