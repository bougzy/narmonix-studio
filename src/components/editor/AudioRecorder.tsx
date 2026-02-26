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

/**
 * Detect the best supported recording MIME type for this browser.
 * Safari doesn't support WebM, so we fall back to MP4/AAC or raw WAV.
 */
function getSupportedMimeType(): { mimeType: string; ext: string } {
  if (typeof MediaRecorder === "undefined") {
    return { mimeType: "", ext: ".wav" };
  }
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", ext: ".webm" },
    { mimeType: "audio/webm", ext: ".webm" },
    { mimeType: "audio/mp4;codecs=aac", ext: ".mp4" },
    { mimeType: "audio/mp4", ext: ".mp4" },
    { mimeType: "audio/ogg;codecs=opus", ext: ".ogg" },
    { mimeType: "audio/wav", ext: ".wav" },
    { mimeType: "", ext: ".webm" }, // browser default
  ];
  for (const c of candidates) {
    if (!c.mimeType || MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return { mimeType: "", ext: ".webm" };
}

/**
 * Convert any audio Blob to WAV for universal playback compatibility.
 * This ensures recordings work on ALL devices (Safari, Chrome, Firefox, mobile).
 */
async function convertToWav(blob: Blob): Promise<Blob> {
  const audioContext = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const numChannels = 1; // mono recording is sufficient
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = length * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++)
        view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    // Downmix to mono and write samples
    let offset = 44;
    const channels = audioBuffer.numberOfChannels;
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        sum += audioBuffer.getChannelData(ch)[i];
      }
      const sample = Math.max(-1, Math.min(1, sum / channels));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
      offset += bytesPerSample;
    }

    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    await audioContext.close();
  }
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const mimeInfoRef = useRef<{ mimeType: string; ext: string }>({
    mimeType: "",
    ext: ".wav",
  });

  const cleanup = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    // Stop all tracks on the stream to release the microphone
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
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
      // Request microphone with optimal settings for voice
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 44100 },
          channelCount: { ideal: 1 },
        },
      });
      streamRef.current = stream;

      // Set up analyser for level meter
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
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

      // Detect the best MIME type for this browser
      const mimeInfo = getSupportedMimeType();
      mimeInfoRef.current = mimeInfo;

      // Start recording with the best available codec
      const recorderOptions: MediaRecorderOptions = {};
      if (mimeInfo.mimeType) {
        recorderOptions.mimeType = mimeInfo.mimeType;
      }
      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
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
      // Build the raw blob from recorded chunks
      const rawBlob = new Blob(chunksRef.current, {
        type: mimeInfoRef.current.mimeType || "audio/webm",
      });

      // Convert to WAV for universal playback on all devices
      let uploadBlob: Blob;
      let fileName: string;
      try {
        uploadBlob = await convertToWav(rawBlob);
        fileName = `recording_${Date.now()}.wav`;
      } catch (convErr) {
        // If WAV conversion fails, upload the raw blob as fallback
        console.warn("WAV conversion failed, uploading raw format:", convErr);
        uploadBlob = rawBlob;
        fileName = `recording_${Date.now()}${mimeInfoRef.current.ext}`;
      }

      // Upload via FormData
      const formData = new FormData();
      formData.append("file", uploadBlob, fileName);
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
