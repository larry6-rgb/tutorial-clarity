/**
 * useClarifyAudio v153.1 — Fixed facade method bindings
 * 
 * CRITICAL FIXES:
 * 
 * The v7 facades were trying to bind methods that DON'T EXIST on the actual classes.
 * This caused ALL safeBindMethod calls to fall through to no-op fallbacks, meaning
 * audio never actually played, synced, or buffered.
 * 
 * AudioBufferManager ACTUAL methods vs what facade tried to bind:
 *   ❌ initialize()     → doesn't exist (use addSegments() to add, no init needed)
 *   ❌ prebufferFrom()  → doesn't exist (preBufferSegments is private, auto-called)
 *   ❌ playAtTime()     → actual name is playFromTime()
 *   ❌ resume()         → doesn't exist (use playFromTime to resume)
 *   ❌ cleanup()        → actual name is dispose()
 *   ❌ getBufferStatus() → actual name is getBufferState()
 *   ✅ pause()          → exists
 *   ✅ setVolume()      → exists
 *   ✅ setMuted()       → exists
 * 
 * ClarifyAudioEngine ACTUAL methods vs what facade tried to bind:
 *   ✅ setOriginalTranscript() → exists
 *   ❌ setClarifiedSegments()  → actual name is addClarifiedSegments()
 *   ❌ addClarifiedSegment()   → doesn't exist (only addClarifiedSegments plural)
 *   ✅ updatePlaybackPosition() → exists
 *   ❌ reset()                  → doesn't exist (no reset method on the class)
 * 
 * Install to: hooks/useClarifyAudio.ts
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ClarifyAudioEngine, TranscriptSegment, SyncState, BufferStatus } from '../lib/clarifyAudioEngine';
import { AudioBufferManager, AudioBufferCallbacks, AudioSegment } from '../lib/audioBufferManager';

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
 * v153.1: Facade for AudioBufferManager using CORRECT method names
 */
interface BufferManagerFacade {
  addSegments: (segments: AudioSegment[]) => void;
  playFromTime: (videoTime: number) => Promise<void>;
  pause: () => void;
  stop: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
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
 * v153.1: Create facade with CORRECT method bindings for AudioBufferManager
 * 
 * Actual AudioBufferManager public methods:
 *   getAvailableVoices(), addSegments(), playFromTime(), pause(), stop(),
 *   setVolume(), setMuted(), getBufferState(), dispose()
 */
function createBufferManagerFacade(callbacks: AudioBufferCallbacks): BufferManagerFacade {
  const instance = new AudioBufferManager(callbacks);
  
  const methodsOnInstance = Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter(name => typeof (instance as any)[name] === 'function' && name !== 'constructor');
  console.log('[useClarifyAudio] AudioBufferManager methods available:', methodsOnInstance);
  
  return {
    addSegments: safeBindMethod(
      instance, 'addSegments',
      () => { console.warn('[useClarifyAudio] addSegments fallback called'); }
    ),
    playFromTime: safeBindMethod(
      instance, 'playFromTime',
      async () => { console.warn('[useClarifyAudio] playFromTime fallback called'); }
    ),
    pause: safeBindMethod(
      instance, 'pause',
      () => { console.warn('[useClarifyAudio] pause fallback called'); }
    ),
    stop: safeBindMethod(
      instance, 'stop',
      () => { console.warn('[useClarifyAudio] stop fallback called'); }
    ),
    setVolume: safeBindMethod(
      instance, 'setVolume',
      () => { console.warn('[useClarifyAudio] setVolume fallback called'); }
    ),
    setMuted: safeBindMethod(
      instance, 'setMuted',
      () => { console.warn('[useClarifyAudio] setMuted fallback called'); }
    ),
    dispose: safeBindMethod(
      instance, 'dispose',
      () => { console.warn('[useClarifyAudio] dispose fallback called'); }
    ),
    getBufferState: safeBindMethod(
      instance, 'getBufferState',
      () => ({ segments: [], currentSegmentIndex: -1, bufferedUntil: 0, isBuffering: false, bufferHealth: 0 })
    ),
    isValid: () => {
      try {
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
 * v153.1: Facade for ClarifyAudioEngine using CORRECT method names
 * 
 * Actual ClarifyAudioEngine public methods:
 *   setOriginalTranscript(), addClarifiedSegments(), updatePlaybackPosition(),
 *   getBufferStatus(), getSyncedAudioTime(), getCurrentSubtitle()
 */
interface EngineFacade {
  setOriginalTranscript: (transcript: TranscriptSegment[]) => void;
  addClarifiedSegments: (segments: TranscriptSegment[]) => void;
  updatePlaybackPosition: (time: number) => SyncState;
  getBufferStatus: () => BufferStatus;
  getCurrentSubtitle: (time: number) => string | null;
  isValid: () => boolean;
}

function createEngineFacade(): EngineFacade {
  const instance = new ClarifyAudioEngine();
  
  const methodsOnInstance = Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter(name => typeof (instance as any)[name] === 'function' && name !== 'constructor');
  console.log('[useClarifyAudio] ClarifyAudioEngine methods available:', methodsOnInstance);
  
  const defaultSyncState: SyncState = {
    currentOffset: 0,
    syncPoints: [],
    lastSyncTime: 0,
    driftRate: 0
  };
  
  return {
    setOriginalTranscript: safeBindMethod(
      instance, 'setOriginalTranscript',
      () => { console.warn('[useClarifyAudio] setOriginalTranscript fallback called'); }
    ),
    // v153.1 FIX: Was "setClarifiedSegments" — actual method is "addClarifiedSegments"
    addClarifiedSegments: safeBindMethod(
      instance, 'addClarifiedSegments',
      () => { console.warn('[useClarifyAudio] addClarifiedSegments fallback called'); }
    ),
    updatePlaybackPosition: safeBindMethod(
      instance, 'updatePlaybackPosition',
      () => {
        console.warn('[useClarifyAudio] updatePlaybackPosition fallback called');
        return defaultSyncState;
      }
    ),
    getBufferStatus: safeBindMethod(
      instance, 'getBufferStatus',
      () => ({ bufferedUntil: 0, isBuffering: false, bufferHealth: 0 })
    ),
    getCurrentSubtitle: safeBindMethod(
      instance, 'getCurrentSubtitle',
      () => null
    ),
    isValid: () => {
      try {
        return typeof instance.setOriginalTranscript === 'function';
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
    bufferedUntil: 0,
    isBuffering: false,
    bufferHealth: 0
  });
  
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  
  // Refs
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
    return () => { mountedRef.current = false; };
  }, []);
  
  // Create facades
  const createFacades = useCallback(() => {
    console.log('[useClarifyAudio v153.1] Creating new facades for video:', videoId);
    
    // Cleanup previous
    if (bufferManagerRef.current) {
      try { bufferManagerRef.current.dispose(); } catch (e) {
        console.warn('[useClarifyAudio] Error disposing previous buffer manager:', e);
      }
    }
    
    // v153.1: ClarifyAudioEngine has no reset() — just create a new instance
    // (The old code tried to call engine.reset() which doesn't exist)
    
    // Create new engine facade
    try {
      engineRef.current = createEngineFacade();
    } catch (e) {
      console.error('[useClarifyAudio] Failed to create engine facade:', e);
      engineRef.current = null;
    }
    
    // Create new buffer manager facade
    try {
      bufferManagerRef.current = createBufferManagerFacade({
        onSegmentComplete: (index: number) => {
          console.log('[useClarifyAudio] Segment complete:', index);
        },
        onBufferUpdate: (state: any) => {
          if (mountedRef.current) {
            setBufferStatus({
              bufferedUntil: state.bufferedUntil || 0,
              isBuffering: state.isBuffering || false,
              bufferHealth: state.bufferHealth || 0
            });
          }
        },
        onError: (err: Error) => {
          console.error('[useClarifyAudio] Buffer error:', err);
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
      // v153.1: dispose() instead of cleanup()
      if (bufferManagerRef.current) {
        try { bufferManagerRef.current.dispose(); } catch (e) {
          console.warn('[useClarifyAudio] Cleanup error (buffer):', e);
        }
      }
      engineRef.current = null;
      bufferManagerRef.current = null;
    };
  }, [videoId, createFacades]);
  
  const ensureValidFacades = useCallback(() => {
    const bufferValid = bufferManagerRef.current && bufferManagerRef.current.isValid();
    const engineValid = engineRef.current && engineRef.current.isValid();
    
    if (!bufferValid || !engineValid) {
      console.log('[useClarifyAudio] Facades invalid, recreating');
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
    
    ensureValidFacades();
    
    setIsProcessing(true);
    setIsActive(true);
    setError(null);
    setProcessingProgress(0);
    readyNotifiedRef.current = false;
    
    console.log('[useClarifyAudio v153.1] Starting processing for video:', videoId, 'from time:', startTime);
    
    try {
      setCurrentStep('🎵 Extracting audio from video...');
      setProcessingProgress(10);
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (currentInitId !== initializationIdRef.current) return;
      
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
      
      if (!mountedRef.current || currentInitId !== initializationIdRef.current) return;
      
      setCurrentStep('🔄 Processing transcript...');
      setProcessingProgress(50);
      
      const transcript: TranscriptSegment[] = processData.transcript;
      
      if (!transcript || transcript.length === 0) {
        throw new Error('Failed to generate transcript from audio');
      }
      
      console.log('[useClarifyAudio v153.1] ✓ Generated transcript with', transcript.length, 'segments');
      segmentsRef.current = transcript;
      
      // Set original transcript on engine
      const engine = engineRef.current;
      if (engine) {
        engine.setOriginalTranscript(transcript);
      }
      
      setCurrentStep('🎵 Preparing audio generation...');
      setProcessingProgress(60);
      
      // v153.1 FIX: Use addClarifiedSegments (correct method name)
      if (engine) {
        engine.addClarifiedSegments(transcript);
      }
      
      // v153.1 FIX: Use addSegments() to load segments into buffer manager
      // AudioBufferManager expects AudioSegment[], not TranscriptSegment[]
      const bufferManager = bufferManagerRef.current;
      if (bufferManager) {
        const audioSegments: AudioSegment[] = transcript.map((seg, index) => ({
          index,
          startTime: seg.start,
          endTime: seg.end,
          text: seg.text,
          isLoaded: false,
          isPlaying: false,
          // audioUrl would be set if we had pre-generated TTS URLs
        }));
        console.log('[useClarifyAudio v153.1] Adding', audioSegments.length, 'segments to buffer');
        bufferManager.addSegments(audioSegments);
      }
      
      setCurrentStep('⏳ Pre-buffering audio segments...');
      setProcessingProgress(70);
      
      // Note: preBufferSegments is private and auto-called by addSegments
      // No need to call prebufferFrom (which doesn't exist)
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (!mountedRef.current || currentInitId !== initializationIdRef.current) return;
      
      setCurrentStep('🔊 Audio ready — starting playback...');
      setProcessingProgress(90);
      
      // v153.1 FIX: Use playFromTime (correct method name) + pass startTime
      if (bufferManager && !audioMuted) {
        console.log('[useClarifyAudio v153.1] Triggering initial playback at time:', startTime);
        try {
          await bufferManager.playFromTime(startTime);
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
        onReadyForPlaybackRef.current?.();
      }
      
      console.log('[useClarifyAudio v153.1] ✓ Processing complete');
      
    } catch (err) {
      if (!mountedRef.current || currentInitId !== initializationIdRef.current) return;
      
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
            // v153.1 FIX: addClarifiedSegments takes an array (not addClarifiedSegment singular)
            if (engine) {
              engine.addClarifiedSegments(data.newSegments);
            }
            
            segmentCount += data.newSegments.length;
            console.log('[useClarifyAudio] Added', data.newSegments.length, 'new segments, total:', segmentCount);
          }
          
          if (!data.isStreaming) {
            if (mountedRef.current) setIsBuffering(false);
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
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
    
    // v153.1: ClarifyAudioEngine has no reset() — just recreate facades on next start
    // v153.1: Use stop() then dispose() instead of cleanup()
    const bufferManager = bufferManagerRef.current;
    if (bufferManager) {
      try { bufferManager.stop(); } catch (e) {
        console.warn('[useClarifyAudio] Error stopping buffer:', e);
      }
      try { bufferManager.dispose(); } catch (e) {
        console.warn('[useClarifyAudio] Error disposing buffer:', e);
      }
    }
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    
    // Recreate fresh facades for next use
    createFacades();
  }, [createFacades]);
  
  /**
   * Pause audio
   */
  const pause = useCallback(() => {
    console.log('[useClarifyAudio] Pausing audio');
    const bufferManager = bufferManagerRef.current;
    if (bufferManager) {
      try { bufferManager.pause(); } catch (e) {
        console.warn('[useClarifyAudio] Error pausing:', e);
      }
    }
    setIsAudioPlaying(false);
  }, []);
  
  /**
   * Resume audio — v153.1: use playFromTime since resume() doesn't exist
   */
  const resume = useCallback(() => {
    console.log('[useClarifyAudio] Resuming audio at time:', currentTimeRef.current);
    if (!audioMuted) {
      const bufferManager = bufferManagerRef.current;
      if (bufferManager) {
        try {
          bufferManager.playFromTime(currentTimeRef.current);
        } catch (e) {
          console.warn('[useClarifyAudio] Error resuming:', e);
        }
      }
    }
  }, [audioMuted]);
  
  /**
   * Update current time — drives engine sync + buffer playback
   */
  const updateTime = useCallback((currentTime: number) => {
    currentTimeRef.current = currentTime;
    
    if (!isActive || isProcessing) return;
    
    // Update engine sync position
    const engine = engineRef.current;
    if (engine) {
      try {
        const newSyncState = engine.updatePlaybackPosition(currentTime);
        if (mountedRef.current) {
          setSyncState(newSyncState);
        }
      } catch (e) {
        // Silent fail for time updates
      }
      
      // Get current subtitle from engine
      try {
        const subtitle = engine.getCurrentSubtitle(currentTime);
        if (mountedRef.current && subtitle !== null) {
          setCurrentSubtitle(subtitle);
          onSubtitleChangeRef.current?.(subtitle);
        }
      } catch (e) {
        // Silent fail
      }
    }
    
    // Update buffer status from engine
    if (engine) {
      try {
        const bs = engine.getBufferStatus();
        if (mountedRef.current) {
          setBufferStatus(bs);
        }
      } catch (e) {
        // Silent fail
      }
    }
    
    // v153.1: Don't call playFromTime on every tick — it would restart sequential
    // playback from scratch. AudioBufferManager.playFromTime plays segments
    // sequentially in an async loop, so it manages its own progression.
    // Only call playFromTime when starting or resuming.
  }, [isActive, isProcessing]);
  
  /**
   * Set audio muted state
   */
  const setAudioMuted = useCallback((muted: boolean) => {
    console.log('[useClarifyAudio] Setting muted:', muted);
    setAudioMutedState(muted);
    
    const bufferManager = bufferManagerRef.current;
    if (bufferManager) {
      try { bufferManager.setMuted(muted); } catch (e) {
        console.warn('[useClarifyAudio] Error setting muted:', e);
      }
    }
    
    if (muted) setIsAudioPlaying(false);
  }, []);
  
  /**
   * Set audio volume
   */
  const setAudioVolume = useCallback((volume: number) => {
    setAudioVolumeState(volume);
    
    const bufferManager = bufferManagerRef.current;
    if (bufferManager) {
      try { bufferManager.setVolume(volume); } catch (e) {
        console.warn('[useClarifyAudio] Error setting volume:', e);
      }
    }
  }, []);
  
  // Build state
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
  
  // Build actions
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
