"""Audio utility functions for the AI service."""

import os
import tempfile
import httpx
import librosa
import numpy as np
from typing import Tuple, Optional

TEMP_DIR = os.environ.get("TEMP_AUDIO_DIR", "/tmp/audio")
os.makedirs(TEMP_DIR, exist_ok=True)


async def download_audio(url: str) -> str:
    """Download audio from URL and save to temp file."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()

        # Determine extension from content type or URL
        content_type = response.headers.get("content-type", "")
        if "wav" in content_type or url.endswith(".wav"):
            ext = ".wav"
        elif "mp3" in content_type or "mpeg" in content_type or url.endswith(".mp3"):
            ext = ".mp3"
        elif "ogg" in content_type or url.endswith(".ogg"):
            ext = ".ogg"
        elif "flac" in content_type or url.endswith(".flac"):
            ext = ".flac"
        elif "webm" in content_type or url.endswith(".webm"):
            ext = ".webm"
        else:
            ext = ".wav"

        fd, path = tempfile.mkstemp(suffix=ext, dir=TEMP_DIR)
        with os.fdopen(fd, "wb") as f:
            f.write(response.content)

        return path


def detect_key_and_tempo(
    audio_path: str,
    fallback_key: Optional[str] = "C major",
    fallback_bpm: Optional[int] = 120,
) -> Tuple[str, str, float]:
    """
    Detect musical key, scale, and tempo from audio.

    Returns:
        key_name: Key name (e.g., "C", "G", "Bb")
        scale_type: Scale type ("major" or "minor")
        bpm: Tempo in beats per minute
    """
    try:
        audio, sr = librosa.load(audio_path, sr=22050, mono=True)

        # Detect tempo
        tempo, _ = librosa.beat.beat_track(y=audio, sr=sr)
        detected_bpm = float(tempo) if np.isscalar(tempo) else float(tempo[0])

        if detected_bpm <= 0 and fallback_bpm:
            detected_bpm = float(fallback_bpm)

        # Detect key using chroma features
        chroma = librosa.feature.chroma_cqt(y=audio, sr=sr)
        chroma_mean = np.mean(chroma, axis=1)

        # Key detection using Krumhansl-Kessler key profiles
        major_profile = np.array(
            [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
        )
        minor_profile = np.array(
            [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
        )

        note_names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

        best_corr = -1
        best_key = "C"
        best_scale = "major"

        for i in range(12):
            rotated = np.roll(chroma_mean, -i)

            # Major correlation
            corr_major = np.corrcoef(rotated, major_profile)[0, 1]
            if corr_major > best_corr:
                best_corr = corr_major
                best_key = note_names[i]
                best_scale = "major"

            # Minor correlation
            corr_minor = np.corrcoef(rotated, minor_profile)[0, 1]
            if corr_minor > best_corr:
                best_corr = corr_minor
                best_key = note_names[i]
                best_scale = "minor"

        return best_key, best_scale, detected_bpm

    except Exception as e:
        print(f"Key/tempo detection failed: {e}")
        # Parse fallback key
        if fallback_key:
            parts = fallback_key.split()
            key_name = parts[0] if parts else "C"
            scale_type = parts[1] if len(parts) > 1 else "major"
        else:
            key_name = "C"
            scale_type = "major"

        return key_name, scale_type, float(fallback_bpm or 120)


def get_audio_duration(audio_path: str) -> float:
    """Get the duration of an audio file in seconds."""
    try:
        duration = librosa.get_duration(path=audio_path)
        return float(duration)
    except Exception:
        return 0.0
