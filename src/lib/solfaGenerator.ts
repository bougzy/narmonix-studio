"use client";

import {
  PitchFrame,
  SolfaSyllable,
  SolfaNote,
  SolfaMeasure,
  SolfaPart,
  SolfaSheet,
} from "@/types";
import { detectPitch } from "./pitchDetector";
import { detectKey, detectBPM, type KeyDetectionResult } from "./keyDetector";

/* ══════════════════════════════════════════════
   Music Theory Constants
   ══════════════════════════════════════════════ */

const NOTE_NAMES = [
  "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
];

/** Semitone offsets for each scale degree in major key */
const MAJOR_SCALE_DEGREES = [0, 2, 4, 5, 7, 9, 11];
/** Semitone offsets for each scale degree in natural minor */
const MINOR_SCALE_DEGREES = [0, 2, 3, 5, 7, 8, 10];

const SOLFA_NAMES: SolfaSyllable[] = ["d", "r", "m", "f", "s", "l", "t"];

/* ══════════════════════════════════════════════
   Chord Definitions for SATB Harmonization

   Scale degree indices: 0=d 1=r 2=m 3=f 4=s 5=l 6=t
   Each chord: [root, third, fifth]
   ══════════════════════════════════════════════ */

const CHORD_TONES: Record<string, [number, number, number]> = {
  I:  [0, 2, 4],  // d, m, s
  ii: [1, 3, 5],  // r, f, l
  IV: [3, 5, 0],  // f, l, d
  V:  [4, 6, 1],  // s, t, r
  vi: [5, 0, 2],  // l, d, m
};

/** Root degree index (for bass voice) */
const CHORD_ROOT: Record<string, number> = {
  I: 0, ii: 1, IV: 3, V: 4, vi: 5,
};

/**
 * For each soprano scale degree (0-6), which chords contain it.
 * Ordered by preference (first = default).
 */
const SOPRANO_TO_CHORDS: string[][] = [
  /* d=0 */ ["I", "IV", "vi"],
  /* r=1 */ ["V", "ii"],
  /* m=2 */ ["I", "vi"],
  /* f=3 */ ["IV", "ii"],
  /* s=4 */ ["I", "V"],
  /* l=5 */ ["vi", "IV", "ii"],
  /* t=6 */ ["V"],
];

/**
 * Voice ranges in semitones relative to root at reference octave (MIDI ~60).
 *   Soprano: d to d'    (0  to +12)
 *   Alto:    s, to s    (-5 to +7)
 *   Tenor:   d(below) to s(below) (-12 to -5)
 *   Bass:    d,, to d   (-24 to  0)
 */
const VOICE_RANGES = {
  soprano: { min: 0, max: 12 },
  alto:    { min: -5, max: 7 },
  tenor:   { min: -12, max: -5 },
  bass:    { min: -24, max: 0 },
};

/* ══════════════════════════════════════════════
   Key Parsing
   ══════════════════════════════════════════════ */

function parseKey(keyStr: string): { root: number; isMinor: boolean } {
  // "Auto-detect" or empty → default to C major (will be overridden by detection)
  if (!keyStr || keyStr === "Auto-detect") {
    return { root: 0, isMinor: false };
  }

  const parts = keyStr.trim().split(/\s+/);
  const noteName = parts[0];
  const isMinor = (parts[1] ?? "major").toLowerCase() === "minor";

  const idx = NOTE_NAMES.indexOf(noteName);
  if (idx !== -1) return { root: idx, isMinor };

  const enharmonic: Record<string, number> = {
    Db: 1, "D#": 3, Fb: 4, "E#": 5,
    Gb: 6, "G#": 8, "A#": 10, Cb: 11, "B#": 0,
  };
  return { root: enharmonic[noteName] ?? 0, isMinor };
}

/* ══════════════════════════════════════════════
   Frequency / MIDI / Solfa Helpers
   ══════════════════════════════════════════════ */

function freqToMidi(freq: number): number {
  if (freq <= 0) return -1;
  return 69 + 12 * Math.log2(freq / 440);
}

function midiToSolfa(
  midiNote: number,
  root: number,
  scaleDegrees: number[]
): { syllable: SolfaSyllable; octaveOffset: number } {
  const rounded = Math.round(midiNote);
  const semitoneFromRoot = ((rounded % 12) - root + 12) % 12;

  let bestIndex = 0;
  let bestDist = 12;
  for (let i = 0; i < scaleDegrees.length; i++) {
    const dist = Math.min(
      Math.abs(semitoneFromRoot - scaleDegrees[i]),
      12 - Math.abs(semitoneFromRoot - scaleDegrees[i])
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }

  const referenceOctaveMidi = 60 + root;
  const noteOctave = Math.floor((rounded - root) / 12);
  const refOctave = Math.floor((referenceOctaveMidi - root) / 12);
  const octaveOffset = noteOctave - refOctave;

  return { syllable: SOLFA_NAMES[bestIndex], octaveOffset };
}

/**
 * Convert a semitone offset from root (at reference octave 0) to SolfaNote.
 *   semitone  0 → d  octave 0
 *   semitone  7 → s  octave 0
 *   semitone 12 → d' octave +1
 *   semitone -5 → s, octave -1
 *   semitone -12 → d, octave -1
 *   semitone -24 → d,, octave -2
 */
function semitoneToSolfa(
  semitoneFromRoot: number,
  scaleDegrees: number[]
): SolfaNote {
  const pitchClass = ((semitoneFromRoot % 12) + 12) % 12;

  let bestIdx = 0;
  let bestDist = 12;
  for (let i = 0; i < scaleDegrees.length; i++) {
    const dist = Math.min(
      Math.abs(pitchClass - scaleDegrees[i]),
      12 - Math.abs(pitchClass - scaleDegrees[i])
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  const octaveOffset = Math.floor(semitoneFromRoot / 12);

  return {
    syllable: SOLFA_NAMES[bestIdx],
    octaveOffset,
    duration: 1,
  };
}

/**
 * Place a pitch class (semitone within one octave) into a specific
 * semitone range by finding the right octave transposition.
 *
 * @param preferCloseTo  Previous position for voice leading (minimize leaps)
 */
function placeToneInRange(
  degreeSemitone: number,
  minSemitone: number,
  maxSemitone: number,
  preferCloseTo?: number
): number {
  const pitchClass = ((degreeSemitone % 12) + 12) % 12;
  const candidates: number[] = [];

  for (let oct = -3; oct <= 2; oct++) {
    const actual = pitchClass + oct * 12;
    if (actual >= minSemitone && actual <= maxSemitone) {
      candidates.push(actual);
    }
  }

  if (candidates.length === 0) {
    // No exact fit - find closest to range
    let best = pitchClass;
    let bestDist = Infinity;
    for (let oct = -3; oct <= 2; oct++) {
      const actual = pitchClass + oct * 12;
      const dist =
        actual < minSemitone
          ? minSemitone - actual
          : actual > maxSemitone
            ? actual - maxSemitone
            : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = actual;
      }
    }
    return best;
  }

  if (preferCloseTo !== undefined && candidates.length > 1) {
    candidates.sort(
      (a, b) => Math.abs(a - preferCloseTo) - Math.abs(b - preferCloseTo)
    );
  }

  return candidates[0];
}

/**
 * Get chord tones as semitone offsets from root.
 * In minor keys, V chord uses raised 7th (harmonic minor leading tone).
 */
function getChordSemitones(
  chordName: string,
  scaleDegrees: number[],
  isMinor: boolean
): number[] {
  const degreeIndices = CHORD_TONES[chordName];
  const semitones = degreeIndices.map((d) => scaleDegrees[d]);

  // Harmonic minor: raise the 7th degree for V chord
  if (isMinor && chordName === "V") {
    const tIdx = degreeIndices.indexOf(6); // find 't' in chord tones
    if (tIdx !== -1) {
      semitones[tIdx] = 11; // leading tone (ti) instead of flat 7th (te)
    }
  }

  return semitones;
}

/* ══════════════════════════════════════════════
   Phrase Detection

   Analyzes soprano measures to find musical
   phrases (runs of singing separated by silence).

   A phrase = consecutive beats with actual notes.
   A phrase boundary = 3+ beats of rest ("x"),
   indicating a real musical pause (not a brief
   pitch detector dropout).
   ══════════════════════════════════════════════ */

interface Phrase {
  /** First measure index (0-based) */
  startMeasure: number;
  /** Last measure index (inclusive) */
  endMeasure: number;
  /** Beat index within startMeasure where singing begins */
  startBeat: number;
  /** How many beats of pitched content in this phrase */
  pitchedBeats: number;
}

/**
 * Detect phrases from soprano/melody measures.
 *
 * A phrase starts when singing begins after silence (or at the start),
 * and ends when there are 3+ consecutive rest beats.
 *
 * This detects the real musical structure: intro silence, verse starts,
 * gaps between phrases, and endings.
 */
function detectPhrases(
  measures: SolfaMeasure[],
  beatsPerMeasure = 4
): Phrase[] {
  const phrases: Phrase[] = [];

  // Flatten all beats into a linear array with measure tracking
  type BeatInfo = { measureIdx: number; beatIdx: number; isPitched: boolean };
  const allBeats: BeatInfo[] = [];

  for (let m = 0; m < measures.length; m++) {
    const measure = measures[m];
    for (let b = 0; b < measure.beats.length; b++) {
      const syl = measure.beats[b].syllable;
      // A beat is "pitched" if it has an actual note (not rest, not sustain-of-nothing)
      const isPitched = syl !== "x" && syl !== "-";
      // Also count sustain as "pitched" since it continues a note
      const isSustain = syl === "-";
      allBeats.push({
        measureIdx: m,
        beatIdx: b,
        isPitched: isPitched || isSustain,
      });
    }
  }

  if (allBeats.length === 0) return [];

  // Walk through beats, finding phrase starts and ends
  let inPhrase = false;
  let phraseStart = -1;
  let phraseStartBeat = 0;
  let consecutiveRests = 0;
  let pitchedCount = 0;

  const PHRASE_GAP_THRESHOLD = 3; // 3+ rests = phrase boundary

  for (let i = 0; i < allBeats.length; i++) {
    const beat = allBeats[i];

    if (beat.isPitched) {
      if (!inPhrase) {
        // Start new phrase
        inPhrase = true;
        phraseStart = beat.measureIdx;
        phraseStartBeat = beat.beatIdx;
        pitchedCount = 0;
      }
      consecutiveRests = 0;
      pitchedCount++;
    } else {
      consecutiveRests++;

      if (inPhrase && consecutiveRests >= PHRASE_GAP_THRESHOLD) {
        // End current phrase
        // Find the last pitched beat before this rest run
        const lastPitchedIdx = i - consecutiveRests;
        const lastBeat = allBeats[lastPitchedIdx];

        if (lastBeat && pitchedCount >= 2) {
          phrases.push({
            startMeasure: phraseStart,
            endMeasure: lastBeat.measureIdx,
            startBeat: phraseStartBeat,
            pitchedBeats: pitchedCount,
          });
        }

        inPhrase = false;
        pitchedCount = 0;
      }
    }
  }

  // Close final phrase if still open
  if (inPhrase && pitchedCount >= 2) {
    const lastPitched = allBeats
      .slice()
      .reverse()
      .find((b) => b.isPitched);
    if (lastPitched) {
      phrases.push({
        startMeasure: phraseStart,
        endMeasure: lastPitched.measureIdx,
        startBeat: phraseStartBeat,
        pitchedBeats: pitchedCount,
      });
    }
  }

  return phrases;
}

/**
 * Which phrase (if any) does measure `m` belong to?
 * Returns the phrase index or -1 if the measure is between phrases (rest).
 */
function getPhraseIndex(phrases: Phrase[], measureIdx: number): number {
  for (let p = 0; p < phrases.length; p++) {
    if (measureIdx >= phrases[p].startMeasure && measureIdx <= phrases[p].endMeasure) {
      return p;
    }
  }
  return -1;
}

/* ══════════════════════════════════════════════
   SATB Harmonization Engine

   Given a soprano melody, generate Alto, Tenor,
   and Bass parts following Catholic hymn writing
   conventions:

   1. All SATB voices active from the start
   2. Detect phrases for cadence placement
   3. Choose chord based on soprano scale degree
   4. Apply V→I cadence at phrase endings
   5. Voice leading: minimize motion, common tones
   6. All voices rest when soprano rests
   ══════════════════════════════════════════════ */

function harmonizeMelody(
  sopranoMeasures: SolfaMeasure[],
  scaleDegrees: number[],
  isMinor: boolean
): { alto: SolfaMeasure[]; tenor: SolfaMeasure[]; bass: SolfaMeasure[] } {
  const altoMeasures: SolfaMeasure[] = [];
  const tenorMeasures: SolfaMeasure[] = [];
  const bassMeasures: SolfaMeasure[] = [];

  // Detect phrases from the melody
  const phrases = detectPhrases(sopranoMeasures);

  // Track previous semitone positions for voice leading
  let prevAlto = 4;
  let prevTenor = -8;
  let prevBass = -12;

  for (let m = 0; m < sopranoMeasures.length; m++) {
    const measure = sopranoMeasures[m];
    const altoBeats: SolfaNote[] = [];
    const tenorBeats: SolfaNote[] = [];
    const bassBeats: SolfaNote[] = [];

    // All voices always active
    const phraseIdx = getPhraseIndex(phrases, m);

    // Detect phrase-level cadence points
    const currentPhrase = phraseIdx >= 0 ? phrases[phraseIdx] : null;
    const isLastMeasureOfPhrase = currentPhrase
      ? m === currentPhrase.endMeasure
      : (m + 1) % 4 === 0 || m === sopranoMeasures.length - 1;

    for (let b = 0; b < measure.beats.length; b++) {
      const sopNote = measure.beats[b];

      // Rest or sustain: all voices follow soprano
      if (sopNote.syllable === "x" || sopNote.syllable === "-") {
        const mirror: SolfaNote = {
          syllable: sopNote.syllable,
          octaveOffset: 0,
          duration: 1,
        };
        altoBeats.push(mirror);
        tenorBeats.push(mirror);
        bassBeats.push(mirror);
        continue;
      }

      const sopDegreeIdx = SOLFA_NAMES.indexOf(
        sopNote.syllable as SolfaSyllable
      );
      if (sopDegreeIdx === -1) {
        const rest: SolfaNote = { syllable: "x", octaveOffset: 0, duration: 1 };
        altoBeats.push(rest);
        tenorBeats.push(rest);
        bassBeats.push(rest);
        continue;
      }

      // --- Chord selection ---
      const isLastBeat =
        isLastMeasureOfPhrase && b === measure.beats.length - 1;
      const isPenultimateBeat =
        isLastMeasureOfPhrase && b === measure.beats.length - 2;

      let chordName: string;

      if (isLastBeat) {
        const iDegrees = CHORD_TONES["I"];
        chordName = iDegrees.includes(sopDegreeIdx)
          ? "I"
          : SOPRANO_TO_CHORDS[sopDegreeIdx][0];
      } else if (isPenultimateBeat) {
        const vDegrees = CHORD_TONES["V"];
        chordName = vDegrees.includes(sopDegreeIdx)
          ? "V"
          : SOPRANO_TO_CHORDS[sopDegreeIdx][0];
      } else {
        chordName = SOPRANO_TO_CHORDS[sopDegreeIdx][0];
      }

      // --- Get chord tones as semitones ---
      const chordSemitones = getChordSemitones(
        chordName,
        scaleDegrees,
        isMinor
      );

      // --- Bass: chord root ---
      const bassRootDegree = CHORD_ROOT[chordName];
      const bassRootSemitone = scaleDegrees[bassRootDegree];
      const bassSemitone = placeToneInRange(
        bassRootSemitone,
        VOICE_RANGES.bass.min,
        VOICE_RANGES.bass.max,
        prevBass
      );

      // --- Alto & Tenor: remaining chord tones ---
      const sopPC =
        ((scaleDegrees[sopDegreeIdx] % 12) + 12) % 12;

      const remaining = chordSemitones.filter((s) => {
        const pc = ((s % 12) + 12) % 12;
        return pc !== sopPC;
      });

      let altoSemitone: number;
      let tenorSemitone: number;

      if (remaining.length >= 2) {
        let bestAlto = 0;
        let bestTenor = 0;
        let bestCost = Infinity;

        for (let i = 0; i < remaining.length; i++) {
          for (let j = 0; j < remaining.length; j++) {
            if (i === j) continue;
            const a = placeToneInRange(
              remaining[i],
              VOICE_RANGES.alto.min,
              VOICE_RANGES.alto.max,
              prevAlto
            );
            const t = placeToneInRange(
              remaining[j],
              VOICE_RANGES.tenor.min,
              VOICE_RANGES.tenor.max,
              prevTenor
            );
            const cost =
              Math.abs(a - prevAlto) + Math.abs(t - prevTenor);
            if (cost < bestCost) {
              bestCost = cost;
              bestAlto = a;
              bestTenor = t;
            }
          }
        }

        altoSemitone = bestAlto;
        tenorSemitone = bestTenor;
      } else if (remaining.length === 1) {
        altoSemitone = placeToneInRange(
          remaining[0],
          VOICE_RANGES.alto.min,
          VOICE_RANGES.alto.max,
          prevAlto
        );
        tenorSemitone = placeToneInRange(
          remaining[0],
          VOICE_RANGES.tenor.min,
          VOICE_RANGES.tenor.max,
          prevTenor
        );
      } else {
        altoSemitone = placeToneInRange(
          chordSemitones[1],
          VOICE_RANGES.alto.min,
          VOICE_RANGES.alto.max,
          prevAlto
        );
        tenorSemitone = placeToneInRange(
          chordSemitones[2],
          VOICE_RANGES.tenor.min,
          VOICE_RANGES.tenor.max,
          prevTenor
        );
      }

      // All voices always get their harmony notes
      altoBeats.push(semitoneToSolfa(altoSemitone, scaleDegrees));
      tenorBeats.push(semitoneToSolfa(tenorSemitone, scaleDegrees));
      bassBeats.push(semitoneToSolfa(bassSemitone, scaleDegrees));

      // Update voice leading positions
      prevAlto = altoSemitone;
      prevTenor = tenorSemitone;
      prevBass = bassSemitone;
    }

    altoMeasures.push({
      measureNumber: measure.measureNumber,
      beats: altoBeats,
    });
    tenorMeasures.push({
      measureNumber: measure.measureNumber,
      beats: tenorBeats,
    });
    bassMeasures.push({
      measureNumber: measure.measureNumber,
      beats: bassBeats,
    });
  }

  return { alto: altoMeasures, tenor: tenorMeasures, bass: bassMeasures };
}

/* ══════════════════════════════════════════════
   Render a single SolfaNote to text

     d  r  m  f  s  l  t   (reference octave)
     d' r' m' ...           (upper octave)
     d, r, m, ...           (lower octave)
     -                      (sustain / hold)
     x                      (rest / silence)
   ══════════════════════════════════════════════ */

export function renderNote(note: SolfaNote): string {
  if (note.syllable === "-") return "-";
  if (note.syllable === "x") return "x";
  const syl = note.syllable;
  if (note.octaveOffset > 0) {
    return syl + "'".repeat(note.octaveOffset);
  }
  if (note.octaveOffset < 0) {
    return syl + ",".repeat(Math.abs(note.octaveOffset));
  }
  return syl;
}

/* ══════════════════════════════════════════════
   Render a beat pair (two subdivisions = one beat)

   In Curwen notation, each quarter-note beat may
   contain one note (quarter) or two notes (eighths):

   - Same note twice → single note (sustained quarter)
   - Note + sustain → single note
   - Two different notes → "note,note" (two eighths)
   - Rest + note → ".,note" (pickup/upbeat)
   - Both rest → "-"
   ══════════════════════════════════════════════ */

function renderBeatPair(
  sub1: SolfaNote | undefined,
  sub2: SolfaNote | undefined
): string {
  if (!sub1 && !sub2) return "-";
  if (!sub1) return sub2 ? renderNote(sub2) : "-";
  if (!sub2) return renderNote(sub1);

  const r1 = renderNote(sub1);
  const r2 = renderNote(sub2);

  // Both rest
  if (r1 === "x" && r2 === "x") return "-";

  // Both sustain
  if (r1 === "-" && r2 === "-") return "-";

  // First is note, second is sustain or same note → quarter note
  if (r1 !== "x" && r1 !== "-" && (r2 === "-" || r1 === r2)) return r1;

  // First is rest/sustain, second is note → pickup/upbeat
  if ((r1 === "x" || r1 === "-") && r2 !== "x" && r2 !== "-")
    return `.${r2}`;

  // First is note, second is rest → just the note (articulated)
  if (r1 !== "x" && r1 !== "-" && r2 === "x") return r1;

  // First is sustain, second is note → new note enters
  if (r1 === "-" && r2 !== "x" && r2 !== "-") return `.${r2}`;

  // Two different pitched notes → two eighth notes
  if (r1 !== "x" && r1 !== "-" && r2 !== "x" && r2 !== "-")
    return `${r1},${r2}`;

  // Fallback
  return r1;
}

/* ══════════════════════════════════════════════
   Render SolfaSheet as Curwen tonic sol-fa text

   Uses the standard Nigerian/African church format
   matching the Curwen notation system:

   Doh is Bb       Title
                    Composer

     S: s . f : m . r  | d . t,,l, : s, . s, |
     A: m . r : d . t, | l, . s,,f, : m, . m, |
     T: s, . l, : d . r | d . - : d . l, |
     B: d, . d, : d, . f,| s, . - : d, . - |

   Format:
   - "." separates beats within each half-measure
   - ":" separates the two halves of a measure
   - "|" is the bar line
   - "a,b" = two eighth notes in one beat
   - ".a" = pickup note (upbeat eighth)
   ══════════════════════════════════════════════ */

export function renderSheetText(sheet: SolfaSheet): string {
  const lines: string[] = [];
  const partOrder = ["soprano", "alto", "tenor", "bass", "vocal"];
  const partLabels: Record<string, string> = {
    soprano: "S",
    alto: "A",
    tenor: "T",
    bass: "B",
    vocal: "V",
  };

  const { root } = parseKey(sheet.key);
  const rootName = NOTE_NAMES[root];
  const modeName = sheet.key.toLowerCase().includes("minor")
    ? "Minor"
    : "Major";

  // Header - Curwen style
  const divider = "=".repeat(60);
  lines.push(divider);
  lines.push(`  ${sheet.projectName}`);
  lines.push(`  Tonic Sol-fa Notation`);
  lines.push(
    `  Doh is ${rootName} ${modeName}  |  ${sheet.timeSignature.numerator}/${sheet.timeSignature.denominator} Time  |  BPM: ${sheet.bpm}`
  );
  lines.push(divider);
  lines.push("");

  // Sort parts in SATB order
  const sorted = [...sheet.parts].sort(
    (a, b) => partOrder.indexOf(a.partKey) - partOrder.indexOf(b.partKey)
  );

  const beatsPerMeasure = sheet.timeSignature.numerator;
  const measuresPerLine = 2; // 2 measures per line (wider Curwen format)
  const totalLines = Math.ceil(sheet.totalMeasures / measuresPerLine);

  // Detect subdivision count from data
  const firstMeasure = sorted[0]?.measures[0];
  const subsPerMeasure = firstMeasure?.beats.length || beatsPerMeasure;
  const subsPerBeat = Math.max(1, Math.round(subsPerMeasure / beatsPerMeasure));
  const hasTwoSubs = subsPerBeat >= 2;

  // Detect phrases for section labeling
  const melodyPart = sorted.find(
    (p) => p.partKey === "soprano" || p.partKey === "vocal"
  );
  const phrases = melodyPart
    ? detectPhrases(melodyPart.measures, beatsPerMeasure)
    : undefined;
  const sectionBreaks = getSectionBreaks(
    sheet.totalMeasures,
    measuresPerLine,
    phrases
  );

  // Helper: get beat string for a specific beat in a measure
  function getBeatString(
    measure: SolfaMeasure | undefined,
    beatIdx: number
  ): string {
    if (!measure) return "-";

    if (hasTwoSubs) {
      const sub1 = measure.beats[beatIdx * 2];
      const sub2 = measure.beats[beatIdx * 2 + 1];
      return renderBeatPair(sub1, sub2);
    } else {
      const note = measure.beats[beatIdx];
      if (!note) return "-";
      const r = renderNote(note);
      return r === "x" ? "-" : r;
    }
  }

  // Render systems (groups of measures per line)
  for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
    const startM = lineIdx * measuresPerLine;
    const endM = Math.min(startM + measuresPerLine, sheet.totalMeasures);
    const measuresInLine = endM - startM;

    // Section label
    const sectionLabel = sectionBreaks.get(lineIdx);
    if (sectionLabel) {
      if (lineIdx > 0) lines.push("");
      lines.push(`  -- ${sectionLabel} --`);
      lines.push("");
    }

    // Pre-compute beat strings for alignment
    // beatStrings[partIdx][measureOffset][beatIdx]
    const beatStrings: string[][][] = [];
    for (let pi = 0; pi < sorted.length; pi++) {
      beatStrings[pi] = [];
      for (let mo = 0; mo < measuresInLine; mo++) {
        const mIdx = startM + mo;
        beatStrings[pi][mo] = [];
        for (let b = 0; b < beatsPerMeasure; b++) {
          beatStrings[pi][mo][b] = getBeatString(
            sorted[pi].measures[mIdx],
            b
          );
        }
      }
    }

    // Compute max width per [measureOffset][beat] for vertical alignment
    const maxW: number[][] = [];
    for (let mo = 0; mo < measuresInLine; mo++) {
      maxW[mo] = [];
      for (let b = 0; b < beatsPerMeasure; b++) {
        let mw = 1;
        for (let pi = 0; pi < sorted.length; pi++) {
          mw = Math.max(mw, beatStrings[pi][mo][b].length);
        }
        maxW[mo][b] = mw;
      }
    }

    // Render each voice part with aligned beats
    for (let pi = 0; pi < sorted.length; pi++) {
      const label = partLabels[sorted[pi].partKey] || "?";
      let row = `  ${label}: `;

      for (let mo = 0; mo < measuresInLine; mo++) {
        if (mo > 0) row += "| ";

        // Format as: B1 . B2 : B3 . B4  (for 4/4)
        const halfIdx = Math.floor(beatsPerMeasure / 2);
        for (let b = 0; b < beatsPerMeasure; b++) {
          if (b === halfIdx) {
            row += ": ";
          } else if (b > 0) {
            row += ". ";
          }
          row += beatStrings[pi][mo][b].padEnd(maxW[mo][b]) + " ";
        }
      }

      row += "|";
      lines.push(row);
    }

    lines.push("");
  }

  // Legend
  lines.push("---");
  lines.push("Legend:");
  lines.push("  d r m f s l t = Do Re Mi Fa Sol La Ti");
  lines.push("  '  = upper octave    ,  = lower octave");
  lines.push("  -  = sustained note / rest");
  lines.push("  .  = beat division   :  = half-measure");
  lines.push("  |  = bar line");
  if (hasTwoSubs) {
    lines.push("  a,b = two eighth notes in one beat");
    lines.push("  .a  = pickup note (upbeat)");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Section break labels based on phrase detection.
 *
 * Uses actual musical phrases to determine sections.
 * Groups consecutive phrases into sections separated
 * by longer silences (>= 1 full measure of rest).
 *
 * Falls back to 8-measure heuristic if no phrases provided.
 */
function getSectionBreaks(
  totalMeasures: number,
  measuresPerLine: number,
  phrases?: Phrase[]
): Map<number, string> {
  const breaks = new Map<number, string>();

  // If we have phrase data, use it for section detection
  if (phrases && phrases.length > 0) {
    let sectionNum = 1;

    // Group phrases into sections based on gaps between them
    // A gap of 2+ measures between phrases = new section
    let prevEndMeasure = -1;

    for (let p = 0; p < phrases.length; p++) {
      const phrase = phrases[p];
      const gapMeasures = prevEndMeasure >= 0
        ? phrase.startMeasure - prevEndMeasure - 1
        : phrase.startMeasure;

      // Label the first phrase, or any phrase after a significant gap
      if (p === 0 || gapMeasures >= 2) {
        const lineIdx = Math.floor(phrase.startMeasure / measuresPerLine);

        // Simple labeling: Section 1, Section 2, etc.
        // For hymns: Intro → Verse 1 → Chorus → Verse 2 pattern
        if (p === 0 && phrase.startMeasure > 0) {
          // Song starts with silence = intro
          breaks.set(0, "Intro");
          breaks.set(lineIdx, `Section ${sectionNum}`);
        } else {
          breaks.set(lineIdx, `Section ${sectionNum}`);
        }
        sectionNum++;
      }

      prevEndMeasure = phrase.endMeasure;
    }

    return breaks;
  }

  // Fallback: simple heuristic
  if (totalMeasures <= 8) {
    breaks.set(0, "Section 1");
    return breaks;
  }

  const measuresPerSection = 8;
  const totalSections = Math.ceil(totalMeasures / measuresPerSection);

  for (let s = 0; s < totalSections; s++) {
    const measureStart = s * measuresPerSection;
    const lineIdx = Math.floor(measureStart / measuresPerLine);
    breaks.set(lineIdx, `Section ${s + 1}`);
  }

  return breaks;
}

/* ══════════════════════════════════════════════
   Beat Quantization with Rest vs Sustain

   - "x" = rest (no pitch detected / silence)
   - "-" = sustain (same note as previous beat)

   Phrase-aware: preserves real musical silences
   between phrases while filling brief pitch
   detector dropouts within sustained singing.
   ══════════════════════════════════════════════ */

function quantizeToBeats(
  pitchFrames: PitchFrame[],
  bpm: number,
  totalDuration: number,
  root: number,
  scaleDegrees: number[],
  subdivisionsPerBeat = 1,
  beatsPerMeasure = 4
): SolfaMeasure[] {
  const beatDuration = 60 / bpm;
  const subdivisionDuration = beatDuration / subdivisionsPerBeat;
  const totalSubdivisions = Math.ceil(totalDuration / subdivisionDuration);
  const subdivisionsPerMeasure = beatsPerMeasure * subdivisionsPerBeat;
  const totalMeasures = Math.ceil(totalSubdivisions / subdivisionsPerMeasure);

  // ── Pass 1: Raw pitch detection per beat ──
  const rawBeats: Array<{ midi: number } | null> = [];

  for (let sub = 0; sub < totalSubdivisions; sub++) {
    const timeStart = sub * subdivisionDuration;
    const timeEnd = timeStart + subdivisionDuration;

    const pitched = pitchFrames.filter(
      (f) => f.time >= timeStart && f.time < timeEnd && f.frequency > 0
    );

    if (pitched.length === 0) {
      rawBeats.push(null);
      continue;
    }

    const freqs = pitched.map((f) => f.frequency).sort((a, b) => a - b);
    const medianFreq = freqs[Math.floor(freqs.length / 2)];
    let midi = freqToMidi(medianFreq);

    if (midi < 0) {
      rawBeats.push(null);
      continue;
    }

    while (midi < 48 && midi > 0) midi += 12;
    while (midi > 84) midi -= 12;

    rawBeats.push({ midi });
  }

  // ── Pass 1.5: Octave normalization ──
  // Correct sub-harmonic/overtone detection errors.
  // Notes more than an octave from the group median are shifted to the correct octave.
  {
    const pitchedMidis = rawBeats
      .filter((b): b is { midi: number } => b !== null)
      .map((b) => b.midi);

    if (pitchedMidis.length > 0) {
      const sortedMidis = [...pitchedMidis].sort((a, b) => a - b);
      const groupMedian = sortedMidis[Math.floor(sortedMidis.length / 2)];

      for (let i = 0; i < rawBeats.length; i++) {
        if (rawBeats[i] !== null) {
          let midi = rawBeats[i]!.midi;
          while (midi < groupMedian - 12) midi += 12;
          while (midi > groupMedian + 12) midi -= 12;
          rawBeats[i] = { midi };
        }
      }
    }
  }

  // ── Pass 1.6: Median smoothing ──
  // 3-frame median filter reduces single-frame pitch jitter
  for (let i = 1; i < rawBeats.length - 1; i++) {
    if (
      rawBeats[i] !== null &&
      rawBeats[i - 1] !== null &&
      rawBeats[i + 1] !== null
    ) {
      const values = [
        rawBeats[i - 1]!.midi,
        rawBeats[i]!.midi,
        rawBeats[i + 1]!.midi,
      ].sort((a, b) => a - b);
      rawBeats[i] = { midi: values[1] };
    }
  }

  // ── Pass 2: Phrase-aware gap filling ──
  // Only fill gaps of 1 beat within a phrase (brief dropout).
  // Gaps of 2+ beats are preserved as real musical rests/phrase breaks.
  // This prevents filling silence between phrases or sections.
  for (let i = 1; i < rawBeats.length - 1; i++) {
    if (
      rawBeats[i] === null &&
      rawBeats[i - 1] !== null &&
      rawBeats[i + 1] !== null
    ) {
      // Only fill if the surrounding notes are similar (within an octave)
      // to avoid bridging across unrelated phrases
      const prevMidi = rawBeats[i - 1]!.midi;
      const nextMidi = rawBeats[i + 1]!.midi;
      if (Math.abs(prevMidi - nextMidi) <= 12) {
        rawBeats[i] = { midi: prevMidi };
      }
    }
  }

  // ── Pass 3: Auto-detect reference octave from singer's range ──
  const detectedMidis = rawBeats
    .filter((b): b is { midi: number } => b !== null)
    .map((b) => b.midi);

  let octaveShift = 0;
  if (detectedMidis.length > 0) {
    const sorted = [...detectedMidis].sort((a, b) => a - b);
    const medianMidi = sorted[Math.floor(sorted.length / 2)];

    const referenceCenter = 60 + root;
    // Find the "do" (root pitch class) at or below the singer's median pitch.
    // This ensures the singer's primary singing range maps to octave 0 (no markers).
    // E.g., for Bb major with median F4 (MIDI 65): doBelow = Bb3 (MIDI 58),
    // so the Bb3-A4 range becomes octave 0, matching standard solfa convention.
    const doBelow = root + Math.floor((medianMidi - root) / 12) * 12;
    octaveShift = Math.round((doBelow - referenceCenter) / 12);
  }

  // ── Pass 4: Build measures with solfa, sustain, rest ──
  // Track previous note for sustain detection.
  // Reset sustain tracking at phrase boundaries (after 3+ rests)
  // so new phrases always start with a fresh note symbol.
  const measures: SolfaMeasure[] = [];
  let prevSyllable: SolfaSyllable | null = null;
  let prevOctave = 0;
  let consecutiveRests = 0;

  for (let m = 0; m < totalMeasures; m++) {
    const beats: SolfaNote[] = [];

    for (let s = 0; s < subdivisionsPerMeasure; s++) {
      const globalSub = m * subdivisionsPerMeasure + s;

      if (globalSub >= rawBeats.length) {
        beats.push({ syllable: "x", octaveOffset: 0, duration: 1 });
        consecutiveRests++;
        continue;
      }

      const raw = rawBeats[globalSub];

      if (raw === null) {
        beats.push({ syllable: "x", octaveOffset: 0, duration: 1 });
        consecutiveRests++;
        // After 3+ rests, we're in a phrase break → reset sustain tracking
        if (consecutiveRests >= 3) {
          prevSyllable = null;
          prevOctave = 0;
        }
        continue;
      }

      consecutiveRests = 0;

      const { syllable, octaveOffset: rawOctave } = midiToSolfa(
        raw.midi,
        root,
        scaleDegrees
      );

      const octaveOffset = rawOctave - octaveShift;

      // Same note as previous → sustain ("-")
      if (syllable === prevSyllable && octaveOffset === prevOctave) {
        beats.push({ syllable: "-", octaveOffset: 0, duration: 1 });
      } else {
        beats.push({ syllable, octaveOffset, duration: 1 });
        prevSyllable = syllable;
        prevOctave = octaveOffset;
      }
    }

    measures.push({ measureNumber: m + 1, beats });
  }

  return measures;
}

/* ══════════════════════════════════════════════
   Main Entry: Generate SolfaSheet from Audio

   - Runs pitch detection on each track
   - Quantizes to beats with rest/sustain distinction
   - Auto-harmonizes if fewer than 4 SATB parts:
     uses functional harmony (I, IV, V, vi, ii)
     to generate missing Alto, Tenor, Bass
   ══════════════════════════════════════════════ */

export async function generateSolfaSheet(
  trackData: Array<{
    partName: string;
    partKey: "soprano" | "alto" | "tenor" | "bass" | "vocal";
    audioBuffer: AudioBuffer;
  }>,
  projectName: string,
  key: string,
  bpm: number,
  onProgress?: (percent: number, message: string) => void
): Promise<SolfaSheet & { detectedKey?: KeyDetectionResult; detectedBPM?: number }> {
  // Use the first audio buffer for key and BPM detection
  const primaryBuffer = trackData[0]?.audioBuffer;
  let effectiveKey = key;
  let effectiveBPM = bpm;
  let keyResult: KeyDetectionResult | undefined;
  let detectedBPMValue: number | undefined;

  if (primaryBuffer) {
    // ── Auto-detect key from audio ──
    onProgress?.(2, "Detecting musical key from audio...");
    try {
      keyResult = await detectKey(primaryBuffer);
      // Use detected key if confidence is reasonable (> 0.3)
      // or if no project key was set (empty / "C major" default)
      const isDefaultKey = !key || key === "C major" || key === "C Major" || key === "Auto-detect";
      if (keyResult.confidence > 0.3 || isDefaultKey) {
        effectiveKey = keyResult.label;
        onProgress?.(
          5,
          `Detected key: ${keyResult.label} (${Math.round(keyResult.confidence * 100)}% confidence)`
        );
      } else {
        onProgress?.(5, `Using project key: ${key} (detection confidence too low)`);
      }
    } catch (e) {
      console.warn("Key detection failed, using project key:", e);
      onProgress?.(5, `Using project key: ${key}`);
    }

    // ── Auto-detect BPM from audio ──
    onProgress?.(7, "Detecting tempo (BPM)...");
    try {
      const bpmResult = await detectBPM(primaryBuffer);
      detectedBPMValue = bpmResult.bpm;
      // Use detected BPM if confidence is decent or project BPM is default
      const isDefaultBPM = !bpm || bpm === 120;
      if (bpmResult.confidence > 0.2 || isDefaultBPM) {
        effectiveBPM = bpmResult.bpm;
        onProgress?.(
          10,
          `Detected tempo: ${bpmResult.bpm} BPM (${Math.round(bpmResult.confidence * 100)}% confidence)`
        );
      } else {
        onProgress?.(10, `Using project tempo: ${bpm} BPM`);
      }
    } catch (e) {
      console.warn("BPM detection failed, using project BPM:", e);
      onProgress?.(10, `Using project tempo: ${bpm} BPM`);
    }
  }

  const { root, isMinor } = parseKey(effectiveKey);
  const scaleDegrees = isMinor ? MINOR_SCALE_DEGREES : MAJOR_SCALE_DEGREES;
  const parts: SolfaPart[] = [];

  // Phase 1: Pitch detection for each provided track (10-60%)
  for (let i = 0; i < trackData.length; i++) {
    const track = trackData[i];
    const pctBase = 10 + (i / trackData.length) * 50;
    const pctStep = 50 / trackData.length;

    onProgress?.(pctBase, `Analyzing ${track.partName}...`);

    const pitchFrames = await detectPitch(track.audioBuffer);

    onProgress?.(
      pctBase + pctStep * 0.5,
      `Generating notation for ${track.partName}...`
    );

    const measures = quantizeToBeats(
      pitchFrames,
      effectiveBPM,
      track.audioBuffer.duration,
      root,
      scaleDegrees,
      2, // 2 subdivisions per beat = eighth note resolution
      4  // 4/4 time
    );

    parts.push({
      partName: track.partName,
      partKey: track.partKey,
      measures,
    });

    await new Promise((r) => setTimeout(r, 10));
  }

  // Phase 2: Auto-harmonize if missing SATB parts (60-95%)
  const hasSoprano = parts.some((p) => p.partKey === "soprano");
  const hasAlto = parts.some((p) => p.partKey === "alto");
  const hasTenor = parts.some((p) => p.partKey === "tenor");
  const hasBass = parts.some((p) => p.partKey === "bass");

  const needsHarmonization = !hasAlto || !hasTenor || !hasBass;

  if (needsHarmonization && parts.length > 0) {
    onProgress?.(62, "Harmonizing melody (generating SATB parts)...");

    // Use soprano, vocal, or first track as the melody source
    const melodyPart =
      parts.find((p) => p.partKey === "soprano") ||
      parts.find((p) => p.partKey === "vocal") ||
      parts[0];

    // Relabel as soprano if it isn't already
    if (!hasSoprano && melodyPart.partKey !== "soprano") {
      melodyPart.partKey = "soprano";
      melodyPart.partName = "Soprano (Melody)";
    }

    onProgress?.(
      68,
      `Applying functional harmony in ${NOTE_NAMES[root]} ${isMinor ? "minor" : "major"}...`
    );

    const { alto, tenor, bass } = harmonizeMelody(
      melodyPart.measures,
      scaleDegrees,
      isMinor
    );

    if (!hasAlto) {
      onProgress?.(78, "Alto part generated...");
      parts.push({ partName: "Alto", partKey: "alto", measures: alto });
    }
    if (!hasTenor) {
      onProgress?.(85, "Tenor part generated...");
      parts.push({ partName: "Tenor", partKey: "tenor", measures: tenor });
    }
    if (!hasBass) {
      onProgress?.(92, "Bass part generated...");
      parts.push({ partName: "Bass", partKey: "bass", measures: bass });
    }
  }

  onProgress?.(100, "Done!");

  const maxMeasures = Math.max(1, ...parts.map((p) => p.measures.length));

  return {
    projectName,
    key: effectiveKey,
    bpm: effectiveBPM,
    timeSignature: { numerator: 4, denominator: 4 },
    parts,
    totalMeasures: maxMeasures,
    detectedKey: keyResult,
    detectedBPM: detectedBPMValue,
  };
}
