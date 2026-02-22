"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useEditorStore } from "@/store/useEditorStore";
import { toast } from "sonner";

interface AudioRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function AudioRecorder({
  open,
  onOpenChange,
  projectId,
}: AudioRecorderProps) {
  const { addTrack, setRecording } = useEditorStore();
  const [state, setState] = useState<
    "idle" | "countdown" | "recording" | "uploading"
  >("idle");
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const cleanup = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current = null;
    analyserRef.current = null;
    chunksRef.current = [];
    setState("idle");
    setCountdown(3);
    setElapsed(0);
    setLevel(0);
    setRecording(false);
  }, [setRecording]);

  useEffect(() => {
    if (!open) cleanup();
  }, [open, cleanup]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up analyser for level meter
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Countdown
      setState("countdown");
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Start recording
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        audioContext.close();
        await handleUpload();
      };

      mediaRecorder.start(100);
      startTimeRef.current = Date.now();
      setState("recording");
      setRecording(true);

      // Elapsed timer
      timerRef.current = setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      }, 100);

      // Level meter animation
      const updateLevel = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setLevel(avg / 255);
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch {
      toast.error("Microphone access denied");
      cleanup();
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setState("uploading");
    setRecording(false);
  }

  async function handleUpload() {
    setState("uploading");

    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const fileName = `recording_${Date.now()}.webm`;

      // Upload via FormData
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("projectId", projectId);

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) throw new Error("Failed to upload recording");
      const { audioUrl } = await uploadRes.json();

      // Create track record
      const trackRes = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: `Recording ${new Date().toLocaleTimeString()}`,
          type: "vocal",
          audioUrl,
          fileName,
          duration: elapsed,
        }),
      });

      if (!trackRes.ok) throw new Error("Failed to create track");
      const track = await trackRes.json();
      addTrack(track);

      toast.success("Recording saved!");
      onOpenChange(false);
    } catch {
      toast.error("Failed to save recording");
    } finally {
      cleanup();
    }
  }

  function formatElapsed(secs: number) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Audio</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-4">
          {state === "idle" && (
            <>
              <div className="h-24 w-24 rounded-full bg-destructive/10 flex items-center justify-center">
                <Mic className="h-12 w-12 text-destructive" />
              </div>
              <p className="text-sm text-muted-foreground">
                Click to start recording. A 3-second countdown will begin.
              </p>
              <Button onClick={startRecording} size="lg">
                <Mic className="h-4 w-4 mr-2" />
                Start Recording
              </Button>
            </>
          )}

          {state === "countdown" && (
            <>
              <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-5xl font-bold text-primary animate-pulse">
                  {countdown}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Get ready...
              </p>
            </>
          )}

          {state === "recording" && (
            <>
              <div className="h-24 w-24 rounded-full bg-destructive/10 flex items-center justify-center relative">
                <Mic className="h-12 w-12 text-destructive animate-pulse" />
                <div className="absolute inset-0 rounded-full border-2 border-destructive animate-ping opacity-50" />
              </div>

              {/* Level Meter */}
              <div className="w-full max-w-xs">
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-75"
                    style={{
                      width: `${level * 100}%`,
                      background: `linear-gradient(90deg, #22c55e, ${
                        level > 0.7 ? "#ef4444" : "#eab308"
                      })`,
                    }}
                  />
                </div>
              </div>

              <span className="font-mono text-2xl text-destructive">
                {formatElapsed(elapsed)}
              </span>

              <Button
                variant="destructive"
                size="lg"
                onClick={stopRecording}
              >
                <Square className="h-4 w-4 mr-2" />
                Stop Recording
              </Button>
            </>
          )}

          {state === "uploading" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Saving recording...
              </p>
              <Progress value={66} className="w-full max-w-xs" />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
