from transformers import pipeline
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TranslatorService:
    def __init__(self):
        self.supported_languages = {
            "en": "eng_Latn",
            "ja": "jpn_Jpan",
            "fr": "fra_Latn"
        }
        self.translator = pipeline(
            "translation",
            model="facebook/nllb-200-distilled-600M",
            device_map="auto"
        )
        self.src_lang = "vie_Latn"
        logger.info("✅ TranslatorService initialized successfully")

    def translate(self, text: str, target_lang: str) -> str:
        """
        Translate Vietnamese text to target language.

        Args:
            text (str): Vietnamese text to translate.
            target_lang (str): One of ['en', 'ja', 'fr'].

        Returns:
            str: Translated text.
        """
        logger.info(f"🔄 Starting translation...")
        logger.info(f"📝 Input text: '{text}'")
        logger.info(f"🌍 Target language: {target_lang}")
        
        if target_lang not in self.supported_languages:
            error_msg = f"Unsupported target language '{target_lang}'. Choose from: {list(self.supported_languages.keys())}"
            logger.error(f"❌ {error_msg}")
            raise ValueError(error_msg)

        tgt_lang = self.supported_languages[target_lang]
        logger.info(f"🔧 Using language codes: {self.src_lang} -> {tgt_lang}")

        try:
            logger.info("🤖 Calling translation model...")
            result = self.translator(
                text,
                src_lang=self.src_lang,
                tgt_lang=tgt_lang
            )
            
            logger.info(f"📊 Raw model result: {result}")
            
            translated_text = result[0]["translation_text"]
            
            logger.info(f"✅ Translation successful!")
            logger.info(f"📤 Original (Vietnamese): '{text}'")
            logger.info(f"📥 Translated ({target_lang}): '{translated_text}'")
            logger.info(f"📊 Translation length: {len(text)} -> {len(translated_text)} characters")
            
            return translated_text
            
        except Exception as e:
            logger.error(f"💥 Translation failed with error: {e}")
            logger.error(f"🔍 Error type: {type(e).__name__}")
            raise


# Global instance
translation_service = None


def get_translation_service():
    global translation_service
    if translation_service is None:
        logger.info("🚀 Initializing TranslationService...")
        try:
            translation_service = TranslatorService()
            logger.info("✅ TranslationService ready for use")
        except Exception as e:
            logger.error(f"❌ Failed to initialize translation service: {e}")
            raise
    else:
        logger.info("♻️ Using existing TranslationService instance")
    return translation_service