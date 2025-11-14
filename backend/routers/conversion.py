from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import tempfile
import logging
import asyncio
import functools
from utils import get_audio_file, get_audio_storage, get_transcript_storage
from dependencies import get_translation_service, get_voice_synthesis_service

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Pydantic models for the combined conversion endpoint
class ConversionRequest(BaseModel):
    des_lang: str  # Match frontend parameter name

class ConversionResponse(BaseModel):
    converted_text: str
    original_transcript: str
    audio_file_path: str

# Separate models for individual operations
class TranslateRequest(BaseModel):
    target_language: str

class VoiceConversionRequest(BaseModel):
    target_language: str
    # Optional text field for custom text synthesis
    text: str = None

class TranslationResponse(BaseModel):
    id: str
    translated_text: str
    message: str

class VoiceConversionResponse(BaseModel):
    id: str
    converted_audio_url: str
    audio_file_path: str
    target_language: str
    synthesized_text: str
    message: str

# Decorator to offload blocking functions
def run_in_thread(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, functools.partial(func, *args, **kwargs))
    return wrapper

# Core synchronous functions
def translate_sync(vietnamese_text: str, target_lang: str) -> str:
    translation_service = get_translation_service()
    return translation_service.translate(vietnamese_text, target_lang)

@run_in_thread
def synthesize_voice(audio_path: str, text: str, language: str = "en") -> str:
    """
    Synthesize text into voice using the provided reference audio.
    """
    voice_service = get_voice_synthesis_service()
    logger.info(f"🎤 Voice service initialized")
    logger.info(f"📝 Synthesizing text: '{text}' in language: {language}")
    logger.info(f"🔊 Reference audio: {audio_path}")

    # Create static directory for converted audio
    static_dir = "static/converted"
    os.makedirs(static_dir, exist_ok=True)
    
    # Generate unique filename
    import uuid
    filename = f"converted_{uuid.uuid4().hex[:8]}_{language}.wav"
    # Use forward slashes for URL consistency
    output_path = os.path.join(static_dir, filename).replace("\\", "/")
    
    logger.info(f"💾 Output path: {output_path}")
    
    try:
        # Call the synthesize method with all required parameters
        result_path = voice_service.synthesize(
            text=text,
            reference_audio_path=audio_path,
            output_path=output_path,
            language=language
        )
        
        # Normalize the result path
        result_path = result_path.replace("\\", "/")
        
        logger.info(f"✅ Voice synthesis completed: {result_path}")
        
        # Verify file exists
        if not os.path.exists(result_path):
            logger.error(f"❌ Synthesized file not found at: {result_path}")
            raise FileNotFoundError(f"Synthesized audio file not created: {result_path}")
        
        # Get file size for verification
        file_size = os.path.getsize(result_path)
        logger.info(f"📁 File size: {file_size} bytes")
        
        return result_path
        
    except Exception as e:
        logger.error(f"❌ Voice synthesis failed: {str(e)}")
        logger.error(f"❌ Error type: {type(e).__name__}")
        raise

# Wrap sync functions
translate_in_thread = run_in_thread(translate_sync)

@router.post("/audios/{id}/translate", response_model=TranslationResponse)
async def translate_text_only(id: str, request: TranslateRequest):
    """Translate stored transcript to target language only"""
    logger.info(f"🎯 Translation request received for ID: {id}")
    logger.info(f"🌍 Target language: {request.target_language}")
    
    transcripts = get_transcript_storage()
    if id not in transcripts:
        logger.error(f"❌ Transcript not found for ID: {id}")
        raise HTTPException(status_code=404, detail="Transcript not found")

    vietnamese_text = transcripts[id].get("corrected_transcript") or transcripts[id].get("raw_transcript", "")
    if not vietnamese_text:
        logger.error(f"❌ No transcript available for ID: {id}")
        raise HTTPException(status_code=400, detail="No transcript to translate")

    logger.info(f"📝 Vietnamese text to translate: '{vietnamese_text}'")
    logger.info(f"📏 Text length: {len(vietnamese_text)} characters")

    try:
        logger.info("🔄 Starting translation process...")
        translated = await translate_in_thread(vietnamese_text, request.target_language)
        
        logger.info(f"✅ Translation completed successfully!")
        logger.info(f"📤 Original: '{vietnamese_text}'")
        logger.info(f"📥 Translated: '{translated}'")
        
        # Store translated text
        transcripts[id]["translated_transcript"] = translated
        logger.info(f"💾 Stored translated text in transcript storage")

        response = TranslationResponse(
            id=id,
            translated_text=translated,
            message="Translation successful"
        )
        
        logger.info(f"📡 Sending response: {response.dict()}")
        return response
    except Exception as e:
        logger.error(f"Translation failed: {e}")
        raise HTTPException(status_code=500, detail="Translation failed")

@router.post("/audios/{id}/voice-conversion", response_model=VoiceConversionResponse)
async def convert_voice_with_language(id: str, request: VoiceConversionRequest):
    """Convert voice using the stored translated text or custom text with language support"""
    logger.info(f"🎤 Voice conversion request received for ID: {id}")
    logger.info(f"🌍 Target language: {request.target_language}")
    logger.info(f"📝 Custom text provided: {bool(request.text)}")
    
    transcripts = get_transcript_storage()
    audio_storage = get_audio_storage()
    
    if id not in transcripts:
        logger.error(f"❌ Transcript not found for ID: {id}")
        raise HTTPException(status_code=404, detail="Transcript not found")
    if id not in audio_storage:
        logger.error(f"❌ Audio not found for ID: {id}")
        raise HTTPException(status_code=404, detail="Audio not found")

    # Determine text to synthesize
    text_to_synthesize = None
    
    if request.text:
        text_to_synthesize = request.text
        logger.info(f"Using custom text for synthesis: '{text_to_synthesize}'")
    else:
        # Try to get translated text first
        translated_text = transcripts[id].get("translated_transcript")
        if translated_text:
            text_to_synthesize = translated_text
            logger.info(f"Using stored translated text: '{text_to_synthesize}'")
        else:
            # Fallback to original transcript
            text_to_synthesize = (
                transcripts[id].get("corrected_transcript") or 
                transcripts[id].get("raw_transcript", "")
            )
            logger.info(f"Using original transcript as fallback: '{text_to_synthesize}'")

    if not text_to_synthesize:
        logger.error(f"❌ No text available for synthesis")
        raise HTTPException(
            status_code=400, 
            detail="No text available for synthesis. Please provide text or translate first."
        )

    logger.info(f"🎤 Synthesizing text: '{text_to_synthesize}' in language: {request.target_language}")

    try:
        # Get original audio file
        audio_path = await get_audio_file(id)
        logger.info(f"📁 Using audio file: {audio_path}")
        
        # Synthesize voice with translated text and target language
        synth_path = await synthesize_voice(
            audio_path=audio_path, 
            text=text_to_synthesize,
            language=request.target_language
        )
        
        if not os.path.exists(synth_path):
            logger.error(f"❌ Synthesized audio not found at: {synth_path}")
            raise HTTPException(status_code=500, detail="Synthesized audio not found")

        # Create a URL for the converted audio - normalize path separators
        relative_path = synth_path.replace("static/", "").replace("\\", "/")
        converted_audio_url = f"/static/{relative_path}"
        logger.info(f"🔗 Converted audio URL: {converted_audio_url}")
        
        # Verify the file is accessible
        file_size = os.path.getsize(synth_path)
        logger.info(f"📊 Final file verification - Size: {file_size} bytes, Path: {synth_path}")
        
        # Store synthesis info
        if "voice_conversions" not in transcripts[id]:
            transcripts[id]["voice_conversions"] = {}
        transcripts[id]["voice_conversions"][request.target_language] = {
            "audio_path": synth_path,
            "text": text_to_synthesize,
            "audio_url": converted_audio_url
        }

        logger.info(f"✅ Voice conversion completed successfully!")
        
        response = VoiceConversionResponse(
            id=id,
            converted_audio_url=converted_audio_url,
            audio_file_path=synth_path,
            target_language=request.target_language,
            synthesized_text=text_to_synthesize,
            message="Voice conversion successful"
        )
        
        logger.info(f"📡 Sending response: {response.dict()}")
        return response
        
    except FileNotFoundError as e:
        logger.error(f"❌ Audio file not found: {e}")
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    except Exception as e:
        logger.error(f"❌ Voice conversion failed: {e}")
        raise HTTPException(status_code=500, detail=f"Voice conversion failed: {str(e)}")