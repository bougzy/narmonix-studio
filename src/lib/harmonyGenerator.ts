"use client";

import { encodeWAV } from "./wavEncoder";
import { detectKey } from "./keyDetector";
import { detectPitch } from "./pitchDetector";

export interface HarmonyPartConfig {
  name: string;
  part: "soprano" | "alto" | "tenor" | "bass";
  semitones: number; // kept for interface compat, not used in new approach
  volume: number;
}

/* ══════════════════════════════════════════════
   Music Theory Constants (SATB Harmonization)
   ══════════════════════════════════════════════ */

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]; // W W H W W W H
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // W H W W H W W

/** Chord tones as scale degree indices [root, third, fifth] */
const CHORD_TONES: Record<string, [number, number, number]> = {
  I:  [0, 2, 4],  // d, m, s
  ii: [1, 3, 5],  // r, f, l
  iii:[2, 4, 6],  // m, s, t
  IV: [3, 5, 0],  // f, l, d
  V:  [4, 6, 1],  // s, t, r
  vi: [5, 0, 2],  // l, d, m
};

/** Root scale degree index for each chord (for bass voice) */
const CHORD_ROOT: Record<string, number> = {
  I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5,
};

/**
 * For each soprano scale degree (0-6), preferred chords containing it.
 * Ordered by preference (first = default).
 */
const SOPRANO_TO_CHORDS: string[][] = [
  /* d=0 */ ["I", "IV", "vi"],
  /* r=1 */ ["V", "ii"],
  /* m=2 */ ["I", "vi", "iii"],
  /* f=3 */ ["IV", "ii"],
  /* s=4 */ ["I", "V"],
  /* l=5 */ ["vi", "IV", "ii"],
  /* t=6 */ ["V", "iii"],
];

/* ══════════════════════════════════════════════
   Helper: Frequency / MIDI / Scale conversions
   ══════════════════════════════════════════════ */

function freqToMidi(freq: number): number {
  if (freq <= 0) return -1;
  return 69 + 12 * Math.log2(freq / 440);
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Snap a MIDI note to the nearest scale tone */
function snapToScale(midi: number, rootMidi: number, scale: number[]): number {
  const pc = ((Math.round(midi) - rootMidi) % 12 + 12) % 12;
  let bestDist = 12;
  let bestScaleTone = 0;
  for (const s of scale) {
    const dist = Math.min(Math.abs(pc - s), 12 - Math.abs(pc - s));
    if (dist < bestDist) {
      bestDist = dist;
      bestScaleTone = s;
    }
  }
  const octave = Math.floor((Math.round(midi) - rootMidi) / 12);
  return rootMidi + octave * 12 + bestScaleTone;
}

/** Get the scale degree index (0-6) of a MIDI note */
function getScaleDegree(midi: number, rootMidi: number, scale: number[]): number {
  const pc = ((Math.round(midi) - rootMidi) % 12 + 12) % 12;
  let bestIdx = 0;
  let bestDist = 12;
  for (let i = 0; i < scale.length; i++) {
    const dist = Math.min(Math.abs(pc - scale[i]), 12 - Math.abs(pc - scale[i]));
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Place a scale degree at a specific octave range, preferring close voice leading.
 */
function placeNote(
  scaleDegree: number,
  scale: number[],
  rootMidi: number,
  minMidi: number,
  maxMidi: number,
  preferCloseTo?: number
): number {
  const semitone = scale[scaleDegree];
  const candidates: number[] = [];

  for (let oct = -2; oct <= 6; oct++) {
    const note = rootMidi + oct * 12 + semitone;
    if (note >= minMidi && note <= maxMidi) {
      candidates.push(note);
    }
  }

  if (candidates.length === 0) {
    // Closest to range
    let best = rootMidi + semitone;
    for (let oct = -2; oct <= 6; oct++) {
      const note = rootMidi + oct * 12 + semitone;
      if (Math.abs(note - (minMidi + maxMidi) / 2) < Math.abs(best - (minMidi + maxMidi) / 2)) {
        best = note;
      }
    }
    return best;
  }

  if (preferCloseTo !== undefined && candidates.length > 1) {
    candidates.sort((a, b) => Math.abs(a - preferCloseTo) - Math.abs(b - preferCloseTo));
  }

  return candidates[0];
}

/* ══════════════════════════════════════════════
   Melody Note Extraction
   ══════════════════════════════════════════════ */

interface MelodyNote {
  startTime: number;  // seconds
  endTime: number;    // seconds
  midi: number;       // MIDI note number
  frequency: number;  // Hz
}

/**
 * Extract a clean sequence of melody notes from pitch frames.
 * Groups consecutive similar pitches into sustained notes,
 * applies smoothing, and removes brief noise spikes.
 */
function extractMelody(
  pitchFrames: Array<{ time: number; frequency: number; confidence: number }>,
  sampleRate: number
): MelodyNote[] {
  if (pitchFrames.length === 0) return [];

  // Step 1: Convert to MIDI notes, filter silence
  const midiFrames: Array<{ time: number; midi: number; conf: number }> = [];
  for (const f of pitchFrames) {
    if (f.frequency > 0 && f.confidence > 0.1) {
      midiFrames.push({ time: f.time, midi: freqToMidi(f.frequency), conf: f.confidence });
    } else {
      midiFrames.push({ time: f.time, midi: -1, conf: 0 });
    }
  }

  // Step 2: Median smoothing (3-frame window) to reduce jitter
  for (let i = 1; i < midiFrames.length - 1; i++) {
    if (midiFrames[i].midi > 0 && midiFrames[i - 1].midi > 0 && midiFrames[i + 1].midi > 0) {
      const vals = [midiFrames[i - 1].midi, midiFrames[i].midi, midiFrames[i + 1].midi].sort((a, b) => a - b);
      midiFrames[i].midi = vals[1];
    }
  }

  // Step 3: Group consecutive frames with similar pitch into notes
  // A new note starts when the pitch changes by more than 1 semitone
  const notes: MelodyNote[] = [];
  let noteStart = -1;
  let noteMidiSum = 0;
  let noteCount = 0;

  for (let i = 0; i < midiFrames.length; i++) {
    const frame = midiFrames[i];

    if (frame.midi <= 0) {
      // Silence - close current note
      if (noteCount > 0) {
        const avgMidi = Math.round(noteMidiSum / noteCount);
        notes.push({
          startTime: midiFrames[noteStart].time,
          endTime: frame.time,
          midi: avgMidi,
          frequency: midiToFreq(avgMidi),
        });
      }
      noteStart = -1;
      noteMidiSum = 0;
      noteCount = 0;
      continue;
    }

    if (noteCount === 0) {
      // Start new note
      noteStart = i;
      noteMidiSum = frame.midi;
      noteCount = 1;
    } else {
      const currentAvg = noteMidiSum / noteCount;
      if (Math.abs(frame.midi - currentAvg) > 1.5) {
        // Pitch changed significantly - close current note, start new one
        const avgMidi = Math.round(noteMidiSum / noteCount);
        notes.push({
          startTime: midiFrames[noteStart].time,
          endTime: frame.time,
          midi: avgMidi,
          frequency: midiToFreq(avgMidi),
        });
        noteStart = i;
        noteMidiSum = frame.midi;
        noteCount = 1;
      } else {
        noteMidiSum += frame.midi;
        noteCount++;
      }
    }
  }

  // Close final note
  if (noteCount > 0) {
    const avgMidi = Math.round(noteMidiSum / noteCount);
    const lastFrame = midiFrames[midiFrames.length - 1];
    notes.push({
      startTime: midiFrames[noteStart].time,
      endTime: lastFrame.time + 0.01,
      midi: avgMidi,
      frequency: midiToFreq(avgMidi),
    });
  }

  // Step 4: Filter out very short notes (< 80ms) as noise
  return notes.filter((n) => n.endTime - n.startTime >= 0.08);
}

/* ══════════════════════════════════════════════
   SATB Chord Assignment & Voice Leading
   ══════════════════════════════════════════════ */

interface HarmonyFrame {
  startTime: number;
  endTime: number;
  sopranoMidi: number;
  altoMidi: number;
  tenorMidi: number;
  bassMidi: number;
}

/**
 * SATB voice ranges (MIDI note numbers):
 *   Soprano: C4(60) to C6(84)
 *   Alto:    F3(53) to F5(77)
 *   Tenor:   C3(48) to C5(72)
 *   Bass:    E2(40) to E4(64)
 */
const VOICE_RANGES = {
  soprano: { min: 60, max: 84 },
  alto:    { min: 53, max: 77 },
  tenor:   { min: 48, max: 72 },
  bass:    { min: 40, max: 64 },
};

/**
 * Generate harmonically correct SATB frames from melody notes.
 *
 * For each melody note:
 * 1. Determine its scale degree
 * 2. Select the best chord (I, IV, V, vi, ii)
 * 3. Assign alto, tenor, bass from chord tones with voice leading
 * 4. Apply V→I cadence at phrase endings
 */
function harmonizeMelody(
  melody: MelodyNote[],
  rootMidi: number,
  scale: number[],
  isMinor: boolean
): HarmonyFrame[] {
  if (melody.length === 0) return [];

  const frames: HarmonyFrame[] = [];

  // Initialize voice positions near middle of their ranges
  let prevAlto = 64;  // E4
  let prevTenor = 57; // A3
  let prevBass = 48;  // C3

  // Detect phrases (notes separated by > 0.5s gaps)
  const phraseEnds = new Set<number>();
  for (let i = 0; i < melody.length - 1; i++) {
    if (melody[i + 1].startTime - melody[i].endTime > 0.5) {
      phraseEnds.add(i);
    }
  }
  phraseEnds.add(melody.length - 1); // last note is always a phrase end

  for (let i = 0; i < melody.length; i++) {
    const note = melody[i];
    const sopMidi = note.midi;
    const sopDegree = getScaleDegree(sopMidi, rootMidi, scale);

    const isLastInPhrase = phraseEnds.has(i);
    const isPenultimate = phraseEnds.has(i + 1);

    // Chord selection
    let chordName: string;
    if (isLastInPhrase) {
      // End on I chord (tonic) for resolution
      const iDegrees = CHORD_TONES["I"];
      chordName = iDegrees.includes(sopDegree) ? "I" : SOPRANO_TO_CHORDS[sopDegree][0];
    } else if (isPenultimate) {
      // Penultimate: try V chord for dominant-tonic cadence
      const vDegrees = CHORD_TONES["V"];
      chordName = vDegrees.includes(sopDegree) ? "V" : SOPRANO_TO_CHORDS[sopDegree][0];
    } else {
      chordName = SOPRANO_TO_CHORDS[sopDegree][0];
    }

    // Get chord tones as scale degrees
    const chordDegrees = CHORD_TONES[chordName];

    // In minor keys, raise 7th for V chord (harmonic minor leading tone)
    const localScale = [...scale];
    if (isMinor && chordName === "V") {
      localScale[6] = 11; // ti instead of te
    }

    // Bass gets chord root
    const bassNote = placeNote(
      CHORD_ROOT[chordName], localScale, rootMidi,
      VOICE_RANGES.bass.min, VOICE_RANGES.bass.max, prevBass
    );

    // Get remaining chord tones (excluding soprano's pitch class)
    const sopPC = ((Math.round(sopMidi) - rootMidi) % 12 + 12) % 12;
    const remaining = chordDegrees.filter((d) => {
      const pc = localScale[d];
      return pc !== sopPC;
    });

    // Alto and tenor get the remaining chord tones
    let altoNote: number;
    let tenorNote: number;

    if (remaining.length >= 2) {
      // Try all permutations and pick the one with smoothest voice leading
      let bestCost = Infinity;
      altoNote = prevAlto;
      tenorNote = prevTenor;

      for (let ri = 0; ri < remaining.length; ri++) {
        for (let rj = 0; rj < remaining.length; rj++) {
          if (ri === rj) continue;
          const a = placeNote(
            remaining[ri], localScale, rootMidi,
            VOICE_RANGES.alto.min, VOICE_RANGES.alto.max, prevAlto
          );
          const t = placeNote(
            remaining[rj], localScale, rootMidi,
            VOICE_RANGES.tenor.min, VOICE_RANGES.tenor.max, prevTenor
          );
          // Voice leading cost: prefer minimal motion
          const cost = Math.abs(a - prevAlto) + Math.abs(t - prevTenor);
          // Penalty for crossing voices (alto below tenor)
          const crossingPenalty = a < t ? 20 : 0;
          if (cost + crossingPenalty < bestCost) {
            bestCost = cost + crossingPenalty;
            altoNote = a;
            tenorNote = t;
          }
        }
      }
    } else if (remaining.length === 1) {
      altoNote = placeNote(
        remaining[0], localScale, rootMidi,
        VOICE_RANGES.alto.min, VOICE_RANGES.alto.max, prevAlto
      );
      // Double the root for tenor
      tenorNote = placeNote(
        CHORD_ROOT[chordName], localScale, rootMidi,
        VOICE_RANGES.tenor.min, VOICE_RANGES.tenor.max, prevTenor
      );
    } else {
      // All chord tones are the soprano's pitch class — use root and fifth
      altoNote = placeNote(
        chordDegrees[1], localScale, rootMidi,
        VOICE_RANGES.alto.min, VOICE_RANGES.alto.max, prevAlto
      );
      tenorNote = placeNote(
        chordDegrees[2], localScale, rootMidi,
        VOICE_RANGES.tenor.min, VOICE_RANGES.tenor.max, prevTenor
      );
    }

    frames.push({
      startTime: note.startTime,
      endTime: note.endTime,
      sopranoMidi: sopMidi,
      altoMidi: altoNote,
      tenorMidi: tenorNote,
      bassMidi: bassNote,
    });

    prevAlto = altoNote;
    prevTenor = tenorNote;
    prevBass = bassNote;
  }

  return frames;
}

/* ══════════════════════════════════════════════
   Audio Synthesis — Warm Choir-like Tone

   Generates clear, warm tones suitable for
   learning vocal parts. Uses additive synthesis
   with natural harmonics, gentle vibrato, and
   ADSR envelopes for a human-like sound.
   ══════════════════════════════════════════════ */

/**
 * Voice-specific synthesis profiles.
 *
 * Each voice has distinct timbral characteristics:
 * - Different formant centers (the resonances that give voices their character)
 * - Different harmonic emphasis (bass has stronger low harmonics, alto has warmer mid)
 * - Different vibrato settings (bass is slower/wider, alto is faster/subtler)
 */
const VOICE_PROFILES = {
  alto: {
    // Warm, round mezzo tone
    harmonics: [
      { ratio: 1, amp: 1.0 },
      { ratio: 2, amp: 0.45 },
      { ratio: 3, amp: 0.30 },
      { ratio: 4, amp: 0.12 },
      { ratio: 5, amp: 0.08 },
    ],
    formants: [
      { center: 700, width: 150, gain: 0.5 },  // F1 (open vowel)
      { center: 1400, width: 200, gain: 0.3 },  // F2
    ],
    vibrato: { rate: 5.2, depth: 0.003, delay: 0.2 },
    attack: 0.035,
    release: 0.055,
    volume: 0.18,
  },
  tenor: {
    // Bright, clear tone — slightly more nasal character
    harmonics: [
      { ratio: 1, amp: 1.0 },
      { ratio: 2, amp: 0.55 },
      { ratio: 3, amp: 0.40 },
      { ratio: 4, amp: 0.20 },
      { ratio: 5, amp: 0.12 },
      { ratio: 6, amp: 0.06 },
    ],
    formants: [
      { center: 500, width: 150, gain: 0.5 },
      { center: 1500, width: 250, gain: 0.3 },
    ],
    vibrato: { rate: 5.0, depth: 0.004, delay: 0.18 },
    attack: 0.03,
    release: 0.05,
    volume: 0.16,
  },
  bass: {
    // Deep, rich, full tone with strong fundamental
    harmonics: [
      { ratio: 1, amp: 1.0 },
      { ratio: 2, amp: 0.6 },
      { ratio: 3, amp: 0.25 },
      { ratio: 4, amp: 0.10 },
      { ratio: 5, amp: 0.05 },
    ],
    formants: [
      { center: 350, width: 120, gain: 0.6 },
      { center: 1000, width: 200, gain: 0.2 },
    ],
    vibrato: { rate: 4.5, depth: 0.005, delay: 0.25 },
    attack: 0.045,
    release: 0.07,
    volume: 0.20,
  },
};

/**
 * Synthesize a single harmony part as an AudioBuffer.
 *
 * Uses additive synthesis (fundamental + harmonics) with:
 * - Per-voice timbral profiles (different for alto, tenor, bass)
 * - Formant shaping for vocal quality
 * - Gentle vibrato with delayed onset for natural feel
 * - Smooth ADSR envelopes
 * - Phase-continuous synthesis to avoid clicks
 */
function synthesizePart(
  frames: HarmonyFrame[],
  partKey: "alto" | "tenor" | "bass",
  totalDuration: number,
  sampleRate: number
): AudioBuffer {
  const length = Math.ceil(totalDuration * sampleRate);
  const buffer = new AudioBuffer({
    numberOfChannels: 1,
    length,
    sampleRate,
  });
  const output = buffer.getChannelData(0);

  const profile = VOICE_PROFILES[partKey];
  const attackSamplesMax = Math.floor(profile.attack * sampleRate);
  const releaseSamplesMax = Math.floor(profile.release * sampleRate);

  // Phase accumulator for continuous phase (no clicks between notes)
  let phase = 0;

  for (const frame of frames) {
    const freq = midiToFreq(frame[`${partKey}Midi`]);
    const startSample = Math.floor(frame.startTime * sampleRate);
    const endSample = Math.min(Math.floor(frame.endTime * sampleRate), length);
    const samplesInNote = endSample - startSample;
    if (samplesInNote <= 0) continue;

    const attackSamples = Math.min(attackSamplesMax, Math.floor(samplesInNote * 0.3));
    const releaseSamples = Math.min(releaseSamplesMax, Math.floor(samplesInNote * 0.3));

    for (let s = startSample; s < endSample; s++) {
      const t = (s - startSample) / sampleRate;
      const sampleInNote = s - startSample;

      // ADSR envelope (smooth cosine curves)
      let envelope = 1.0;
      if (sampleInNote < attackSamples) {
        envelope = 0.5 * (1 - Math.cos(Math.PI * sampleInNote / attackSamples));
      } else if (sampleInNote > samplesInNote - releaseSamples) {
        const releasePos = sampleInNote - (samplesInNote - releaseSamples);
        envelope = 0.5 * (1 + Math.cos(Math.PI * releasePos / releaseSamples));
      }

      // Vibrato with delayed onset (natural: singers don't vibrate immediately)
      const vibratoOnset = Math.min(1, Math.max(0, (t - profile.vibrato.delay) * 3));
      const vibrato = 1 + profile.vibrato.depth * vibratoOnset *
        Math.sin(2 * Math.PI * profile.vibrato.rate * t);
      const currentFreq = freq * vibrato;

      // Advance phase accumulator (continuous across notes)
      phase += (2 * Math.PI * currentFreq) / sampleRate;
      // Keep phase in [0, 2π) to avoid floating point drift
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

      // Additive synthesis with formant shaping
      let sample = 0;
      for (const h of profile.harmonics) {
        const hFreq = currentFreq * h.ratio;

        // Formant resonance — gaussian boost near formant centers
        let formantBoost = 1.0;
        for (const f of profile.formants) {
          formantBoost += f.gain * Math.exp(
            -0.5 * Math.pow((hFreq - f.center) / f.width, 2)
          );
        }

        sample += h.amp * formantBoost * Math.sin(phase * h.ratio);
      }

      output[s] += sample * envelope * profile.volume;
    }
  }

  // Two-pass gentle smoothing for a more natural sound
  // (removes synthesis artifacts without losing clarity)
  const smoothed = new Float32Array(length);
  for (let i = 2; i < length - 2; i++) {
    smoothed[i] =
      output[i] * 0.5 +
      (output[i - 1] + output[i + 1]) * 0.2 +
      (output[i - 2] + output[i + 2]) * 0.05;
  }
  smoothed[0] = output[0];
  smoothed[1] = output[1];
  smoothed[length - 1] = output[length - 1];
  smoothed[length - 2] = output[length - 2];

  // Copy back
  for (let i = 0; i < length; i++) {
    output[i] = smoothed[i];
  }

  return buffer;
}

/* ══════════════════════════════════════════════
   Fetch & Decode Audio
   ══════════════════════════════════════════════ */

async function fetchAndDecode(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to fetch audio: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }
}

/* ══════════════════════════════════════════════
   Main Entry Point
   ══════════════════════════════════════════════ */

/**
 * Generate SATB harmony parts from a vocal source track.
 *
 * NEW APPROACH (replaces old pitch-shifting):
 * 1. Detect melody notes from source audio using YIN pitch detection
 * 2. Detect or use the musical key
 * 3. Apply music theory (functional harmony) to determine correct
 *    alto, tenor, bass notes for each melody note
 * 4. Synthesize each part with a warm, choir-like tone
 *
 * Each generated part plays the CORRECT harmony notes that a real
 * singer would sing — not a pitch-shifted copy of the melody.
 * This makes the tool genuinely useful for learning SATB parts.
 */
export async function generateHarmonies(
  sourceAudioUrl: string,
  projectKey: string,
  onProgress?: (step: number, message: string) => void
): Promise<
  Array<{ part: HarmonyPartConfig; blob: Blob; detectedKey?: string }>
> {
  // Step 0: Load source audio
  onProgress?.(0, "Loading source audio...");

  let sourceBuffer: AudioBuffer;
  try {
    sourceBuffer = await fetchAndDecode(sourceAudioUrl);
  } catch (err) {
    throw new Error(
      `Failed to load source audio: ${err instanceof Error ? err.message : "Network error"}`
    );
  }

  console.log(
    `Source audio loaded: ${sourceBuffer.duration.toFixed(1)}s, ` +
      `${sourceBuffer.sampleRate}Hz, ${sourceBuffer.numberOfChannels}ch`
  );

  if (sourceBuffer.duration < 0.5) {
    throw new Error(
      "Audio too short for harmony generation. Please use a recording of at least 1 second."
    );
  }

  // Step 1: Analyze pitch and extract melody notes
  onProgress?.(1, "Analyzing pitch and melody...");

  const pitchFrames = await detectPitch(sourceBuffer);
  const melody = extractMelody(pitchFrames, sourceBuffer.sampleRate);

  console.log(`Extracted ${melody.length} melody notes from ${pitchFrames.length} pitch frames`);

  if (melody.length < 2) {
    throw new Error(
      "Could not detect enough melody notes. Please ensure the recording has clear vocal content."
    );
  }

  // Step 2: Key detection
  let effectiveKey = projectKey;
  const needsDetection =
    !projectKey ||
    projectKey === "Auto-detect" ||
    projectKey === "C major";

  onProgress?.(
    2,
    needsDetection
      ? "Detecting key from audio..."
      : "Analyzing key and scale..."
  );

  if (needsDetection) {
    try {
      const keyResult = await detectKey(sourceBuffer);
      effectiveKey = keyResult.label;
      console.log(
        `Auto-detected key: ${keyResult.label} ` +
          `(${Math.round(keyResult.confidence * 100)}% confidence)`
      );
    } catch (e) {
      console.warn("Key detection failed, falling back to C major:", e);
      effectiveKey = "C major";
    }
  }

  // Parse key
  const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const keyParts = effectiveKey.trim().split(/\s+/);
  const rootIdx = NOTE_NAMES.indexOf(keyParts[0]);
  const rootMidi = (rootIdx >= 0 ? rootIdx : 0); // pitch class 0-11
  const isMinor = effectiveKey.toLowerCase().includes("minor");
  const scale = isMinor ? MINOR_SCALE : MAJOR_SCALE;

  console.log(
    `Generating SATB harmonies in ${effectiveKey} (${isMinor ? "minor" : "major"} mode)`
  );

  // Snap melody notes to scale
  const snappedMelody = melody.map((n) => ({
    ...n,
    midi: snapToScale(n.midi, rootMidi, scale),
    frequency: midiToFreq(snapToScale(n.midi, rootMidi, scale)),
  }));

  // Step 3: Harmonize — determine correct SATB notes
  onProgress?.(3, "Computing SATB harmony (music theory)...");

  const harmonyFrames = harmonizeMelody(snappedMelody, rootMidi, scale, isMinor);

  console.log(`Generated ${harmonyFrames.length} harmony frames`);

  // Log a sample of the harmony for debugging
  if (harmonyFrames.length > 0) {
    const sample = harmonyFrames[0];
    console.log(
      `First chord: S=${sample.sopranoMidi} A=${sample.altoMidi} ` +
      `T=${sample.tenorMidi} B=${sample.bassMidi}`
    );
  }

  // Step 4-5: Synthesize each part
  // Use 22050Hz for synthesis — the synthesized tones only contain content
  // up to ~3.5kHz (highest harmonic of alto at F5 with 5x ratio), so 22050Hz
  // (Nyquist = 11025Hz) gives plenty of headroom while keeping file sizes
  // well within the 15MB MongoDB document storage limit.
  const sampleRate = 22050;
  const totalDuration = sourceBuffer.duration;

  const parts: Array<{ key: "alto" | "tenor" | "bass"; name: string; volume: number }> = [
    { key: "alto", name: "Alto Harmony", volume: 0.75 },
    { key: "tenor", name: "Tenor Harmony", volume: 0.70 },
    { key: "bass", name: "Bass Harmony", volume: 0.65 },
  ];

  const results: Array<{
    part: HarmonyPartConfig;
    blob: Blob;
    detectedKey?: string;
  }> = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    onProgress?.(3 + i, `Synthesizing ${p.name}...`);

    try {
      const synthBuffer = await Promise.race([
        (async () => {
          const buf = synthesizePart(harmonyFrames, p.key, totalDuration, sampleRate);
          // Yield to keep UI responsive
          await new Promise((r) => setTimeout(r, 0));
          return buf;
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout generating ${p.name}`)),
            90000
          )
        ),
      ]);

      // Apply volume scaling to the buffer
      const data = synthBuffer.getChannelData(0);
      for (let s = 0; s < data.length; s++) {
        data[s] *= p.volume;
      }

      const wavBlob = encodeWAV(synthBuffer, true);

      if (wavBlob.size === 0) {
        throw new Error("Generated audio is empty");
      }

      const partConfig: HarmonyPartConfig = {
        name: p.name,
        part: p.key,
        semitones: 0, // not used in new approach
        volume: p.volume,
      };

      results.push({
        part: partConfig,
        blob: wavBlob,
        detectedKey: needsDetection ? effectiveKey : undefined,
      });

      console.log(
        `Synthesized ${p.name}: ${(wavBlob.size / 1024).toFixed(0)}KB`
      );
    } catch (err) {
      console.error(`Failed to generate ${p.name}:`, err);
      throw new Error(
        `Failed to generate ${p.name}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  // Step 6: Done
  onProgress?.(6, "Done!");

  console.log(
    `Harmony generation complete: ${results.length} parts generated ` +
      `(${(results.reduce((sum, r) => sum + r.blob.size, 0) / 1024).toFixed(0)}KB total)`
  );

  return results;
}
