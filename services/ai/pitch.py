"""Pitch detection using CREPE neural network."""

import numpy as np
import librosa
from typing import Tuple, List

# Try importing CREPE; fall back to librosa pyin if unavailable
try:
    import crepe

    HAS_CREPE = True
except ImportError:
    HAS_CREPE = False


def analyze_pitch(
    audio_path: str,
    sample_rate: int = 16000,
    step_size: int = 10,
) -> Tuple[List[float], List[float], float]:
    """
    Extract pitch contour from audio file.

    Returns:
        pitch_contour: List of fundamental frequencies (Hz), 0.0 for unvoiced
        timestamps: List of time positions (seconds)
        duration: Total audio duration in seconds
    """
    # Load audio
    audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    duration = len(audio) / sr

    if HAS_CREPE:
        # Use CREPE for high-quality pitch detection
        time_arr, frequency, confidence, _ = crepe.predict(
            audio,
            sr,
            step_size=step_size,
            viterbi=True,  # Use Viterbi smoothing
            model_capacity="medium",
        )

        # Filter by confidence threshold
        frequency[confidence < 0.5] = 0.0

        pitch_contour = frequency.tolist()
        timestamps = time_arr.tolist()
    else:
        # Fallback to librosa pyin
        f0, voiced_flag, _ = librosa.pyin(
            audio,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C7"),
            sr=sr,
        )

        # Replace NaN with 0.0 (unvoiced)
        f0 = np.nan_to_num(f0, nan=0.0)

        # Generate timestamps
        hop_length = 512
        timestamps_arr = librosa.times_like(f0, sr=sr, hop_length=hop_length)

        pitch_contour = f0.tolist()
        timestamps = timestamps_arr.tolist()

    return pitch_contour, timestamps, duration


def hz_to_midi(frequency: float) -> int:
    """Convert frequency in Hz to MIDI note number."""
    if frequency <= 0:
        return 0
    return int(round(69 + 12 * np.log2(frequency / 440.0)))


def midi_to_hz(midi_note: int) -> float:
    """Convert MIDI note number to frequency in Hz."""
    if midi_note <= 0:
        return 0.0
    return 440.0 * (2.0 ** ((midi_note - 69) / 12.0))
