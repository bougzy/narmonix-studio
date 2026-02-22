"use client";

import { useState, useRef, useCallback } from "react";
import {
  FileText,
  Loader2,
  Printer,
  Music,
  Copy,
  Check,
  Download,
  Cpu,
  Globe,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useEditorStore } from "@/store/useEditorStore";
import { getAudioEngine } from "@/lib/audioEngine";
import { generateSolfaSheet, renderSheetText } from "@/lib/solfaGenerator";
import { toast } from "sonner";
import type { SolfaSheet } from "@/types";
import type { KeyDetectionResult } from "@/lib/keyDetector";

interface SolfaNotationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fetch and decode an audio URL into an AudioBuffer.
 * Fallback when the audio engine buffer isn't available.
 */
async function fetchAudioBuffer(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }
}

/**
 * Try the backend AI transcription service (CREPE + music21).
 * Returns the result, or null if the service is unavailable.
 */
async function tryBackendTranscribe(
  projectId: string,
  trackIds: string[]
): Promise<{
  sheet: SolfaSheet;
  sheetText: string;
  confidence: number;
  detectedKey: string;
  detectedBpm: number;
} | null> {
  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, trackIds }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.fallback) return null; // Service unavailable, use fallback
      throw new Error(data.message || "Transcription failed");
    }

    const data = await res.json();

    // If the backend returned pre-formatted text, use it directly
    const notationText: string = data.notation_text || "";

    // Convert the backend sheet to our SolfaSheet type
    const sheet: SolfaSheet = data.sheet;

    return {
      sheet,
      sheetText: notationText || renderSheetText(sheet),
      confidence: data.detected?.confidence ?? 1,
      detectedKey: `${data.detected?.key ?? ""} ${data.detected?.scale ?? ""}`.trim(),
      detectedBpm: data.detected?.bpm ?? 0,
    };
  } catch {
    return null;
  }
}

export function SolfaNotationModal({
  open,
  onOpenChange,
}: SolfaNotationModalProps) {
  const { project, tracks, bpm } = useEditorStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [sheet, setSheet] = useState<SolfaSheet | null>(null);
  const [sheetText, setSheetText] = useState("");
  const [copied, setCopied] = useState(false);
  const [usedBackend, setUsedBackend] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [detectedKeyInfo, setDetectedKeyInfo] = useState<KeyDetectionResult | null>(null);
  const [detectedBPMInfo, setDetectedBPMInfo] = useState<number | null>(null);
  const sheetRef = useRef<HTMLPreElement>(null);

  const eligibleTracks = tracks.filter(
    (t) => t.type === "harmony" || t.type === "vocal" || t.type === "mixed"
  );

  const handleGenerate = useCallback(async () => {
    if (!project) return;

    const currentTracks = useEditorStore.getState().tracks;
    const eligible = currentTracks.filter(
      (t) => t.type === "harmony" || t.type === "vocal" || t.type === "mixed"
    );

    setIsGenerating(true);
    setProgress(0);
    setSheet(null);
    setSheetText("");
    setUsedBackend(false);
    setConfidence(null);
    setDetectedKeyInfo(null);
    setDetectedBPMInfo(null);

    try {
      // ─── Try backend AI service first (CREPE + music21) ───
      setProgressMessage(
        "Connecting to AI transcription service (CREPE)..."
      );
      setProgress(5);

      const backendResult = await tryBackendTranscribe(
        project._id,
        eligible.map((t) => t._id)
      );

      if (backendResult) {
        setSheet(backendResult.sheet);
        setSheetText(backendResult.sheetText);
        setUsedBackend(true);
        setConfidence(backendResult.confidence);

        const keyInfo = backendResult.detectedKey
          ? ` (Detected: ${backendResult.detectedKey})`
          : "";
        toast.success(`Solfa notation generated via AI service!${keyInfo}`);
        return;
      }

      // ─── Fallback: client-side processing (YIN pitch detection) ───
      setProgressMessage(
        "AI service unavailable. Using client-side analysis..."
      );
      setProgress(10);

      const engine = getAudioEngine();
      const trackData: Array<{
        partName: string;
        partKey: "soprano" | "alto" | "tenor" | "bass" | "vocal";
        audioBuffer: AudioBuffer;
      }> = [];

      for (let i = 0; i < eligible.length; i++) {
        const track = eligible[i];
        setProgressMessage(`Loading audio for ${track.name}...`);
        setProgress(10 + (i / eligible.length) * 10);

        let buffer = engine.getBuffer(track._id);

        if (!buffer) {
          try {
            buffer = await fetchAudioBuffer(track.audioUrl);
          } catch (e) {
            console.error(`Failed to load audio for ${track.name}:`, e);
            continue;
          }
        }

        trackData.push({
          partName: track.name,
          partKey: track.harmonyPart ?? "vocal",
          audioBuffer: buffer,
        });
      }

      if (trackData.length === 0) {
        toast.error("Could not load audio for any tracks.");
        return;
      }

      const result = await generateSolfaSheet(
        trackData,
        project.name,
        project.key,
        bpm,
        (pct, msg) => {
          setProgress(20 + pct * 0.8);
          setProgressMessage(msg);
        }
      );

      setSheet(result);
      setSheetText(renderSheetText(result));

      // Store detected key and BPM info
      if (result.detectedKey) {
        setDetectedKeyInfo(result.detectedKey);
      }
      if (result.detectedBPM) {
        setDetectedBPMInfo(result.detectedBPM);
      }

      const keyMsg = result.detectedKey
        ? ` | Key: ${result.detectedKey.label} (${Math.round(result.detectedKey.confidence * 100)}%)`
        : "";
      const bpmMsg = result.detectedBPM ? ` | ${result.detectedBPM} BPM` : "";
      toast.success(`Solfa notation generated!${keyMsg}${bpmMsg}`);
    } catch (error) {
      console.error("Solfa generation error:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to generate solfa notation"
      );
    } finally {
      setIsGenerating(false);
    }
  }, [project, bpm]);

  const handleCopy = useCallback(async () => {
    if (!sheetText) return;
    try {
      await navigator.clipboard.writeText(sheetText);
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }, [sheetText]);

  const handlePrint = useCallback(() => {
    if (!sheetText || !sheet) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups for this site.");
      return;
    }

    const escaped = sheetText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${sheet.projectName} - Tonic Sol-fa Notation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      padding: 20mm;
      color: #1a1a1a;
      font-size: 13px;
      line-height: 1.6;
    }
    pre {
      white-space: pre;
      font-family: inherit;
      font-size: inherit;
    }
    @media print {
      body { padding: 15mm; }
    }
  </style>
</head>
<body>
  <pre>${escaped}</pre>
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`);
    printWindow.document.close();
  }, [sheet, sheetText]);

  const handleDownloadPDF = useCallback(() => {
    if (!sheetText || !sheet) return;

    const escaped = sheetText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>${sheet.projectName} - Tonic Sol-fa Notation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      padding: 20mm;
      color: #1a1a1a;
      font-size: 13px;
      line-height: 1.6;
    }
    pre {
      white-space: pre;
      font-family: inherit;
      font-size: inherit;
    }
  </style>
</head>
<body>
  <pre>${escaped}</pre>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.projectName} - Solfa Notation.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded! Open in browser and use Print > Save as PDF");
  }, [sheet, sheetText]);

  const handleDownloadText = useCallback(() => {
    if (!sheetText || !sheet) return;
    const blob = new Blob([sheetText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.projectName} - Solfa Notation.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Text file downloaded!");
  }, [sheet, sheetText]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Tonic Sol-fa Notation
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4 pt-2">
          {/* Initial state */}
          {!sheet && !isGenerating && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Generate a Catholic church-style tonic sol-fa notation sheet
                showing all voice parts (SATB) with movable Do system.
              </p>

              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 font-mono space-y-1">
                <p className="font-semibold text-foreground mb-1">Format:</p>
                <p>{"S: d  r  m  f | s  -  s  l |"}</p>
                <p>{"A: m  f  s  l | l  -  l  s |"}</p>
                <p>{"T: s, l, t, d | d  -  d  l,|"}</p>
                <p>{"B: d, -  d, - | s,,- d, -  |"}</p>
                <p className="mt-1 text-muted-foreground">
                  {"d r m f s l t = Do Re Mi Fa Sol La Ti"}
                </p>
                <p className="text-muted-foreground">
                  {"' = upper octave  , = lower octave  - = sustain  x = rest"}
                </p>
              </div>

              {eligibleTracks.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <Label className="text-xs">
                    Tracks to analyze ({eligibleTracks.length}):
                  </Label>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {eligibleTracks.map((t) => (
                      <li key={t._id}>
                        {t.name}{" "}
                        <span className="opacity-60">
                          ({t.harmonyPart ?? t.type})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button
                onClick={handleGenerate}
                disabled={eligibleTracks.length === 0}
                className="w-full"
              >
                <Music className="h-4 w-4 mr-2" />
                Generate Notation
              </Button>

              {eligibleTracks.length === 0 && (
                <p className="text-xs text-destructive">
                  No vocal or harmony tracks available. Upload a vocal track or
                  generate harmonies first.
                </p>
              )}
            </div>
          )}

          {/* Progress */}
          {isGenerating && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">{progressMessage}</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {/* Rendered notation - monospace text */}
          {sheet && sheetText && (
            <>
              {/* Processing info badge */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {usedBackend ? (
                  <>
                    <Globe className="h-3 w-3" />
                    <span>
                      Processed by AI service (CREPE neural pitch detection)
                    </span>
                  </>
                ) : (
                  <>
                    <Cpu className="h-3 w-3" />
                    <span>Processed client-side (YIN pitch detection)</span>
                  </>
                )}
                {confidence !== null && confidence < 0.6 && (
                  <span className="text-amber-500 ml-2">
                    Low confidence ({Math.round(confidence * 100)}%)
                  </span>
                )}
              </div>

              {/* Detected key info */}
              {detectedKeyInfo && (
                <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      Detected Key: {detectedKeyInfo.label}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        detectedKeyInfo.confidence > 0.6
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : detectedKeyInfo.confidence > 0.3
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {Math.round(detectedKeyInfo.confidence * 100)}% confidence
                    </span>
                  </div>
                  {detectedBPMInfo && (
                    <div className="text-xs text-muted-foreground">
                      Detected Tempo: {detectedBPMInfo} BPM
                    </div>
                  )}
                  {detectedKeyInfo.allKeys.length > 1 && (
                    <div className="text-xs text-muted-foreground">
                      Top matches:{" "}
                      {detectedKeyInfo.allKeys.slice(0, 5).map((k, i) => (
                        <span key={`${k.key}-${k.scale}`}>
                          {i > 0 && ", "}
                          <span
                            className={
                              i === 0 ? "font-semibold text-foreground" : ""
                            }
                          >
                            {k.key} {k.scale}
                          </span>
                          <span className="opacity-60">
                            {" "}
                            ({Math.round(k.correlation * 100)}%)
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <ScrollArea className="flex-1 border rounded-md bg-white dark:bg-zinc-950 min-h-[300px] max-h-[55vh]">
                <pre
                  ref={sheetRef}
                  className="p-4 text-xs leading-relaxed font-mono text-foreground whitespace-pre overflow-x-auto"
                >
                  {sheetText}
                </pre>
              </ScrollArea>
            </>
          )}
        </div>

        {/* Footer actions */}
        {sheet && (
          <DialogFooter className="flex-wrap gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <Check className="h-4 w-4 mr-1" />
              ) : (
                <Copy className="h-4 w-4 mr-1" />
              )}
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadText}>
              <Download className="h-4 w-4 mr-1" />
              .TXT
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPDF}>
              <Download className="h-4 w-4 mr-1" />
              .HTML
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />
              Print PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleGenerate}>
              Regenerate
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
