"use client";

import { useRef, useCallback } from "react";
import { useEditorStore } from "@/store/useEditorStore";
import { getAudioEngine } from "@/lib/audioEngine";

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms}`;
}

export function Timeline() {
  const { currentTime, zoom, tracks, setCurrentTime } = useEditorStore();
  const timelineRef = useRef<HTMLDivElement>(null);

  const maxDuration = Math.max(
    ...tracks.map((t) => t.duration || 0),
    30
  );

  const totalWidth = maxDuration * 50 * zoom;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
      const time = x / (50 * zoom);
      setCurrentTime(time);
      getAudioEngine().seekTo(time);
    },
    [zoom, setCurrentTime]
  );

  const markers = [];
  const interval = zoom >= 2 ? 1 : zoom >= 0.5 ? 5 : 10;
  for (let i = 0; i <= maxDuration; i += interval) {
    markers.push(
      <div
        key={i}
        className="absolute top-0 h-full border-l border-border/30 text-[10px] text-muted-foreground pl-1"
        style={{ left: `${i * 50 * zoom}px` }}
      >
        {formatTime(i)}
      </div>
    );
  }

  const playheadPosition = currentTime * 50 * zoom;

  return (
    <div
      ref={timelineRef}
      className="relative h-8 bg-card border-b border-border overflow-x-auto cursor-pointer select-none"
      onClick={handleClick}
    >
      <div className="relative h-full" style={{ width: `${totalWidth}px` }}>
        {markers}
        {/* Playhead */}
        <div
          className="absolute top-0 h-full w-0.5 bg-primary z-10 pointer-events-none"
          style={{ left: `${playheadPosition}px` }}
        >
          <div className="w-3 h-3 bg-primary -ml-[5px] -mt-0.5 rotate-45 rounded-sm" />
        </div>
      </div>
    </div>
  );
}
