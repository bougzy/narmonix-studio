"use client";

import {
  MousePointer2,
  Scissors,
  SplitSquareHorizontal,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditorStore } from "@/store/useEditorStore";
import { getAudioEngine } from "@/lib/audioEngine";
import { encodeWAV } from "@/lib/wavEncoder";
import { toast } from "sonner";

export function EditingToolbar() {
  const {
    selectedTrackId,
    tracks,
    editMode,
    selectionRange,
    currentTime,
    setEditMode,
    updateTrack,
    addTrack,
    pushHistory,
    project,
  } = useEditorStore();

  const selectedTrack = tracks.find((t) => t._id === selectedTrackId);

  async function uploadAudioBlob(blob: Blob, fileName: string): Promise<string> {
    const formData = new FormData();
    formData.append("file", blob, fileName);
    formData.append("projectId", project!._id);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");
    const { audioUrl } = await res.json();
    return audioUrl;
  }

  async function replaceTrackAudio(trackId: string, audioBuffer: AudioBuffer) {
    const blob = encodeWAV(audioBuffer);
    const audioUrl = await uploadAudioBlob(blob, "edited_audio.wav");

    // Update track in DB
    await fetch(`/api/tracks/${trackId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioUrl, duration: audioBuffer.duration }),
    });

    // Update store
    updateTrack(trackId, { audioUrl, duration: audioBuffer.duration });

    // Reload in engine
    const engine = getAudioEngine();
    engine.removeTrack(trackId);
    await engine.addTrack(trackId, audioUrl);
  }

  async function handleTrim() {
    if (!selectedTrackId || !selectionRange) return;
    const engine = getAudioEngine();
    const buffer = engine.getBuffer(selectedTrackId);
    if (!buffer) {
      toast.error("Audio not loaded yet");
      return;
    }

    pushHistory();
    const { start, end } = selectionRange;
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.min(Math.floor(end * sampleRate), buffer.length);
    const newLength = endSample - startSample;

    if (newLength <= 0) {
      toast.error("Invalid selection range");
      return;
    }

    const offlineCtx = new OfflineAudioContext(
      buffer.numberOfChannels,
      newLength,
      sampleRate
    );
    const newBuffer = offlineCtx.createBuffer(
      buffer.numberOfChannels,
      newLength,
      sampleRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const sourceData = buffer.getChannelData(ch);
      const destData = newBuffer.getChannelData(ch);
      for (let i = 0; i < newLength; i++) {
        destData[i] = sourceData[startSample + i];
      }
    }

    try {
      await replaceTrackAudio(selectedTrackId, newBuffer);
      toast.success("Track trimmed");
    } catch {
      toast.error("Failed to trim track");
    }
  }

  async function handleCut() {
    if (!selectedTrackId || !selectionRange) return;
    const engine = getAudioEngine();
    const buffer = engine.getBuffer(selectedTrackId);
    if (!buffer) {
      toast.error("Audio not loaded yet");
      return;
    }

    pushHistory();
    const { start, end } = selectionRange;
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.min(Math.floor(end * sampleRate), buffer.length);
    const cutLength = endSample - startSample;
    const newLength = buffer.length - cutLength;

    if (newLength <= 0) {
      toast.error("Cannot cut entire track");
      return;
    }

    const offlineCtx = new OfflineAudioContext(
      buffer.numberOfChannels,
      newLength,
      sampleRate
    );
    const newBuffer = offlineCtx.createBuffer(
      buffer.numberOfChannels,
      newLength,
      sampleRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const sourceData = buffer.getChannelData(ch);
      const destData = newBuffer.getChannelData(ch);
      let destIdx = 0;
      for (let i = 0; i < buffer.length; i++) {
        if (i < startSample || i >= endSample) {
          destData[destIdx++] = sourceData[i];
        }
      }
    }

    try {
      await replaceTrackAudio(selectedTrackId, newBuffer);
      toast.success("Selection cut");
    } catch {
      toast.error("Failed to cut selection");
    }
  }

  async function handleSplit() {
    if (!selectedTrackId || !selectedTrack || !project) return;
    const engine = getAudioEngine();
    const buffer = engine.getBuffer(selectedTrackId);
    if (!buffer) {
      toast.error("Audio not loaded yet");
      return;
    }

    const splitTime = currentTime;
    if (splitTime <= 0 || splitTime >= buffer.duration) {
      toast.error("Move playhead to where you want to split");
      return;
    }

    pushHistory();
    const sampleRate = buffer.sampleRate;
    const splitSample = Math.floor(splitTime * sampleRate);

    // First part
    const firstLength = splitSample;
    const firstCtx = new OfflineAudioContext(buffer.numberOfChannels, firstLength, sampleRate);
    const firstBuffer = firstCtx.createBuffer(buffer.numberOfChannels, firstLength, sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = firstBuffer.getChannelData(ch);
      for (let i = 0; i < firstLength; i++) dst[i] = src[i];
    }

    // Second part
    const secondLength = buffer.length - splitSample;
    const secondCtx = new OfflineAudioContext(buffer.numberOfChannels, secondLength, sampleRate);
    const secondBuffer = secondCtx.createBuffer(buffer.numberOfChannels, secondLength, sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = secondBuffer.getChannelData(ch);
      for (let i = 0; i < secondLength; i++) dst[i] = src[splitSample + i];
    }

    try {
      // Replace original with first part
      await replaceTrackAudio(selectedTrackId, firstBuffer);

      // Create second part as new track
      const blob = encodeWAV(secondBuffer);
      const audioUrl = await uploadAudioBlob(blob, "split_part.wav");

      const trackRes = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project._id,
          name: `${selectedTrack.name} (split)`,
          type: selectedTrack.type,
          audioUrl,
          fileName: "split_part.wav",
          duration: secondBuffer.duration,
        }),
      });

      if (!trackRes.ok) throw new Error("Failed to create split track");
      const newTrack = await trackRes.json();
      addTrack(newTrack);
      await engine.addTrack(newTrack._id, newTrack.audioUrl);

      toast.success("Track split at playhead");
    } catch {
      toast.error("Failed to split track");
    }
  }

  async function handleFade(type: "in" | "out") {
    if (!selectedTrackId || !selectionRange) return;
    const engine = getAudioEngine();
    const buffer = engine.getBuffer(selectedTrackId);
    if (!buffer) {
      toast.error("Audio not loaded yet");
      return;
    }

    pushHistory();
    const { start, end } = selectionRange;
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.min(Math.floor(end * sampleRate), buffer.length);
    const fadeSamples = endSample - startSample;

    // Clone the buffer
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, sampleRate);
    const newBuffer = offlineCtx.createBuffer(buffer.numberOfChannels, buffer.length, sampleRate);

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const sourceData = buffer.getChannelData(ch);
      const destData = newBuffer.getChannelData(ch);

      for (let i = 0; i < buffer.length; i++) {
        if (i >= startSample && i < endSample) {
          const fadePos = (i - startSample) / fadeSamples;
          const gain = type === "in" ? fadePos : 1 - fadePos;
          destData[i] = sourceData[i] * gain;
        } else {
          destData[i] = sourceData[i];
        }
      }
    }

    try {
      await replaceTrackAudio(selectedTrackId, newBuffer);
      toast.success(`Fade ${type} applied`);
    } catch {
      toast.error(`Failed to apply fade ${type}`);
    }
  }

  const hasSelection = !!selectionRange && !!selectedTrackId;

  return (
    <div className="flex items-center gap-1 px-4 py-1 bg-card/50 border-b border-border">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={editMode === "select" ? "default" : "outline"}
            onClick={() => setEditMode(editMode === "select" ? null : "select")}
          >
            <MousePointer2 className="h-3 w-3 mr-1" />
            Select
          </Button>
        </TooltipTrigger>
        <TooltipContent>Select a region on the waveform</TooltipContent>
      </Tooltip>

      <div className="w-px h-5 bg-border mx-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={handleTrim}
            disabled={!hasSelection}
          >
            <Scissors className="h-3 w-3 mr-1" />
            Trim
          </Button>
        </TooltipTrigger>
        <TooltipContent>Keep only the selected region</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCut}
            disabled={!hasSelection}
          >
            <Scissors className="h-3 w-3 mr-1 rotate-90" />
            Cut
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove the selected region</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSplit}
            disabled={!selectedTrackId}
          >
            <SplitSquareHorizontal className="h-3 w-3 mr-1" />
            Split
          </Button>
        </TooltipTrigger>
        <TooltipContent>Split track at playhead position</TooltipContent>
      </Tooltip>

      <div className="w-px h-5 bg-border mx-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleFade("in")}
            disabled={!hasSelection}
          >
            <ArrowUpRight className="h-3 w-3 mr-1" />
            Fade In
          </Button>
        </TooltipTrigger>
        <TooltipContent>Apply fade in to selection</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleFade("out")}
            disabled={!hasSelection}
          >
            <ArrowDownRight className="h-3 w-3 mr-1" />
            Fade Out
          </Button>
        </TooltipTrigger>
        <TooltipContent>Apply fade out to selection</TooltipContent>
      </Tooltip>

      {selectionRange && (
        <span className="ml-2 text-xs text-muted-foreground">
          Selection: {selectionRange.start.toFixed(2)}s - {selectionRange.end.toFixed(2)}s
        </span>
      )}
    </div>
  );
}
