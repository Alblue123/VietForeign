from fastapi import APIRouter, File, UploadFile, HTTPException
from utils import get_audio_file, save_audio_in_memory_and_disk, check_audio_format
from dependencies import UnsupportedFileFormatException
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/audios/")
async def upload_audio(file: UploadFile = File(...)):
    """Upload audio file"""
    try:
        # Check format first
        print(f"→ Received upload: filename={file.filename!r}, content_type={file.content_type!r}")
        await check_audio_format(file.filename or "")
        
        # Read file content once
        contents = await file.read()
        
        # Validate content is not empty
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
        
        # Save to both memory and disk
        audio_id = await save_audio_in_memory_and_disk(file, contents)
        
        return {
            "id": audio_id,
            "filename": file.filename,
            "message": "Audio uploaded successfully",
            "size": len(contents)
        }
        
    except UnsupportedFileFormatException as e:
        raise HTTPException(status_code=415, detail=str(e))
    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")
    finally:
        if hasattr(file, 'file') and file.file:
            file.file.close()

@router.get("/audios/{id}/conversions/{lang}")
async def download_audio(id: str):
    try:
        audio = await get_audio_file(id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Audio file not found")
    finally:
        audio.file.close()

    return {
        "id": id,
        "message": "Audio download successful"
    }