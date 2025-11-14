import os
import torch
import tempfile
import logging
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts
from TTS.api import TTS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class VoiceSynthesisService:
    # Language mapping for XTTS-v2 supported languages (limited to English, Japanese, French)
    SUPPORTED_LANGUAGES = {
        'en': 'en',
        'english': 'en',
        'ja': 'ja',
        'japanese': 'ja',
        'jp': 'ja',  # Alternative code for Japanese
        'fr': 'fr',
        'french': 'fr',
        'français': 'fr'  # French with accent
    }

    def __init__(
        self,
        xtts_model_dir: str = "./model",              
        voice_conversion_model: str = "voice_conversion_models/multilingual/multi-dataset/openvoice_v2"
    ):
        self.model_dir = xtts_model_dir
        self.voice_conversion_model = voice_conversion_model  # Fixed: Store the parameter
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.xtts_model: Xtts = None
        self.vc_model: TTS = None

        print(f"🚀 Initializing VoiceSynthesisService...")
        print(f"📁 XTTS model directory: {self.model_dir}")
        print(f"🎤 Voice conversion model: {self.voice_conversion_model}")
        print(f"💻 Device: {self.device}")

        # Load both models up‐front:
        self._load_xtts_model()
        self._load_voice_conversion_model()

    def _load_xtts_model(self):
        print(f"📥 Loading XTTS model from {self.model_dir}...")
        logger.info("Loading XTTS model from %s", self.model_dir)
        
        try:
            config = XttsConfig()
            config_path = os.path.join(self.model_dir, "config.json")
            
            if not os.path.exists(config_path):
                raise FileNotFoundError(f"XTTS config file not found: {config_path}")
            
            config.load_json(config_path)

            self.xtts_model = Xtts.init_from_config(config)
            self.xtts_model.load_checkpoint(config, checkpoint_dir=self.model_dir)
            self.xtts_model.eval()
            
            if torch.cuda.is_available():
                self.xtts_model.cuda()
                print("🔥 XTTS model loaded on CUDA")
            else:
                print("💻 XTTS model loaded on CPU")
                
        except Exception as e:
            print(f"❌ Failed to load XTTS model: {e}")
            logger.error(f"Failed to load XTTS model: {e}")
            raise

    def _load_voice_conversion_model(self):
        print(f"📥 Loading voice conversion model...")
        logger.info("Loading voice conversion model: %s", self.voice_conversion_model)
        
        try:
            self.vc_model = TTS(self.voice_conversion_model).to(self.device)
            print("✅ Voice conversion model loaded successfully")
        except Exception as e:
            print(f"❌ Failed to load voice conversion model: {e}")
            logger.error(f"Failed to load voice conversion model: {e}")
            raise

    def _normalize_language_code(self, language: str) -> str:
        """
        Normalize language input to supported XTTS language codes.
        """
        if not language:
            return "en"  # Default to English
        
        language_lower = language.lower().strip()
        
        # Direct lookup in supported languages
        if language_lower in self.SUPPORTED_LANGUAGES:
            return self.SUPPORTED_LANGUAGES[language_lower]
        
        # Try to match partial language names
        for key, value in self.SUPPORTED_LANGUAGES.items():
            if language_lower.startswith(key) or key.startswith(language_lower):
                return value
        
        logger.warning(f"Language '{language}' not supported, defaulting to English")
        return "en"

    def get_supported_languages(self) -> list:
        """Return list of supported language codes."""
        return list(set(self.SUPPORTED_LANGUAGES.values()))

    def synthesize(
        self,
        text: str,
        reference_audio_path: str,
        output_path: str,
        language: str = "en"
    ) -> str:
        """
        1) Compute conditioning latents from the reference audio.
        2) Run XTTS inference with those latents.
        3) Apply voice‐conversion and write to output_path.
        
        Args:
            text: Text to synthesize
            reference_audio_path: Path to reference audio file
            output_path: Output path for synthesized audio
            language: Target language for synthesis
        """
        print(f"\n{'='*60}")
        print(f"🎤 VOICE SYNTHESIS REQUEST")
        print(f"{'='*60}")
        print(f"📝 Text: '{text}'")
        print(f"🎯 Language: {language}")
        print(f"🔊 Reference audio: {reference_audio_path}")
        print(f"💾 Output path: {output_path}")
        
        # Normalize language code
        normalized_language = self._normalize_language_code(language)
        print(f"🔧 Using normalized language code: {normalized_language}")

        try:
            # 1) Latent extraction for this specific audio
            print("🧠 Computing conditioning latents...")
            logger.info("Computing conditioning latents for %s", reference_audio_path)
            
            if not os.path.exists(reference_audio_path):
                raise FileNotFoundError(f"Reference audio file not found: {reference_audio_path}")
            
            gpt_cond_latent, speaker_embedding = self.xtts_model.get_conditioning_latents(
                audio_path=reference_audio_path,
                gpt_cond_len=self.xtts_model.config.gpt_cond_len,
                max_ref_length=self.xtts_model.config.max_ref_len,
                sound_norm_refs=self.xtts_model.config.sound_norm_refs,
            )

            # 2) TTS inference with specified language
            print(f"🤖 Running XTTS inference...")
            logger.info("Running XTTS inference for text: %r in language: %s", text, normalized_language)
            out_wav = self.xtts_model.inference(
                text=text,
                language=normalized_language,  # Use the normalized language code
                gpt_cond_latent=gpt_cond_latent,
                speaker_embedding=speaker_embedding,
                temperature=0.3,
                length_penalty=1.0,
                repetition_penalty=10.0,
                top_k=30,
                top_p=0.85,
            )

            # 3) Voice conversion
            print(f"🔄 Applying voice conversion...")
            logger.info("Applying voice conversion to file: %s", output_path)
            
            # Ensure output directory exists
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            self.vc_model.voice_conversion_to_file(
                source_wav=out_wav["wav"],
                target_wav=reference_audio_path,
                speaker="MySpeaker",
                file_path=output_path,
            )

            print(f"✅ VOICE SYNTHESIS COMPLETED!")
            print(f"💾 Output saved to: {output_path}")
            print(f"{'='*60}\n")
            
            logger.info("Synthesis complete—saved to %s", output_path)
            return output_path
            
        except Exception as e:
            print(f"❌ Voice synthesis failed: {e}")
            logger.error(f"Voice synthesis failed: {e}")
            raise


# Singleton accessor
_voice_synthesis_service: VoiceSynthesisService = None

def get_voice_synthesis_service() -> VoiceSynthesisService:
    global _voice_synthesis_service
    if _voice_synthesis_service is None:
        print("🚀 Initializing VoiceSynthesisService singleton...")
        logger.info("Initializing VoiceSynthesisService singleton")
        try:
            _voice_synthesis_service = VoiceSynthesisService()
            print("✅ VoiceSynthesisService singleton ready!")
        except Exception as e:
            print(f"❌ Failed to initialize VoiceSynthesisService: {e}")
            logger.error(f"Failed to initialize VoiceSynthesisService: {e}")
            raise
    else:
        print("♻️ Using existing VoiceSynthesisService singleton")
    return _voice_synthesis_service