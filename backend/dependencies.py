from typing import Annotated
from TTS.api import TTS
from fastapi import Header, HTTPException
from pathlib import Path
import sys
import os

project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

try:
    from ai_service.transcript_service import get_transcript_service
except ImportError as e:
    print(f"Failed to import transcript_service: {e}")
    get_transcript_service = None


try:
    from ai_service.translation_service import get_translation_service
except ImportError as e:
    print(f"Failed to import translation_service: {e}")
    get_translation_service = None

try:
    from ai_service.conversion_service import get_voice_synthesis_service
except ImportError as e:
    print(f"Failed to import conversion_service: {e}")
    get_voice_synthesis_service = None

class UnsupportedFileFormatException(HTTPException):
    def __init__(self, detail: str):
        # Always use status code 415 for unsupported media type
        super().__init__(status_code=415, detail=detail)

class UnsupportedLanguageException(Exception):
    def __init__(self, message, source_lang, status_code):
        super().__init__(message)
        self.source_lang = source_lang
        self.status_code = status_code

    def __str__(self):
        return f"Unsupported language: {self.source_lang}, Status code: {self.status_code}"