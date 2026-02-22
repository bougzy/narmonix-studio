export interface IUser {
  _id: string;
  name: string;
  email: string;
  passwordHash?: string;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProject {
  _id: string;
  userId: string;
  name: string;
  bpm: number;
  key: string;
  tracks: string[] | ITrack[];
  createdAt: Date;
  updatedAt: Date;
}

export type TrackType = "vocal" | "harmony" | "instrumental" | "mixed";
export type HarmonyPart = "soprano" | "alto" | "tenor" | "bass" | null;

export interface ITrack {
  _id: string;
  projectId: string;
  name: string;
  type: TrackType;
  harmonyPart: HarmonyPart;
  audioUrl: string;
  fileName: string;
  duration: number;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  eq: { low: number; mid: number; high: number };
  reverb: number;
  color: string;
  order: number;
  createdAt: Date;
}

export interface EditorState {
  project: IProject | null;
  tracks: ITrack[];
  isPlaying: boolean;
  isRecording: boolean;
  currentTime: number;
  bpm: number;
  selectedTrackId: string | null;
  isGeneratingHarmonies: boolean;
  harmonyProgress: string;
  zoom: number;
  loopEnabled: boolean;
  history: ITrack[][];
  historyIndex: number;
}

export interface HarmonyProgressUpdate {
  step: string;
  progress: number;
}

export interface ExportOptions {
  format: "wav" | "mp3";
  quality: "standard" | "high";
  type: "full-mix" | "individual" | "stems";
  trackId?: string;
}

// --- Solfa Notation Types ---

export interface PitchFrame {
  time: number;
  frequency: number;
  confidence: number;
}

export type SolfaSyllable = "d" | "r" | "m" | "f" | "s" | "l" | "t";

export interface SolfaNote {
  syllable: SolfaSyllable | "-" | "x";
  octaveOffset: number;
  duration: number;
}

export interface SolfaMeasure {
  measureNumber: number;
  beats: SolfaNote[];
}

export interface SolfaPart {
  partName: string;
  partKey: "soprano" | "alto" | "tenor" | "bass" | "vocal";
  measures: SolfaMeasure[];
}

export interface SolfaSheet {
  projectName: string;
  key: string;
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  parts: SolfaPart[];
  totalMeasures: number;
}
