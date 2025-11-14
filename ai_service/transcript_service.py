import torch
import soundfile as sf
import librosa
import os
from pydub import AudioSegment
import tempfile
import logging
from pathlib import Path
from transformers import (
    WhisperProcessor,
    WhisperForConditionalGeneration,
    AutoTokenizer,
    AutoModelForSeq2SeqLM,
    pipeline,
)
import traceback

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TranscriptService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {self.device}")
        
        # Model loading flags
        self.asr_loaded = False
        self.correction_loaded = False
        
        # Initialize models
        self._load_models()
    
    def _load_models(self):
        """Load both ASR and correction models with error handling"""
        try:
            self._load_asr_model()
            self.asr_loaded = True
        except Exception as e:
            logger.error(f"Failed to load ASR model: {e}")
            self.asr_loaded = False
        
        try:
            self._load_correction_model()
            self.correction_loaded = True
        except Exception as e:
            logger.error(f"Failed to load correction model: {e}")
            self.correction_loaded = False
        
        if not self.asr_loaded:
            logger.error("ASR model failed to load - transcript service will not work")
    
    def _load_asr_model(self):
        """Load Whisper ASR model for Vietnamese"""
        try:
            ASR_MODEL = "JRHuy/whisper-vietnamese"
            logger.info("Loading Whisper ASR model...")
            
            self.processor_asr = WhisperProcessor.from_pretrained(
                ASR_MODEL, language="Vietnamese", task="transcribe"
            )
            self.model_asr = WhisperForConditionalGeneration.from_pretrained(ASR_MODEL).to(self.device)
            self.model_asr.config.forced_decoder_ids = self.processor_asr.get_decoder_prompt_ids(
                language="vietnamese", task="transcribe"
            )
            logger.info("ASR model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load ASR model: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise
    
    def _load_correction_model(self):
        """Load Vietnamese correction model"""
        try:
            CORR_MODEL = "bmd1905/vietnamese-correction-v2"
            logger.info("Loading Vietnamese correction model...")
            
            self.tokenizer_corr = AutoTokenizer.from_pretrained(CORR_MODEL)
            self.model_corr = AutoModelForSeq2SeqLM.from_pretrained(
                CORR_MODEL,
                device_map="auto"
            )
            
            self.corrector = pipeline(
                "text2text-generation",
                model=self.model_corr,
                tokenizer=self.tokenizer_corr,
                max_length=256,
                do_sample=False,
            )
            logger.info("Correction model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load correction model: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise
    
    def _validate_audio_file(self, audio_path: str) -> bool:
        """Validate if audio file exists and is readable"""
        try:
            if not os.path.exists(audio_path):
                logger.error(f"Audio file does not exist: {audio_path}")
                return False
            
            if not os.path.isfile(audio_path):
                logger.error(f"Path is not a file: {audio_path}")
                return False
            
            if os.path.getsize(audio_path) == 0:
                logger.error(f"Audio file is empty: {audio_path}")
                return False
            
            # Try to read the file header
            try:
                audio, sr = sf.read(audio_path, frames=1)  # Read just one frame to test
                logger.info(f"Audio file validation successful. Sample rate: {sr}")
                return True
            except Exception as e:
                logger.error(f"Cannot read audio file {audio_path}: {e}")
                return False
                
        except Exception as e:
            logger.error(f"Audio file validation failed: {e}")
            return False
    
    def transcribe(self, audio_path: str) -> str:
        """Transcribe audio file to text, converting non‑WAV to WAV first."""
        try:
            if not self.asr_loaded:
                raise RuntimeError("ASR model not loaded")

            # 1) If not WAV, convert to a temp WAV file
            orig_path = audio_path
            suffix = Path(orig_path).suffix.lower()
            if suffix != ".wav":
                try:
                    logging.info(f"Converting {suffix} → .wav via pydub")
                    audio_seg = AudioSegment.from_file(orig_path, format=suffix.lstrip("."))
                    tmp_wav = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
                    audio_seg.export(tmp_wav.name, format="wav")
                    tmp_wav_path = tmp_wav.name
                    tmp_wav.close()
                    audio_path = tmp_wav_path
                except Exception as e:
                    logging.error(f"Failed to convert {orig_path} to WAV: {e}")
                    raise ValueError(f"Cannot convert {suffix} to WAV: {e}")

            # 2) Validate the (possibly converted) file
            if not self._validate_audio_file(audio_path):
                raise ValueError(f"Invalid audio file: {audio_path}")

            # 3) Load via soundfile
            audio, sr = sf.read(audio_path)
            logging.info(f"Loaded audio: shape={audio.shape}, sr={sr}")

            # 4) Clean up temp WAV if we made one
            if suffix != ".wav":
                try:
                    os.remove(audio_path)
                except OSError:
                    pass

            # 5) Mono/stereo, resample, normalize (exactly your existing logic)…
            if len(audio.shape) > 1:
                audio = librosa.to_mono(audio.T)
            if sr != 16000:
                audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
                sr = 16000
            if audio.max() > 0:
                audio = audio / audio.max() * 0.9

            # 6) Whisper inference
            inputs = self.processor_asr(audio, sampling_rate=sr, return_tensors="pt").to(self.device)
            with torch.no_grad():
                predicted_ids = self.model_asr.generate(**inputs, num_beams=5)
            raw_transcript = self.processor_asr.batch_decode(predicted_ids, skip_special_tokens=True)[0]

            return raw_transcript.strip()

        except Exception as e:
            logging.error(f"Transcription failed: {e}")
            logging.error(traceback.format_exc())
            raise
    
    def correct_text(self, raw_text: str) -> str:
        """Correct Vietnamese text using correction model"""
        try:
            if not raw_text.strip():
                logger.warning("Empty text provided for correction")
                return ""
            
            if not self.correction_loaded:
                logger.warning("Correction model not loaded, returning raw text")
                return raw_text
            
            logger.info("Correcting text...")
            output = self.corrector(raw_text)[0]["generated_text"]
            logger.info(f"Text corrected: {output[:100]}...")
            return output.strip()
            
        except Exception as e:
            logger.error(f"Text correction failed: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            # Return original text if correction fails
            return raw_text
    
    def process_audio(self, audio_path: str) -> dict:
        """Complete audio processing pipeline"""
        try:
            logger.info(f"Starting audio processing for: {audio_path}")
            
            if not self.asr_loaded:
                error_msg = "ASR model not loaded - cannot process audio"
                logger.error(error_msg)
                return {
                    "raw_transcript": "",
                    "corrected_transcript": "",
                    "status": "error",
                    "error": error_msg
                }
            
            # Step 1: Transcribe
            try:
                raw_transcript = self.transcribe(audio_path)
                logger.info(f"Raw transcript: {raw_transcript}")
            except Exception as e:
                error_msg = f"Transcription failed: {str(e)}"
                logger.error(error_msg)
                return {
                    "raw_transcript": "",
                    "corrected_transcript": "",
                    "status": "error",
                    "error": error_msg
                }
            
            # Step 2: Correct
            try:
                corrected_transcript = self.correct_text(raw_transcript)
                logger.info(f"Corrected transcript: {corrected_transcript}")
            except Exception as e:
                logger.warning(f"Text correction failed, using raw transcript: {e}")
                corrected_transcript = raw_transcript
            
            return {
                "raw_transcript": raw_transcript,
                "corrected_transcript": corrected_transcript,
                "status": "success"
            }
            
        except Exception as e:
            error_msg = f"Audio processing failed: {str(e)}"
            logger.error(error_msg)
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                "raw_transcript": "",
                "corrected_transcript": "",
                "status": "error",
                "error": error_msg
            }

# Global instance with lazy initialization
transcript_service = None

def get_transcript_service():
    """Get transcript service instance with lazy loading"""
    global transcript_service
    if transcript_service is None:
        logger.info("Initializing transcript service...")
        try:
            transcript_service = TranscriptService()
        except Exception as e:
            logger.error(f"Failed to initialize transcript service: {e}")
            raise
    return transcript_service

# For backward compatibility
try:
    transcript_service = TranscriptService()
except Exception as e:
    logger.error(f"Failed to initialize transcript service on import: {e}")
    transcript_service = None