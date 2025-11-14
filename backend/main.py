from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
import logging
import shutil
import asyncio
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def cleanup_files_async(directory: str) -> None:
    """Async file cleanup to prevent blocking"""
    if not os.path.exists(directory):
        return
    
    try:
        # Use thread pool for file operations to prevent blocking
        loop = asyncio.get_event_loop()
        
        def cleanup_dir():
            files_removed = 0
            for filename in os.listdir(directory):
                file_path = os.path.join(directory, filename)
                try:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                        files_removed += 1
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
                        files_removed += 1
                except Exception as e:
                    logger.warning(f"Could not remove {file_path}: {e}")
            return files_removed
        
        # Run in thread pool to prevent blocking
        files_removed = await loop.run_in_executor(None, cleanup_dir)
        logger.info(f"Cleaned up {files_removed} items from {directory}")
        
    except Exception as e:
        logger.error(f"Error cleaning up {directory}: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events"""
    # Startup
    logger.info("🚀 VietForeign API starting up...")
    
    # Create static directories on startup
    os.makedirs("static/converted", exist_ok=True)
    os.makedirs("static/uploads", exist_ok=True)
    logger.info("📁 Static directories created")
    
    yield
    
    # Shutdown - Clean up everything with timeout
    logger.info("🛑 VietForeign API shutting down, starting cleanup...")
    
    try:
        # Set a timeout for cleanup operations
        async with asyncio.timeout(10):  # 10 second timeout
            await perform_cleanup()
        logger.info("✅ Cleanup completed successfully")
        
    except asyncio.TimeoutError:
        logger.warning("⏰ Cleanup timed out after 10 seconds")
    except Exception as e:
        logger.error(f"❌ Error during shutdown cleanup: {e}")

async def perform_cleanup():
    """Perform all cleanup operations"""
    cleanup_tasks = []
    
    # 1. Clean up audio storage
    try:
        from backend.utils import get_audio_storage
        audio_storage = get_audio_storage()
        
        for audio_id, data in list(audio_storage.items()):  # Use list() to avoid dict changing during iteration
            file_path = data.get("file_path")
            if file_path and Path(file_path).exists():
                try:
                    Path(file_path).unlink()
                    logger.info(f"🗑️ Cleaned up temp file: {file_path}")
                except Exception as e:
                    logger.warning(f"Could not remove {file_path}: {e}")
                    
        # Clear the storage dictionary
        audio_storage.clear()
        logger.info("🧹 Cleared audio storage")
        
    except ImportError:
        logger.info("ℹ️ Audio storage utilities not available")
    except Exception as e:
        logger.error(f"❌ Error cleaning up audio storage: {e}")
    
    # 2. Clean up static directories (async)
    static_dirs = ["static/converted", "static/uploads"]
    for dir_path in static_dirs:
        cleanup_tasks.append(cleanup_files_async(dir_path))
    
    # 3. Clean up temp directories (async)
    temp_dirs = ["temp", "tmp", "temporary"]
    for temp_dir in temp_dirs:
        if os.path.exists(temp_dir):
            cleanup_tasks.append(cleanup_temp_directory_async(temp_dir))
    
    # 4. Run all cleanup tasks concurrently
    if cleanup_tasks:
        await asyncio.gather(*cleanup_tasks, return_exceptions=True)
    
    # 5. Clear GPU memory if available
    await clear_gpu_memory_async()
    
    # 6. Force garbage collection
    import gc
    gc.collect()
    logger.info("🗑️ Forced garbage collection")

async def cleanup_temp_directory_async(temp_dir: str) -> None:
    """Async temp directory cleanup"""
    try:
        loop = asyncio.get_event_loop()
        
        def remove_temp_dir():
            shutil.rmtree(temp_dir)
            return temp_dir
        
        removed_dir = await loop.run_in_executor(None, remove_temp_dir)
        logger.info(f"🗑️ Cleaned up temp directory: {removed_dir}")
        
    except Exception as e:
        logger.error(f"❌ Error cleaning up temp directory {temp_dir}: {e}")

async def clear_gpu_memory_async() -> None:
    """Async GPU memory cleanup"""
    try:
        loop = asyncio.get_event_loop()
        
        def clear_gpu():
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.synchronize()
                    return "GPU cache cleared"
            except Exception:
                pass
            return "No GPU cleanup needed"
        
        result = await loop.run_in_executor(None, clear_gpu)
        logger.info(f"🎮 {result}")
        
    except Exception as e:
        logger.error(f"❌ Error clearing GPU resources: {e}")

# Initialize FastAPI with lifespan
app = FastAPI(
    title="VietForeign API",
    description="Vietnamese audio translation and voice conversion service",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Next.js development
        "http://127.0.0.1:3000",
        "http://localhost:3001",  # Alternative port
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Include your routers
from routers import audios, transcript, conversion
app.include_router(audios.router)
app.include_router(transcript.router)
app.include_router(conversion.router)

@app.get("/")
async def root():
    return {
        "message": "VietForeign API is running",
        "status": "healthy",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": asyncio.get_event_loop().time()
    }

# Optional: Add a manual cleanup endpoint for testing
@app.post("/cleanup")
async def manual_cleanup():
    """Manual cleanup endpoint for testing purposes"""
    try:
        await perform_cleanup()
        return {"message": "✅ Manual cleanup completed successfully"}
    except Exception as e:
        logger.error(f"❌ Manual cleanup failed: {e}")
        return {"message": f"❌ Cleanup failed: {str(e)}"}