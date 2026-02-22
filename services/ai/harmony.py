"""SATB harmony generation using music theory rules."""

import numpy as np
from typing import List, Dict
from pitch import hz_to_midi, midi_to_hz

# Try importing music21
try:
    from music21 import (
        key as m21_key,
        chord as m21_chord,
        note as m21_note,
        pitch as m21_pitch,
        roman,
        stream,
    )

    HAS_MUSIC21 = True
except ImportError:
    HAS_MUSIC21 = False


# Voice ranges in MIDI note numbers
VOICE_RANGES = {
    "soprano": (60, 79),  # C4 to G5
    "alto": (55, 74),  # G3 to D5
    "tenor": (48, 69),  # C3 to A4
    "bass": (40, 64),  # E2 to E4
}

# Common chord progressions for harmonization
CHORD_PROGRESSIONS = {
    "major": [
        ["I", "IV", "V", "I"],
        ["I", "vi", "IV", "V"],
        ["I", "V", "vi", "IV"],
        ["I", "IV", "ii", "V"],
    ],
    "minor": [
        ["i", "iv", "V", "i"],
        ["i", "VI", "III", "VII"],
        ["i", "iv", "v", "i"],
        ["i", "VI", "iv", "V"],
    ],
}


def generate_satb_harmonies(
    pitch_contour: List[float],
    key: str,
    scale: str,
    bpm: float,
    duration: float,
) -> List[Dict]:
    """
    Generate four-part SATB harmony from melody pitch contour.

    Args:
        pitch_contour: List of fundamental frequencies (Hz)
        key: Musical key (e.g., "C", "G", "Bb")
        scale: Scale type ("major" or "minor")
        bpm: Tempo in BPM
        duration: Total duration in seconds

    Returns:
        List of harmony parts with pitch data
    """
    # Generate timestamps
    time_step = duration / max(len(pitch_contour), 1)
    timestamps = [i * time_step for i in range(len(pitch_contour))]

    # Convert melody to MIDI
    melody_midi = [hz_to_midi(f) for f in pitch_contour]

    # Generate harmony parts
    soprano_pitches = []
    alto_pitches = []
    tenor_pitches = []
    bass_pitches = []

    if HAS_MUSIC21:
        soprano_pitches, alto_pitches, tenor_pitches, bass_pitches = (
            _generate_with_music21(melody_midi, key, scale)
        )
    else:
        soprano_pitches, alto_pitches, tenor_pitches, bass_pitches = (
            _generate_simple_harmony(melody_midi, key, scale)
        )

    # Convert back to Hz
    parts = []
    for part_name, midi_pitches in [
        ("soprano", soprano_pitches),
        ("alto", alto_pitches),
        ("tenor", tenor_pitches),
        ("bass", bass_pitches),
    ]:
        hz_pitches = [midi_to_hz(m) if m > 0 else 0.0 for m in midi_pitches]
        parts.append(
            {
                "part": part_name,
                "pitches": hz_pitches,
                "timestamps": timestamps,
            }
        )

    return parts


def _generate_with_music21(
    melody_midi: List[int], key_name: str, scale_type: str
) -> tuple:
    """Generate harmonies using music21 theory engine."""
    try:
        k = m21_key.Key(key_name, scale_type)
    except Exception:
        k = m21_key.Key("C", "major")

    soprano = []
    alto = []
    tenor = []
    bass = []

    for midi_note in melody_midi:
        if midi_note <= 0:
            soprano.append(0)
            alto.append(0)
            tenor.append(0)
            bass.append(0)
            continue

        try:
            p = m21_pitch.Pitch(midi=midi_note)
            n = m21_note.Note(p)

            # Find the scale degree
            degree = k.getScaleDegreeFromPitch(p)
            if degree is None:
                degree = 1

            # Build chord from scale degree
            rn = roman.RomanNumeral(degree, k)
            chord_pitches = rn.pitches

            # Assign voices within proper ranges
            s_note = _fit_to_range(midi_note, *VOICE_RANGES["soprano"])
            a_note = _fit_to_range(
                chord_pitches[0].midi if len(chord_pitches) > 0 else midi_note - 4,
                *VOICE_RANGES["alto"],
            )
            t_note = _fit_to_range(
                chord_pitches[1].midi if len(chord_pitches) > 1 else midi_note - 7,
                *VOICE_RANGES["tenor"],
            )
            b_note = _fit_to_range(
                chord_pitches[0].midi if len(chord_pitches) > 0 else midi_note - 12,
                *VOICE_RANGES["bass"],
            )

            soprano.append(s_note)
            alto.append(a_note)
            tenor.append(t_note)
            bass.append(b_note)
        except Exception:
            # Fallback to simple intervals
            soprano.append(_fit_to_range(midi_note, *VOICE_RANGES["soprano"]))
            alto.append(_fit_to_range(midi_note - 4, *VOICE_RANGES["alto"]))
            tenor.append(_fit_to_range(midi_note - 7, *VOICE_RANGES["tenor"]))
            bass.append(_fit_to_range(midi_note - 12, *VOICE_RANGES["bass"]))

    return soprano, alto, tenor, bass


def _generate_simple_harmony(
    melody_midi: List[int], key_name: str, scale_type: str
) -> tuple:
    """Fallback: generate harmonies using simple interval rules."""
    # Major/minor third and fifth intervals
    if scale_type == "minor":
        third_interval = 3  # Minor third
        fifth_interval = 7  # Perfect fifth
    else:
        third_interval = 4  # Major third
        fifth_interval = 7  # Perfect fifth

    soprano = []
    alto = []
    tenor = []
    bass = []

    for midi_note in melody_midi:
        if midi_note <= 0:
            soprano.append(0)
            alto.append(0)
            tenor.append(0)
            bass.append(0)
            continue

        # Soprano: melody note in soprano range
        s = _fit_to_range(midi_note, *VOICE_RANGES["soprano"])

        # Alto: third below melody
        a = _fit_to_range(midi_note - third_interval, *VOICE_RANGES["alto"])

        # Tenor: fifth below melody
        t = _fit_to_range(midi_note - fifth_interval, *VOICE_RANGES["tenor"])

        # Bass: octave below melody (root)
        b = _fit_to_range(midi_note - 12, *VOICE_RANGES["bass"])

        soprano.append(s)
        alto.append(a)
        tenor.append(t)
        bass.append(b)

    return soprano, alto, tenor, bass


def _fit_to_range(midi_note: int, low: int, high: int) -> int:
    """Fit a MIDI note into the specified range by octave transposition."""
    if midi_note <= 0:
        return 0

    while midi_note < low:
        midi_note += 12
    while midi_note > high:
        midi_note -= 12

    # Clamp to range
    return max(low, min(high, midi_note))
