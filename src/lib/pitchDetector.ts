"use client";

import { PitchFrame } from "@/types";

const DEFAULT_FRAME_SIZE = 2048;
const DEFAULT_HOP_SIZE = 512;    // Finer resolution (was 1024)
const YIN_THRESHOLD = 0.3;       // More permissive (was 0.15; higher = accepts more)
const MIN_FREQUENCY = 80;        // C2-ish (raw detection floor)
const MAX_FREQUENCY = 1100;      // C6
const VOCAL_MIN_FREQ = 130;      // Below this, apply octave correction (C3)
const VOCAL_MAX_FREQ = 900;      // Above this, apply octave correction down
const SILENCE_THRESHOLD = 0.001; // RMS below this = silence (very low to catch quiet singing)
const YIELD_INTERVAL = 200;

/**
 * Detect pitch from an AudioBuffer using the YIN algorithm.
 *
 * Improvements over basic YIN:
 *   - Mono downmix for stereo audio
 *   - Energy-based silence gating (no false positives in quiet sections)
 *   - Octave correction (YIN commonly detects sub-harmonics)
 *   - More permissive threshold to catch quieter pitched content
 */
export async function detectPitch(
  audioBuffer: AudioBuffer,
  frameSize: number = DEFAULT_FRAME_SIZE,
  hopSize: number = DEFAULT_HOP_SIZE
): Promise<PitchFrame[]> {
  // Mono downmix if stereo (avoids empty-channel issues)
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
    data = audioBuffer.getChannelData(0);
  }

  const sampleRate = audioBuffer.sampleRate;
  const frames: PitchFrame[] = [];

  const minLag = Math.floor(sampleRate / MAX_FREQUENCY);
  const maxLag = Math.floor(sampleRate / MIN_FREQUENCY);
  const halfSize = Math.floor(frameSize / 2);

  let frameCount = 0;

  for (let start = 0; start + frameSize < data.length; start += hopSize) {
    const time = start / sampleRate;
    const frame = data.subarray(start, start + frameSize);

    // ── Energy check: skip silent frames ──
    let rms = 0;
    for (let i = 0; i < frame.length; i++) {
      rms += frame[i] * frame[i];
    }
    rms = Math.sqrt(rms / frame.length);

    if (rms < SILENCE_THRESHOLD) {
      frames.push({ time, frequency: 0, confidence: 0 });
      frameCount++;
      if (frameCount % YIELD_INTERVAL === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
      continue;
    }

    // ── Step 1: Difference function ──
    const diff = new Float32Array(halfSize);
    for (let tau = 0; tau < halfSize; tau++) {
      let sum = 0;
      for (let j = 0; j < halfSize; j++) {
        const delta = frame[j] - frame[j + tau];
        sum += delta * delta;
      }
      diff[tau] = sum;
    }

    // ── Step 2: Cumulative mean normalized difference ──
    const cmndf = new Float32Array(halfSize);
    cmndf[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < halfSize; tau++) {
      runningSum += diff[tau];
      cmndf[tau] = runningSum === 0 ? 1 : (diff[tau] * tau) / runningSum;
    }

    // ── Step 3: Absolute threshold - find first dip ──
    let bestTau = -1;
    for (let tau = minLag; tau < Math.min(maxLag, halfSize); tau++) {
      if (cmndf[tau] < YIN_THRESHOLD) {
        // Walk to the local minimum
        while (tau + 1 < halfSize && cmndf[tau + 1] < cmndf[tau]) {
          tau++;
        }
        bestTau = tau;
        break;
      }
    }

    // If strict threshold found nothing, try the global minimum in lag range
    if (bestTau === -1) {
      let globalMinVal = Infinity;
      let globalMinTau = -1;
      for (let tau = minLag; tau < Math.min(maxLag, halfSize); tau++) {
        if (cmndf[tau] < globalMinVal) {
          globalMinVal = cmndf[tau];
          globalMinTau = tau;
        }
      }
      // Accept if the global minimum is reasonably low (< 0.5)
      if (globalMinTau !== -1 && globalMinVal < 0.5) {
        bestTau = globalMinTau;
      }
    }

    if (bestTau === -1) {
      // No pitch found despite audio energy → mark as low-confidence
      frames.push({ time, frequency: 0, confidence: 0 });
    } else {
      // ── Step 4: Parabolic interpolation ──
      const s0 = bestTau > 0 ? cmndf[bestTau - 1] : cmndf[bestTau];
      const s1 = cmndf[bestTau];
      const s2 =
        bestTau + 1 < halfSize ? cmndf[bestTau + 1] : cmndf[bestTau];
      const denominator = 2 * (s0 - 2 * s1 + s2);
      const shift =
        denominator !== 0 && isFinite((s0 - s2) / denominator)
          ? (s0 - s2) / denominator
          : 0;
      const refinedTau = bestTau + shift;

      let frequency = sampleRate / refinedTau;
      const confidence = Math.max(0, Math.min(1, 1 - s1));

      // ── Octave correction ──
      // YIN commonly detects sub-harmonics (half the actual frequency).
      // If below typical vocal range, double until in range.
      if (frequency > 0 && frequency < VOCAL_MIN_FREQ) {
        while (frequency < VOCAL_MIN_FREQ) {
          frequency *= 2;
        }
      }
      // If above typical vocal range, halve
      if (frequency > VOCAL_MAX_FREQ) {
        while (frequency > VOCAL_MAX_FREQ) {
          frequency /= 2;
        }
      }

      // Final range check
      if (frequency >= MIN_FREQUENCY && frequency <= MAX_FREQUENCY) {
        frames.push({ time, frequency, confidence });
      } else {
        frames.push({ time, frequency: 0, confidence: 0 });
      }
    }

    frameCount++;
    if (frameCount % YIELD_INTERVAL === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return frames;
}
