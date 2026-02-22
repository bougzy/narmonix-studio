"""Audio-to-Tonic-Sol-fa transcription pipeline.

Full processing pipeline:
  1. Preprocess audio (normalize, noise gate)
  2. Pitch detection (CREPE neural net, fallback librosa pyin)
  3. Key detection (Krumhansl-Kessler chroma profiles)
  4. Tempo detection (librosa beat tracking)
  5. Beat quantization (4/4 grid)
  6. Frequency → movable Do solfa mapping (any key)
  7. SATB harmonization (functional harmony: I, IV, V, vi, ii)
  8. Confidence scoring
"""

import numpy as np
import librosa
from typing import List, Dict, Optional, Tuple
from pitch import analyze_pitch, hz_to_midi
from audio_utils import detect_key_and_tempo

# ──────────────────────────────────────────────
# Music Theory Constants
# ──────────────────────────────────────────────

SOLFA_NAMES = ["d", "r", "m", "f", "s", "l", "t"]

MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]

NOTE_TO_SEMITONE = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
    "E": 4, "Fb": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7,
    "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
}

# Chord tones as scale degree indices: 0=d 1=r 2=m 3=f 4=s 5=l 6=t
CHORD_TONES = {
    "I":  [0, 2, 4],   # d, m, s
    "ii": [1, 3, 5],   # r, f, l
    "IV": [3, 5, 0],   # f, l, d
    "V":  [4, 6, 1],   # s, t, r
    "vi": [5, 0, 2],   # l, d, m
}

CHORD_ROOTS = {"I": 0, "ii": 1, "IV": 3, "V": 4, "vi": 5}

# Soprano degree → preferred chords (first = default)
SOPRANO_CHORD_MAP = [
    ["I", "IV", "vi"],     # d (0)
    ["V", "ii"],           # r (1)
    ["I", "vi"],           # m (2)
    ["IV", "ii"],          # f (3)
    ["I", "V"],            # s (4)
    ["vi", "IV", "ii"],    # l (5)
    ["V"],                 # t (6)
]

# Voice ranges: semitones relative to root at reference octave (~MIDI 60)
VOICE_RANGES = {
    "soprano": (0, 12),     # d to d'
    "alto":    (-5, 7),     # s, to s
    "tenor":   (-12, -5),   # d(below) to s(below)
    "bass":    (-24, 0),    # d,, to d
}


# ──────────────────────────────────────────────
# Preprocessing
# ──────────────────────────────────────────────

def preprocess_audio(audio_path: str) -> Tuple[np.ndarray, int]:
    """Load, normalize, and clean audio signal."""
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)

    # Normalize amplitude
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = audio / peak * 0.95

    # Simple noise gate: suppress very low amplitude segments
    threshold = 0.01
    audio[np.abs(audio) < threshold] = 0.0

    return audio, sr


# ──────────────────────────────────────────────
# Pitch → Solfa Conversion
# ──────────────────────────────────────────────

def freq_to_solfa(
    freq: float,
    root_semitone: int,
    scale_intervals: List[int],
) -> Optional[Dict]:
    """
    Convert frequency (Hz) to solfa syllable using movable Do.

    Returns dict with syllable, octave_offset, confidence,
    or None if unvoiced/inaudible.
    """
    if freq <= 0:
        return None

    midi = hz_to_midi(freq)
    if midi <= 0:
        return None

    semitone_from_root = (midi - root_semitone) % 12

    # Find nearest scale degree
    best_idx = 0
    best_dist = 12
    for i, interval in enumerate(scale_intervals):
        dist = min(
            abs(semitone_from_root - interval),
            12 - abs(semitone_from_root - interval),
        )
        if dist < best_dist:
            best_dist = dist
            best_idx = i

    # Octave offset relative to reference (root near MIDI 60)
    ref_midi = 60 + root_semitone
    note_octave = (midi - root_semitone) // 12
    ref_octave = (ref_midi - root_semitone) // 12
    octave_offset = note_octave - ref_octave

    # Confidence decreases if note is far from nearest scale degree
    confidence = max(0.0, 1.0 - best_dist / 2.0)

    return {
        "syllable": SOLFA_NAMES[best_idx],
        "octave_offset": int(octave_offset),
        "confidence": float(confidence),
    }


# ──────────────────────────────────────────────
# Beat Quantization
# ──────────────────────────────────────────────

def quantize_pitches_to_beats(
    pitch_contour: List[float],
    timestamps: List[float],
    bpm: float,
    duration: float,
    root_semitone: int,
    scale_intervals: List[int],
    beats_per_measure: int = 4,
) -> List[Dict]:
    """
    Snap pitch contour to beat grid and map to solfa.

    Distinguishes:
      - "x" = rest (no pitch detected / silence)
      - "-" = sustain (same note held from previous beat)

    Returns list of measures with beat-level solfa notes.
    """
    beat_duration = 60.0 / bpm
    total_beats = max(1, int(duration / beat_duration))
    total_measures = max(1, (total_beats + beats_per_measure - 1) // beats_per_measure)

    measures = []
    prev_syllable = None
    prev_octave = None

    for m in range(total_measures):
        beats = []
        for b in range(beats_per_measure):
            beat_idx = m * beats_per_measure + b
            beat_start = beat_idx * beat_duration
            beat_end = beat_start + beat_duration

            # Collect voiced pitches within this beat window
            freqs_in_window = []
            for i, t in enumerate(timestamps):
                if beat_start <= t < beat_end and i < len(pitch_contour):
                    if pitch_contour[i] > 0:
                        freqs_in_window.append(pitch_contour[i])

            if not freqs_in_window:
                beats.append({
                    "syllable": "x",
                    "octave_offset": 0,
                    "confidence": 0.0,
                })
                prev_syllable = None
                continue

            # Use median frequency for robustness against outliers
            median_freq = float(np.median(freqs_in_window))
            solfa = freq_to_solfa(median_freq, root_semitone, scale_intervals)

            if solfa is None:
                beats.append({
                    "syllable": "x",
                    "octave_offset": 0,
                    "confidence": 0.0,
                })
                prev_syllable = None
                continue

            # Sustain detection: same note as previous beat
            if (
                solfa["syllable"] == prev_syllable
                and solfa["octave_offset"] == prev_octave
            ):
                beats.append({
                    "syllable": "-",
                    "octave_offset": 0,
                    "confidence": solfa["confidence"],
                })
            else:
                beats.append(solfa)
                prev_syllable = solfa["syllable"]
                prev_octave = solfa["octave_offset"]

        measures.append({
            "measure_number": m + 1,
            "beats": beats,
        })

    return measures


# ──────────────────────────────────────────────
# Helpers for Harmonization
# ──────────────────────────────────────────────

def _place_in_range(
    semitone: int,
    min_st: int,
    max_st: int,
    prefer_close_to: Optional[int] = None,
) -> int:
    """Place a pitch class into a semitone range by octave transposition."""
    pc = semitone % 12
    candidates = []
    for oct in range(-3, 3):
        actual = pc + oct * 12
        if min_st <= actual <= max_st:
            candidates.append(actual)

    if not candidates:
        center = (min_st + max_st) / 2
        best = pc
        best_dist = float("inf")
        for oct in range(-3, 3):
            actual = pc + oct * 12
            if abs(actual - center) < best_dist:
                best_dist = abs(actual - center)
                best = actual
        return best

    if prefer_close_to is not None and len(candidates) > 1:
        candidates.sort(key=lambda x: abs(x - prefer_close_to))

    return candidates[0]


def _semitone_to_solfa(semitone: int, scale_intervals: List[int]) -> Dict:
    """Convert a semitone offset from root to solfa note dict."""
    pc = semitone % 12
    if pc < 0:
        pc += 12

    best_idx = 0
    best_dist = 12
    for i, interval in enumerate(scale_intervals):
        dist = min(abs(pc - interval), 12 - abs(pc - interval))
        if dist < best_dist:
            best_dist = dist
            best_idx = i

    octave = semitone // 12

    return {
        "syllable": SOLFA_NAMES[best_idx],
        "octave_offset": octave,
        "confidence": 1.0,
    }


# ──────────────────────────────────────────────
# SATB Harmonization (Functional Harmony)
# ──────────────────────────────────────────────

def harmonize_measures(
    soprano_measures: List[Dict],
    scale_intervals: List[int],
    is_minor: bool,
) -> Dict[str, List[Dict]]:
    """
    Generate Alto, Tenor, Bass parts from soprano melody.

    Uses Catholic hymn-style functional harmony:
      - Chord selection: I, IV, V, vi, ii
      - V→I cadence at phrase boundaries (every 4 measures)
      - Bass sings chord root
      - Alto & Tenor get remaining chord tones
      - Voice leading: minimize motion between beats
      - Harmonic minor: raised 7th for V chord in minor keys
    """
    alto_measures = []
    tenor_measures = []
    bass_measures = []

    prev_alto = 4      # ~m (major 3rd above root)
    prev_tenor = -8    # mid-tenor range
    prev_bass = -12    # d, (one octave below root)

    for m_idx, measure in enumerate(soprano_measures):
        a_beats = []
        t_beats = []
        b_beats = []

        is_phrase_end = (
            (m_idx + 1) % 4 == 0 or m_idx == len(soprano_measures) - 1
        )
        beats = measure["beats"]

        for b_idx, sop_note in enumerate(beats):
            syl = sop_note["syllable"]

            # Rest or sustain: all voices follow soprano
            if syl in ("x", "-"):
                mirror = {"syllable": syl, "octave_offset": 0, "confidence": 1.0}
                a_beats.append(mirror)
                t_beats.append(mirror)
                b_beats.append(mirror)
                continue

            if syl not in SOLFA_NAMES:
                rest = {"syllable": "x", "octave_offset": 0, "confidence": 0.0}
                a_beats.append(rest)
                t_beats.append(rest)
                b_beats.append(rest)
                continue

            sop_deg = SOLFA_NAMES.index(syl)
            is_last = is_phrase_end and b_idx == len(beats) - 1
            is_penult = is_phrase_end and b_idx == len(beats) - 2

            # --- Chord selection ---
            if is_last and sop_deg in CHORD_TONES["I"]:
                chord = "I"
            elif is_penult and sop_deg in CHORD_TONES["V"]:
                chord = "V"
            else:
                chord = SOPRANO_CHORD_MAP[sop_deg][0]

            # --- Chord tones as semitones ---
            chord_semitones = [scale_intervals[d] for d in CHORD_TONES[chord]]

            # Harmonic minor: raise 7th for V chord
            if is_minor and chord == "V" and 6 in CHORD_TONES[chord]:
                idx = CHORD_TONES[chord].index(6)
                chord_semitones[idx] = 11

            # --- Bass: chord root ---
            bass_root_st = scale_intervals[CHORD_ROOTS[chord]]
            bass_st = _place_in_range(
                bass_root_st, *VOICE_RANGES["bass"], prev_bass
            )

            # --- Alto & Tenor: remaining chord tones ---
            sop_pc = scale_intervals[sop_deg] % 12
            remaining = [s for s in chord_semitones if s % 12 != sop_pc]

            if len(remaining) >= 2:
                best_a, best_t = remaining[0], remaining[1]
                best_cost = float("inf")
                for i in range(len(remaining)):
                    for j in range(len(remaining)):
                        if i == j:
                            continue
                        a = _place_in_range(
                            remaining[i], *VOICE_RANGES["alto"], prev_alto
                        )
                        t = _place_in_range(
                            remaining[j], *VOICE_RANGES["tenor"], prev_tenor
                        )
                        cost = abs(a - prev_alto) + abs(t - prev_tenor)
                        if cost < best_cost:
                            best_cost = cost
                            best_a, best_t = a, t
                alto_st = best_a
                tenor_st = best_t
            elif len(remaining) == 1:
                alto_st = _place_in_range(
                    remaining[0], *VOICE_RANGES["alto"], prev_alto
                )
                tenor_st = _place_in_range(
                    remaining[0], *VOICE_RANGES["tenor"], prev_tenor
                )
            else:
                alto_st = _place_in_range(
                    chord_semitones[1], *VOICE_RANGES["alto"], prev_alto
                )
                tenor_st = _place_in_range(
                    chord_semitones[2], *VOICE_RANGES["tenor"], prev_tenor
                )

            a_beats.append(_semitone_to_solfa(alto_st, scale_intervals))
            t_beats.append(_semitone_to_solfa(tenor_st, scale_intervals))
            b_beats.append(_semitone_to_solfa(bass_st, scale_intervals))

            prev_alto = alto_st
            prev_tenor = tenor_st
            prev_bass = bass_st

        alto_measures.append({"measure_number": measure["measure_number"], "beats": a_beats})
        tenor_measures.append({"measure_number": measure["measure_number"], "beats": t_beats})
        bass_measures.append({"measure_number": measure["measure_number"], "beats": b_beats})

    return {
        "alto": alto_measures,
        "tenor": tenor_measures,
        "bass": bass_measures,
    }


# ──────────────────────────────────────────────
# Text Rendering
# ──────────────────────────────────────────────

def _render_note(note: Dict) -> str:
    """Render a single solfa note to text."""
    syl = note["syllable"]
    if syl in ("-", "x"):
        return syl
    offset = note.get("octave_offset", 0)
    if offset > 0:
        return syl + "'" * offset
    if offset < 0:
        return syl + "," * abs(offset)
    return syl


def format_notation(
    parts: Dict[str, List[Dict]],
    project_name: str,
    key_name: str,
    scale_type: str,
    bpm: float,
    beats_per_measure: int = 4,
) -> str:
    """
    Format SATB notation as plain text in Catholic church
    choir rehearsal format:

      S: d  r  m  f | s  -  s  l | ...
      A: m  f  s  l | l  -  l  s | ...
      T: s, l, t, d | d  -  d  l,| ...
      B: d, -  d, - | s,,- d, -  | ...
    """
    lines = []
    divider = "=" * 56
    mode = "Minor" if scale_type == "minor" else "Major"

    lines.append(divider)
    lines.append(f"  {project_name}")
    lines.append(f"  Tonic Sol-fa Notation")
    lines.append(
        f"  Key: {key_name} {mode} (Do = {key_name})  |  "
        f"Time: 4/4  |  BPM: {int(bpm)}"
    )
    lines.append(divider)
    lines.append("")

    part_order = ["soprano", "alto", "tenor", "bass"]
    labels = {"soprano": "S", "alto": "A", "tenor": "T", "bass": "B"}

    max_measures = max(
        (len(m) for m in parts.values()), default=0
    )
    measures_per_line = 4
    total_lines = max(
        1, (max_measures + measures_per_line - 1) // measures_per_line
    )

    for line_idx in range(total_lines):
        start_m = line_idx * measures_per_line
        end_m = min(start_m + measures_per_line, max_measures)

        for part_name in part_order:
            if part_name not in parts:
                continue

            label = labels.get(part_name, "?")
            measure_texts = []

            for m in range(start_m, end_m):
                if m < len(parts[part_name]):
                    measure = parts[part_name][m]
                    beat_texts = []
                    for beat in measure["beats"][:beats_per_measure]:
                        text = _render_note(beat)
                        beat_texts.append(text.ljust(2))
                    measure_texts.append(" ".join(beat_texts))
                else:
                    rest_beats = ["x " for _ in range(beats_per_measure)]
                    measure_texts.append(" ".join(rest_beats))

            row = f"{label}: {'| '.join(measure_texts)}|"
            lines.append(row)

        lines.append("")

    lines.append("---")
    lines.append("Legend:")
    lines.append("  d r m f s l t = Do Re Mi Fa Sol La Ti")
    lines.append("  '  = upper octave (d' = Do above)")
    lines.append("  ,  = lower octave (d, = Do below)")
    lines.append("  -  = sustained note (hold previous)")
    lines.append("  x  = rest (silence)")
    lines.append("  |  = measure bar line")
    lines.append("")

    return "\n".join(lines)


# ──────────────────────────────────────────────
# Polyphony Detection
# ──────────────────────────────────────────────

def detect_polyphony(audio_path: str) -> bool:
    """
    Attempt to detect if the audio is polyphonic (multiple voices)
    using spectral analysis.
    """
    try:
        audio, sr = librosa.load(audio_path, sr=22050, mono=True)

        # Use harmonic-percussive separation
        harmonic, _ = librosa.effects.hpss(audio)

        # Compute chroma features
        chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sr)

        # Count simultaneous active pitch classes per frame
        threshold = 0.3 * np.max(chroma, axis=0, keepdims=True)
        active_per_frame = np.sum(chroma > threshold, axis=0)

        # If average active pitches > 2, likely polyphonic
        avg_active = np.mean(active_per_frame)
        return float(avg_active) > 2.5
    except Exception:
        return False


# ──────────────────────────────────────────────
# Main Transcription Pipeline
# ──────────────────────────────────────────────

def transcribe_audio(
    audio_path: str,
    project_name: str = "Transcribed Hymn",
    project_key: Optional[str] = None,
    project_bpm: Optional[int] = None,
) -> Dict:
    """
    Full transcription pipeline: audio → tonic sol-fa notation.

    Steps:
      A. Preprocess audio (normalize, noise gate)
      B. CREPE pitch detection (or librosa pyin fallback)
      C. Key detection (Krumhansl-Kessler chroma profiles)
      D. Tempo/BPM detection (beat tracking)
      E. Quantize to 4/4 beat grid
      F. Map frequencies to movable Do sol-fa
      G. SATB harmonization (if monophonic)
      H. Confidence scoring

    Returns:
        Dict with:
          - notation_text: formatted SATB text
          - parts: structured measure/beat data per voice
          - key, scale, bpm, duration, confidence, total_measures
    """
    # --- Step A: Preprocess ---
    audio, sr = preprocess_audio(audio_path)
    duration = float(len(audio) / sr)

    # --- Step B: Pitch detection (CREPE / pyin) ---
    pitch_contour, timestamps, _ = analyze_pitch(audio_path)

    # --- Step C: Key detection ---
    detected_key, detected_scale, detected_bpm = detect_key_and_tempo(
        audio_path,
        fallback_key=project_key,
        fallback_bpm=project_bpm,
    )

    # Apply explicit overrides if the user set them
    if project_key:
        parts = project_key.split()
        detected_key = parts[0]
        if len(parts) > 1:
            detected_scale = parts[1].lower()

    if project_bpm and project_bpm > 0:
        detected_bpm = float(project_bpm)

    # --- Resolve theory parameters ---
    root_semitone = NOTE_TO_SEMITONE.get(detected_key, 0)
    is_minor = detected_scale == "minor"
    scale_intervals = MINOR_INTERVALS if is_minor else MAJOR_INTERVALS

    # --- Step D/E: Quantize to beats ---
    soprano_measures = quantize_pitches_to_beats(
        pitch_contour,
        timestamps,
        detected_bpm,
        duration,
        root_semitone,
        scale_intervals,
    )

    # --- Confidence scoring ---
    total_conf = 0.0
    note_count = 0
    rest_count = 0
    for m in soprano_measures:
        for beat in m["beats"]:
            if beat["syllable"] == "x":
                rest_count += 1
            elif beat["syllable"] != "-":
                total_conf += beat.get("confidence", 0.0)
                note_count += 1

    avg_confidence = total_conf / max(note_count, 1)
    total_beats = sum(len(m["beats"]) for m in soprano_measures)

    # If mostly rests, confidence is low
    if total_beats > 0 and rest_count / total_beats > 0.6:
        avg_confidence *= 0.5

    # --- Step F: Check for polyphony ---
    is_polyphonic = detect_polyphony(audio_path)

    # --- Step G: SATB harmonization ---
    if is_polyphonic:
        # For polyphonic input, the detected melody IS soprano.
        # In a full system, voice separation would give us individual parts.
        # For now, we harmonize the detected melody line.
        pass

    harmony = harmonize_measures(soprano_measures, scale_intervals, is_minor)

    all_parts = {
        "soprano": soprano_measures,
        "alto": harmony["alto"],
        "tenor": harmony["tenor"],
        "bass": harmony["bass"],
    }

    # --- Step H: Format output ---
    notation_text = format_notation(
        all_parts,
        project_name,
        detected_key,
        detected_scale,
        detected_bpm,
    )

    return {
        "notation_text": notation_text,
        "parts": all_parts,
        "key": detected_key,
        "scale": detected_scale,
        "bpm": float(detected_bpm),
        "duration": duration,
        "confidence": float(avg_confidence),
        "total_measures": len(soprano_measures),
        "is_polyphonic": is_polyphonic,
    }
