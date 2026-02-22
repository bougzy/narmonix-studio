"use client";

/**
 * Client-side musical key detection from AudioBuffer.
 *
 * Uses chroma feature extraction (CQT-style via FFT bin mapping)
 * and Krumhansl-Kessler key profiles with Pearson correlation
 * to determine the most likely key and mode (major/minor).
 *
 * Mirrors the Python backend approach in services/ai/audio_utils.py
 */

export interface KeyDetectionResult {
  key: string;        // e.g. "C", "F#", "Bb"
  scale: string;      // "major" or "minor"
  confidence: number; // 0-1 correlation strength
  /** Full label: "C major", "F# minor" */
  label: string;
  /** All 24 key correlations sorted by strength */
  allKeys: Array<{ key: string; scale: string; correlation: number }>;
}

// ── Note names (matching pitch class indices 0-11) ──
const NOTE_NAMES = [
  "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
];

/**
 * Krumhansl-Kessler key-finding profiles.
 * These represent the expected distribution of pitch classes
 * in pieces of music in major and minor keys.
 *
 * Source: Krumhansl, C.L. (1990) "Cognitive Foundations of Musical Pitch"
 */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

/**
 * Detect the musical key from an AudioBuffer.
 *
 * @param audioBuffer - The audio to analyze
 * @param options - Optional configuration
 * @returns KeyDetectionResult with detected key, scale, and confidence
 */
export async function detectKey(
  audioBuffer: AudioBuffer,
  options?: {
    /** Use only a portion of the audio (seconds from start). Default: full length */
    maxDuration?: number;
    /** FFT size for spectral analysis. Default: 8192 (good frequency resolution) */
    fftSize?: number;
  }
): Promise<KeyDetectionResult> {
  const fftSize = options?.fftSize ?? 8192;
  const sampleRate = audioBuffer.sampleRate;

  // ── Step 1: Get mono audio data ──
  let data: Float32Array;
  if (audioBuffer.numberOfChannels > 1) {
    data = new Float32Array(audioBuffer.length);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < audioBuffer.length; i++) {
        data[i] += channelData[i] / audioBuffer.numberOfChannels;
      }
    }
  } else {
    // Copy so we don't modify the original
    data = new Float32Array(audioBuffer.getChannelData(0));
  }

  // Optionally trim to maxDuration
  const maxSamples = options?.maxDuration
    ? Math.min(data.length, Math.floor(options.maxDuration * sampleRate))
    : data.length;
  if (maxSamples < data.length) {
    data = data.slice(0, maxSamples);
  }

  // ── Step 2: Compute chroma features using FFT ──
  // We compute the power spectrum in overlapping windows,
  // then map FFT bins to the 12 pitch classes (chroma).
  const chroma = computeChroma(data, sampleRate, fftSize);

  // ── Step 3: Correlate with Krumhansl-Kessler profiles ──
  const allKeys = correlateWithProfiles(chroma);

  // Sort by correlation (strongest first)
  allKeys.sort((a, b) => b.correlation - a.correlation);

  const best = allKeys[0];
  const secondBest = allKeys[1];

  // Confidence: difference between best and second-best correlation
  // normalized to 0-1 range
  const rawConfidence = best.correlation;
  const margin = best.correlation - secondBest.correlation;

  // Combine absolute correlation and margin for confidence
  const confidence = Math.max(
    0,
    Math.min(1, rawConfidence * 0.5 + margin * 2.5)
  );

  return {
    key: best.key,
    scale: best.scale,
    confidence,
    label: `${best.key} ${best.scale}`,
    allKeys,
  };
}

/**
 * Compute chroma (pitch class distribution) from raw audio samples.
 *
 * Uses overlapping FFT windows, maps each bin to its nearest pitch class,
 * and accumulates energy. This is a simplified CQT-like approach that
 * works well for key detection.
 */
function computeChroma(
  samples: Float32Array,
  sampleRate: number,
  fftSize: number
): Float64Array {
  const chroma = new Float64Array(12);
  const halfFFT = fftSize / 2;
  const hopSize = fftSize / 2; // 50% overlap
  const numFrames = Math.floor((samples.length - fftSize) / hopSize) + 1;

  if (numFrames <= 0) {
    // Audio too short for even one frame
    return chroma;
  }

  // Hann window
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  // Precompute: which pitch class does each FFT bin map to?
  // We only care about bins in the musically relevant range (C2~65Hz to C7~2093Hz)
  const binPitchClass = new Int8Array(halfFFT);
  const binIsRelevant = new Uint8Array(halfFFT);

  for (let bin = 1; bin < halfFFT; bin++) {
    const freq = (bin * sampleRate) / fftSize;
    if (freq < 60 || freq > 2100) {
      binIsRelevant[bin] = 0;
      continue;
    }
    // MIDI note from frequency
    const midi = 69 + 12 * Math.log2(freq / 440);
    const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
    binPitchClass[bin] = pitchClass;
    binIsRelevant[bin] = 1;
  }

  // Process each frame
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hopSize;

    // Apply window and copy to real array
    for (let i = 0; i < fftSize; i++) {
      real[i] = samples[offset + i] * window[i];
      imag[i] = 0;
    }

    // FFT (in-place, Cooley-Tukey radix-2)
    fft(real, imag, fftSize);

    // Accumulate power into chroma bins
    for (let bin = 1; bin < halfFFT; bin++) {
      if (!binIsRelevant[bin]) continue;
      const power = real[bin] * real[bin] + imag[bin] * imag[bin];
      chroma[binPitchClass[bin]] += power;
    }

    // Yield every 500 frames to avoid blocking
    if (frame % 500 === 0 && frame > 0) {
      // Intentionally synchronous - key detection is fast enough
    }
  }

  // Normalize chroma to sum to 1
  let chromaSum = 0;
  for (let i = 0; i < 12; i++) chromaSum += chroma[i];
  if (chromaSum > 0) {
    for (let i = 0; i < 12; i++) chroma[i] /= chromaSum;
  }

  return chroma;
}

/**
 * Correlate chroma features with Krumhansl-Kessler major and minor
 * profiles for all 12 root notes (24 keys total).
 *
 * Uses Pearson correlation coefficient.
 */
function correlateWithProfiles(
  chroma: Float64Array
): Array<{ key: string; scale: string; correlation: number }> {
  const results: Array<{ key: string; scale: string; correlation: number }> =
    [];

  for (let root = 0; root < 12; root++) {
    // Rotate chroma so that 'root' becomes index 0
    const rotated = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = chroma[(i + root) % 12];
    }

    // Major correlation
    const corrMajor = pearsonCorrelation(rotated, MAJOR_PROFILE);
    results.push({
      key: NOTE_NAMES[root],
      scale: "major",
      correlation: corrMajor,
    });

    // Minor correlation
    const corrMinor = pearsonCorrelation(rotated, MINOR_PROFILE);
    results.push({
      key: NOTE_NAMES[root],
      scale: "minor",
      correlation: corrMinor,
    });
  }

  return results;
}

/**
 * Pearson correlation coefficient between two arrays.
 */
function pearsonCorrelation(
  x: Float64Array | number[],
  y: number[]
): number {
  const n = x.length;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * In-place Cooley-Tukey radix-2 FFT.
 * Operates on arrays of length N (must be power of 2).
 */
function fft(
  real: Float64Array,
  imag: Float64Array,
  n: number
): void {
  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let tmp = real[i];
      real[i] = real[j];
      real[j] = tmp;
      tmp = imag[i];
      imag[i] = imag[j];
      imag[j] = tmp;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computation
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;

      for (let k = 0; k < halfLen; k++) {
        const evenIdx = i + k;
        const oddIdx = i + k + halfLen;

        const tReal = curReal * real[oddIdx] - curImag * imag[oddIdx];
        const tImag = curReal * imag[oddIdx] + curImag * real[oddIdx];

        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] += tReal;
        imag[evenIdx] += tImag;

        const newCurReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = newCurReal;
      }
    }
  }
}

/**
 * Detect BPM from an AudioBuffer using onset detection.
 *
 * Uses spectral flux (energy difference between frames) to find onsets,
 * then auto-correlates the onset signal to find the dominant period.
 */
export async function detectBPM(
  audioBuffer: AudioBuffer,
  options?: {
    minBPM?: number;
    maxBPM?: number;
  }
): Promise<{ bpm: number; confidence: number }> {
  const minBPM = options?.minBPM ?? 50;
  const maxBPM = options?.maxBPM ?? 200;
  const sampleRate = audioBuffer.sampleRate;

  // Get mono audio
  let data: Float32Array;
  if (audioBuffer.numberOfChannels > 1) {
    data = new Float32Array(audioBuffer.length);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < audioBuffer.length; i++) {
        data[i] += channelData[i] / audioBuffer.numberOfChannels;
      }
    }
  } else {
    data = new Float32Array(audioBuffer.getChannelData(0));
  }

  const frameSize = 1024;
  const hopSize = 512;
  const numFrames = Math.floor((data.length - frameSize) / hopSize) + 1;

  if (numFrames < 4) {
    return { bpm: 120, confidence: 0 };
  }

  // ── Compute spectral flux (onset strength) ──
  const onsetStrength = new Float32Array(numFrames);
  let prevSpectrum = new Float32Array(frameSize / 2);

  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hopSize;
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);

    for (let i = 0; i < frameSize; i++) {
      real[i] = data[offset + i] * window[i];
      imag[i] = 0;
    }

    fft(real, imag, frameSize);

    // Magnitude spectrum
    const spectrum = new Float32Array(frameSize / 2);
    for (let i = 0; i < frameSize / 2; i++) {
      spectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }

    // Half-wave rectified spectral flux
    let flux = 0;
    for (let i = 0; i < spectrum.length; i++) {
      const diff = spectrum[i] - prevSpectrum[i];
      if (diff > 0) flux += diff;
    }
    onsetStrength[frame] = flux;
    prevSpectrum = spectrum;
  }

  // ── Auto-correlation of onset strength ──
  const framesPerSec = sampleRate / hopSize;
  const minLag = Math.floor(framesPerSec * (60 / maxBPM));
  const maxLag = Math.ceil(framesPerSec * (60 / minBPM));

  let bestLag = minLag;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= Math.min(maxLag, numFrames - 1); lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < numFrames - lag; i++) {
      corr += onsetStrength[i] * onsetStrength[i + lag];
      count++;
    }
    if (count > 0) corr /= count;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const detectedBPM = (60 * framesPerSec) / bestLag;

  // Normalize BPM to common range (60-180)
  let normalizedBPM = detectedBPM;
  while (normalizedBPM < 60) normalizedBPM *= 2;
  while (normalizedBPM > 180) normalizedBPM /= 2;

  // Round to nearest integer
  normalizedBPM = Math.round(normalizedBPM);

  // Confidence based on autocorrelation peak prominence
  let meanCorr = 0;
  let count = 0;
  for (let lag = minLag; lag <= Math.min(maxLag, numFrames - 1); lag++) {
    let corr = 0;
    let c2 = 0;
    for (let i = 0; i < numFrames - lag; i++) {
      corr += onsetStrength[i] * onsetStrength[i + lag];
      c2++;
    }
    if (c2 > 0) meanCorr += corr / c2;
    count++;
  }
  meanCorr /= count || 1;

  const confidence =
    meanCorr > 0 ? Math.min(1, (bestCorr - meanCorr) / meanCorr) : 0;

  return { bpm: normalizedBPM, confidence: Math.max(0, confidence) };
}
