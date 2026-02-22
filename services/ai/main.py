"""Harmonix Studio AI Service - FastAPI microservice for harmony generation."""

import os
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

from pitch import analyze_pitch
from harmony import generate_satb_harmonies
from voice_clone import synthesize_voices
from audio_utils import download_audio, detect_key_and_tempo
from transcribe import transcribe_audio

app = FastAPI(title="Harmonix Studio AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AI_SERVICE_SECRET = os.getenv("AI_SERVICE_SECRET", "")


def verify_secret(x_internal_secret: Optional[str] = Header(None)):
    """Verify the internal service secret."""
    if AI_SERVICE_SECRET and x_internal_secret != AI_SERVICE_SECRET:
        raise HTTPException(status_code=403, detail="Invalid service secret")


# --- Request/Response Models ---


class AnalyzeRequest(BaseModel):
    audio_url: str
    project_key: Optional[str] = "C major"
    bpm: Optional[int] = 120


class AnalyzeResponse(BaseModel):
    key: str
    scale: str
    bpm: float
    pitch_contour: List[float]
    duration: float
    timestamps: List[float]


class HarmonyRequest(BaseModel):
    pitch_contour: List[float]
    key: str
    scale: str
    bpm: float
    duration: float


class HarmonyPart(BaseModel):
    part: str  # soprano, alto, tenor, bass
    pitches: List[float]
    timestamps: List[float]


class HarmonyResponse(BaseModel):
    parts: List[HarmonyPart]


class SynthesizeRequest(BaseModel):
    audio_url: str
    harmony_parts: List[HarmonyPart]
    duration: float


class SynthesizeResponse(BaseModel):
    audio_urls: List[str]


class TranscribeRequest(BaseModel):
    audio_url: str
    project_name: Optional[str] = "Transcribed Hymn"
    project_key: Optional[str] = None
    project_bpm: Optional[int] = None


class SolfaBeat(BaseModel):
    syllable: str
    octave_offset: int
    confidence: float


class SolfaMeasure(BaseModel):
    measure_number: int
    beats: List[SolfaBeat]


class TranscribeResponse(BaseModel):
    notation_text: str
    parts: dict
    key: str
    scale: str
    bpm: float
    duration: float
    confidence: float
    total_measures: int
    is_polyphonic: bool


# --- Endpoints ---


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "harmonix-ai"}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_audio(
    request: AnalyzeRequest,
    x_internal_secret: Optional[str] = Header(None),
):
    """Analyze audio for pitch, key, scale, and tempo."""
    verify_secret(x_internal_secret)

    try:
        # Download audio file
        audio_path = await download_audio(request.audio_url)

        # Detect pitch contour using CREPE
        pitch_contour, timestamps, duration = analyze_pitch(audio_path)

        # Detect key and tempo
        detected_key, detected_scale, detected_bpm = detect_key_and_tempo(
            audio_path, fallback_key=request.project_key, fallback_bpm=request.bpm
        )

        return AnalyzeResponse(
            key=detected_key,
            scale=detected_scale,
            bpm=detected_bpm,
            pitch_contour=pitch_contour,
            duration=duration,
            timestamps=timestamps,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.post("/generate-harmonies", response_model=HarmonyResponse)
async def generate_harmonies(
    request: HarmonyRequest,
    x_internal_secret: Optional[str] = Header(None),
):
    """Generate SATB harmony parts from melody pitch contour."""
    verify_secret(x_internal_secret)

    try:
        parts = generate_satb_harmonies(
            pitch_contour=request.pitch_contour,
            key=request.key,
            scale=request.scale,
            bpm=request.bpm,
            duration=request.duration,
        )

        return HarmonyResponse(parts=parts)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Harmony generation failed: {str(e)}"
        )


@app.post("/synthesize-voice", response_model=SynthesizeResponse)
async def synthesize_voice(
    request: SynthesizeRequest,
    x_internal_secret: Optional[str] = Header(None),
):
    """Synthesize harmony voices using voice cloning."""
    verify_secret(x_internal_secret)

    try:
        audio_path = await download_audio(request.audio_url)

        audio_urls = synthesize_voices(
            source_audio_path=audio_path,
            harmony_parts=request.harmony_parts,
            duration=request.duration,
        )

        return SynthesizeResponse(audio_urls=audio_urls)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Voice synthesis failed: {str(e)}"
        )


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: TranscribeRequest,
    x_internal_secret: Optional[str] = Header(None),
):
    """
    Full audio-to-tonic-sol-fa transcription pipeline.

    Accepts audio URL, returns structured SATB notation with:
    - CREPE neural pitch detection
    - Auto key/BPM detection
    - Movable Do solfa mapping (any key)
    - SATB harmonization (functional harmony)
    - Confidence scoring
    """
    verify_secret(x_internal_secret)

    try:
        audio_path = await download_audio(request.audio_url)

        result = transcribe_audio(
            audio_path=audio_path,
            project_name=request.project_name or "Transcribed Hymn",
            project_key=request.project_key,
            project_bpm=request.project_bpm,
        )

        return TranscribeResponse(
            notation_text=result["notation_text"],
            parts=result["parts"],
            key=result["key"],
            scale=result["scale"],
            bpm=result["bpm"],
            duration=result["duration"],
            confidence=result["confidence"],
            total_measures=result["total_measures"],
            is_polyphonic=result["is_polyphonic"],
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Transcription failed: {str(e)}"
        )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
