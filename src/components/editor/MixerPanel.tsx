"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditorStore } from "@/store/useEditorStore";
import { getAudioEngine } from "@/lib/audioEngine";
import { ITrack } from "@/types";

interface MixerPanelProps {
  open: boolean;
  onClose: () => void;
}

export function MixerPanel({ open, onClose }: MixerPanelProps) {
  const { tracks, updateTrack } = useEditorStore();
  const engine = getAudioEngine();

  if (!open) return null;

  return (
    <div className="w-80 border-l border-border bg-card flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Mixer</h3>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {tracks.map((track) => (
            <MixerChannel
              key={track._id}
              track={track}
              onUpdate={(updates) => {
                updateTrack(track._id, updates);
                if (updates.volume !== undefined) engine.setVolume(track._id, updates.volume);
                if (updates.pan !== undefined) engine.setPan(track._id, updates.pan);
                if (updates.reverb !== undefined) engine.setReverb(track._id, updates.reverb);
                if (updates.eq) {
                  engine.setEQ(track._id, updates.eq.low, updates.eq.mid, updates.eq.high);
                }
              }}
            />
          ))}
          {tracks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tracks to mix
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function MixerChannel({
  track,
  onUpdate,
}: {
  track: ITrack;
  onUpdate: (updates: Partial<ITrack>) => void;
}) {
  const harmonyColors: Record<string, string> = {
    soprano: "text-blue-400",
    alto: "text-green-400",
    tenor: "text-orange-400",
    bass: "text-red-400",
  };

  const nameColor = track.harmonyPart
    ? harmonyColors[track.harmonyPart] || ""
    : "";

  return (
    <div className="space-y-3">
      <h4 className={`text-sm font-medium truncate ${nameColor}`}>
        {track.name}
      </h4>

      {/* Volume */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Volume</Label>
          <span className="text-xs text-muted-foreground">
            {Math.round(track.volume * 100)}%
          </span>
        </div>
        <Slider
          value={[track.volume]}
          min={0}
          max={1.5}
          step={0.01}
          onValueChange={([v]) => onUpdate({ volume: v })}
        />
      </div>

      {/* Pan */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Pan</Label>
          <span className="text-xs text-muted-foreground">
            {track.pan === 0
              ? "C"
              : track.pan < 0
              ? `L${Math.round(Math.abs(track.pan) * 100)}`
              : `R${Math.round(track.pan * 100)}`}
          </span>
        </div>
        <Slider
          value={[track.pan]}
          min={-1}
          max={1}
          step={0.01}
          onValueChange={([v]) => onUpdate({ pan: v })}
        />
      </div>

      {/* EQ */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">EQ</Label>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground block text-center">
              Low
            </span>
            <Slider
              orientation="vertical"
              value={[track.eq.low]}
              min={-12}
              max={12}
              step={0.5}
              className="h-16 mx-auto"
              onValueChange={([v]) =>
                onUpdate({ eq: { ...track.eq, low: v } })
              }
            />
            <span className="text-[10px] text-muted-foreground block text-center">
              {track.eq.low > 0 ? "+" : ""}
              {track.eq.low}
            </span>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground block text-center">
              Mid
            </span>
            <Slider
              orientation="vertical"
              value={[track.eq.mid]}
              min={-12}
              max={12}
              step={0.5}
              className="h-16 mx-auto"
              onValueChange={([v]) =>
                onUpdate({ eq: { ...track.eq, mid: v } })
              }
            />
            <span className="text-[10px] text-muted-foreground block text-center">
              {track.eq.mid > 0 ? "+" : ""}
              {track.eq.mid}
            </span>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground block text-center">
              High
            </span>
            <Slider
              orientation="vertical"
              value={[track.eq.high]}
              min={-12}
              max={12}
              step={0.5}
              className="h-16 mx-auto"
              onValueChange={([v]) =>
                onUpdate({ eq: { ...track.eq, high: v } })
              }
            />
            <span className="text-[10px] text-muted-foreground block text-center">
              {track.eq.high > 0 ? "+" : ""}
              {track.eq.high}
            </span>
          </div>
        </div>
      </div>

      {/* Reverb */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Reverb</Label>
          <span className="text-xs text-muted-foreground">
            {Math.round(track.reverb * 100)}%
          </span>
        </div>
        <Slider
          value={[track.reverb]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={([v]) => onUpdate({ reverb: v })}
        />
      </div>

      <Separator />
    </div>
  );
}
