"use client";

import { useState } from "react";
import { Download, Loader2, FileAudio, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEditorStore } from "@/store/useEditorStore";
import { mixTracks, exportSingleTrack } from "@/lib/audioMixer";
import { toast } from "sonner";

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportModal({ open, onOpenChange }: ExportModalProps) {
  const { project, tracks } = useEditorStore();
  const [format, setFormat] = useState<"wav" | "mp3">("wav");
  const [quality, setQuality] = useState<"standard" | "high">("high");
  const [exportType, setExportType] = useState<
    "full-mix" | "individual" | "stems"
  >("full-mix");
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    if (!project) return;

    setIsExporting(true);
    setProgress(0);

    try {
      if (exportType === "full-mix") {
        const mixableTracks = tracks.map((t) => ({
          name: t.name,
          audioUrl: t.audioUrl,
          volume: t.volume,
          pan: t.pan,
          muted: t.muted,
        }));

        const blob = await mixTracks(mixableTracks, setProgress);
        downloadBlob(blob, `${project.name}_mix.${format}`);
      } else if (exportType === "individual" && selectedTrackId) {
        const track = tracks.find((t) => t._id === selectedTrackId);
        if (!track) throw new Error("Track not found");

        const blob = await exportSingleTrack(track.audioUrl, setProgress);
        downloadBlob(blob, `${track.name}.${format}`);
      } else if (exportType === "stems") {
        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];
          if (track.muted) continue;

          const blob = await exportSingleTrack(track.audioUrl, (pct) =>
            setProgress(((i + pct / 100) / tracks.length) * 100)
          );
          downloadBlob(blob, `${project.name}_${track.name}.${format}`);
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      setProgress(100);
      toast.success("Export complete!");

      setTimeout(() => {
        onOpenChange(false);
        setProgress(0);
      }, 1000);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Audio
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Export Type */}
          <div className="space-y-2">
            <Label>Export Type</Label>
            <Select
              value={exportType}
              onValueChange={(v) =>
                setExportType(v as "full-mix" | "individual" | "stems")
              }
              disabled={isExporting}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full-mix">
                  <span className="flex items-center gap-2">
                    <FileAudio className="h-4 w-4" />
                    Full Mix (all tracks merged)
                  </span>
                </SelectItem>
                <SelectItem value="individual">
                  <span className="flex items-center gap-2">
                    <FileAudio className="h-4 w-4" />
                    Individual Track
                  </span>
                </SelectItem>
                <SelectItem value="stems">
                  <span className="flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Stems (separate files)
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Track Selection for Individual */}
          {exportType === "individual" && (
            <div className="space-y-2">
              <Label>Select Track</Label>
              <Select
                value={selectedTrackId}
                onValueChange={setSelectedTrackId}
                disabled={isExporting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a track..." />
                </SelectTrigger>
                <SelectContent>
                  {tracks.map((track) => (
                    <SelectItem key={track._id} value={track._id}>
                      {track.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Format */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Format</Label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as "wav" | "mp3")}
                disabled={isExporting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wav">WAV</SelectItem>
                  <SelectItem value="mp3">MP3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quality</Label>
              <Select
                value={quality}
                onValueChange={(v) =>
                  setQuality(v as "standard" | "high")
                }
                disabled={isExporting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">
                    Standard {format === "mp3" ? "(128kbps)" : "(16-bit)"}
                  </SelectItem>
                  <SelectItem value="high">
                    High {format === "mp3" ? "(320kbps)" : "(24-bit)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Progress */}
          {isExporting && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground text-center">
                {progress < 30
                  ? "Preparing..."
                  : progress < 90
                  ? "Processing audio..."
                  : "Finalizing..."}
              </p>
            </div>
          )}

          <Button
            onClick={handleExport}
            disabled={
              isExporting ||
              (exportType === "individual" && !selectedTrackId)
            }
            className="w-full"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {isExporting ? "Exporting..." : "Export"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
