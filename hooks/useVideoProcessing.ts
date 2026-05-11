import { useState, useCallback, useRef, useEffect } from 'react';

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

interface ClarifiedData {
  transcript: TranscriptSegment[];
  audioUrl?: string;
  startTimeOffset: number;
}

interface ProcessingState {
  isStreaming: boolean;
  lastProcessedTime: number;
}

const SEGMENT_POLL_INTERVAL = 5000; // Poll every 5 seconds

export function useVideoProcessing(videoId: string) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('idle');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [clarifiedData, setClarifiedData] = useState<ClarifiedData | null>(null);
  const [error, setError] = useState('');
  const [streamingState, setStreamingState] = useState<ProcessingState>({
    isStreaming: false,
    lastProcessedTime: 0
  });
  
  const processingRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for new segments
  const pollForNewSegments = useCallback(async () => {
    if (!clarifiedData || !streamingState.isStreaming) return;

    try {
      const response = await fetch(
        `/api/process-video?videoId=${videoId}&afterCount=${clarifiedData.transcript.length}`
      );

      if (response.ok) {
        const data = await response.json();
        
        if (data.newSegments && data.newSegments.length > 0) {
          setClarifiedData(prev => prev ? {
            ...prev,
            transcript: [...prev.transcript, ...data.newSegments]
          } : null);
          
          console.log('[useVideoProcessing] Added', data.newSegments.length, 'new segments');
        }

        setStreamingState({
          isStreaming: data.isStreaming,
          lastProcessedTime: data.lastProcessedTime
        });

        if (!data.isStreaming) {
          console.log('[useVideoProcessing] Streaming complete');
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      }
    } catch (err) {
      console.error('[useVideoProcessing] Poll error:', err);
    }
  }, [videoId, clarifiedData, streamingState.isStreaming]);

  // Start polling when streaming
  useEffect(() => {
    if (streamingState.isStreaming && !pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(pollForNewSegments, SEGMENT_POLL_INTERVAL);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [streamingState.isStreaming, pollForNewSegments]);

  const startProcessing = useCallback(async (
    option: number | string, 
    targetLanguage: string,
    startTimeOffset: number = 0
  ) => {
    if (processingRef.current) {
      console.log('[useVideoProcessing] Already processing');
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);
    setProcessingStatus('starting');
    setProcessingProgress(0);
    setCurrentStep('Initializing...');
    setError('');

    console.log('[useVideoProcessing] Starting processing:', { 
      videoId, 
      option, 
      targetLanguage,
      startTimeOffset 
    });

    try {
      setCurrentStep('🎵 Extracting audio...');
      setProcessingProgress(10);
      await new Promise(resolve => setTimeout(resolve, 500));

      setProcessingProgress(25);
      setCurrentStep('📝 Transcribing speech...');
      setProcessingProgress(30);
      await new Promise(resolve => setTimeout(resolve, 500));

      const response = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, option, targetLanguage })
      });

      setProcessingProgress(60);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Processing failed');
      }

      const data = await response.json();
      console.log('[useVideoProcessing] API response:', data);

      setCurrentStep('✨ Building buffer...');
      setProcessingProgress(80);
      await new Promise(resolve => setTimeout(resolve, 500));

      setCurrentStep('✅ Buffer ready!');
      setProcessingProgress(100);

      setClarifiedData({ 
        transcript: data.transcript,
        startTimeOffset: startTimeOffset
      });

      setStreamingState({
        isStreaming: data.isStreaming || false,
        lastProcessedTime: data.lastProcessedTime || 0
      });

      setProcessingProgress(100);
      setProcessingStatus('completed');
      setCurrentStep('✅ Complete!');
      
    } catch (err) {
      console.error('[useVideoProcessing] Error:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
      setProcessingStatus('error');
      setCurrentStep('❌ Error occurred');
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
        processingRef.current = false;
      }, 1000);
    }
  }, [videoId]);

  const stopProcessing = useCallback(() => {
    processingRef.current = false;
    setIsProcessing(false);
    setProcessingStatus('idle');
    setProcessingProgress(0);
    setCurrentStep('');
    setClarifiedData(null);
    setError('');
    setStreamingState({ isStreaming: false, lastProcessedTime: 0 });
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  return {
    isProcessing,
    processingStatus,
    processingProgress,
    currentStep,
    clarifiedData,
    error,
    startProcessing,
    stopProcessing,
    isStreaming: streamingState.isStreaming,
    lastProcessedTime: streamingState.lastProcessedTime
  };
}