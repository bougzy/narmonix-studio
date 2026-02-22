"use client";

import * as Tone from "tone";

interface TrackNode {
  player: Tone.Player;
  eq: Tone.EQ3;
  panner: Tone.Panner;
  reverb: Tone.Reverb;
  volume: Tone.Volume;
  solo: Tone.Solo;
}

class AudioEngine {
  private tracks: Map<string, TrackNode> = new Map();
  private isInitialized = false;
  private onTimeUpdate?: (time: number) => void;
  private animationFrameId?: number;

  async init() {
    if (this.isInitialized) return;
    await Tone.start();
    this.isInitialized = true;
  }

  async addTrack(trackId: string, audioUrl: string): Promise<void> {
    await this.init();

    if (this.tracks.has(trackId)) {
      this.removeTrack(trackId);
    }

    const player = new Tone.Player();
    const eq = new Tone.EQ3(0, 0, 0);
    const panner = new Tone.Panner(0);
    const reverb = new Tone.Reverb({ decay: 2, wet: 0 });
    const volume = new Tone.Volume(0);
    const solo = new Tone.Solo();

    player.chain(eq, panner, reverb, volume, solo, Tone.getDestination());
    this.tracks.set(trackId, { player, eq, panner, reverb, volume, solo });

    try {
      await player.load(audioUrl);
      console.log(`Track ${trackId} loaded`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // Fetch was aborted (e.g. component unmounted) - not an error
        return;
      }
      console.error(`Failed to load audio for track ${trackId}:`, e);
      throw e;
    }
  }

  removeTrack(trackId: string) {
    const node = this.tracks.get(trackId);
    if (node) {
      node.player.stop();
      node.player.dispose();
      node.eq.dispose();
      node.panner.dispose();
      node.reverb.dispose();
      node.volume.dispose();
      node.solo.dispose();
      this.tracks.delete(trackId);
    }
  }

  async play() {
    await this.init();
    const now = Tone.now();
    const offset = Tone.getTransport().seconds;

    this.tracks.forEach((node) => {
      if (node.player.loaded) {
        node.player.start(now, offset);
      }
    });

    Tone.getTransport().start();
    this.startTimeTracking();
  }

  pause() {
    Tone.getTransport().pause();
    this.tracks.forEach((node) => {
      if (node.player.state === "started") {
        node.player.stop();
      }
    });
    this.stopTimeTracking();
  }

  stop() {
    Tone.getTransport().stop();
    Tone.getTransport().seconds = 0;
    this.tracks.forEach((node) => {
      if (node.player.state === "started") {
        node.player.stop();
      }
    });
    this.stopTimeTracking();
    this.onTimeUpdate?.(0);
  }

  seekTo(time: number) {
    const wasPlaying = Tone.getTransport().state === "started";
    if (wasPlaying) {
      this.pause();
    }
    Tone.getTransport().seconds = time;
    if (wasPlaying) {
      this.play();
    }
  }

  setVolume(trackId: string, value: number) {
    const node = this.tracks.get(trackId);
    if (node) {
      // Convert 0-1.5 range to dB (-Infinity to +3.5dB)
      const db = value === 0 ? -Infinity : 20 * Math.log10(value);
      node.volume.volume.value = db;
    }
  }

  setPan(trackId: string, value: number) {
    const node = this.tracks.get(trackId);
    if (node) {
      node.panner.pan.value = value;
    }
  }

  setEQ(trackId: string, low: number, mid: number, high: number) {
    const node = this.tracks.get(trackId);
    if (node) {
      node.eq.low.value = low;
      node.eq.mid.value = mid;
      node.eq.high.value = high;
    }
  }

  setReverb(trackId: string, wet: number) {
    const node = this.tracks.get(trackId);
    if (node) {
      node.reverb.wet.value = wet;
    }
  }

  muteTrack(trackId: string, muted: boolean) {
    const node = this.tracks.get(trackId);
    if (node) {
      node.volume.mute = muted;
    }
  }

  soloTrack(trackId: string, solo: boolean) {
    const node = this.tracks.get(trackId);
    if (node) {
      node.solo.solo = solo;
    }
  }

  setOnTimeUpdate(callback: (time: number) => void) {
    this.onTimeUpdate = callback;
  }

  private startTimeTracking() {
    const tick = () => {
      if (Tone.getTransport().state === "started") {
        this.onTimeUpdate?.(Tone.getTransport().seconds);
        this.animationFrameId = requestAnimationFrame(tick);
      }
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  private stopTimeTracking() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }

  getBuffer(trackId: string): AudioBuffer | null {
    const node = this.tracks.get(trackId);
    if (node?.player.loaded) {
      return node.player.buffer.get() as AudioBuffer | null;
    }
    return null;
  }

  getTrackDuration(trackId: string): number {
    const node = this.tracks.get(trackId);
    if (node?.player.loaded) {
      return node.player.buffer.duration;
    }
    return 0;
  }

  getCurrentTime(): number {
    return Tone.getTransport().seconds;
  }

  isTrackLoaded(trackId: string): boolean {
    const node = this.tracks.get(trackId);
    return node?.player.loaded ?? false;
  }

  setBpm(bpm: number) {
    Tone.getTransport().bpm.value = bpm;
  }

  setLoop(enabled: boolean, start = 0, end = 0) {
    Tone.getTransport().loop = enabled;
    if (enabled && end > start) {
      Tone.getTransport().loopStart = start;
      Tone.getTransport().loopEnd = end;
    }
  }

  dispose() {
    this.stop();
    this.tracks.forEach((_, id) => this.removeTrack(id));
    this.tracks.clear();
  }
}

// Singleton
let engineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engineInstance) {
    engineInstance = new AudioEngine();
  }
  return engineInstance;
}

export type { AudioEngine };
