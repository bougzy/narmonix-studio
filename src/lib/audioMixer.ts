import { encodeWAV } from "./wavEncoder";

export interface MixTrack {
  name: string;
  audioUrl: string;
  volume: number;
  pan: number;
  muted: boolean;
}

async function fetchAudioBuffer(
  url: string,
  ctx: OfflineAudioContext | AudioContext
): Promise<AudioBuffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}

export async function mixTracks(
  tracks: MixTrack[],
  onProgress?: (pct: number) => void
): Promise<Blob> {
  const activeTracks = tracks.filter((t) => !t.muted);
  if (activeTracks.length === 0) throw new Error("No active tracks to mix");

  onProgress?.(5);

  // First, decode all audio to get durations and find the longest
  const tempCtx = new AudioContext();
  const buffers: AudioBuffer[] = [];

  for (let i = 0; i < activeTracks.length; i++) {
    const buf = await fetchAudioBuffer(activeTracks[i].audioUrl, tempCtx);
    buffers.push(buf);
    onProgress?.(5 + (40 * (i + 1)) / activeTracks.length);
  }

  const sampleRate = buffers[0].sampleRate;
  const maxLength = Math.max(...buffers.map((b) => b.length));
  const numChannels = 2; // stereo output

  // Create offline context for rendering
  const offlineCtx = new OfflineAudioContext(numChannels, maxLength, sampleRate);

  onProgress?.(50);

  // Add each track with its volume and pan
  for (let i = 0; i < activeTracks.length; i++) {
    const track = activeTracks[i];
    const buffer = buffers[i];

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    // Volume
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = track.volume;

    // Pan
    const panNode = offlineCtx.createStereoPanner();
    panNode.pan.value = track.pan;

    source.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(offlineCtx.destination);

    source.start(0);
  }

  onProgress?.(60);

  // Render
  const renderedBuffer = await offlineCtx.startRendering();

  onProgress?.(85);

  // Encode to WAV
  const blob = encodeWAV(renderedBuffer);

  await tempCtx.close();

  onProgress?.(100);
  return blob;
}

export async function exportSingleTrack(
  audioUrl: string,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  onProgress?.(10);
  const response = await fetch(audioUrl);
  onProgress?.(50);
  const arrayBuffer = await response.arrayBuffer();

  // Decode and re-encode to ensure consistent WAV format
  const tempCtx = new AudioContext();
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();
  onProgress?.(80);

  const blob = encodeWAV(audioBuffer);
  onProgress?.(100);
  return blob;
}
