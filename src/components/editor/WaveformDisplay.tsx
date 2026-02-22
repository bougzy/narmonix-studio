"use client";

import { useEffect, useRef, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import { useEditorStore } from "@/store/useEditorStore";

const HARMONY_COLORS: Record<string, string> = {
  soprano: "#3b82f6",
  alto: "#22c55e",
  tenor: "#f97316",
  bass: "#ef4444",
};

interface WaveformDisplayProps {
  trackId: string;
  audioUrl: string;
  harmonyPart?: string | null;
  isSelected: boolean;
}

export function WaveformDisplay({
  trackId,
  audioUrl,
  harmonyPart,
  isSelected,
}: WaveformDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const { zoom, currentTime, isPlaying, editMode, setSelectionRange } =
    useEditorStore();

  const waveColor = harmonyPart
    ? HARMONY_COLORS[harmonyPart] || "#6366f1"
    : "#6366f1";

  const handleRegionUpdate = useCallback(
    (region: { start: number; end: number }) => {
      setSelectionRange({ start: region.start, end: region.end });
    },
    [setSelectionRange]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: waveColor,
      progressColor: `${waveColor}80`,
      cursorColor: "transparent",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: isSelected ? 140 : 60,
      normalize: true,
      interact: true,
      backend: "WebAudio",
    });

    const regions = ws.registerPlugin(RegionsPlugin.create());
    regionsRef.current = regions;

    regions.enableDragSelection({
      color: "rgba(99, 102, 241, 0.2)",
    });

    regions.on("region-created", (region) => {
      // Only keep the latest region
      regions.getRegions().forEach((r) => {
        if (r.id !== region.id) r.remove();
      });
      handleRegionUpdate(region);
    });

    regions.on("region-updated", (region) => {
      handleRegionUpdate(region);
    });

    wavesurferRef.current = ws;

    ws.load(audioUrl).catch((err: unknown) => {
      // AbortError is expected when component unmounts during load
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(`WaveSurfer failed to load ${audioUrl}:`, err);
    });

    return () => {
      ws.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, trackId]);

  // Update interaction mode based on editMode
  useEffect(() => {
    if (regionsRef.current) {
      if (editMode === "select" && isSelected) {
        regionsRef.current.enableDragSelection({
          color: "rgba(99, 102, 241, 0.2)",
        });
      }
    }
  }, [editMode, isSelected]);

  // Update height on selection change
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setOptions({
        height: isSelected ? 140 : 60,
      });
    }
  }, [isSelected]);

  // Sync progress
  useEffect(() => {
    if (wavesurferRef.current && !isPlaying) {
      const duration = wavesurferRef.current.getDuration();
      if (duration > 0) {
        wavesurferRef.current.seekTo(Math.min(currentTime / duration, 1));
      }
    }
  }, [currentTime, isPlaying]);

  return (
    <div
      ref={containerRef}
      className="waveform-container flex-1"
      style={{
        minWidth: `${(zoom || 1) * 100}%`,
      }}
    />
  );
}
