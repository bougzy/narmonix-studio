import { create } from "zustand";
import { IProject, ITrack } from "@/types";

interface EditorState {
  project: IProject | null;
  tracks: ITrack[];
  isPlaying: boolean;
  isRecording: boolean;
  currentTime: number;
  bpm: number;
  selectedTrackId: string | null;
  isGeneratingHarmonies: boolean;
  harmonyProgress: string;
  harmonySopranoTrackId: string | null;
  zoom: number;
  loopEnabled: boolean;
  editMode: "select" | "trim" | "cut" | "split" | "fade-in" | "fade-out" | null;
  selectionRange: { start: number; end: number } | null;
  history: ITrack[][];
  historyIndex: number;
}

interface EditorActions {
  setProject: (project: IProject) => void;
  setTracks: (tracks: ITrack[]) => void;
  addTrack: (track: ITrack) => void;
  updateTrack: (trackId: string, updates: Partial<ITrack>) => void;
  removeTrack: (trackId: string) => void;
  setPlaying: (playing: boolean) => void;
  setRecording: (recording: boolean) => void;
  setCurrentTime: (time: number) => void;
  setBpm: (bpm: number) => void;
  setSelectedTrack: (trackId: string | null) => void;
  setGeneratingHarmonies: (generating: boolean) => void;
  setHarmonyProgress: (progress: string) => void;
  setHarmonySopranoTrackId: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setEditMode: (mode: EditorState["editMode"]) => void;
  setSelectionRange: (range: { start: number; end: number } | null) => void;
  reorderTracks: (activeId: string, overId: string) => void;
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  reset: () => void;
}

const initialState: EditorState = {
  project: null,
  tracks: [],
  isPlaying: false,
  isRecording: false,
  currentTime: 0,
  bpm: 120,
  selectedTrackId: null,
  isGeneratingHarmonies: false,
  harmonyProgress: "",
  harmonySopranoTrackId: null,
  zoom: 1,
  loopEnabled: false,
  editMode: null,
  selectionRange: null,
  history: [],
  historyIndex: -1,
};

export const useEditorStore = create<EditorState & EditorActions>((set, get) => ({
  ...initialState,

  setProject: (project) => set({ project, bpm: project.bpm }),

  setTracks: (tracks) => set({ tracks }),

  addTrack: (track) => {
    const state = get();
    state.pushHistory();
    set({ tracks: [...state.tracks, track] });
  },

  updateTrack: (trackId, updates) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t._id === trackId ? { ...t, ...updates } : t
      ),
    })),

  removeTrack: (trackId) => {
    const state = get();
    state.pushHistory();
    set({
      tracks: state.tracks.filter((t) => t._id !== trackId),
      selectedTrackId:
        state.selectedTrackId === trackId ? null : state.selectedTrackId,
    });
  },

  setPlaying: (isPlaying) => set({ isPlaying }),
  setRecording: (isRecording) => set({ isRecording }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setBpm: (bpm) => set({ bpm }),
  setSelectedTrack: (selectedTrackId) => set({ selectedTrackId }),
  setGeneratingHarmonies: (isGeneratingHarmonies) =>
    set({ isGeneratingHarmonies }),
  setHarmonyProgress: (harmonyProgress) => set({ harmonyProgress }),
  setHarmonySopranoTrackId: (harmonySopranoTrackId) =>
    set({ harmonySopranoTrackId }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setLoopEnabled: (loopEnabled) => set({ loopEnabled }),
  setEditMode: (editMode) => set({ editMode }),
  setSelectionRange: (selectionRange) => set({ selectionRange }),

  reorderTracks: (activeId, overId) =>
    set((state) => {
      const oldIndex = state.tracks.findIndex((t) => t._id === activeId);
      const newIndex = state.tracks.findIndex((t) => t._id === overId);
      if (oldIndex === -1 || newIndex === -1) return state;

      const newTracks = [...state.tracks];
      const [removed] = newTracks.splice(oldIndex, 1);
      newTracks.splice(newIndex, 0, removed);

      return {
        tracks: newTracks.map((t, i) => ({ ...t, order: i })),
      };
    }),

  pushHistory: () =>
    set((state) => {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push([...state.tracks]);
      return {
        history: newHistory.slice(-50),
        historyIndex: Math.min(newHistory.length - 1, 49),
      };
    }),

  undo: () =>
    set((state) => {
      if (state.historyIndex < 0) return state;
      const tracks = state.history[state.historyIndex];
      return {
        tracks,
        historyIndex: state.historyIndex - 1,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state;
      const tracks = state.history[state.historyIndex + 1];
      return {
        tracks,
        historyIndex: state.historyIndex + 1,
      };
    }),

  reset: () => set(initialState),
}));
