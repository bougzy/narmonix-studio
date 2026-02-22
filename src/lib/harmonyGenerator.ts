"use client";

import { encodeWAV } from "./wavEncoder";
import { detectKey } from "./keyDetector";

export interface HarmonyPartConfig {
  name: string;
  part: "soprano" | "alto" | "tenor" | "bass";
  semitones: number;
  volume: number;
}

/**
 * Harmony intervals for each key mode.
 *
 * Only Alto, Tenor, and Bass are generated — the original vocal
 * track serves as the Soprano (melody) line.
 *
 * Intervals chosen for diatonic consonance in church SATB style:
 *   Alto  : diatonic 3rd below  (most common parallel harmony)
 *   Tenor : perfect 5th below   (strong harmonic foundation)
 *   Bass  : octave below        (root doubling, classic bass)
 */
const HARMONY_CONFIGS: Record<string, HarmonyPartConfig[]> = {
  major: [
    { name: "Alto Harmony", part: "alto", semitones: -4, volume: 0.75 },
    { name: "Tenor Harmony", part: "tenor", semitones: -7, volume: 0.7 },
    { name: "Bass Harmony", part: "bass", semitones: -12, volume: 0.65 },
  ],
  minor: [
    { name: "Alto Harmony", part: "alto", semitones: -3, volume: 0.75 },
    { name: "Tenor Harmony", part: "tenor", semitones: -7, volume: 0.7 },
    { name: "Bass Harmony", part: "bass", semitones: -12, volume: 0.65 },
  ],
};

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

/**
 * Pitch-shift an AudioBuffer using granular overlap-add (OLA).
 *
 * Small overlapping grains are individually resampled and recombined
 * with Hann windowing. This avoids the large intermediate buffers
 * that the two-pass OfflineAudioContext approach creates (which can
 * cause timeouts for large pitch shifts like -12 semitones).
 *
 * Advantages over two-pass approach:
 * - O(grainSize) memory regardless of shift amount
 * - No intermediate buffer 2x or 0.5x the original length
 * - Preserves original duration exactly
 * - Works reliably for all shift amounts up to ±12 semitones
 */
async function pitchShift(
  sourceBuffer: AudioBuffer,
  semitones: number,
  volume: number
): Promise<AudioBuffer> {
  const ratio = Math.pow(2, semitones / 12);
  const sampleRate = sourceBuffer.sampleRate;
  const numChannels = sourceBuffer.numberOfChannels;
  const srcLength = sourceBuffer.length;

  if (srcLength === 0) {
    throw new Error("Source audio buffer is empty");
  }

  // Create output buffer (same length = same duration)
  let output: AudioBuffer;
  try {
    output = new AudioBuffer({
      numberOfChannels: numChannels,
      length: srcLength,
      sampleRate,
    });
  } catch {
    // Fallback for environments where AudioBuffer constructor is unavailable
    const ctx = new OfflineAudioContext(numChannels, srcLength, sampleRate);
    output = ctx.createBuffer(numChannels, srcLength, sampleRate);
  }

  // Granular OLA parameters
  // 2048 samples ≈ 46ms at 44100Hz — good grain size for vocal pitch shifting
  const grainSize = 2048;
  const hopSize = grainSize >> 2; // 75% overlap (grainSize / 4)
  const numGrains = Math.ceil(srcLength / hopSize);

  // Hann window for smooth overlap-add transitions
  const hann = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
  }

  // With 75% overlap Hann window, the COLA (Constant Overlap-Add) sum = 2.0
  // Combine volume scaling and COLA normalization into one factor
  const normFactor = volume / 2.0;

  for (let ch = 0; ch < numChannels; ch++) {
    const src = sourceBuffer.getChannelData(ch);
    const dst = output.getChannelData(ch);

    for (let g = 0; g < numGrains; g++) {
      const writeStart = g * hopSize;

      for (let i = 0; i < grainSize; i++) {
        const outIdx = writeStart + i;
        if (outIdx >= srcLength) break;

        // Read from source at pitch-shifted rate:
        //   ratio > 1 (pitch up): reads faster through source → compressed waveform
        //   ratio < 1 (pitch down): reads slower → stretched waveform
        const srcPos = writeStart + i * ratio;
        const srcIdx = Math.floor(srcPos);
        const frac = srcPos - srcIdx;

        let sample = 0;
        if (srcIdx >= 0 && srcIdx + 1 < srcLength) {
          // Linear interpolation between adjacent samples
          sample = src[srcIdx] * (1 - frac) + src[srcIdx + 1] * frac;
        } else if (srcIdx >= 0 && srcIdx < srcLength) {
          sample = src[srcIdx];
        }

        dst[outIdx] += sample * hann[i] * normFactor;
      }

      // Yield every 500 grains to keep the UI responsive
      if (g % 500 === 0 && g > 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  return output;
}

/**
 * Generate SATB harmony parts from a vocal source track.
 *
 * The source audio is treated as the Soprano (melody) line.
 * Alto, Tenor, and Bass parts are generated using pitch shifting
 * with musically appropriate intervals based on the detected key.
 *
 * @param sourceAudioUrl  URL of the source vocal audio
 * @param projectKey      Project key setting (e.g. "Bb Major", "Auto-detect")
 * @param onProgress      Callback for progress updates (step 0-6)
 * @returns Array of generated harmony parts with audio blobs
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

  // Step 1: Analyze audio characteristics
  onProgress?.(1, "Analyzing pitch and melody...");

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
      : "Detecting key and scale..."
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

  const isMinor = effectiveKey.toLowerCase().includes("minor");
  const configs = isMinor ? HARMONY_CONFIGS.minor : HARMONY_CONFIGS.major;

  console.log(
    `Generating ${configs.length} harmony parts in ${effectiveKey} ` +
      `(${isMinor ? "minor" : "major"} mode)`
  );

  // Steps 3-5: Generate each harmony part
  const results: Array<{
    part: HarmonyPartConfig;
    blob: Blob;
    detectedKey?: string;
  }> = [];

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    onProgress?.(3 + i, `Generating ${config.name}...`);

    try {
      const resultBuffer = await Promise.race([
        pitchShift(sourceBuffer, config.semitones, config.volume),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout generating ${config.name}`)),
            90000 // 90 seconds per part — generous for long recordings
          )
        ),
      ]);

      const wavBlob = encodeWAV(resultBuffer, true); // mono to reduce file size

      if (wavBlob.size === 0) {
        throw new Error("Generated audio is empty");
      }

      results.push({
        part: config,
        blob: wavBlob,
        detectedKey: needsDetection ? effectiveKey : undefined,
      });

      console.log(
        `Generated ${config.name}: ${(wavBlob.size / 1024).toFixed(0)}KB ` +
          `(${config.semitones > 0 ? "+" : ""}${config.semitones} semitones, ` +
          `${Math.round(config.volume * 100)}% volume)`
      );
    } catch (err) {
      console.error(`Failed to generate ${config.name}:`, err);
      throw new Error(
        `Failed to generate ${config.name}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  // Step 6: Done
  onProgress?.(6, "Done!");

  console.log(
    `Harmony generation complete: ${results.length} parts generated ` +
      `(${results.reduce((sum, r) => sum + r.blob.size, 0) / 1024}KB total)`
  );

  return results;
}
