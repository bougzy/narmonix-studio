"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Upload, Sliders, Download, Music, FileText, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditorStore } from "@/store/useEditorStore";
import { getAudioEngine } from "@/lib/audioEngine";
import { TransportBar } from "./TransportBar";
import { Timeline } from "./Timeline";
import { TrackLane } from "./TrackLane";
import { MixerPanel } from "./MixerPanel";
import { AudioRecorder } from "./AudioRecorder";
import { HarmonyPanel } from "./HarmonyPanel";
import { EditingToolbar } from "./EditingToolbar";
import { ExportModal } from "./ExportModal";
import { SolfaNotationModal } from "./SolfaNotationModal";
import { HarmonyModal } from "./HarmonyModal";
import { toast } from "sonner";
import { IProject, ITrack } from "@/types";

interface DAWEditorProps {
  project: IProject;
  initialTracks: ITrack[];
}

export function DAWEditor({ project, initialTracks }: DAWEditorProps) {
  const {
    tracks,
    setProject,
    setTracks,
    addTrack,
    reorderTracks,
    setCurrentTime,
    setPlaying,
    isPlaying,
    isRecording,
  } = useEditorStore();

  const [showMixer, setShowMixer] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSolfa, setShowSolfa] = useState(false);
  const [showHarmony, setShowHarmony] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Initialize
  useEffect(() => {
    setProject(project);
    setTracks(initialTracks);

    const engine = getAudioEngine();
    engine.setOnTimeUpdate(setCurrentTime);
    engine.setBpm(project.bpm);

    // Load tracks into audio engine
    let disposed = false;
    async function loadAllTracks() {
      for (const track of initialTracks) {
        if (disposed) return;
        try {
          await engine.addTrack(track._id, track.audioUrl);
          if (disposed) return;
          engine.setVolume(track._id, track.volume);
          engine.setPan(track._id, track.pan);
          engine.setEQ(track._id, track.eq.low, track.eq.mid, track.eq.high);
          engine.setReverb(track._id, track.reverb);
          engine.muteTrack(track._id, track.muted);
          engine.soloTrack(track._id, track.solo);
        } catch (e) {
          if (disposed) return;
          console.error(`Failed to load track ${track.name}:`, e);
        }
      }
    }
    loadAllTracks();

    return () => {
      disposed = true;
      engine.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        const engine = getAudioEngine();
        if (isPlaying) {
          engine.pause();
          setPlaying(false);
        } else {
          engine.play();
          setPlaying(true);
        }
      }

      if (e.code === "KeyR" && !isRecording) {
        e.preventDefault();
        setShowRecorder(true);
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.code === "KeyZ") {
          e.preventDefault();
          useEditorStore.getState().undo();
        }
        if (e.code === "KeyY") {
          e.preventDefault();
          useEditorStore.getState().redo();
        }
        if (e.code === "KeyS") {
          e.preventDefault();
          handleSave();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, isRecording, setPlaying]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        reorderTracks(active.id as string, over.id as string);
      }
    },
    [reorderTracks]
  );

  async function handleSave() {
    try {
      // Save track states
      for (const track of tracks) {
        await fetch(`/api/tracks/${track._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            volume: track.volume,
            pan: track.pan,
            muted: track.muted,
            solo: track.solo,
            eq: track.eq,
            reverb: track.reverb,
            order: track.order,
            name: track.name,
          }),
        });
      }
    } catch {
      toast.error("Failed to save");
    }
  }

  async function handleFileUpload(files: FileList) {
    const allowedTypes = [
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/mp3",
      "audio/mpeg",
      "audio/ogg",
      "audio/flac",
      "audio/webm",
      "application/octet-stream", // Some browsers/OS report this for audio files
    ];

    const allowedExtensions = [".wav", ".mp3", ".ogg", ".flac", ".webm", ".m4a", ".aac"];

    for (const file of Array.from(files)) {
      const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
      const typeOk = allowedTypes.includes(file.type) || allowedExtensions.includes(ext);

      if (!typeOk) {
        toast.error(`Unsupported format: ${file.name}`);
        continue;
      }

      if (file.size > 25 * 1024 * 1024) {
        toast.error(`File too large (max 25MB): ${file.name}`);
        continue;
      }

      try {
        toast.loading(`Uploading ${file.name}...`, { id: file.name });

        // Upload file via FormData
        const formData = new FormData();
        formData.append("file", file);
        formData.append("projectId", project._id);

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(err.message || "Upload failed");
        }
        const { audioUrl } = await uploadRes.json();

        // Get duration from audio
        const blobUrl = URL.createObjectURL(file);
        const audio = new Audio(blobUrl);
        const duration = await new Promise<number>((resolve) => {
          audio.addEventListener("loadedmetadata", () => {
            resolve(audio.duration);
            URL.revokeObjectURL(blobUrl);
          });
          audio.addEventListener("error", () => {
            resolve(0);
            URL.revokeObjectURL(blobUrl);
          });
        });

        // Create track
        const trackRes = await fetch("/api/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project._id,
            name: file.name.replace(/\.[^.]+$/, ""),
            type: "vocal",
            audioUrl,
            fileName: file.name,
            duration,
          }),
        });

        if (!trackRes.ok) throw new Error("Failed to create track");
        const track = await trackRes.json();
        addTrack(track);

        // Load into audio engine
        await getAudioEngine().addTrack(track._id, track.audioUrl);

        toast.success(`Uploaded ${file.name}`, { id: file.name });
      } catch (error) {
        toast.error(
          `Failed to upload ${file.name}: ${error instanceof Error ? error.message : ""}`,
          { id: file.name }
        );
      }
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Transport Bar */}
      <TransportBar
        onRecord={() => setShowRecorder(true)}
        onSave={handleSave}
      />

      {/* Action Bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-card/50 border-b border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3 w-3 mr-1" />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
        />

        <Button
          variant={showMixer ? "default" : "outline"}
          size="sm"
          onClick={() => setShowMixer(!showMixer)}
        >
          <Sliders className="h-3 w-3 mr-1" />
          Mixer
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowExport(true)}
          disabled={tracks.length === 0}
        >
          <Download className="h-3 w-3 mr-1" />
          Export
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSolfa(true)}
          disabled={tracks.length === 0}
        >
          <FileText className="h-3 w-3 mr-1" />
          Solfa Sheet
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowHarmony(true)}
          disabled={tracks.filter((t) => t.type === "harmony").length === 0}
        >
          <Headphones className="h-3 w-3 mr-1" />
          Harmonies
        </Button>
      </div>

      {/* Editing Toolbar */}
      <EditingToolbar />

      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Timeline */}
          <Timeline />

          {/* Track List */}
          <ScrollArea
            className="flex-1"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={tracks.map((t) => t._id)}
                strategy={verticalListSortingStrategy}
              >
                {tracks.map((track) => (
                  <TrackLane key={track._id} track={track} />
                ))}
              </SortableContext>
            </DndContext>

            {/* Empty State / Drop Zone */}
            {tracks.length === 0 && (
              <div
                className={`flex flex-col items-center justify-center py-20 ${
                  isDragOver
                    ? "bg-primary/10 border-2 border-dashed border-primary"
                    : ""
                }`}
              >
                <Music className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No tracks yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Drag & drop audio files here, or use the buttons above
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Audio
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowRecorder(true)}
                  >
                    Record
                  </Button>
                </div>
              </div>
            )}

            {/* Drag Over Indicator */}
            {isDragOver && tracks.length > 0 && (
              <div className="p-8 border-2 border-dashed border-primary bg-primary/5 text-center text-primary">
                Drop audio files here to add tracks
              </div>
            )}
          </ScrollArea>

          {/* Harmony Panel */}
          <HarmonyPanel onHarmoniesGenerated={() => setShowHarmony(true)} />
        </div>

        {/* Mixer Panel */}
        <MixerPanel open={showMixer} onClose={() => setShowMixer(false)} />
      </div>

      {/* Modals */}
      <AudioRecorder
        open={showRecorder}
        onOpenChange={setShowRecorder}
        projectId={project._id}
      />
      <ExportModal open={showExport} onOpenChange={setShowExport} />
      <SolfaNotationModal open={showSolfa} onOpenChange={setShowSolfa} />
      <HarmonyModal open={showHarmony} onOpenChange={setShowHarmony} />
    </div>
  );
}
