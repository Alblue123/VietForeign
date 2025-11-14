"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, ChevronDown, Home, Pause, Volume2, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

interface ConversionData {
  audioId: string;
  selectedLanguage: string;
  originalAudio: string;
  translatedTranscript: string;
  originalTranscript: string;
}

interface ConvertPageProps {
  onBackToHome: () => void;
  conversionData: ConversionData | null;
}

const ConvertPage: React.FC<ConvertPageProps> = ({ onBackToHome, conversionData }) => {
  const [selectedLanguage, setSelectedLanguage] = useState('Chọn ngôn ngữ...');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [conversionText, setConversionText] = useState('Văn bản sẽ xuất hiện ở đây...');
  const [isPlayingOriginal, setIsPlayingOriginal] = useState(false);
  const [isPlayingConverted, setIsPlayingConverted] = useState(false);
  const [originalWaveform, setOriginalWaveform] = useState<number[]>([]);
  const [convertedWaveform, setConvertedWaveform] = useState<number[]>([]);
  
  // Voice conversion states
  const [isConvertingVoice, setIsConvertingVoice] = useState(false);
  const [voiceConversionStatus, setVoiceConversionStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [convertedAudioUrl, setConvertedAudioUrl] = useState<string | null>(null);
  const [convertedAudioBlob, setConvertedAudioBlob] = useState<string | null>(null); // For local blob URL
  const [voiceConversionError, setVoiceConversionError] = useState<string | null>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [selectedAudioFormat, setSelectedAudioFormat] = useState('wav');
  const [isDownloading, setIsDownloading] = useState(false);
  
  const originalAudioRef = useRef<HTMLAudioElement | null>(null);
  const convertedAudioRef = useRef<HTMLAudioElement | null>(null);
  const originalWaveformAnimationRef = useRef<number | null>(null);
  const convertedWaveformAnimationRef = useRef<number | null>(null);
  const originalAudioContextRef = useRef<AudioContext | null>(null);
  const originalAnalyserRef = useRef<AnalyserNode | null>(null);
  const originalDataArrayRef = useRef<Uint8Array | null>(null);
  const convertedAudioContextRef = useRef<AudioContext | null>(null);
  const convertedAnalyserRef = useRef<AnalyserNode | null>(null);
  const convertedDataArrayRef = useRef<Uint8Array | null>(null);
  
  // Ref to prevent multiple API calls
  const voiceConversionInitialized = useRef(false);
  
  
  // Audio format options
  const audioFormats = [
    { value: 'wav', label: 'WAV (High Quality)', mimeType: 'audio/wav' },
    { value: 'mp3', label: 'MP3 (Compressed)', mimeType: 'audio/mpeg' },
    { value: 'ogg', label: 'OGG (Open Source)', mimeType: 'audio/ogg' },
    { value: 'webm', label: 'WebM (Web Optimized)', mimeType: 'audio/webm' }
  ];

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'ja', name: 'Japanese' }, 
    { code: 'fr', name: 'French' }
  ];

  // API configuration
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Function to fetch audio file as blob and create local URL
  const fetchAudioAsBlob = async (audioPath: string): Promise<string> => {
    try {
      // Handle both relative and absolute paths
      const fullPath = audioPath.startsWith('http') ? audioPath : `${API_BASE_URL}${audioPath}`;
      
      console.log('Fetching audio from:', fullPath);
      const response = await fetch(fullPath);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      console.log('Created blob URL:', blobUrl);
      
      return blobUrl;
    } catch (error) {
      console.error('Error fetching audio as blob:', error);
      throw error;
    }
  };

  // Voice conversion API call
  const convertVoiceAPI = async (audioId: string, targetLanguage: string) => {
    // ✅ Prevent multiple simultaneous calls using ref
    if (isConvertingVoice || voiceConversionInitialized.current) {
      console.log('Voice conversion already in progress or completed, skipping...');
      return;
    }

    voiceConversionInitialized.current = true;
    setIsConvertingVoice(true);
    setVoiceConversionStatus('processing');
    setVoiceConversionError(null);

    try {
      console.log(`Converting voice for ID: ${audioId} to language: ${targetLanguage}`);
      
      const response = await fetch(`${API_BASE_URL}/audios/${audioId}/voice-conversion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target_language: targetLanguage }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Voice conversion failed: ${response.status} - ${errorText}`);
        
        if (response.status === 404) {
          throw new Error('Không tìm thấy file audio');
        }
        if (response.status === 400) {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.detail || 'Yêu cầu không hợp lệ');
        }
        throw new Error(`Voice conversion thất bại: ${response.status}`);
      }

      const result = await response.json();
      console.log('Voice conversion successful:', result);
      
      // Set the converted audio URL
      setConvertedAudioUrl(result.converted_audio_url);
      
      // Fetch the audio file as blob for local playback
      try {
        const blobUrl = await fetchAudioAsBlob(result.converted_audio_url);
        setConvertedAudioBlob(blobUrl);
        setVoiceConversionStatus('completed');
      } catch (blobError) {
        console.error('Failed to create blob URL:', blobError);
        // Still mark as completed but with warning
        setVoiceConversionStatus('completed');
        setVoiceConversionError('Audio được tạo thành công nhưng không thể phát. Vui lòng tải xuống để nghe.');
      }
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Voice conversion thất bại';
      setVoiceConversionError(errorMessage);
      setVoiceConversionStatus('error');
      voiceConversionInitialized.current = false; // Reset on error to allow retry
      console.error('Voice conversion error:', error);
      throw error;
    } finally {
      setIsConvertingVoice(false);
    }
  };

  // Retry voice conversion
  const retryVoiceConversion = async () => {
    if (!conversionData) return;
    
    // Reset all states
    voiceConversionInitialized.current = false;
    setConvertedAudioUrl(null);
    setConvertedAudioBlob(null);
    setVoiceConversionStatus('idle');
    setVoiceConversionError(null);
    
    await convertVoiceAPI(conversionData.audioId, conversionData.selectedLanguage);
  };

  // Generate random waveform for demo (similar to upload page)
  const generateWaveform = () => {
    return Array.from({ length: 50 }, () => Math.random() * 100);
  };

  // Generate animated waveform during playback (similar to upload page)
  const animateOriginalWaveform = () => {
    if (!originalAnalyserRef.current || !originalDataArrayRef.current) {
      // Fallback to random animation if Web Audio API isn't available
      const bars = Array.from({ length: 50 }, () => Math.random() * 100 + 10);
      setOriginalWaveform(bars);
    } else {
      // Use real audio analysis
      originalAnalyserRef.current.getByteFrequencyData(originalDataArrayRef.current);
      const bars = Array.from(originalDataArrayRef.current.slice(0, 50), (value) => (value / 255) * 100);
      setOriginalWaveform(bars);
    }

    if (isPlayingOriginal) {
      originalWaveformAnimationRef.current = requestAnimationFrame(animateOriginalWaveform);
    }
  };

  const animateConvertedWaveform = () => {
    if (!convertedAnalyserRef.current || !convertedDataArrayRef.current) {
      // Fallback to random animation if Web Audio API isn't available
      const bars = Array.from({ length: 50 }, () => Math.random() * 100 + 10);
      setConvertedWaveform(bars);
    } else {
      // Use real audio analysis
      convertedAnalyserRef.current.getByteFrequencyData(convertedDataArrayRef.current);
      const bars = Array.from(convertedDataArrayRef.current.slice(0, 50), (value) => (value / 255) * 100);
      setConvertedWaveform(bars);
    }

    if (isPlayingConverted) {
      convertedWaveformAnimationRef.current = requestAnimationFrame(animateConvertedWaveform);
    }
  };

  // Setup Web Audio API for real waveform analysis (similar to upload page)
  const setupOriginalAudioAnalysis = (audioElement: HTMLAudioElement) => {
    try {
      if (!originalAudioContextRef.current) {
        originalAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = originalAudioContextRef.current;
      const source = audioContext.createMediaElementSource(audioElement);
      const analyser = audioContext.createAnalyser();
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      source.connect(analyser);
      analyser.connect(audioContext.destination);

      originalAnalyserRef.current = analyser;
      originalDataArrayRef.current = dataArray;
    } catch (error) {
      console.log('Web Audio API not available for original audio, using fallback animation');
    }
  };

  const setupConvertedAudioAnalysis = (audioElement: HTMLAudioElement) => {
    try {
      if (!convertedAudioContextRef.current) {
        convertedAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = convertedAudioContextRef.current;
      const source = audioContext.createMediaElementSource(audioElement);
      const analyser = audioContext.createAnalyser();
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      source.connect(analyser);
      analyser.connect(audioContext.destination);

      convertedAnalyserRef.current = analyser;
      convertedDataArrayRef.current = dataArray;
    } catch (error) {
      console.log('Web Audio API not available for converted audio, using fallback animation');
    }
  };

  // ✅ Fixed useEffect - only run once when conversionData changes and voice conversion hasn't been initialized
  useEffect(() => {
    // Initialize waveforms
    setOriginalWaveform(generateWaveform());
    setConvertedWaveform(generateWaveform());

    // Set initial data from props and start voice conversion only once
    if (conversionData && !voiceConversionInitialized.current) {
      const targetLang = languages.find(lang => lang.code === conversionData.selectedLanguage);
      setSelectedLanguage(targetLang ? targetLang.name : 'Chọn ngôn ngữ...');
      setConversionText(conversionData.translatedTranscript || 'Văn bản chuyển đổi sẽ hiển thị ở đây...');
      
      // Only start voice conversion if not already initialized
      convertVoiceAPI(conversionData.audioId, conversionData.selectedLanguage);
    }
  }, [conversionData?.audioId]); // Only depend on audioId to prevent multiple calls

  // Updated useEffect for original waveform animation (similar to upload page)
  useEffect(() => {
    if (isPlayingOriginal) {
      animateOriginalWaveform();
    } else if (originalWaveformAnimationRef.current) {
      cancelAnimationFrame(originalWaveformAnimationRef.current);
      originalWaveformAnimationRef.current = null;
    }

    return () => {
      if (originalWaveformAnimationRef.current) {
        cancelAnimationFrame(originalWaveformAnimationRef.current);
      }
    };
  }, [isPlayingOriginal]);

  // Updated useEffect for converted waveform animation (similar to upload page)
  useEffect(() => {
    if (isPlayingConverted) {
      animateConvertedWaveform();
    } else if (convertedWaveformAnimationRef.current) {
      cancelAnimationFrame(convertedWaveformAnimationRef.current);
      convertedWaveformAnimationRef.current = null;
    }

    return () => {
      if (convertedWaveformAnimationRef.current) {
        cancelAnimationFrame(convertedWaveformAnimationRef.current);
      }
    };
  }, [isPlayingConverted]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (convertedAudioBlob) {
        URL.revokeObjectURL(convertedAudioBlob);
      }
    };
  }, [convertedAudioBlob]);

  const handlePlayOriginal = () => {
    if (!conversionData?.originalAudio) return;

    // Stop converted audio if playing
    if (convertedAudioRef.current) {
      convertedAudioRef.current.pause();
      setIsPlayingConverted(false);
    }

    if (originalAudioRef.current) {
      originalAudioRef.current.pause();
      originalAudioRef.current = null;
    }

    if (isPlayingOriginal) {
      setIsPlayingOriginal(false);
      return;
    }

    const audio = new Audio(conversionData.originalAudio);
    originalAudioRef.current = audio;

    setupOriginalAudioAnalysis(audio);

    audio.onplay = () => {
      setIsPlayingOriginal(true);
      if (originalAudioContextRef.current && originalAudioContextRef.current.state === 'suspended') {
        originalAudioContextRef.current.resume();
      }
    };
    
    audio.onpause = () => setIsPlayingOriginal(false);
    
    audio.onended = () => {
      setIsPlayingOriginal(false);
      originalAudioRef.current = null;
      // Reset to static waveform when audio ends
      setOriginalWaveform(generateWaveform());
    };

    audio.onerror = (error) => {
      console.error('Error with original audio:', error);
      setIsPlayingOriginal(false);
    };

    audio.play().catch(error => {
      console.error('Error playing original audio:', error);
      setIsPlayingOriginal(false);
    });
  };

  const handlePlayConverted = () => {
    // Use blob URL if available, otherwise fall back to original URL
    const audioUrl = convertedAudioBlob || convertedAudioUrl;
    
    if (!audioUrl) {
      console.log('No converted audio available yet');
      return;
    }

    // Stop original audio if playing
    if (originalAudioRef.current) {
      originalAudioRef.current.pause();
      setIsPlayingOriginal(false);
    }

    if (convertedAudioRef.current) {
      convertedAudioRef.current.pause();
      convertedAudioRef.current = null;
    }

    if (isPlayingConverted) {
      setIsPlayingConverted(false);
      return;
    }

    console.log('Playing converted audio from:', audioUrl);
    const audio = new Audio(audioUrl);
    convertedAudioRef.current = audio;

    setupConvertedAudioAnalysis(audio);

    audio.onplay = () => {
      setIsPlayingConverted(true);
      if (convertedAudioContextRef.current && convertedAudioContextRef.current.state === 'suspended') {
        convertedAudioContextRef.current.resume();
      }
    };
    
    audio.onpause = () => setIsPlayingConverted(false);
    
    audio.onended = () => {
      setIsPlayingConverted(false);
      convertedAudioRef.current = null;
      // Reset to static waveform when audio ends
      setConvertedWaveform(generateWaveform());
    };

    audio.onerror = (error) => {
      console.error('Error with converted audio:', error);
      setIsPlayingConverted(false);
    };

    audio.play().catch(error => {
      console.error('Error playing converted audio:', error);
      setIsPlayingConverted(false);
    });
  };

  // Convert audio format using Web Audio API
  const convertAudioFormat = async (audioBlob: Blob, targetFormat: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const fileReader = new FileReader();
      
      fileReader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          // Create MediaRecorder for format conversion
          const canvas = document.createElement('canvas');
          const canvasContext = canvas.getContext('2d');
          const mediaStream = (canvas as any).captureStream();
          
          // Create audio stream from buffer
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          
          const destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          
          // Get MIME type for target format
          const targetMimeType = audioFormats.find(f => f.value === targetFormat)?.mimeType || 'audio/wav';
          
          const mediaRecorder = new MediaRecorder(destination.stream, {
            mimeType: targetMimeType
          });
          
          const chunks: BlobPart[] = [];
          
          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data);
            }
          };
          
          mediaRecorder.onstop = () => {
            const convertedBlob = new Blob(chunks, { type: targetMimeType });
            resolve(convertedBlob);
          };
          
          mediaRecorder.start();
          source.start();
          
          // Stop recording when audio ends
          setTimeout(() => {
            mediaRecorder.stop();
            source.stop();
          }, (audioBuffer.duration * 1000) + 100);
          
        } catch (error) {
          reject(error);
        }
      };
      
      fileReader.onerror = () => reject(new Error('Failed to read audio file'));
      fileReader.readAsArrayBuffer(audioBlob);
    });
  };

  // Simple format conversion fallback (just changes extension)
  const downloadWithFormatChange = async (originalBlob: Blob, filename: string, format: string): Promise<void> => {
    try {
      // For WAV, download as-is since most conversions result in WAV
      if (format === 'wav') {
        const url = URL.createObjectURL(originalBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename.replace(/\.[^/.]+$/, '.wav');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      }

      // For other formats, try Web Audio API conversion
      try {
        const convertedBlob = await convertAudioFormat(originalBlob, format);
        const url = URL.createObjectURL(convertedBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename.replace(/\.[^/.]+$/, `.${format}`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (conversionError) {
        console.warn('Audio conversion failed, downloading as original format:', conversionError);
        // Fallback: download with changed extension (browser will handle as best as possible)
        const url = URL.createObjectURL(originalBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename.replace(/\.[^/.]+$/, `.${format}`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Download failed:', error);
      throw error;
    }
  };

  const handleDownload = async () => {
    setShowDownloadModal(true);
  };

  const handleDownloadConfirm = async () => {
    if (!conversionData) return;

    setIsDownloading(true);
    try {
      // Download only the converted audio in selected format if available
      if (convertedAudioBlob || convertedAudioUrl) {
        const audioFilename = `converted_audio_${conversionData.audioId}_${getLanguageDisplayName().toLowerCase()}`;
        
        if (convertedAudioBlob) {
          // Use the blob directly and convert format
          const originalBlob = await fetch(convertedAudioBlob).then(r => r.blob());
          await downloadWithFormatChange(originalBlob, audioFilename, selectedAudioFormat);
        } else if (convertedAudioUrl) {
          // Fetch and download with format conversion
          const audioUrl = convertedAudioUrl.startsWith('http') 
            ? convertedAudioUrl 
            : `${API_BASE_URL}${convertedAudioUrl}`;
          
          const response = await fetch(audioUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.statusText}`);
          }
          
          const audioBlob = await response.blob();
          await downloadWithFormatChange(audioBlob, audioFilename, selectedAudioFormat);
        }
      } else {
        throw new Error('Không có audio để tải xuống');
      }
      
      // Close modal and reset state
      setShowDownloadModal(false);
      setSelectedAudioFormat('wav');
      
    } catch (error) {
      console.error('Download failed:', error);
      alert('Tải xuống thất bại. Vui lòng thử lại.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadCancel = () => {
    setShowDownloadModal(false);
    setSelectedAudioFormat('wav');
  };

  const getLanguageDisplayName = () => {
    if (!conversionData) return 'Chọn ngôn ngữ...';
    const lang = languages.find(l => l.code === conversionData.selectedLanguage);
    return lang ? lang.name : conversionData.selectedLanguage;
  };

  const getVoiceConversionStatusIcon = () => {
    switch (voiceConversionStatus) {
      case 'processing':
        return <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      default:
        return null;
    }
  };

  const getVoiceConversionStatusText = () => {
    switch (voiceConversionStatus) {
      case 'processing':
        return 'Đang chuyển đổi giọng nói...';
      case 'completed':
        return 'Chuyển đổi giọng nói hoàn thành';
      case 'error':
        return 'Lỗi khi chuyển đổi giọng nói';
      default:
        return 'Chuẩn bị chuyển đổi giọng nói';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-blue-200 bg-clip-text text-transparent">
            VietForeign
          </h1>
          <button
            onClick={onBackToHome}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            <Home className="w-4 h-4" />
            Home
          </button>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
            Kết quả chuyển đổi
          </h2>
          <h3 className="text-2xl md:text-3xl font-bold mb-6 leading-tight">
            Chào mừng bạn đến với chân trời mới
          </h3>
          <p className="text-lg text-gray-300">
            Văn bản của bạn đã được dịch sang {getLanguageDisplayName()}
          </p>
        </div>

        {/* Conversion Status */}
        {conversionData && (
          <div className="max-w-2xl mx-auto mb-6 p-4 bg-green-500/20 border border-green-500/30 rounded-lg text-green-200">
            <div className="text-center">
              <p className="font-semibold">✅ Dịch văn bản thành công!</p>
              <p className="text-sm mt-1">Audio ID: {conversionData.audioId} | Ngôn ngữ đích: {getLanguageDisplayName()}</p>
            </div>
          </div>
        )}

        {/* Voice Conversion Status */}
        <div className="max-w-2xl mx-auto mb-6">
          <div className={`p-4 rounded-lg border ${
            voiceConversionStatus === 'completed' ? 'bg-green-500/20 border-green-500/30 text-green-200' :
            voiceConversionStatus === 'processing' ? 'bg-blue-500/20 border-blue-500/30 text-blue-200' :
            voiceConversionStatus === 'error' ? 'bg-red-500/20 border-red-500/30 text-red-200' :
            'bg-gray-500/20 border-gray-500/30 text-gray-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getVoiceConversionStatusIcon()}
                <p className="font-semibold">{getVoiceConversionStatusText()}</p>
              </div>
              {voiceConversionStatus === 'error' && (
                <button
                  onClick={retryVoiceConversion}
                  disabled={isConvertingVoice}
                  className="text-xs bg-red-500/20 hover:bg-red-500/30 px-3 py-1 rounded text-red-300 transition-colors disabled:opacity-50"
                >
                  Thử lại
                </button>
              )}
            </div>
            {voiceConversionError && (
              <p className="text-sm mt-2 opacity-80">Lỗi: {voiceConversionError}</p>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-gradient-to-br from-indigo-800/40 to-purple-800/40 backdrop-blur-sm rounded-2xl p-8 border border-indigo-500/20 shadow-xl">
            
            {/* Language Selection Display */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-4">Ngôn ngữ đích</h3>
              <div className="bg-indigo-800/40 border border-indigo-500/30 rounded-lg p-3 text-white">
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-green-400 rounded-full"></span>
                  {getLanguageDisplayName()}
                </span>
              </div>
            </div>

            {/* Original Audio */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-4">Âm thanh đầu vào (Tiếng Việt)</h3>
              <div className="bg-purple-900/40 rounded-xl p-6">
                {/* Waveform Visualization - Updated to match upload page */}
                <div className="flex items-center justify-center h-32 mb-4">
                  {conversionData?.originalAudio ? (
                    <div className="flex items-center justify-center h-full w-full">
                      <div className="flex items-end gap-1 h-full justify-center">
                        {originalWaveform.map((height, index) => (
                          <div
                            key={index}
                            className={`w-1 transition-all duration-75 ${
                              isPlayingOriginal 
                                ? 'bg-gradient-to-t from-orange-400 via-red-400 to-pink-400 animate-pulse' 
                                : 'bg-gradient-to-t from-orange-400/60 to-red-500/60'
                            }`}
                            style={{ height: `${Math.max(height, 5)}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-400 text-center">
                      <Volume2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Không có audio khả dụng</p>
                    </div>
                  )}
                </div>
                <button 
                  onClick={handlePlayOriginal}
                  disabled={!conversionData?.originalAudio}
                  className={`w-full rounded-lg py-3 flex items-center justify-center gap-2 transition-colors ${
                    !conversionData?.originalAudio
                      ? 'bg-gray-600 cursor-not-allowed'
                      : isPlayingOriginal
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {isPlayingOriginal ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isPlayingOriginal ? 'Tạm dừng âm thanh gốc' : 'Phát âm thanh gốc'}
                </button>
              </div>
            </div>

            {/* Converted Audio */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-4">Âm thanh đầu ra ({getLanguageDisplayName()})</h3>
              <div className="bg-purple-900/40 rounded-xl p-6">
                {/* Waveform Visualization - Updated to match upload page */}
                <div className="flex items-center justify-center h-32 mb-4">
                  {convertedAudioBlob || convertedAudioUrl ? (
                    <div className="flex items-center justify-center h-full w-full">
                      <div className="flex items-end gap-1 h-full justify-center">
                        {convertedWaveform.map((height, index) => (
                          <div
                            key={index}
                            className={`w-1 transition-all duration-75 ${
                              isPlayingConverted 
                                ? 'bg-gradient-to-t from-green-400 via-blue-400 to-purple-400 animate-pulse' 
                                : 'bg-gradient-to-t from-blue-400/80 to-purple-400/80'
                            }`}
                            style={{ height: `${Math.max(height, 5)}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-400 text-center">
                      <Volume2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">
                        {voiceConversionStatus === 'processing' 
                          ? 'Đang tạo audio chuyển đổi...' 
                          : voiceConversionStatus === 'error'
                          ? 'Lỗi tạo audio chuyển đổi'
                          : 'Chưa có audio chuyển đổi'}
                      </p>
                    </div>
                  )}
                </div>
                <button 
                  onClick={handlePlayConverted}
                  disabled={!(convertedAudioBlob || convertedAudioUrl) || voiceConversionStatus === 'processing'}
                  className={`w-full rounded-lg py-3 flex items-center justify-center gap-2 transition-colors ${
                    !(convertedAudioBlob || convertedAudioUrl) || voiceConversionStatus === 'processing'
                      ? 'bg-gray-600 cursor-not-allowed'
                      : isPlayingConverted
                      ? 'bg-purple-600 hover:bg-purple-700'
                      : 'bg-pink-600 hover:bg-pink-700'
                  }`}
                >
                  {voiceConversionStatus === 'processing' ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Đang tạo audio...
                    </>
                  ) : !(convertedAudioBlob || convertedAudioUrl) ? (
                    <>
                      <Volume2 className="w-4 h-4" />
                      Chưa có audio chuyển đổi
                    </>
                  ) : isPlayingConverted ? (
                    <>
                      <Pause className="w-4 h-4" />
                      Tạm dừng âm thanh đã chuyển đổi
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Phát âm thanh đã chuyển đổi
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Translated Text Section */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-4">Văn bản đã dịch ({getLanguageDisplayName()})</h3>
              <div className="bg-purple-900/40 rounded-xl p-6">
                <label className="block text-sm text-gray-300 mb-2">
                  Nội dung đã dịch:
                </label>
                <textarea
                  value={conversionText}
                  readOnly
                  className="w-full bg-indigo-800/40 border border-indigo-500/30 rounded-lg p-4 text-white placeholder-gray-400 resize-none focus:outline-none cursor-default h-32"
                  placeholder="Văn bản dịch sẽ hiển thị ở đây..."
                />
              </div>
            </div>

            {/* Download Button */}
            <button 
              onClick={handleDownload}
              disabled={!conversionData || !(convertedAudioBlob || convertedAudioUrl)}
              className={`w-full rounded-xl py-4 px-6 font-semibold text-white transition-all duration-300 flex items-center justify-center gap-3 shadow-lg ${
                !conversionData || !(convertedAudioBlob || convertedAudioUrl)
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600'
              }`}
            >
              <Download className="w-5 h-5" />
              Tải xuống audio đã chuyển đổi
            </button>

          </div>
        </div>

        {/* Download Modal */}
        {showDownloadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-indigo-800/90 to-purple-800/90 backdrop-blur-sm rounded-2xl p-6 border border-indigo-500/20 shadow-xl max-w-md w-full">
              <h3 className="text-xl font-bold mb-4 text-white">Chọn định dạng audio</h3>
              
              <div className="mb-6">
                <label className="block text-sm text-gray-300 mb-3">
                  Định dạng file audio:
                </label>
                <div className="space-y-2">
                  {audioFormats.map((format) => (
                    <label
                      key={format.value}
                      className="flex items-center gap-3 p-3 bg-indigo-800/40 border border-indigo-500/30 rounded-lg cursor-pointer hover:bg-indigo-700/40 transition-colors"
                    >
                      <input
                        type="radio"
                        name="audioFormat"
                        value={format.value}
                        checked={selectedAudioFormat === format.value}
                        onChange={(e) => setSelectedAudioFormat(e.target.value)}
                        className="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 focus:ring-indigo-500"
                      />
                      <div className="flex-1">
                        <div className="text-white font-medium">{format.label}</div>
                        <div className="text-gray-400 text-xs">{format.mimeType}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mb-4 p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg">
                <p className="text-blue-200 text-sm">
                  🎵 Sẽ tải xuống: Audio chuyển đổi (.{selectedAudioFormat})
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleDownloadCancel}
                  disabled={isDownloading}
                  className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  onClick={handleDownloadConfirm}
                  disabled={isDownloading}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDownloading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Đang tải...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Tải xuống
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConvertPage;