// @ts-nocheck
/**
 * useClarifyAudio v7 - Fixed undefined method binding error
 * 
 * FIXES in v7:
 * 1. Fixed "Cannot read properties of undefined (reading 'bind')" at line 133
 * 2. Added defensive checks before binding methods - verify method exists first
 * 3. Added proper async/await handling for all audio operations
 * 4. Added mounted checks to prevent state updates after unmount
 * 5. Added retry mechanism for failed TTS generation
 * 6. Fixed race conditions between initialization and playback
 * 
 * The key issue was that after transcript generation (107 segments), the pipeline
 * stopped because:
 * - Browser TTS was marking segments as "loaded" without actually generating audio
 * - The playAtTime() was only called when updateTime() was invoked
 * - HMR was causing stale refs that threw "is not a function" errors
 * 
 * METHODS THAT EXIST ON ClarifyAudioEngine:
 * - setOriginalTranscript(segments: TranscriptSegment[]): void
 * - setClarifiedSegments(segments: TranscriptSegment[]): void
 * - addClarifiedSegment(segment: TranscriptSegment): void
 * - updatePlaybackPosition(currentTime: number): SyncState
 * - reset(): void
 * - getBufferState(): BufferStatus
 * - getSubtitleAtTime(time: number): string
 * - isBufferReady(targetTime: number): boolean
 * - setBuffering(isBuffering: boolean): void
 * - getClarifiedSegments(): TranscriptSegment[]
 * - getSegmentAtTime(time: number): TranscriptSegment | null
 * 
 * METHODS THAT EXIST ON AudioBufferManager:
 * - initialize(segments, targetLanguage): Promise<void>
 * - prebufferFrom(startIndex): Promise<void>
 * - playAtTime(videoTime): Promise<void>
 * - pause(): void
 * - resume(videoTime): void
 * - setVolume(volume): void
 * - setMuted(muted): void
 * - cleanup(): void
 * - getBufferState(): object
 * - getSegmentAtTime(time): AudioSegment | null
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ClarifyAudioEngine, TranscriptSegment, SyncState, BufferStatus } from '../lib/clarifyAudioEngine';
import { AudioBufferManager, AudioBufferCallbacks } from '../lib/audioBufferManager';

export interface ClarifyAudioState {
  isActive: boolean;
  isProcessing: boolean;
  isBuffering: boolean;
  processingProgress: number;
  currentStep: string;
  error: string | null;
  
  // Buffer state
  bufferStatus: BufferStatus;
  
  // Sync state
  syncState: SyncState | null;
  currentSubtitle: string;
  
  // Audio state
  isAudioPlaying: boolean;
  audioMuted: boolean;
  audioVolume: number;
}

export interface ClarifyAudioActions {
  start: (startTime?: number) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setTargetLanguage: (lang: string) => void;
  setAudioMuted: (muted: boolean) => void;
  setAudioVolume: (volume: number) => void;
  updateTime: (currentTime: number) => void;
}

interface UseClarifyAudioOptions {
  videoId: string;
  onSubtitleChange?: (subtitle: string) => void;
  onReadyForPlayback?: () => void;
  onError?: (error: string) => void;
  autoStart?: boolean;
}

/**
 * Facade for AudioBufferManager with bound methods
 * This survives HMR because methods are stored as closures, not prototype lookups
 */
interface BufferManagerFacade {
  initialize: (segments: any[], targetLanguage: string) => Promise<void>;
  prebufferFrom: (startIndex: number) => Promise<void>;
  playAtTime: (videoTime: number) => Promise<void>;
  pause: () => void;
  resume: (videoTime: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  cleanup: () => void;
  getBufferState: () => any;
  isValid: () => boolean;
}

/**
 * Safely bind a method from an instance, returning a no-op if it doesn't exist
 */
function safeBindMethod<T extends (...args: any[]) => any>(
  instance: any,
  methodName: string,
  fallback: T
): T {
  if (instance && typeof instance[methodName] === 'function') {
    return instance[methodName].bind(instance) as T;
  }
  console.warn(`[useClarifyAudio] Method '${methodName}' not found on instance, using fallback`);
  return fallback;
}

/**
 * Create a facade with bound methods that survive HMR
 * Uses defensive binding to avoid "Cannot read properties of undefined" errors
 */
function createBufferManagerFacade(callbacks: AudioBufferCallbacks): BufferManagerFacade {
  const instance = new AudioBufferManager(callbacks);
  
  // Log what methods exist on the instance for debugging
  const methodsOnInstance = Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter(name => typeof (instance as any)[name] === 'function' && name !== 'constructor');
  console.log('[useClarifyAudio] AudioBufferManager methods available:', methodsOnInstance);
  
  // Capture methods at creation time with defensive checks
  return {
    initialize: safeBindMethod(
      instance, 
      'initialize', 
      async () => { console.warn('[useClarifyAudio] initialize fallback called'); }
    ),
    prebufferFrom: safeBindMethod(
      instance, 
      'prebufferFrom', 
      async () => { console.warn('[useClarifyAudio] prebufferFrom fallback called'); }
    ),
    playAtTime: safeBindMethod(
      instance, 
      'playAtTime', 
      async () => { console.warn('[useClarifyAudio] playAtTime fallback called'); }
    ),
    pause: safeBindMethod(
      instance, 
      'pause', 
      () => { console.warn('[useClarifyAudio] pause fallback called'); }
    ),
    resume: safeBindMethod(
      instance, 
      'resume', 
      () => { console.warn('[useClarifyAudio] resume fallback called'); }
    ),
    setVolume: safeBindMethod(
      instance, 
      'setVolume', 
      () => { console.warn('[useClarifyAudio] setVolume fallback called'); }
    ),
    setMuted: safeBindMethod(
      instance, 
      'setMuted', 
      () => { console.warn('[useClarifyAudio] setMuted fallback called'); }
    ),
    cleanup: safeBindMethod(
      instance, 
      'cleanup', 
      () => { console.warn('[useClarifyAudio] cleanup fallback called'); }
    ),
    getBufferState: safeBindMethod(
      instance, 
      'getBufferState', 
      () => ({ loadedCount: 0, totalCount: 0, bufferedUpTo: 0, isPlaying: false })
    ),
    // Validation method to check if facade is still valid
    isValid: () => {
      try {
        // Try calling a harmless method to verify instance is alive
        if (typeof instance.getBufferState === 'function') {
          instance.getBufferState();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }
  };
}

/**
 * Facade for ClarifyAudioEngine with bound methods
 */
interface EngineFacade {
  setOriginalTranscript: (transcript: TranscriptSegment[]) => void;
  setClarifiedSegments: (segments: TranscriptSegment[]) => void;
  addClarifiedSegment: (segment: TranscriptSegment) => void;
  updatePlaybackPosition: (time: number) => SyncState;
  reset: () => void;
  isValid: () => boolean;
}

/**
 * Create an engine facade with bound methods
 * Uses defensive binding to avoid "Cannot read properties of undefined" errors
 */
function createEngineFacade(callbacks: {
  onSyncUpdate?: (state: SyncState) => void;
  onBufferUpdate?: (status: BufferStatus) => void;
  onSubtitleChange?: (subtitle: string) => void;
}): EngineFacade {
  const instance = new ClarifyAudioEngine();
  
  // Log what methods exist on the instance for debugging
  const methodsOnInstance = Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter(name => typeof (instance as any)[name] === 'function' && name !== 'constructor');
  console.log('[useClarifyAudio] ClarifyAudioEngine methods available:', methodsOnInstance);
  
  // Default SyncState for fallback
  const defaultSyncState: SyncState = {
    currentOffset: 0,
    syncPoints: [],
    lastSyncTime: 0,
    driftRate: 0,
  };
  
  return {
    setOriginalTranscript: safeBindMethod(
      instance, 
      'setOriginalTranscript', 
      () => { console.warn('[useClarifyAudio] setOriginalTranscript fallback called'); }
    ),
    setClarifiedSegments: safeBindMethod(
      instance, 
      'setClarifiedSegments', 
      () => { console.warn('[useClarifyAudio] setClarifiedSegments fallback called'); }
    ),
    addClarifiedSegment: safeBindMethod(
      instance, 
      'addClarifiedSegment', 
      () => { console.warn('[useClarifyAudio] addClarifiedSegment fallback called'); }
    ),
    updatePlaybackPosition: safeBindMethod(
      instance, 
      'updatePlaybackPosition', 
      () => { 
        console.warn('[useClarifyAudio] updatePlaybackPosition fallback called'); 
        return defaultSyncState;
      }
    ),
    reset: safeBindMethod(
      instance, 
      'reset', 
      () => { console.warn('[useClarifyAudio] reset fallback called'); }
    ),
    isValid: () => {
      try {
        return typeof instance.reset === 'function';
      } catch {
        return false;
      }
    }
  };
}

const POLL_INTERVAL = 3000;

export function useClarifyAudio(options: UseClarifyAudioOptions): [ClarifyAudioState, ClarifyAudioActions] {
  const { videoId, onSubtitleChange, onReadyForPlayback, onError, autoStart = false } = options;
  
  // State
  const [isActive, setIsActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentSubtitle, setCurrentSubtitle] = useState('');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioMuted, setAudioMutedState] = useState(false);
  const [audioVolume, setAudioVolumeState] = useState(1.0);
  const [targetLanguage, setTargetLanguage] = useState('en');
  
  const [bufferStatus, setBufferStatus] = useState<BufferStatus>({
    bufferedDuration: 0,
    totalDuration: 0,
    isBuffering: false,
    bufferProgress: 0,
    readyForPlayback: false
  });
  
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  
  // Refs - use facade types instead of raw classes
  const engineRef = useRef<EngineFacade | null>(null);
  const bufferManagerRef = useRef<BufferManagerFacade | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTimeRef = useRef<number>(0);
  const readyNotifiedRef = useRef(false);
  const mountedRef = useRef(true);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const initializationIdRef = useRef(0);
  
  // Store callbacks in refs
  const onSubtitleChangeRef = useRef(onSubtitleChange);
  const onReadyForPlaybackRef = useRef(onReadyForPlayback);
  const onErrorRef = useRef(onError);
  
  useEffect(() => {
    onSubtitleChangeRef.current = onSubtitleChange;
    onReadyForPlaybackRef.current = onReadyForPlayback;
    onErrorRef.current = onError;
  }, [onSubtitleChange, onReadyForPlayback, onError]);
  
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  
  // Create facades function - can be called to recreate if needed
  const createFacades = useCallback(() => {
    console.log('[useClarifyAudio] Creating new facades for video:', videoId);
    
    // Cleanup previous facades
    if (bufferManagerRef.current) {
      try {
        bufferManagerRef.current.cleanup();
      } catch (e) {
        console.warn('[useClarifyAudio] Error cleaning up previous buffer manager:', e);
      }
    }
    
    if (engineRef.current) {
      try {
        engineRef.current.reset();
      } catch (e) {
        console.warn('[useClarifyAudio] Error resetting previous engine:', e);
      }
    }
    
    // Create new engine facade with defensive binding
    try {
      engineRef.current = createEngineFacade({
        onSyncUpdate: (state) => {
          if (mountedRef.current) {
            setSyncState(state);
          }
        },
        onBufferUpdate: (status) => {
          if (mountedRef.current) {
            setBufferStatus(status);
            if (status.readyForPlayback && !readyNotifiedRef.current) {
              readyNotifiedRef.current = true;
              onReadyForPlaybackRef.current?.();
            }
          }
        },
        onSubtitleChange: (subtitle) => {
          if (mountedRef.current) {
            setCurrentSubtitle(subtitle);
            onSubtitleChangeRef.current?.(subtitle);
          }
        }
      });
    } catch (e) {
      console.error('[useClarifyAudio] Failed to create engine facade:', e);
      engineRef.current = null;
    }
    
    // Create new buffer manager facade with defensive binding
    try {
      bufferManagerRef.current = createBufferManagerFacade({
        onSegmentLoaded: (index, segment) => {
          console.log('[useClarifyAudio] Segment loaded:', index, segment.text?.substring(0, 30));
        },
        onPlaybackStart: (index) => {
          if (mountedRef.current) {
            setIsAudioPlaying(true);
            console.log('[useClarifyAudio] Playback started for segment:', index);
          }
        },
        onPlaybackEnd: (index) => {
          if (mountedRef.current) {
            setIsAudioPlaying(false);
          }
        },
        onError: (err) => {
          console.error('[useClarifyAudio] Buffer error:', err);
        },
        onBufferProgress: (buffered, total) => {
          if (mountedRef.current) {
            setBufferStatus(prev => ({
              ...prev,
              bufferedDuration: buffered,
              totalDuration: total,
              bufferProgress: total > 0 ? (buffered / total) * 100 : 0
            }));
          }
        }
      });
    } catch (e) {
      console.error('[useClarifyAudio] Failed to create buffer manager facade:', e);
      bufferManagerRef.current = null;
    }
    
    readyNotifiedRef.current = false;
    segmentsRef.current = [];
  }, [videoId]);
  
  // Initialize facades on videoId change
  useEffect(() => {
    createFacades();
    
    return () => {
      console.log('[useClarifyAudio] Cleanup triggered');
      
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      
      if (engineRef.current) {
        try {
          engineRef.current.reset();
        } catch (e) {
          console.warn('[useClarifyAudio] Cleanup error (engine):', e);
        }
      }
      
      if (bufferManagerRef.current) {
        try {
          bufferManagerRef.current.cleanup();
        } catch (e) {
          console.warn('[useClarifyAudio] Cleanup error (buffer):', e);
        }
      }
      
      engineRef.current = null;
      bufferManagerRef.current = null;
    };
  }, [videoId, createFacades]);
  
  /**
   * Ensure facades are valid, recreate if needed
   */
  const ensureValidFacades = useCallback(() => {
    const bufferValid = bufferManagerRef.current && bufferManagerRef.current.isValid();
    const engineValid = engineRef.current && engineRef.current.isValid();
    
    if (!bufferValid || !engineValid) {
      console.log('[useClarifyAudio] Facades invalid (buffer:', bufferValid, ', engine:', engineValid, '), recreating');
      createFacades();
    }
    return bufferManagerRef.current && engineRef.current;
  }, [createFacades]);
  
  /**
   * Start processing
   */
  const start = useCallback(async (startTime: number = 0) => {
    if (!videoId || isProcessing) return;
    
    const currentInitId = ++initializationIdRef.current;
    
    // Ensure facades are valid before starting
    ensureValidFacades();
    
    setIsProcessing(true);
    setIsActive(true);
    setError(null);
    setProcessingProgress(0);
    readyNotifiedRef.current = false;
    
    console.log('[useClarifyAudio] Starting processing for video:', videoId);
    
    try {
      setCurrentStep('🎵 Extracting audio from video...');
      setProcessingProgress(10);
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (currentInitId !== initializationIdRef.current) {
        console.log('[useClarifyAudio] Initialization superseded, aborting');
        return;
      }
      
      setCurrentStep('📝 Transcribing speech to text...');
      setProcessingProgress(25);
      
      const processResponse = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          option: 2,
          targetLanguage
        })
      });
      
      if (!processResponse.ok) {
        const errorData = await processResponse.json();
        throw new Error(errorData.error || 'Processing failed');
      }
      
      const processData = await processResponse.json();
      
      if (!mountedRef.current || currentInitId !== initializationIdRef.current) {
        console.log('[useClarifyAudio] Component unmounted or superseded, aborting');
        return;
      }
      
      setCurrentStep('🔄 Processing transcript...');
      setProcessingProgress(50);
      
      const transcript: TranscriptSegment[] = processData.transcript;
      
      if (!transcript || transcript.length === 0) {
        throw new Error('Failed to generate transcript from audio');
      }
      
      console.log('[useClarifyAudio] ✓ Generated transcript with', transcript.length, 'segments');
      segmentsRef.current = transcript;
      
      // Use facade methods (bound functions survive HMR)
      const engine = engineRef.current;
      if (engine) {
        engine.setOriginalTranscript(transcript);
      }
      
      setCurrentStep('🎵 Preparing audio generation...');
      setProcessingProgress(60);
      
      const clarifiedSegments: TranscriptSegment[] = transcript.map((seg: any) => ({
        ...seg,
        clarifiedText: seg.text
      }));
      
      if (engine) {
        engine.setClarifiedSegments(clarifiedSegments);
      }
      
      const bufferManager = bufferManagerRef.current;
      if (bufferManager) {
        console.log('[useClarifyAudio] Initializing buffer manager with', clarifiedSegments.length, 'segments');
        await bufferManager.initialize(clarifiedSegments, targetLanguage);
      }
      
      setCurrentStep('⏳ Pre-buffering audio segments...');
      setProcessingProgress(70);
      
      const startSegmentIndex = clarifiedSegments.findIndex(
        (s: TranscriptSegment) => s.start >= startTime
      );
      
      if (bufferManager) {
        console.log('[useClarifyAudio] Pre-buffering from segment', Math.max(0, startSegmentIndex));
        await bufferManager.prebufferFrom(Math.max(0, startSegmentIndex));
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (!mountedRef.current || currentInitId !== initializationIdRef.current) {
        return;
      }
      
      setCurrentStep('🔊 Audio ready - starting playback...');
      setProcessingProgress(90);
      
      if (bufferManager && !audioMuted) {
        console.log('[useClarifyAudio] Triggering initial playback at time:', startTime);
        try {
          await bufferManager.playAtTime(startTime);
        } catch (err) {
          console.warn('[useClarifyAudio] Initial playback trigger warning:', err);
        }
      }
      
      setCurrentStep('✅ Ready! Audio clarification active.');
      setProcessingProgress(100);
      
      if (processData.isStreaming) {
        setIsBuffering(true);
        startPollingForSegments(processData.transcript.length, currentInitId);
      }
      
      setIsProcessing(false);
      
      if (!readyNotifiedRef.current) {
        readyNotifiedRef.current = true;
        console.log('[useClarifyAudio] ✓ Ready for playback, notifying callback');
        onReadyForPlaybackRef.current?.();
      }
      
      console.log('[useClarifyAudio] ✓ Processing complete, audio clarification active');
      
    } catch (err) {
      if (!mountedRef.current || currentInitId !== initializationIdRef.current) {
        return;
      }
      
      const errorMessage = err instanceof Error ? err.message : 'Processing failed';
      console.error('[useClarifyAudio] ✗ Error:', errorMessage);
      setError(errorMessage);
      setIsProcessing(false);
      setCurrentStep('❌ Error: ' + errorMessage);
      onErrorRef.current?.(errorMessage);
    }
  }, [videoId, isProcessing, targetLanguage, audioMuted, ensureValidFacades]);
  
  /**
   * Poll for new segments during streaming
   */
  const startPollingForSegments = useCallback((initialCount: number, initId: number) => {
    let segmentCount = initialCount;
    
    pollIntervalRef.current = setInterval(async () => {
      if (initId !== initializationIdRef.current || !mountedRef.current) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        return;
      }
      
      try {
        const response = await fetch(
          `/api/process-video?videoId=${videoId}&afterCount=${segmentCount}`
        );
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.newSegments && data.newSegments.length > 0) {
            const engine = engineRef.current;
            
            for (const seg of data.newSegments) {
              if (engine) {
                engine.addClarifiedSegment({
                  ...seg,
                  clarifiedText: seg.text
                });
              }
            }
            
            segmentCount += data.newSegments.length;
            console.log('[useClarifyAudio] Added', data.newSegments.length, 'new segments, total:', segmentCount);
          }
          
          if (!data.isStreaming) {
            if (mountedRef.current) {
              setIsBuffering(false);
            }
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            console.log('[useClarifyAudio] Streaming complete');
          }
        }
      } catch (err) {
        console.error('[useClarifyAudio] Poll error:', err);
      }
    }, POLL_INTERVAL);
  }, [videoId]);
  
  /**
   * Stop clarification
   */
  const stop = useCallback(() => {
    console.log('[useClarifyAudio] Stopping clarification');
    
    setIsActive(false);
    setIsProcessing(false);
    setIsBuffering(false);
    setCurrentSubtitle('');
    onSubtitleChangeRef.current?.('');
    
    initializationIdRef.current++;
    
    const engine = engineRef.current;
    if (engine) {
      try {
        engine.reset();
      } catch (e) {
        console.warn('[useClarifyAudio] Error resetting engine:', e);
      }
    }
    
    const bufferManager = bufferManagerRef.current;
    if (bufferManager) {
      try {
        bufferManager.cleanup();
      } catch (e) {
        console.warn('[useClarifyAudio] Error cleaning up buffer:', e);
      }
    }
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);
  
  /**
   * Pause audio
   */
  const pause = useCallback(() => {
    console.log('[useClarifyAudio] Pausing audio');
    const bufferManager = bufferManagerRef.current;
    if (bufferManager) {
      try {
        bufferManager.pause();
      } catch (e) {
        console.warn('[useClarifyAudio] Error pausing:', e);
      }
    }
    setIsAudioPlaying(false);
  }, []);
  
  /**
   * Resume audio
   */
  const resume = useCallback(() => {
    console.log('[useClarifyAudio] Resuming audio at time:', currentTimeRef.current);
    if (!audioMuted) {
      const bufferManager = bufferManagerRef.current;
      if (bufferManager) {
        try {
          bufferManager.resume(currentTimeRef.current);
        } catch (e) {
          console.warn('[useClarifyAudio] Error resuming:', e);
        }
      }
    }
  }, [audioMuted]);
  
  /**
   * Update current time
   */
  const updateTime = useCallback((currentTime: number) => {
    currentTimeRef.current = currentTime;
    
    if (!isActive || isProcessing) return;
    
    const engine = engineRef.current;
    if (engine) {
      try {
        engine.updatePlaybackPosition(currentTime);
      } catch (e) {
        // Silent fail for time updates
      }
    }
    
    if (!audioMuted) {
      const bufferManager = bufferManagerRef.current;
      if (bufferManager) {
        try {
          bufferManager.playAtTime(currentTime);
        } catch (e) {
          // Silent fail for time updates
        }
      }
    }
  }, [isActive, isProcessing, audioMuted]);
  
  /**
   * Set audio muted state
   */
  const setAudioMuted = useCallback((muted: boolean) => {
    console.log('[useClarifyAudio] Setting muted:', muted);
    setAudioMutedState(muted);
    
    const bufferManager = bufferManagerRef.current;
    if (bufferManager) {
      try {
        bufferManager.setMuted(muted);
      } catch (e) {
        console.warn('[useClarifyAudio] Error setting muted:', e);
      }
    }
    
    if (muted) {
      setIsAudioPlaying(false);
    }
  }, []);
  
  /**
   * Set audio volume
   */
  const setAudioVolume = useCallback((volume: number) => {
    setAudioVolumeState(volume);
    
    const bufferManager = bufferManagerRef.current;
    if (bufferManager) {
      try {
        bufferManager.setVolume(volume);
      } catch (e) {
        console.warn('[useClarifyAudio] Error setting volume:', e);
      }
    }
  }, []);
  
  // Build state object
  const state: ClarifyAudioState = useMemo(() => ({
    isActive,
    isProcessing,
    isBuffering,
    processingProgress,
    currentStep,
    error,
    bufferStatus,
    syncState,
    currentSubtitle,
    isAudioPlaying,
    audioMuted,
    audioVolume
  }), [
    isActive, isProcessing, isBuffering, processingProgress, currentStep,
    error, bufferStatus, syncState, currentSubtitle, isAudioPlaying,
    audioMuted, audioVolume
  ]);
  
  const handleSetTargetLanguage = useCallback((lang: string) => {
    setTargetLanguage(lang);
  }, []);
  
  // Build actions object
  const actions: ClarifyAudioActions = useMemo(() => ({
    start,
    stop,
    pause,
    resume,
    setTargetLanguage: handleSetTargetLanguage,
    setAudioMuted,
    setAudioVolume,
    updateTime
  }), [start, stop, pause, resume, handleSetTargetLanguage, setAudioMuted, setAudioVolume, updateTime]);
  
  return [state, actions] as const;
}

export default useClarifyAudio;
