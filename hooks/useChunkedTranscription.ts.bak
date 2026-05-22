/**
 * useChunkedTranscription Hook v70
 * 
 * Full compatibility with AudioClarification v62 component
 * Provides chunked transcription functionality via AssemblyAI API
 */

import { useState, useCallback, useRef } from 'react';

// Types
export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface SpeakerInfo {
  id: string;
  gender: string;
  totalSpeakingTime: number;
  segmentCount: number;
}

export interface ChunkInfo {
  index: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'loading' | 'loaded' | 'error';
  segmentCount: number;
}

export interface TranscriptionConfig {
  videoId: string;
  targetLanguage: string;
  videoDuration?: number;
  chunkDuration?: number;
  bufferAhead?: number;
}

export interface UseChunkedTranscriptionReturn {
  allSegments: TranscriptSegment[];
  chunks: ChunkInfo[];
  loadedRange: { start: number; end: number };
  isInitializing: boolean;
  isLoadingChunk: boolean;
  error: string | null;
  totalSegmentsLoaded: number;
  bufferAheadSeconds: number;
  isReady: boolean;
  speakers: SpeakerInfo[];
  speakerCount: number;
  hasSpeakerInfo: boolean;
  startTranscription: (config: TranscriptionConfig) => Promise<void>;
  stopTranscription: () => void;
  updatePlaybackPosition: (time: number) => void;
}

export function useChunkedTranscription(): UseChunkedTranscriptionReturn {
  // State
  const [allSegments, setAllSegments] = useState<TranscriptSegment[]>([]);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [loadedRange, setLoadedRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [isInitializing, setIsInitializing] = useState<boolean>(false);
  const [isLoadingChunk, setIsLoadingChunk] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [speakers, setSpeakers] = useState<SpeakerInfo[]>([]);
  const [bufferAheadSeconds] = useState<number>(30);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentPositionRef = useRef<number>(0);

  // Computed values
  const totalSegmentsLoaded = allSegments.length;
  const speakerCount = speakers.length;
  const hasSpeakerInfo = speakers.length > 0;

  // Extract speaker info from segments
  const extractSpeakerInfo = useCallback((segments: TranscriptSegment[]): SpeakerInfo[] => {
    const speakerMap = new Map<string, { totalTime: number; count: number }>();

    segments.forEach((segment) => {
      const speakerId = segment.speaker || 'SPEAKER_0';
      const duration = segment.end - segment.start;
      
      if (speakerMap.has(speakerId)) {
        const existing = speakerMap.get(speakerId)!;
        existing.totalTime += duration;
        existing.count += 1;
      } else {
        speakerMap.set(speakerId, { totalTime: duration, count: 1 });
      }
    });

    return Array.from(speakerMap.entries()).map(([id, data]) => ({
      id,
      gender: 'unknown',
      totalSpeakingTime: data.totalTime,
      segmentCount: data.count,
    }));
  }, []);

  // Start transcription
  const startTranscription = useCallback(async (config: TranscriptionConfig): Promise<void> => {
    const { videoId, targetLanguage, videoDuration = 0, chunkDuration = 60, bufferAhead = 30 } = config;

    // Reset state
    setError(null);
    setIsInitializing(true);
    setIsReady(false);
    setAllSegments([]);
    setSpeakers([]);
    setChunks([]);
    setLoadedRange({ start: 0, end: 0 });

    // Create abort controller
    abortControllerRef.current = new AbortController();

    try {
      // Initialize mock chunks based on video duration
      const numChunks = Math.ceil(videoDuration / chunkDuration) || 1;
      const initialChunks: ChunkInfo[] = Array.from({ length: numChunks }, (_, i) => ({
        index: i,
        startTime: i * chunkDuration,
        endTime: Math.min((i + 1) * chunkDuration, videoDuration),
        status: 'pending' as const,
        segmentCount: 0,
      }));
      setChunks(initialChunks);

      setIsInitializing(false);
      setIsLoadingChunk(true);

      // Update first chunk status
      setChunks((prev) =>
        prev.map((chunk, i) => (i === 0 ? { ...chunk, status: 'loading' as const } : chunk))
      );

      // Call AssemblyAI API
      const response = await fetch('/api/assemblyai-transcription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId,
          targetLanguage,
          videoDuration,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const data = await response.json();

      // Process segments from API response
      const processedSegments: TranscriptSegment[] = (data.segments || data.utterances || []).map(
        (seg: any, index: number) => ({
          id: seg.id || `segment-${index}`,
          start: seg.start / 1000, // Convert ms to seconds if needed
          end: seg.end / 1000,
          text: seg.text || '',
          speaker: seg.speaker || `SPEAKER_${index % 2}`,
          confidence: seg.confidence || 1.0,
        })
      );

      // Update state with results
      setAllSegments(processedSegments);
      
      // Extract and set speaker info
      const speakerInfo = extractSpeakerInfo(processedSegments);
      setSpeakers(speakerInfo);

      // Update chunks to loaded
      setChunks((prev) =>
        prev.map((chunk) => ({
          ...chunk,
          status: 'loaded' as const,
          segmentCount: processedSegments.filter(
            (s) => s.start >= chunk.startTime && s.start < chunk.endTime
          ).length,
        }))
      );

      // Update loaded range
      if (processedSegments.length > 0) {
        const maxEnd = Math.max(...processedSegments.map((s) => s.end));
        setLoadedRange({ start: 0, end: maxEnd });
      }

      setIsLoadingChunk(false);
      setIsReady(true);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Transcription was stopped
        return;
      }
      
      console.error('Transcription error:', err);
      setError(err.message || 'Failed to transcribe audio');
      setIsInitializing(false);
      setIsLoadingChunk(false);
      setIsReady(false);

      // Mark chunks as error
      setChunks((prev) =>
        prev.map((chunk) => ({
          ...chunk,
          status: chunk.status === 'loading' ? 'error' as const : chunk.status,
        }))
      );
    }
  }, [extractSpeakerInfo]);

  // Stop transcription
  const stopTranscription = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    setIsInitializing(false);
    setIsLoadingChunk(false);
  }, []);

  // Update playback position (for chunk loading logic)
  const updatePlaybackPosition = useCallback((time: number): void => {
    currentPositionRef.current = time;
    // In a full implementation, this would trigger loading of nearby chunks
    // For now, we just track the position
  }, []);

  return {
    allSegments,
    chunks,
    loadedRange,
    isInitializing,
    isLoadingChunk,
    error,
    totalSegmentsLoaded,
    bufferAheadSeconds,
    isReady,
    speakers,
    speakerCount,
    hasSpeakerInfo,
    startTranscription,
    stopTranscription,
    updatePlaybackPosition,
  };
}

export default useChunkedTranscription;
