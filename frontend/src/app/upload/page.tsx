"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Upload, Play, Pause, Volume2, RefreshCw, CheckCircle, AlertCircle, Languages, Clock } from 'lucide-react';

interface HomePageProps {
  onConvert: (conversionData: ConversionData) => void;
}

interface ConversionData {
  audioId: string;
  selectedLanguage: string;
  originalAudio: string;
  translatedTranscript: string;
  originalTranscript: string;
}

const HomePage: React.FC<HomePageProps> = ({ onConvert }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<string | null>(null);
  const [convertedAudio, setConvertedAudio] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioWaveform, setAudioWaveform] = useState<number[]>([]);
  const [audioId, setAudioId] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [transcript, setTranscript] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState<'idle' | 'processing' | 'completed' | 'error' | 'language_error'>('idle');
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [languageWarning, setLanguageWarning] = useState<string | null>(null);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [pendingTranscript, setPendingTranscript] = useState('');
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformAnimationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // Maximum duration in seconds (1 minute)
  const MAX_DURATION = 60;

  // Generate random waveform for demo
  const generateWaveform = () => {
    const bars = Array.from({ length: 50 }, () => Math.random() * 100);
    setAudioWaveform(bars);
  };

  // Generate animated waveform during playback
  const animateWaveform = () => {
    if (!analyserRef.current || !dataArrayRef.current) {
      // Fallback to random animation if Web Audio API isn't available
      const bars = Array.from({ length: 50 }, () => Math.random() * 100 + 10);
      setAudioWaveform(bars);
    } else {
      // Use real audio analysis
      analyserRef.current.getByteFrequencyData(dataArrayRef.current);
      const bars = Array.from(dataArrayRef.current.slice(0, 50), (value) => (value / 255) * 100);
      setAudioWaveform(bars);
    }

    if (isPlaying) {
      waveformAnimationRef.current = requestAnimationFrame(animateWaveform);
    }
  };

  // Setup Web Audio API for real waveform analysis
  const setupAudioAnalysis = (audioElement: HTMLAudioElement) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      const source = audioContext.createMediaElementSource(audioElement);
      const analyser = audioContext.createAnalyser();
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      source.connect(analyser);
      analyser.connect(audioContext.destination);

      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;
    } catch (error) {
      console.log('Web Audio API not available, using fallback animation');
    }
  };

  // Function to get audio duration
  const getAudioDuration = (audioUrl: string): Promise<number> => {
    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      audio.addEventListener('loadedmetadata', () => {
        resolve(audio.duration);
      });
      audio.addEventListener('error', () => {
        reject(new Error('Failed to load audio metadata'));
      });
      audio.load();
    });
  };

  // Function to validate audio duration
  const validateAudioDuration = async (audioUrl: string, fileName?: string): Promise<boolean> => {
    try {
      const duration = await getAudioDuration(audioUrl);
      setAudioDuration(duration);
      
      if (duration > MAX_DURATION) {
        const minutes = Math.floor(duration / 60);
        const seconds = Math.floor(duration % 60);
        const fileInfo = fileName ? ` (${fileName})` : '';
        setUploadError(`Audio quá dài${fileInfo}: ${minutes}:${seconds.toString().padStart(2, '0')}. Vui lòng sử dụng audio dưới 1 phút.`);
        return false;
      }
      
      setUploadError(null);
      return true;
    } catch (error) {
      console.error('Error getting audio duration:', error);
      setUploadError('Không thể đọc thông tin audio. Vui lòng thử file khác.');
      return false;
    }
  };

  useEffect(() => {
    if (isRecording) {
      generateWaveform();
      const interval = setInterval(generateWaveform, 100);
      return () => clearInterval(interval);
    }
  }, [isRecording]);

  useEffect(() => {
    if (isPlaying) {
      animateWaveform();
    } else if (waveformAnimationRef.current) {
      cancelAnimationFrame(waveformAnimationRef.current);
      waveformAnimationRef.current = null;
    }

    return () => {
      if (waveformAnimationRef.current) {
        cancelAnimationFrame(waveformAnimationRef.current);
      }
    };
  }, [isPlaying]);

  // API configuration
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Helper function to handle language detection errors
  const handleLanguageError = (errorMessage: string, detectedLang?: string) => {
    setTranscriptStatus('language_error');
    setLanguageWarning(errorMessage);
    if (detectedLang) {
      setDetectedLanguage(detectedLang);
    }
  };

  // Reset language error state
  const resetLanguageError = () => {
    setLanguageWarning(null);
    setDetectedLanguage(null);
    setTranscriptStatus('idle');
  };

  // Updated transcript fetching function with language detection
  const fetchTranscript = async (id: string) => {
    setIsTranscribing(true);
    setTranscriptStatus('processing');
    resetLanguageError();
    
    try {
      console.log(`Fetching transcript for ID: ${id}`);
      
      const response = await fetch(`${API_BASE_URL}/audios/${id}/transcript`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`Transcript fetch failed: ${response.status} - ${JSON.stringify(errorData)}`);
        
        if (response.status === 404) {
          throw new Error(`Audio not found (ID: ${id}). Please try uploading again.`);
        }
        
        // Handle language detection error
        if (response.status === 400 && errorData.detail?.includes('language')) {
          const detectedLang = errorData.detected_language || 'unknown';
          handleLanguageError(
            errorData.detail || 'Audio is not in Vietnamese. Please upload Vietnamese audio or correct the transcript.',
            detectedLang
          );
          return;
        }
        
        throw new Error(`Failed to fetch transcript: ${response.status} - ${errorData.detail || 'Unknown error'}`);
      }

      const result = await response.json();
      console.log('Transcript result:', result);
      
      setTranscript(result.corrected_transcript || '');
      setDetectedLanguage(result.detected_language || null);
      setTranscriptStatus('completed');
      
    } catch (error) {
      console.error('Fetch transcript error:', error);
      
      if (transcriptStatus !== 'language_error') {
        setTranscriptStatus('error');
        const errorMessage = error instanceof Error ? error.message : 'Transcription failed';
        setUploadError(errorMessage);
        
        if (errorMessage.includes('not found')) {
          setAudioId(null);
          setUploadedFileName(null);
        }
      }
    } finally {
      setIsTranscribing(false);
    }
  };

  // Updated upload function with duration validation
  const uploadAudioToAPI = async (audioBlob: Blob, filename: string) => {
    setIsUploading(true);
    setUploadError(null);
    resetLanguageError();

    try {
      // Create audio URL for duration validation
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Validate duration first
      const isValidDuration = await validateAudioDuration(audioUrl, filename);
      if (!isValidDuration) {
        URL.revokeObjectURL(audioUrl);
        return;
      }

      const formData = new FormData();
      formData.append('file', audioBlob, filename);

      console.log(`Uploading file: ${filename}, size: ${audioBlob.size}`);

      const response = await fetch(`${API_BASE_URL}/audios/`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Upload failed: ${response.status} - ${errorText}`);
        
        if (response.status === 415) {
          throw new Error('Định dạng file không được hỗ trợ');
        }
        if (response.status === 404) {
          throw new Error('Không tìm thấy endpoint API');
        }
        throw new Error(`Upload thất bại: ${response.status}`);
      }

      const result = await response.json();
      console.log('Upload successful:', result);
      
      setAudioId(result.id);
      setUploadedFileName(result.filename);
      
      setTimeout(() => {
        fetchTranscript(result.id);
      }, 100);
      
      // Clean up the temporary URL
      URL.revokeObjectURL(audioUrl);
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload thất bại';
      setUploadError(errorMessage);
      console.error('Upload error:', error);
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  // Update transcript with language validation
  const updateTranscript = async (newTranscript: string) => {
    if (!audioId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/audios/${audioId}/transcript`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript: newTranscript }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Handle language detection error
        if (response.status === 400 && errorData.detail?.includes('language')) {
          const detectedLang = errorData.detected_language || 'unknown';
          handleLanguageError(
            errorData.detail || 'Transcript is not in Vietnamese. Please provide Vietnamese text.',
            detectedLang
          );
          return;
        }
        
        throw new Error(`Failed to update transcript: ${response.status} - ${errorData.detail || 'Unknown error'}`);
      }

      console.log('Transcript updated successfully');
      setTranscriptStatus('completed');
      resetLanguageError();
    } catch (error) {
      console.error('Update transcript error:', error);
      if (transcriptStatus !== 'language_error') {
        setUploadError(error instanceof Error ? error.message : 'Update failed');
      }
    }
  };

  // Handle transcript text change
  const handleTranscriptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newTranscript = event.target.value;
    setTranscript(newTranscript);
    
    // Reset language error when user starts typing
    if (languageWarning) {
      resetLanguageError();
    }
  };

  // Retry transcript generation
  const retryTranscript = async () => {
    if (!audioId) return;
    
    setTranscript('');
    setTranscriptStatus('idle');
    setUploadError(null);
    resetLanguageError();
    
    await fetchTranscript(audioId);
  };

  // Handle re-upload audio
  const handleReUploadAudio = () => {
    // Reset all states
    setRecordedAudio(null);
    setConvertedAudio(null);
    setAudioId(null);
    setUploadedFileName(null);
    setTranscript('');
    setTranscriptStatus('idle');
    setUploadError(null);
    resetLanguageError();
    setAudioWaveform([]);
    setAudioDuration(null);
    
    // Stop any playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  };

  // Separate translation API call
  const getTranslationAPI = async (id: string, targetLang: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/audios/${id}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target_language: targetLang }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Không tìm thấy file audio');
        }
        if (response.status === 400) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Yêu cầu không hợp lệ');
        }
        throw new Error(`Translation thất bại: ${response.status}`);
      }

      const result = await response.json();
      console.log('Translation successful:', result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Translation thất bại';
      console.error('Translation error:', error);
      throw new Error(errorMessage);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';

        let extension = 'webm';
        if (mimeType.includes('wav')) {
          extension = 'wav';
        } else if (mimeType.includes('ogg')) {
          extension = 'ogg';
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Validate duration before setting the recorded audio
        const isValidDuration = await validateAudioDuration(audioUrl);
        if (!isValidDuration) {
          URL.revokeObjectURL(audioUrl);
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        
        setRecordedAudio(audioUrl);
        const filename = `recording_${Date.now()}.${extension}`;

        console.log('Uploading', filename, 'with MIME type', mimeType);

        try {
          await uploadAudioToAPI(audioBlob, filename);
        } catch (error) {
          console.error('Failed to upload recording:', error);
        }

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const newTime = prev + 1;
          // Auto-stop recording if it reaches max duration
          if (newTime >= MAX_DURATION) {
            stopRecording();
          }
          return newTime;
        });
      }, 1000);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setUploadError('Không thể truy cập microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const audioUrl = URL.createObjectURL(file);
      
      // Validate duration first
      const isValidDuration = await validateAudioDuration(audioUrl, file.name);
      if (!isValidDuration) {
        URL.revokeObjectURL(audioUrl);
        // Clear the input
        event.target.value = '';
        return;
      }
      
      setRecordedAudio(audioUrl);
      generateWaveform();
      
      setTranscript('');
      setTranscriptStatus('idle');
      resetLanguageError();
      
      try {
        await uploadAudioToAPI(file, file.name);
      } catch (error) {
        console.error('Failed to upload file:', error);
      }
    }
  };

  const handlePlayAudio = () => {
    if (!recordedAudio) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(recordedAudio);
    audioRef.current = audio;

    setupAudioAnalysis(audio);

    audio.onplay = () => {
      setIsPlaying(true);
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    };
    
    audio.onpause = () => setIsPlaying(false);
    
    audio.onended = () => {
      setIsPlaying(false);
      audioRef.current = null;
      generateWaveform();
    };

    audio.play().catch(error => {
      console.error('Error playing audio:', error);
      setIsPlaying(false);
    });
  };

  // Updated convert function - only calls translation API
  const handleConvert = async () => {
    if (!audioId) {
      setUploadError('Vui lòng upload file audio trước');
      return;
    }

    if (transcriptStatus !== 'completed') {
      setUploadError('Vui lòng chờ transcript hoàn thành');
      return;
    }

    setIsConverting(true);
    setUploadError(null);
    
    try {
      // Only call translation API here
      const translationData = await getTranslationAPI(audioId, selectedLanguage);
      
      // Prepare data for the convert page (voice conversion will happen there)
      const dataForNextPage: ConversionData = {
        audioId,
        selectedLanguage,
        originalAudio: recordedAudio || '',
        translatedTranscript: translationData.translated_text,
        originalTranscript: transcript,
      };
      
      // Navigate to the convert page with the translation data
      onConvert(dataForNextPage);
      
    } catch (error) {
      console.error('Translation failed:', error);
      setUploadError(error instanceof Error ? error.message : 'Translation thất bại');
    } finally {
      setIsConverting(false);
    }
  };

  const handleConfirm = async () => {
    if (!audioId) {
      setUploadError('Chưa có audio để lấy transcript');
      return;
    }

    setIsTranscribing(true);
    setUploadError(null);

    try {
      await updateTranscript(transcript);
      if (transcriptStatus !== 'language_error') {
        await fetchTranscript(audioId);
        console.log('Transcript saved and re‑loaded successfully');
      }
    } catch (e) {
      console.error('Error in confirm cycle:', e);
      if (transcriptStatus !== 'language_error') {
        setUploadError(e instanceof Error ? e.message : 'Lỗi khi xác nhận transcript');
      }
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTranscriptStatusIcon = () => {
    switch (transcriptStatus) {
      case 'processing':
        return <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      case 'language_error':
        return <Languages className="w-4 h-4 text-orange-400" />;
      default:
        return null;
    }
  };

  const getTranscriptStatusText = () => {
    switch (transcriptStatus) {
      case 'processing':
        return 'Đang xử lý transcript...';
      case 'completed':
        return 'Transcript hoàn thành';
      case 'error':
        return 'Lỗi khi tạo transcript';
      case 'language_error':
        return 'Lỗi ngôn ngữ';
      default:
        return 'Chưa có transcript';
    }
  };

  const getLanguageName = (code: string) => {
    const languages: { [key: string]: string } = {
      'en': 'Tiếng Anh',
      'ja': 'Tiếng Nhật',
      'fr': 'Tiếng Pháp',
    };
    return languages[code] || code;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-6 bg-gradient-to-r from-white to-blue-200 bg-clip-text text-transparent">
            VietForeign
          </h1>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
            Hãy cất lên tiếng nói của bạn
          </h2>
          <h3 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
            và chúng tôi sẽ đưa bạn đến chân trời mới
          </h3>
          <p className="text-lg text-gray-300 max-w-md mx-auto">
            VietForeign giúp bạn chuyển đổi tiếng nói của mình sang một ngôn ngữ mới
          </p>
        </div>

        {/* Upload Status */}
        {uploadError && (
          <div className="max-w-6xl mx-auto mb-4 p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-200">
            Lỗi: {uploadError}
          </div>
        )}

        {/* Language Warning */}
        {languageWarning && (
          <div className="max-w-6xl mx-auto mb-4 p-4 bg-orange-500/20 border border-orange-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <Languages className="w-5 h-5 text-orange-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-orange-200 mb-3">{languageWarning}</p>
                {detectedLanguage && (
                  <p className="text-orange-300 text-sm mb-3">
                    Phát hiện ngôn ngữ: {detectedLanguage.toUpperCase()}
                  </p>
                )}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={handleReUploadAudio}
                    className="px-3 py-1 bg-orange-600 hover:bg-orange-700 rounded text-sm transition-colors"
                  >
                    Tải lại audio
                  </button>
                  <button
                    onClick={() => {
                      setTranscriptStatus('idle');
                      resetLanguageError();
                    }}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
                  >
                    Sửa transcript
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {audioId && uploadedFileName && (
          <div className="max-w-6xl mx-auto mb-4 p-4 bg-green-500/20 border border-green-500/30 rounded-lg text-green-200">
            <div className="flex items-center justify-between">
              <span>Đã tải lên thành công: {uploadedFileName} (ID: {audioId})</span>
              {audioDuration && (
                <div className="flex items-center gap-2 text-green-300">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm">{formatTime(Math.floor(audioDuration))}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8">
          {/* Recording Section */}
          <div className="bg-gradient-to-br from-indigo-800/40 to-purple-800/40 backdrop-blur-sm rounded-2xl p-6 border border-indigo-500/20 shadow-xl flex flex-col">
            <h3 className="text-lg font-semibold mb-6 text-center">Ghi âm hoặc tải file</h3>
            
            {/* Recording Controls */}
            <div className="flex-1 space-y-4">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isUploading || isTranscribing}
                className={`w-full py-4 px-6 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-3 ${
                  isUploading || isTranscribing
                    ? 'bg-gray-600 cursor-not-allowed'
                    : isRecording 
                    ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                <Mic className="w-5 h-5" />
                {isUploading ? 'Đang tải lên...' : 
                 isTranscribing ? 'Đang xử lý...' :
                 isRecording ? (
                   <span>
                     Đang ghi... {formatTime(recordingTime)}
                     {recordingTime >= 50 && <span className="text-yellow-300 ml-2">(gần hết thời gian)</span>}
                   </span>
                 ) : 'Nhấn vào để ghi âm'}
              </button>

              <div className="relative">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  disabled={isUploading || isTranscribing}
                  className="hidden"
                  id="audio-upload"
                />
                <label
                  htmlFor="audio-upload"
                  className={`w-full py-4 px-6 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-3 cursor-pointer ${
                    isUploading || isTranscribing
                      ? 'bg-gray-600 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  <Upload className="w-5 h-5" />
                  {isUploading ? 'Đang tải lên...' : 
                   isTranscribing ? 'Đang xử lý...' : 
                   'Nhấn vào để tải file ghi âm lên'}
                </label>
              </div>

              <div className="bg-indigo-900/40 rounded-xl p-4 flex-1">
                <p className="text-sm text-gray-300 mb-2">
                  Chọn ngôn ngữ đích để chuyển đổi
                </p>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full bg-indigo-800/40 border border-indigo-500/30 rounded-lg p-3 text-white mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                >
                  <option value="en">Tiếng Anh</option>
                  <option value="ja">Tiếng Nhật</option>
                  <option value="fr">Tiếng Pháp</option>
                </select>
                
                {/* Transcript Status */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getTranscriptStatusIcon()}
                    <p className="text-sm text-gray-300">
                      {getTranscriptStatusText()}
                    </p>
                  </div>
                  {(transcriptStatus === 'error' || transcriptStatus === 'language_error') && audioId && (
                    <button
                      onClick={retryTranscript}
                      disabled={isTranscribing}
                      className="text-xs bg-red-500/20 hover:bg-red-500/30 px-2 py-1 rounded text-red-300 transition-colors disabled:opacity-50"
                    >
                      Thử lại
                    </button>
                  )}
                </div>
                
                {/* Transcript Textarea */}
                <textarea
                  value={transcript}
                  onChange={handleTranscriptChange}
                  disabled={isTranscribing}
                  className={`w-full bg-indigo-800/40 border rounded-lg p-3 text-white placeholder-gray-400 resize-none focus:outline-none focus:ring-2 disabled:opacity-50 ${
                    transcriptStatus === 'language_error' 
                      ? 'border-orange-500/50 focus:ring-orange-500/50' 
                      : 'border-indigo-500/30 focus:ring-indigo-500/50'
                  }`}
                  rows={4}
                  placeholder={isTranscribing ? "Đang xử lý transcript..." : "Transcript sẽ hiển thị ở đây sau khi upload..."}
                />
                
                {transcriptStatus === 'completed' && (
                  <div className="mt-2 p-2 bg-indigo-700/30 rounded text-xs text-gray-300">
                    Bạn có thể chỉnh sửa transcript trước khi chuyển đổi
                  </div>
                )}

                {transcriptStatus === 'language_error' && (
                  <div className="mt-2 p-2 bg-orange-700/30 rounded text-xs text-orange-200">
                    Vui lòng nhập transcript bằng tiếng Việt hoặc tải lại audio bằng tiếng Việt
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleConfirm}
              disabled={!recordedAudio || isUploading || isTranscribing || transcriptStatus === 'language_error'}
              className={`w-full py-4 px-6 rounded-xl font-semibold transition-all duration-300 mt-4 ${
                !recordedAudio || isUploading || isTranscribing || transcriptStatus === 'language_error'
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isUploading ? 'Đang tải lên...' : 
               isTranscribing ? 'Đang xử lý transcript...' : 
               transcriptStatus === 'language_error' ? 'Cần sửa ngôn ngữ trước' :
               'Xác nhận'}
            </button>
          </div>

          {/* Conversion Result Section */}
          <div className="bg-gradient-to-br from-purple-800/40 to-pink-800/40 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/20 shadow-xl flex flex-col">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-white font-bold text-xl">VF</span>
              </div>
              <div className="bg-purple-700/50 backdrop-blur-sm rounded-xl p-4 mx-4 border border-purple-400/30">
                <p className="text-white text-sm">
                  "Hãy nhấn nút Chuyển đổi giọng nói, nếu bạn đã sẵn sàng cho một cuộc chơi..."
                </p>
              </div>
            </div>

            {/* Waveform Visualization */}
            <div className="bg-purple-900/40 rounded-xl p-4 mb-6 flex-1">
              <div className="flex items-center justify-center h-32 w-full">
                {audioWaveform.length > 0 ? (
                  <div className="flex items-center justify-center h-full w-full">
                    <div className="flex items-end gap-1 h-full justify-center">
                      {audioWaveform.map((height, index) => (
                        <div
                          key={index}
                          className={`w-1 transition-all duration-75 ${
                            isPlaying 
                              ? 'bg-gradient-to-t from-green-400 via-blue-400 to-purple-400 animate-pulse' 
                              : 'bg-gradient-to-t from-blue-400 to-purple-400'
                          }`}
                          style={{ height: `${Math.max(height, 5)}%` }}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-400 text-center">
                    <Volume2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Waveform sẽ hiển thị ở đây</p>
                  </div>
                )}
              </div>
              
              {/* Audio Duration Display */}
              {audioDuration && (
                <div className="mt-3 flex items-center justify-center gap-2 text-purple-200">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm">
                    Thời lượng: {formatTime(Math.floor(audioDuration))} / {formatTime(MAX_DURATION)}
                  </span>
                </div>
              )}
            </div>

            {/* Playback Controls */}
            <div className="space-y-4">
              <button
                onClick={handlePlayAudio}
                disabled={!recordedAudio}
                className={`w-full py-4 px-6 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-3 ${
                  !recordedAudio
                    ? 'bg-gray-600 cursor-not-allowed'
                    : isPlaying
                    ? 'bg-green-600 hover:bg-green-700 animate-pulse'
                    : 'bg-pink-600 hover:bg-pink-700'
                }`}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                {isPlaying ? 'Tạm dừng' : 'Phát âm thanh'}
              </button>

              <button
                onClick={handleConvert}
                disabled={!recordedAudio || isConverting || transcriptStatus !== 'completed'}
                className={`w-full py-4 px-6 rounded-xl font-semibold transition-all duration-300 ${
                  !recordedAudio || isConverting || transcriptStatus !== 'completed'
                    ? 'bg-gray-600 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isConverting ? 'Đang chuyển đổi...' : `Chuyển đổi giọng nói sang ${getLanguageName(selectedLanguage)}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;