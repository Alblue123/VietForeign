import uuid
from fastapi import UploadFile
from pathlib import Path
import logging
import tempfile
from dependencies import UnsupportedFileFormatException, UnsupportedLanguageException
from fast_langdetect import detect
from typing import Dict, Tuple
from datetime import datetime

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_EXTS = {'.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac', '.webm'}
MAX_DURATION = 60.0  
SUPPORTED_LANGUAGES = {"en", "fr", "ja"}


audio_storage: Dict[str, dict] = {}
transcript_storage: Dict[str, dict] = {}

# Create temp directory for audio files
TEMP_AUDIO_DIR = Path(tempfile.gettempdir()) / "audio_uploads"
TEMP_AUDIO_DIR.mkdir(exist_ok=True)

def get_audio_storage():
    """Get the shared audio storage"""
    return audio_storage

def get_transcript_storage():
    """Get the shared transcript storage"""
    return transcript_storage

def get_temp_audio_dir():
    """Get the temporary audio directory"""
    return TEMP_AUDIO_DIR


async def get_audio_file(audio_id: str) -> Path:
    """Get audio file path for processing"""
    audio_storage = get_audio_storage()
    
    if audio_id not in audio_storage:
        logger.error(f"Audio ID {audio_id} not found in storage")
        logger.error(f"Available IDs: {list(audio_storage.keys())}")
        raise FileNotFoundError(f"Audio with ID {audio_id} not found")
    
    audio_data = audio_storage[audio_id]
    file_path = audio_data.get("file_path")
    
    if not file_path:
        logger.error(f"No file path found for audio ID {audio_id}")
        raise FileNotFoundError(f"No file path found for audio ID {audio_id}")
    
    if not file_path.exists():
        logger.error(f"Audio file not found on disk: {file_path}")
        raise FileNotFoundError(f"Audio file not found on disk: {file_path}")
    
    logger.info(f"Found audio file for ID {audio_id}: {file_path}")
    return file_path

async def generate_audio_id() -> str:
    """Generate a unique audio ID"""
    return str(uuid.uuid4())

async def check_audio_format(filename: str):
    """Check if the audio format is supported based on filename"""
    supported_formats = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac', '.webm']
    if not any(filename.lower().endswith(fmt) for fmt in supported_formats):
        raise UnsupportedFileFormatException(
            f"Unsupported file format. Supported formats: {', '.join(supported_formats)}"
        )

async def save_audio_in_memory_and_disk(audio: UploadFile, contents: bytes) -> str:
    """Save the uploaded audio file both in memory and to disk"""
    audio_id = await generate_audio_id()
    audio_storage = get_audio_storage()
    temp_dir = get_temp_audio_dir()
    
    # Create temporary file path
    file_extension = Path(audio.filename or "audio.wav").suffix
    temp_file_path = temp_dir / f"{audio_id}{file_extension}"
    
    # Write to disk for transcript processing
    with open(temp_file_path, "wb") as f:
        f.write(contents)
    
    # Store in shared memory storage
    audio_storage[audio_id] = {
        "id": audio_id,
        "filename": audio.filename,
        "content": contents,
        "content_type": audio.content_type,
        "file_path": temp_file_path,
        "upload_time": datetime.now()
    }
    
    logger.info(f"Stored audio with ID: {audio_id}")
    logger.info(f"File saved to: {temp_file_path}")
    logger.info(f"Current storage keys: {list(audio_storage.keys())}")
    
    return audio_id

async def get_transcript(id: str) -> str:
    """
    Get the transcript for the given audio ID
    """
    transcript_storage = get_transcript_storage()
    
    if id not in transcript_storage:
        logger.error(f"Transcript ID {id} not found in storage")
        logger.error(f"Available transcript IDs: {list(transcript_storage.keys())}")
        raise FileNotFoundError(f"Transcript with ID {id} not found")
    
    transcript_data = transcript_storage[id]
    
    # Try to get the corrected transcript first, then fall back to original
    transcript_text = (
        transcript_data.get("corrected_transcript") or 
        transcript_data.get("original_transcript") or 
        transcript_data.get("transcript", "")
    )
    
    if not transcript_text:
        logger.error(f"No transcript content found for ID {id}")
        raise FileNotFoundError(f"No transcript content found for ID {id}")
    
    logger.info(f"Found transcript for ID {id}")
    return transcript_text

async def is_vietnamese_transcript(transcript: str) -> tuple[bool, str]:
    """
    Check if transcript is in Vietnamese
    
    Args:
        transcript (str): Text to check
        
    Returns:
        tuple[bool, str]: (is_vietnamese, detected_language)
    """
    if not transcript or len(transcript.strip()) < 10:
        return False, "text_too_short"
    
    try:
        detected_lang = detect(transcript.strip())
        is_vietnamese = detected_lang in ['VI', 'VIE']
        
        logger.info(f"Language detection: {detected_lang}, is_vietnamese: {is_vietnamese}")
        return is_vietnamese, detected_lang
        
    except Exception as e:
        logger.error(f"Language detection failed: {e}")
        return False, "detection_failed"

