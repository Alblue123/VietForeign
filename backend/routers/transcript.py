# transcript_api.py - Minimal version with Vietnamese detection
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging
from utils import (
    get_audio_file, 
    get_audio_storage, 
    get_transcript_storage,
    is_vietnamese_transcript  
)
from dependencies import get_transcript_service
import asyncio
import functools

logger = logging.getLogger(__name__)
router = APIRouter()

class TranscriptUpdateRequest(BaseModel):
    transcript: str

class TranscriptResponse(BaseModel):
    id: str
    raw_transcript: Optional[str] = None
    corrected_transcript: str
    status: str
    message: str

def run_in_thread(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, func, *args, **kwargs)
    return wrapper

@run_in_thread
def process_audio_sync(audio_path: str) -> dict:
    try:
        service = get_transcript_service()
        result = service.process_audio(audio_path)
    
        return result
    except Exception as e:
        logger.error(f"Audio processing failed: {e}")
        return {"status": "error", "error": str(e)}

@router.get("/audios/{id}/transcript")
async def get_transcript(id: str):
    try:
        audio_storage = get_audio_storage()
        transcript_storage = get_transcript_storage()
        
        # Return cached transcript if exists
        if id in transcript_storage:
            stored = transcript_storage[id]
            # Re-check language for cached transcripts
            corrected_transcript = stored.get("corrected_transcript", "")
            if corrected_transcript:
                is_vn, detected_lang = await is_vietnamese_transcript(corrected_transcript)
                if not is_vn:
                    raise HTTPException(
                        status_code=400, 
                        detail=f"Transcript is not in Vietnamese. Detected: {detected_lang.upper()}. Please provide Vietnamese transcript."
                    )
            
            return TranscriptResponse(
                id=id,
                raw_transcript=stored.get("raw_transcript"),
                corrected_transcript=corrected_transcript,
                status=stored.get("status", "completed"),
                message="Transcript retrieved successfully"
            )
        
        # Check audio exists
        if id not in audio_storage:
            raise HTTPException(status_code=404, detail="Audio not found")
        
        # Get audio file and process
        audio_file_path = await get_audio_file(id)
        if not audio_file_path.exists():
            raise HTTPException(status_code=404, detail="Audio file not found")
        
        # Process audio
        result = await process_audio_sync(str(audio_file_path))
        
        # Handle language error
        if result["status"] == "language_error":
            raise HTTPException(status_code=400, detail=result["error"])
        
        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=result["error"])
        
        # Store successful result
        transcript_storage[id] = {
            "raw_transcript": result.get("raw_transcript", ""),
            "corrected_transcript": result.get("corrected_transcript", ""),
            "status": "completed"
        }
        
        return TranscriptResponse(
            id=id,
            raw_transcript=result.get("raw_transcript", ""),
            corrected_transcript=result.get("corrected_transcript", ""),
            status="completed",
            message="Transcript generated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/audios/{id}/transcript")
async def update_transcript(id: str, request: TranscriptUpdateRequest):
    try:
        audio_storage = get_audio_storage()
        transcript_storage = get_transcript_storage()
        
        if id not in audio_storage:
            raise HTTPException(status_code=404, detail="Audio not found")
        
        new_transcript = request.transcript.strip()
        if not new_transcript:
            raise HTTPException(status_code=400, detail="Transcript cannot be empty")
        
        # Check if transcript is Vietnamese
        is_vn, detected_lang = await is_vietnamese_transcript(new_transcript)
        if not is_vn:
            raise HTTPException(
                status_code=400,
                detail=f"Transcript is not in Vietnamese. Detected: {detected_lang.upper()}. Please provide Vietnamese text."
            )
        
        # Update transcript
        if id not in transcript_storage:
            transcript_storage[id] = {}
        
        transcript_storage[id].update({
            "corrected_transcript": new_transcript,
            "status": "updated"
        })
        
        return TranscriptResponse(
            id=id,
            raw_transcript=transcript_storage[id].get("raw_transcript"),
            corrected_transcript=new_transcript,
            status="updated",
            message="Transcript updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating transcript: {e}")
        raise HTTPException(status_code=500, detail=str(e))