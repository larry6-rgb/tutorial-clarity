/**
 * useAudioTranslation v152 — preserve originalText through pipeline for source-language display
 *
 * v152 CHANGES:
 * 1) Added originalText to AudioSegment interface
 * 2) addSegments now accepts and stores originalText
 * 3) buildWordTimestampsFromSegment uses originalText properly (no more 'as any')
 * 4) Console log on segment addition shows originalText vs text
 *
 * Previous: v146 — fix totalCount: use generation target, not video segment count
 *
 * v143 CHANGES:
 * 1) Video playback is always natural speed (1.0x).
 * 2) Rate matching is computed from word-rate math and applied to TTS audio only.
 * 3) Pre-release planner uses locked TTS playback multiplier (no per-segment video-speed coupling).
 * 4) Exposes monitor fields for natural video rate, TTS rate, and applied TTS speed.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceConfig, VoiceProvider, assignVoicesToSpeakers, getVoiceForSpeaker } from '../lib/voiceAssignment';
import { Speaker, SpeakerSegment } from '../lib/speakerDiarization';

// v81: OPENAI_VOICES defined locally to avoid import issues
const OPENAI_VOICES: VoiceConfig[] = [
  { id: 'nova', name: 'Nova', gender: 'female', provider: 'openai' },
  { id: 'shimmer', name: 'Shimmer', gender: 'female', provider: 'openai' },
  { id: 'alloy', name: 'Alloy', gender: 'neutral', provider: 'openai' },
  { id: 'echo', name: 'Echo', gender: 'male', provider: 'openai' },
  { id: 'fable', name: 'Fable', gender: 'male', provider: 'openai' },
  { id: 'onyx', name: 'Onyx', gender: 'male', provider: 'openai' },
];

// v81: Round-robin diverse voice list for auto-assignment
const DIVERSE_VOICE_ORDER = ['nova', 'echo', 'shimmer', 'fable', 'alloy', 'onyx'];

export interface AudioSegment {
  id: string;
  text: string;
  originalText?: string;  // v152: preserve source-language text (e.g. German) from YouTube captions
  startTime: number;
  endTime: number;
  speakerId: string;
  speakerGender: 'male' | 'female' | 'unknown';
  audioGenerated: boolean;
  audioUrl?: string;
  audioError?: string;
  voice?: VoiceConfig;
  targetDuration?: number;
}

interface SpeakerWithCustomVoice extends Speaker {
  customVoice?: string;
}

interface VoiceAssignment {
  speakerId: string;
  voiceId: string;
}

// v81: Return type for playAtTime (inherited from v79)
interface PlayAtTimeResult {
  segmentIndex: number;
  startTime: number;
  segmentId: string;
}

interface SegmentTimeMapEntry {
  index: number;
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  source: 'segment.startTime' | 'segment.id' | 'invalid';
}

type PlaybackMachineState = 'BUFFERING' | 'READY' | 'ARMED' | 'PLAYING' | 'ENDED';
type QueueMode = 'SEQUENTIAL' | 'PROXIMITY';

interface PreReleasePlan {
  segmentIndex: number;
  segmentId: string;
  playbackRate: number;
  startOffset: number;
  expectedEndTime: number;
}

interface AudioTranslationState {
  isEnabled: boolean;
  isGenerating: boolean;
  isPlaying: boolean;
  currentSegmentId: string | null;
  generatedCount: number;
  totalCount: number;
  error: string | null;
  voiceProvider: string;
  speakers: SpeakerWithCustomVoice[];
  voiceAssignments: Map<string, VoiceConfig>;
  customVoiceMappings: Map<string, string>;
  needsAudio: boolean;
  voicesInitialized: boolean;
}

// v86: REMOVED crossfade (was causing stuttering)
// v86: Increased preload lookahead from 3s to 5s for better buffering
const PRELOAD_LOOKAHEAD_SECONDS = 5;

// =====================================================================
// v97: GEORGE THE VIDEO EDITOR — Constants
// =====================================================================
// George's look-ahead window: how far ahead to monitor the video timeline
const GEORGE_LOOK_AHEAD_SECONDS = 0.5;
// George's monitoring interval: how often George checks the timeline (2x per second)
const GEORGE_CHECK_INTERVAL_MS = 500;
// Playback rate limits — keep audio sounding natural
const GEORGE_MIN_PLAYBACK_RATE = 0.8;  // v101.3: never drop to robotic half-speed unless explicitly unavoidable
const GEORGE_MAX_PLAYBACK_RATE = 1.3;  // v101.3: keep speech natural and avoid chipmunk drift
// v140: Balanced jump threshold (2.5s) + short cooldown (2000ms) for tight sync without thrash.
const JUMP_ALIGNMENT_THRESHOLD_SECONDS = 2.5;
const JUMP_COOLDOWN_MS = 2000;

// v101.3: Rolling buffer controls
const INITIAL_BUFFER_TARGET = 30;
const ROLLING_BUFFER_AHEAD_TARGET = 15;
const ROLLING_BUFFER_AHEAD_MIN = 10;
const BATCH_REQUEST_MIN = 3;
const BATCH_REQUEST_MAX = 5;
const ROLLING_CHECK_INTERVAL_MS = 750;
const ROLLING_CHECK_FORCE_THRESHOLD = 8;

type BufferHealth = 'healthy' | 'low' | 'critical';

// v98: George's buffer status — exposed to component for debug overlay
export interface GeorgeBufferStatus {
  currentTime: number;
  lookAheadTime: number;
  currentSegment: number;
  targetSegment: number;
  totalSegments: number;
  playbackRate: number;
  isGeorgeActive: boolean;
  lastAction: string;
  playbackState: PlaybackMachineState;
  minBufferSize: number;
  currentBufferSize: number;
  firstSpeechStart: number;
  totalGenerated: number;
  currentSegmentIndex: number;
  segmentsAhead: number;
  bufferAheadTarget: number;
  bufferHealth: BufferHealth;
}

export type SyncStatusColor = 'green' | 'yellow' | 'red';

export interface SyncStatusMonitor {
  videoTime: number;
  audioPosition: number;
  targetAudioPosition: number;
  positionDiff: number;
  drift: number;
  germanWord: string;
  videoText: string;
  audioText: string;
  status: 'IN SYNC' | 'ALIGNING';
  severity: 'IN_SYNC' | 'ALIGNING';
  color: SyncStatusColor;
  outOfSync: boolean;
  action: string;
  videoRate: number;
  audioRate: number;
  ttsPlaybackSpeed: number;
  ratesMatched: boolean;
  wordsAligned: boolean;
  loopIteration: number;
  isPlaying: boolean;
  updatedAt: number;
}

export interface SyncWordTimestamp {
  word: string;
  startTime: number;
  endTime: number;
  relativeIndex: number;
}

export interface SyncWordComparisonData {
  videoWords: SyncWordTimestamp[];
  audioWords: SyncWordTimestamp[];
  videoSegmentId: string | null;
  audioSegmentId: string | null;
  videoTime: number;
  audioTime: number;
  generatedAt: number;
}

type CalibrationLine = 'video' | 'audio';

interface UseAudioTranslationOptions {
  videoId: string;
  voiceProvider?: VoiceProvider;
  prebufferCount?: number;
  autoAdvance?: boolean;  // v81: Default TRUE (inherited from v80)
  targetLanguage?: string; // v100: Preserve multi-language support in TTS route
  ttsModel?: 'tts-1' | 'tts-1-hd';  // v100: OpenAI model — 'tts-1' (fast, default) or 'tts-1-hd' (quality)
  // v102.1.0: Reuse existing player speed control path (watch/page.tsx -> player.setPlaybackRate)
  setVideoPlaybackRate?: (rate: number) => void;
  // v102.1.0: Optional live playback state from component (used to avoid rate changes while paused)
  isVideoPlaying?: boolean;
  // v102.1.0: Optional direct video-time callback from parent (preferred when available)
  getVideoCurrentTime?: () => number | null | undefined;
}

export function useAudioTranslation(options: UseAudioTranslationOptions) {
  // v81 KEY: autoAdvance defaults to TRUE (inherited from v80)
  // v100: ttsModel defaults to 'tts-1' for speed (~200ms TTFB vs ~500ms for tts-1-hd)
  const {
    videoId,
    voiceProvider = 'openai',
    prebufferCount = 5,
    autoAdvance = true,
    targetLanguage = 'en',
    ttsModel = 'tts-1',
    setVideoPlaybackRate,
    isVideoPlaying = true,
    getVideoCurrentTime,
  } = options;

  const [state, setState] = useState<AudioTranslationState>({
    isEnabled: false,
    isGenerating: false,
    isPlaying: false,
    currentSegmentId: null,
    generatedCount: 0,
    totalCount: 0,
    error: null,
    voiceProvider,
    speakers: [],
    voiceAssignments: new Map(),
    customVoiceMappings: new Map(),
    needsAudio: false,
    voicesInitialized: false,
  });

  // v98: George's buffer status — exposed to component for debug overlay
  const [georgeBufferStatus, setGeorgeBufferStatus] = useState<GeorgeBufferStatus>({
    currentTime: 0,
    lookAheadTime: 0,
    currentSegment: -1,
    targetSegment: -1,
    totalSegments: 0,
    playbackRate: 1.0,
    isGeorgeActive: false,
    lastAction: 'idle',
    playbackState: 'BUFFERING',
    minBufferSize: INITIAL_BUFFER_TARGET,
    currentBufferSize: 0,
    firstSpeechStart: 0,
    totalGenerated: 0,
    currentSegmentIndex: -1,
    segmentsAhead: 0,
    bufferAheadTarget: ROLLING_BUFFER_AHEAD_TARGET,
    bufferHealth: 'critical',
  });

  const [syncStatus, setSyncStatus] = useState<SyncStatusMonitor>({
    videoTime: 0,
    audioPosition: 0,
    targetAudioPosition: 0,
    positionDiff: 0,
    drift: 0,
    germanWord: '(waiting...)',
    videoText: '(loading...)',
    audioText: '(waiting...)',
    status: 'ALIGNING',
    severity: 'ALIGNING',
    color: 'yellow',
    outOfSync: true,
    action: '⏳ Waiting for live sync data',
    videoRate: 1,
    audioRate: 1,
    ttsPlaybackSpeed: 1,
    ratesMatched: false,
    wordsAligned: false,
    loopIteration: 0,
    isPlaying: false,
    updatedAt: Date.now(),
  });

  // v140: simple manual calibration state for the word-comparison panel
  const [selectedLine, setSelectedLine] = useState<CalibrationLine>('video');
  const [videoLineOffset, setVideoLineOffset] = useState<number>(0);
  const [audioLineOffset, setAudioLineOffset] = useState<number>(0);
  const [calibrationLocked, setCalibrationLocked] = useState<boolean>(false);

  // Internal refs
  const segmentsRef = useRef<Map<string, AudioSegment>>(new Map());
  const generationQueueRef = useRef<string[]>([]);
  const isGeneratingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const isEnabledRef = useRef(false);

  const roundOffset = useCallback((value: number): number => Number(value.toFixed(1)), []);

  const adjustSelectedLineOffset = useCallback((delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) return;

    setCalibrationLocked(false);

    if (selectedLine === 'video') {
      setVideoLineOffset((prev) => roundOffset(prev + delta));
      return;
    }

    if (selectedLine === 'audio') {
      setAudioLineOffset((prev) => roundOffset(prev + delta));
    }
  }, [roundOffset, selectedLine]);

  const lockCalibration = useCallback(() => {
    setCalibrationLocked(true);
  }, []);

  useEffect(() => {
    // v148: True smooth scrolling using requestAnimationFrame while key is held
    // Avoids OS key-repeat delay/throttling — gives instant continuous response
    let rafId: number | null = null;
    let scrollDirection = 0; // -1, 0, or 1
    let scrollStartTime = 0;
    let isShift = false;

    const stepFunction = () => {
      if (scrollDirection === 0) {
        rafId = null;
        return;
      }
      const elapsed = Date.now() - scrollStartTime;
      // Smooth acceleration: 0.5 px/frame for first 200ms, then ramp up
      // At 60fps that's 30 frames = 0.6s of acceleration
      let perFrameStep: number;
      if (isShift) {
        perFrameStep = 0.05; // shift = fast (3.0/sec)
      } else if (elapsed < 200) {
        perFrameStep = 0.005; // first 200ms: 0.3/sec — fine control
      } else if (elapsed < 600) {
        perFrameStep = 0.015; // 200-600ms: 0.9/sec — medium
      } else {
        perFrameStep = 0.035; // after 600ms: 2.1/sec — fast
      }
      adjustSelectedLineOffset(scrollDirection * perFrameStep);
      rafId = window.requestAnimationFrame(stepFunction);
    };

    const startScrolling = (direction: number, shift: boolean) => {
      if (scrollDirection === direction && rafId !== null) return; // already scrolling that way
      scrollDirection = direction;
      scrollStartTime = Date.now();
      isShift = shift;
      // Apply immediate first step so single tap is responsive
      adjustSelectedLineOffset(direction * (shift ? 0.1 : 0.02));
      if (rafId === null) {
        // Delay continuous scroll by 250ms so single tap doesn't accelerate
        window.setTimeout(() => {
          if (scrollDirection !== 0 && rafId === null) {
            rafId = window.requestAnimationFrame(stepFunction);
          }
        }, 250);
      }
    };

    const stopScrolling = () => {
      scrollDirection = 0;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (event.repeat) return;
        setCalibrationLocked(false);
        setSelectedLine('video');
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (event.repeat) return;
        setCalibrationLocked(false);
        setSelectedLine('audio');
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.repeat) return; // ignore OS auto-repeat — RAF handles continuous scroll
        startScrolling(-1, event.shiftKey);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.repeat) return;
        startScrolling(1, event.shiftKey);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.repeat) return;
        lockCalibration();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        stopScrolling();
      }
    };

    const onBlur = () => stopScrolling();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      stopScrolling();
    };
  }, [adjustSelectedLineOffset, lockCalibration]);
  const voiceAssignmentsRef = useRef<Map<string, VoiceConfig>>(new Map());
  const customVoiceMappingsRef = useRef<Map<string, string>>(new Map());
  const currentlyPlayingSegmentIndexRef = useRef<number | null>(null);
  const lastAutoAdvanceAttemptRef = useRef<number>(0);
  // v100.2: Forward-only progression guards
  const playedSegmentsRef = useRef<Set<string>>(new Set());
  const lastPlayedTimeRef = useRef<number>(-1);
  const generatingSegmentIdsRef = useRef<Set<string>>(new Set());
  const rollingRefillInProgressRef = useRef<boolean>(false);
  const lastRollingCheckAtRef = useRef<number>(0);
  const maintainRollingBufferRef = useRef<((trigger: string, currentSegmentIndexInput?: number | null) => Promise<void>)>(async () => {});
  const processGenerationQueueRef = useRef<() => void>(() => {});
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const playbackAllowedRef = useRef<boolean>(false);

  const playbackStateRef = useRef<PlaybackMachineState>('BUFFERING');
  const [playbackState, setPlaybackState] = useState<PlaybackMachineState>('BUFFERING');
  const queueModeRef = useRef<QueueMode>('SEQUENTIAL');
  const lastGeneratedIndexRef = useRef<number>(-1);
  const currentSequentialIndexRef = useRef<number>(0);
  const firstSpeechStartRef = useRef<number>(0);
  const minBufferSizeRef = useRef<number>(INITIAL_BUFFER_TARGET);
  const currentBufferSizeRef = useRef<number>(0);
  const preReleasePlanRef = useRef<PreReleasePlan | null>(null);

  // v85: Track whether audio elements have been lazily created
  const audioInitializedRef = useRef<boolean>(false);

  // v84/v85: Dual audio element preloading for gapless transitions
  const preloadAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const preloadedSegmentIdRef = useRef<string | null>(null);
  const preloadReadyRef = useRef<boolean>(false);
  // v85: Second preload element for N+2 segment
  const preload2AudioElementRef = useRef<HTMLAudioElement | null>(null);
  const preloaded2SegmentIdRef = useRef<string | null>(null);
  const preload2ReadyRef = useRef<boolean>(false);

  // v81: Stable refs for callbacks
  const playAtTimeRef = useRef<((time: number) => Promise<PlayAtTimeResult | null>)>(async () => null);
  const playSegmentAudioRef = useRef<((segmentId: string) => Promise<void>)>(async () => {});
  const playSegmentByIndexRef = useRef<((index: number, source: string, videoTime?: number) => Promise<boolean>)>(async () => false);

  // v99: watchdogIntervalRef REMOVED — George's 100ms loop replaces it

  // v85: timeupdate handler ref for cleanup
  const timeUpdateHandlerRef = useRef<(() => void) | null>(null);
  const halfPreloadTriggeredSegmentRef = useRef<number | null>(null);
  const lastBufferHealthRef = useRef<BufferHealth>('critical');

  // v87: Activity gate — when false, all logging and playback callbacks are suppressed
  const isActiveRef = useRef<boolean>(false);

  // v88: Stopped flag — prevents re-creation of intervals after stop
  const stoppedRef = useRef<boolean>(false);

  // v91: Paused flag — when true, suppresses logging and halts generation
  const isPausedRef = useRef<boolean>(false);

  // v99: syncWatchdogIntervalRef REMOVED — George's 100ms loop replaces it
  // v99: transitioningRef + transitioningTimeoutRef REMOVED — was blocking George's ticks

  // v94: Loop detector — tracks consecutive plays of same segment
  const lastPlayedIndexRef = useRef<number>(-1);
  const consecutivePlayCountRef = useRef<number>(0);

  // v99: phraseTimeoutRef REMOVED — George's 100ms loop detects stalled playback

  // v95: Enhanced loop counter — tracks play count per segment index across session
  const loopCounterRef = useRef<Map<number, number>>(new Map());

  // v96: STABLE REF for handleAudioEnded — eliminates stale closure issues
  // All event listeners call handleAudioEndedRef.current() instead of capturing
  // the handleAudioEnded function directly. This ensures the latest version
  // of the callback is always invoked, even if React re-creates it.
  const handleAudioEndedRef = useRef<() => void>(() => {});
  const handleAudioErrorRef = useRef<(e: Event) => void>(() => {});


  // v96: Track whether timeupdate-based end detection has already fired for current segment
  // Prevents double-triggering when both 'ended' event and timeupdate detect the end
  const endDetectionFiredRef = useRef<boolean>(false);

  // v97: GEORGE THE VIDEO EDITOR — Proactive sync monitoring interval
  const georgeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // v97: Track last George log time to avoid log spam (log at most once per second)
  const georgeLastLogTimeRef = useRef<number>(0);
  const georgeLoopIterationRef = useRef<number>(0);
  const georgeLoopStartedRef = useRef<boolean>(false);
  // v102.1.0: Video-rate plumbing + convergence monitoring refs
  const setVideoPlaybackRateRef = useRef<((rate: number) => void) | undefined>(setVideoPlaybackRate);
  const videoIsPlayingRef = useRef<boolean>(isVideoPlaying);
  const lastAppliedVideoRateRef = useRef<number>(1.0);
  const videoElementCacheRef = useRef<HTMLVideoElement | null>(null);
  const lastAppliedAudioRateRef = useRef<number>(1.0);
  const lockedTtsPlaybackRateRef = useRef<number>(1.0);
  const targetVideoWordRateRef = useRef<number>(1.0);
  const targetAudioWordRateRef = useRef<number>(1.0);
  const targetRateLockedRef = useRef<boolean>(false);
  const audioPositionRef = useRef<number>(0);
  const currentSegmentStartAudioPositionRef = useRef<number>(0);
  const segmentDurationByIndexRef = useRef<Map<number, number>>(new Map());
  const lastCompletedSegmentIndexRef = useRef<number>(-1);
  const lastDriftLogAtRef = useRef<number>(0);
  const lastVideoTickRef = useRef<{ time: number; at: number }>({ time: 0, at: Date.now() });
  const getVideoCurrentTimeRef = useRef<(() => number | null | undefined) | undefined>(getVideoCurrentTime);
  const youtubePlayerCacheRef = useRef<any>(null);
  const lastResolvedVideoTimeRef = useRef<number>(0);
  const videoTimeStuckCountRef = useRef<number>(0);
  const currentSyncActionRef = useRef<string>('✅ NORMAL');
  const lastAlignmentDiffRef = useRef<number>(0);
  const lastTargetAudioPositionRef = useRef<number>(0);
  const lastGermanWordRef = useRef<string>('');
  const lastWordsAlignedRef = useRef<boolean>(true);
  const lastJumpTimeRef = useRef<number>(0);
  const syncCheckInFlightRef = useRef<boolean>(false);
  const debouncedVideoTimeRef = useRef<{ time: number; at: number }>({ time: 0, at: 0 });

  const previousVideoIdRef = useRef<string>(videoId);
  const segmentTimesMapRef = useRef<SegmentTimeMapEntry[]>([]);
  const segmentTimeMapSignatureRef = useRef<string>('');
  const lastSelectionLogRef = useRef<{ index: number; timeBucket: number }>({ index: -1, timeBucket: -1 });
  // =====================================================================
  // v101.3: Guarded logging helper — logs once buffering activity is active.
  // Playback permission is no longer required because pre-buffering starts on mount.
  // =====================================================================
  const log = useCallback((...args: any[]) => {
    if (isActiveRef.current && !isPausedRef.current) {
      console.log(...args);
    }
  }, []);

  const logWarn = useCallback((...args: any[]) => {
    if (isActiveRef.current && !isPausedRef.current) {
      console.warn(...args);
    }
  }, []);

  useEffect(() => {
    setVideoPlaybackRateRef.current = setVideoPlaybackRate;
  }, [setVideoPlaybackRate]);

  useEffect(() => {
    videoIsPlayingRef.current = isVideoPlaying;
  }, [isVideoPlaying]);

  useEffect(() => {
    getVideoCurrentTimeRef.current = getVideoCurrentTime;
  }, [getVideoCurrentTime]);

  const getControllableVideoElement = useCallback((): HTMLVideoElement | null => {
    if (videoElementCacheRef.current && !videoElementCacheRef.current.isConnected) {
      videoElementCacheRef.current = null;
    }

    if (videoElementCacheRef.current) {
      return videoElementCacheRef.current;
    }

    const directVideo = document.querySelector('video') as HTMLVideoElement | null;
    if (directVideo) {
      videoElementCacheRef.current = directVideo;
      return directVideo;
    }

    // Reuse existing same-origin iframe probing pattern from AudioClarification v102
    const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        const iframeVideo = iframeDoc?.querySelector('video') as HTMLVideoElement | null;
        if (iframeVideo) {
          videoElementCacheRef.current = iframeVideo;
          return iframeVideo;
        }
      } catch {
        // Cross-origin iframe (expected for YouTube embeds) — ignore.
      }
    }

    return null;
  }, []);

  const postYouTubeCommand = useCallback((func: string, args: any[] = []): boolean => {
    const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];

    for (const iframe of iframes) {
      const src = iframe.src || '';
      const isYouTubeEmbed = src.includes('youtube.com/embed') || src.includes('youtube-nocookie.com/embed');
      if (!isYouTubeEmbed || !iframe.contentWindow) {
        continue;
      }

      try {
        // Same command path used by the working Watch menu controls.
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: 'listening',
            id: 1,
            channel: 'widget',
          }),
          '*',
        );

        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func, args }),
          '*',
        );

        return true;
      } catch {
        // Try the next candidate iframe.
      }
    }

    return false;
  }, []);

  const setYouTubePlaybackRate = useCallback((rate: number): boolean => {
    const normalized = clamp(rate, 0.25, 2.0);

    const setRateFn = setVideoPlaybackRateRef.current;
    if (setRateFn) {
      try {
        setRateFn(normalized);
        lastAppliedVideoRateRef.current = normalized;
        return true;
      } catch (error) {
        logWarn('[v140 George] ⚠️ setVideoPlaybackRate callback failed, trying direct YouTube command', error);
      }
    }

    const posted = postYouTubeCommand('setPlaybackRate', [normalized]);
    if (posted) {
      lastAppliedVideoRateRef.current = normalized;
      return true;
    }

    const videoEl = getControllableVideoElement();
    if (!videoEl) {
      return false;
    }

    try {
      videoEl.playbackRate = normalized;
      lastAppliedVideoRateRef.current = normalized;
      return true;
    } catch (error) {
      logWarn('[v140 George] ⚠️ Failed to set fallback video.playbackRate', error);
      return false;
    }
  }, [getControllableVideoElement, logWarn, postYouTubeCommand]);

  const applyVideoPlaybackRate = useCallback((_rate: number): boolean => {
    // v143: video MUST stay natural speed; ignore requested rate and always enforce 1.0x.
    return setYouTubePlaybackRate(1.0);
  }, [setYouTubePlaybackRate]);

  const seekVideo = useCallback((targetTime: number): boolean => {
    const safeTarget = Math.max(0, Number.isFinite(targetTime) ? targetTime : 0);
    console.log(`[v140 George] 🦘 Seeking video to ${safeTarget.toFixed(2)}s`);

    const w = typeof window !== 'undefined' ? (window as any) : null;
    const candidates = [
      youtubePlayerCacheRef.current,
      w?.__TC_ACTIVE_YT_PLAYER__,
      w?.__YT_PLAYER__,
      w?.youtubePlayer,
      w?.player,
      w?.ytPlayer,
      w?.ytplayer?.player,
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate.seekTo !== 'function') continue;
      try {
        candidate.seekTo(safeTarget, true);
        youtubePlayerCacheRef.current = candidate;
        currentTimeRef.current = safeTarget;
        console.log('[v140 George] ✅ Video seek successful');
        return true;
      } catch {
        // Try next candidate
      }
    }

    const posted = postYouTubeCommand('seekTo', [safeTarget, true]);
    if (posted) {
      currentTimeRef.current = safeTarget;
      console.log('[v140 George] ✅ Video seek successful');
      return true;
    }

    const videoEl = getControllableVideoElement();
    if (videoEl) {
      try {
        videoEl.currentTime = safeTarget;
        currentTimeRef.current = safeTarget;
        console.log('[v140 George] ✅ Video seek successful');
        return true;
      } catch {
        // fall through
      }
    }

    console.warn('[v140 George] ⚠️ Video seek failed');
    return false;
  }, [getControllableVideoElement, postYouTubeCommand]);


  const getYouTubePlayerCurrentTime = useCallback((): number | null => {
    if (typeof window === 'undefined') return null;

    const isPlayable = (candidate: any): candidate is { getCurrentTime: () => number } => {
      return !!candidate && typeof candidate.getCurrentTime === 'function';
    };

    const cached = youtubePlayerCacheRef.current;
    if (isPlayable(cached)) {
      const t = Number(cached.getCurrentTime());
      if (Number.isFinite(t) && t >= 0) return t;
    }

    const w = window as any;
    const candidates = [
      w.__TC_ACTIVE_YT_PLAYER__,
      w.__YT_PLAYER__,
      w.youtubePlayer,
      w.player,
      w.ytPlayer,
      w.ytplayer?.player,
    ];

    for (const candidate of candidates) {
      if (!isPlayable(candidate)) continue;
      try {
        const t = Number(candidate.getCurrentTime());
        if (Number.isFinite(t) && t >= 0) {
          youtubePlayerCacheRef.current = candidate;
          return t;
        }
      } catch {
        // ignore invalid candidate
      }
    }

    return null;
  }, []);

  const getVideoTime = useCallback((reason: string = 'runtime'): number => {
    let resolved = Number.isFinite(currentTimeRef.current) ? currentTimeRef.current : 0;
    let source: 'callback' | 'youtube' | 'element' | 'ref' = 'ref';

    const isLegitimateAutoZero = (value: number, sourceName: 'callback' | 'youtube' | 'element', videoEl?: HTMLVideoElement | null): boolean => {
      if (Math.abs(value) > 0.0001) return true;

      const refLooksAtStart = Number.isFinite(currentTimeRef.current) && Math.abs(currentTimeRef.current) <= 0.25;
      const elementLooksAtStart = !!videoEl && Number.isFinite(videoEl.currentTime) && Math.abs(videoEl.currentTime) <= 0.25;
      const elementStateKnown = !!videoEl && !!videoEl.currentSrc && videoEl.readyState >= 1;
      const hasPausedSignal = !!videoEl && typeof videoEl.paused === 'boolean';
      const hasKnownPlaybackSignal = videoIsPlayingRef.current || (elementStateKnown && hasPausedSignal);

      const legitimateZero = (refLooksAtStart || elementLooksAtStart) && hasKnownPlaybackSignal;
      if (!legitimateZero) {
        log(`[v140 George] ⏭️ Ignoring ${sourceName} time 0.00s (treating as uninitialized; falling back to ref)`);
      }
      return legitimateZero;
    };

    const activeVideoEl = getControllableVideoElement();
    const callbackTime = Number(getVideoCurrentTimeRef.current?.());
    if (Number.isFinite(callbackTime) && callbackTime >= 0 && isLegitimateAutoZero(callbackTime, 'callback', activeVideoEl)) {
      resolved = callbackTime;
      source = 'callback';
    } else {
      const ytTime = Number(getYouTubePlayerCurrentTime());
      if (Number.isFinite(ytTime) && ytTime >= 0 && isLegitimateAutoZero(ytTime, 'youtube', activeVideoEl)) {
        resolved = ytTime;
        source = 'youtube';
      } else {
        const videoEl = activeVideoEl ?? getControllableVideoElement();
        const elementTime = Number(videoEl?.currentTime);
        if (videoEl && Number.isFinite(elementTime) && elementTime >= 0 && isLegitimateAutoZero(elementTime, 'element', videoEl)) {
          resolved = elementTime;
          source = 'element';
        }
      }
    }

    const delta = Math.abs(resolved - lastResolvedVideoTimeRef.current);
    const progressing = delta > 0.005;

    if (progressing) {
      videoTimeStuckCountRef.current = 0;
    } else if (videoIsPlayingRef.current) {
      videoTimeStuckCountRef.current += 1;
      if (videoTimeStuckCountRef.current > 5) {
        logWarn(`[v140 George] ⚠️ Video time stuck at ${resolved.toFixed(2)}s (source=${source}, reason=${reason}, stuckCount=${videoTimeStuckCountRef.current})`);
      }
    } else {
      videoTimeStuckCountRef.current = 0;
    }

    currentTimeRef.current = resolved;
    lastResolvedVideoTimeRef.current = resolved;

    log(`[v140 George] George time: ${resolved.toFixed(2)}s (source: ${source})`);
    log(`[v140 George] 📹 Video time: ${resolved.toFixed(2)}s (${progressing ? 'progressing ✅' : 'STUCK! ⚠️'}) [source=${source}, reason=${reason}]`);
    return resolved;
  }, [getControllableVideoElement, getYouTubePlayerCurrentTime, log, logWarn]);

  const getDebouncedVideoTime = useCallback((reason: string, debounceMs: number = 100): number => {
    const now = Date.now();
    const lastSample = debouncedVideoTimeRef.current;

    if (now - lastSample.at < debounceMs) {
      return lastSample.time;
    }

    const sampled = getVideoTime(reason);
    debouncedVideoTimeRef.current = { time: sampled, at: now };
    return sampled;
  }, [getVideoTime]);

  const logError = useCallback((...args: any[]) => {
    // Errors always log (important for debugging even after stop)
    console.error(...args);
  }, []);

  const extractTimeFromSegmentId = useCallback((segmentId: string): number => {
    const match = segmentId.match(/seg_(\d+\.?\d*)/);
    if (match && match[1]) {
      return parseFloat(match[1]);
    }
    return NaN;
  }, []);

  const getSegmentStartTime = useCallback((segment: AudioSegment): { value: number; source: SegmentTimeMapEntry['source'] } => {
    if (Number.isFinite(segment.startTime)) {
      return { value: segment.startTime, source: 'segment.startTime' };
    }

    const extracted = extractTimeFromSegmentId(segment.id);
    if (Number.isFinite(extracted)) {
      return { value: extracted, source: 'segment.id' };
    }

    return { value: NaN, source: 'invalid' };
  }, [extractTimeFromSegmentId]);

  const formatTime = useCallback((value: number): string => {
    if (!Number.isFinite(value)) return '∞';
    return `${value.toFixed(2)}s`;
  }, []);

  /**
   * v81: getSortedSegments helper
   */
  const getSortedSegments = useCallback((): AudioSegment[] => {
    return Array.from(segmentsRef.current.values())
      .sort((a, b) => {
        const aTiming = getSegmentStartTime(a).value;
        const bTiming = getSegmentStartTime(b).value;

        if (Number.isFinite(aTiming) && Number.isFinite(bTiming)) {
          return aTiming - bTiming;
        }
        if (Number.isFinite(aTiming)) return -1;
        if (Number.isFinite(bTiming)) return 1;
        return a.id.localeCompare(b.id);
      });
  }, [getSegmentStartTime]);

  const buildSegmentTimesMap = useCallback((segments: AudioSegment[], shouldLog: boolean): SegmentTimeMapEntry[] => {
    const map: SegmentTimeMapEntry[] = segments.map((seg, index) => {
      const resolved = getSegmentStartTime(seg);
      const extracted = extractTimeFromSegmentId(seg.id);

      if (shouldLog) {
        if (Number.isFinite(extracted)) {
          log(`[v140 George] Extracted times: ${seg.id} → ${extracted.toFixed(2)}s`);
        } else {
          logWarn(`[v140 George] ⚠️ Failed to extract time from segment ID: ${seg.id}`);
        }
      }

      return {
        index,
        id: seg.id,
        startTime: resolved.value,
        endTime: Number.isFinite(seg.endTime) ? seg.endTime : Infinity,
        duration: Number.isFinite(seg.endTime) && Number.isFinite(resolved.value)
          ? seg.endTime - resolved.value
          : Infinity,
        source: resolved.source,
      };
    });

    for (let i = 0; i < map.length; i++) {
      const current = map[i];
      const next = map[i + 1];
      const candidateEnd = next && Number.isFinite(next.startTime)
        ? next.startTime
        : (Number.isFinite(current.endTime) ? current.endTime : Infinity);

      current.endTime = candidateEnd;
      current.duration = Number.isFinite(current.startTime) && Number.isFinite(candidateEnd)
        ? Math.max(0, candidateEnd - current.startTime)
        : Infinity;

      if (shouldLog) {
        log(`[v140 George] Segment ${current.index}: ${formatTime(current.startTime)} - ${formatTime(current.endTime)} (duration: ${formatTime(current.duration)}) [source=${current.source}]`);
      }
    }

    return map;
  }, [extractTimeFromSegmentId, formatTime, getSegmentStartTime, log, logWarn]);

  const refreshSegmentTimesMap = useCallback((forceLog: boolean = false): SegmentTimeMapEntry[] => {
    const sorted = getSortedSegments();
    const signature = sorted.map(seg => `${seg.id}:${Number.isFinite(seg.startTime) ? seg.startTime.toFixed(2) : 'NaN'}:${Number.isFinite(seg.endTime) ? seg.endTime.toFixed(2) : 'NaN'}`).join('|');
    const shouldRebuild = forceLog || signature !== segmentTimeMapSignatureRef.current || segmentTimesMapRef.current.length !== sorted.length;

    if (!shouldRebuild) {
      return segmentTimesMapRef.current;
    }

    const nextMap = buildSegmentTimesMap(sorted, true);
    segmentTimeMapSignatureRef.current = signature;
    segmentTimesMapRef.current = nextMap;
    return nextMap;
  }, [buildSegmentTimesMap, getSortedSegments]);

  const findSegmentIndex = useCallback((segmentId: string): number => {
    const sorted = getSortedSegments();
    return sorted.findIndex(s => s.id === segmentId);
  }, [getSortedSegments]);

  /**
   * v102.1.0: Video-time-based segment selector.
   * Always resolves to the segment that best matches the current video time.
   */
  const getSegmentIndexForVideoTime = useCallback((videoTime: number): number => {
    const segmentTimesMap = refreshSegmentTimesMap(false);
    if (segmentTimesMap.length === 0) return -1;

    for (let i = 0; i < segmentTimesMap.length; i++) {
      const seg = segmentTimesMap[i];
      if (!Number.isFinite(seg.startTime)) continue;
      if (videoTime >= seg.startTime && videoTime < seg.endTime) {
        const timeBucket = Math.floor(videoTime * 10);
        if (lastSelectionLogRef.current.index !== i || lastSelectionLogRef.current.timeBucket !== timeBucket) {
          log(`[v140 George] Video at ${videoTime.toFixed(2)}s → Selected segment ${i} (${formatTime(seg.startTime)} - ${formatTime(seg.endTime)})`);
          lastSelectionLogRef.current = { index: i, timeBucket };
        }
        return i;
      }
    }

    let closestIndex = 0;
    let closestDiff = Infinity;

    for (let i = 0; i < segmentTimesMap.length; i++) {
      const seg = segmentTimesMap[i];
      if (!Number.isFinite(seg.startTime)) continue;

      const diff = Math.abs(seg.startTime - videoTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }

    if (!Number.isFinite(closestDiff)) {
      logWarn(`[v140 George] ⚠️ No valid segment start times for video ${videoTime.toFixed(2)}s. Falling back to sequential index 0.`);
      return 0;
    }

    const closest = segmentTimesMap[closestIndex];
    log(`[v140 George] Video at ${videoTime.toFixed(2)}s → closest fallback segment ${closestIndex} (${formatTime(closest.startTime)} - ${formatTime(closest.endTime)})`);
    return closestIndex;
  }, [formatTime, log, logWarn, refreshSegmentTimesMap]);

  const findSegmentIndexForTime = useCallback((time: number): number => {
    return getSegmentIndexForVideoTime(time);
  }, [getSegmentIndexForVideoTime]);

  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

  const computeMinBufferSize = useCallback((totalSegments: number): number => {
    // v101.3: Keep startup gate fixed at 30 for normal videos.
    // Only relax when the entire clip has fewer than 30 segments.
    if (totalSegments <= 0) return INITIAL_BUFFER_TARGET;
    if (totalSegments < INITIAL_BUFFER_TARGET) return totalSegments;
    return INITIAL_BUFFER_TARGET;
  }, []);

  const detectSpeechStartTime = useCallback((segments: AudioSegment[]): number => {
    for (const segment of segments) {
      const hasSpeech = (segment.text || '').replace(/\s+/g, '').length > 0;
      const duration = Math.max(0, segment.endTime - segment.startTime);
      if (hasSpeech && duration >= 0.15) {
        return Math.max(0, segment.startTime);
      }
    }
    return segments.length > 0 ? Math.max(0, segments[0].startTime) : 0;
  }, []);

  const getGeneratedSegmentCount = useCallback((sortedSegments: AudioSegment[]): number => {
    return sortedSegments.filter(seg => seg.audioGenerated && !!seg.audioUrl).length;
  }, []);

  const getSequentialTargetCount = useCallback((sortedSegments: AudioSegment[]): number => {
    return Math.min(INITIAL_BUFFER_TARGET, sortedSegments.length);
  }, []);

  const getContiguousGeneratedIndex = useCallback((sortedSegments: AudioSegment[]): number => {
    const targetCount = getSequentialTargetCount(sortedSegments);
    let contiguousIndex = -1;
    for (let i = 0; i < targetCount; i++) {
      const seg = sortedSegments[i];
      if (!seg) break;
      if (seg.audioGenerated && !!seg.audioUrl) {
        contiguousIndex = i;
      } else {
        break;
      }
    }
    return contiguousIndex;
  }, [getSequentialTargetCount]);

  const getSequentialReadyCount = useCallback((sortedSegments: AudioSegment[]): number => {
    const contiguousIndex = getContiguousGeneratedIndex(sortedSegments);
    lastGeneratedIndexRef.current = contiguousIndex;
    return contiguousIndex + 1;
  }, [getContiguousGeneratedIndex]);

  const initializeSequentialBuffer = useCallback((): { targetCount: number; readyCount: number } => {
    const sortedSegments = getSortedSegments();
    const targetCount = getSequentialTargetCount(sortedSegments);
    const contiguousIndex = getContiguousGeneratedIndex(sortedSegments);
    const readyCount = contiguousIndex + 1;

    generationQueueRef.current = [];
    currentSequentialIndexRef.current = Math.max(0, readyCount);
    lastGeneratedIndexRef.current = contiguousIndex;

    if (targetCount <= 0) {
      log('[v140 George] Initializing sequential buffer: no segments available');
      return { targetCount, readyCount };
    }

    const firstThirtyIds: string[] = [];
    for (let i = 0; i < targetCount; i++) {
      const segment = sortedSegments[i];
      if (!segment) continue;
      firstThirtyIds.push(segment.id);
    }

    generationQueueRef.current = firstThirtyIds;
    log(`[v140 George] Initializing sequential buffer: segments 0-${Math.max(0, targetCount - 1)} (${firstThirtyIds.length}/${targetCount})`);

    return { targetCount, readyCount };
  }, [getContiguousGeneratedIndex, getSequentialTargetCount, getSortedSegments, log]);

  const getNextSequentialSegment = useCallback((): { segment: AudioSegment | null; index: number; targetCount: number; readyCount: number } => {
    const sortedSegments = getSortedSegments();
    const targetCount = getSequentialTargetCount(sortedSegments);
    const contiguousIndex = getContiguousGeneratedIndex(sortedSegments);
    const readyCount = contiguousIndex + 1;
    lastGeneratedIndexRef.current = contiguousIndex;

    if (targetCount <= 0) {
      return { segment: null, index: -1, targetCount, readyCount };
    }

    if (currentSequentialIndexRef.current < readyCount) {
      currentSequentialIndexRef.current = readyCount;
    }

    const nextIndex = currentSequentialIndexRef.current;
    if (nextIndex >= targetCount) {
      return { segment: null, index: -1, targetCount, readyCount };
    }

    const nextSegment = sortedSegments[nextIndex] ?? null;
    return { segment: nextSegment, index: nextIndex, targetCount, readyCount };
  }, [getContiguousGeneratedIndex, getSequentialTargetCount, getSortedSegments]);

  const getRollingBufferMetrics = useCallback((currentSegmentIndexInput?: number | null) => {
    const sortedSegments = getSortedSegments();
    const totalGenerated = getGeneratedSegmentCount(sortedSegments);

    if (playbackStateRef.current === 'BUFFERING') {
      const sequentialReady = getSequentialReadyCount(sortedSegments);
      return {
        totalGenerated,
        currentSegmentIndex: sequentialReady - 1,
        segmentsAhead: sequentialReady,
        bufferAheadTarget: Math.max(1, getSequentialTargetCount(sortedSegments)),
        bufferHealth: sequentialReady >= Math.max(1, getSequentialTargetCount(sortedSegments)) ? 'healthy' as BufferHealth : 'critical' as BufferHealth,
        totalSegments: sortedSegments.length,
      };
    }

    const currentSegmentIndex = currentSegmentIndexInput ?? currentlyPlayingSegmentIndexRef.current ?? -1;
    const forwardStartIndex = currentSegmentIndex >= 0 ? currentSegmentIndex : 0;
    const segmentsAhead = sortedSegments
      .slice(forwardStartIndex)
      .filter(seg => seg.audioGenerated && !!seg.audioUrl)
      .length;

    let bufferHealth: BufferHealth = 'healthy';
    if (segmentsAhead < ROLLING_BUFFER_AHEAD_MIN) {
      bufferHealth = 'critical';
    } else if (segmentsAhead < ROLLING_BUFFER_AHEAD_TARGET) {
      bufferHealth = 'low';
    }

    return {
      totalGenerated,
      currentSegmentIndex,
      segmentsAhead,
      bufferAheadTarget: ROLLING_BUFFER_AHEAD_TARGET,
      bufferHealth,
      totalSegments: sortedSegments.length,
    };
  }, [getGeneratedSegmentCount, getSequentialReadyCount, getSequentialTargetCount, getSortedSegments]);
  const applyRollingBufferToStatus = useCallback((
    status: GeorgeBufferStatus,
    currentSegmentIndexInput?: number | null,
    trigger: string = 'status-update'
  ): GeorgeBufferStatus => {
    const metrics = getRollingBufferMetrics(currentSegmentIndexInput);

    if (metrics.bufferHealth !== lastBufferHealthRef.current) {
      log(`[v140 George] 🩺 Buffer health ${lastBufferHealthRef.current} -> ${metrics.bufferHealth} (${trigger}) ahead=${metrics.segmentsAhead}/${metrics.bufferAheadTarget}`);
      lastBufferHealthRef.current = metrics.bufferHealth;
    }

    return {
      ...status,
      totalGenerated: metrics.totalGenerated,
      currentSegmentIndex: metrics.currentSegmentIndex,
      segmentsAhead: metrics.segmentsAhead,
      bufferAheadTarget: metrics.bufferAheadTarget,
      bufferHealth: metrics.bufferHealth,
      totalSegments: metrics.totalSegments,
    };
  }, [getRollingBufferMetrics, log]);
  const updatePlaybackState = useCallback((nextState: PlaybackMachineState, reason: string) => {
    if (playbackStateRef.current === nextState) return;
    const prev = playbackStateRef.current;
    playbackStateRef.current = nextState;

    const nextQueueMode: QueueMode = nextState === 'PLAYING' ? 'PROXIMITY' : 'SEQUENTIAL';
    if (queueModeRef.current !== nextQueueMode) {
      queueModeRef.current = nextQueueMode;
      log(`[v140 George] 🧭 Queue mode: ${nextQueueMode} (${nextQueueMode === 'SEQUENTIAL' ? 'buffering' : 'playing'})`);
    }

    setPlaybackState(nextState);
    log(`[v140 George] 🔁 State transition: ${prev} → ${nextState} (${reason})`);
  }, [log]);

  const getCurrentBufferSize = useCallback((videoTime: number): number => {
    const sorted = getSortedSegments();
    if (sorted.length === 0) return 0;

    if (playbackStateRef.current === 'BUFFERING') {
      return getSequentialReadyCount(sorted);
    }

    const currentIdx = Math.max(0, findSegmentIndexForTime(videoTime));
    const forwardWindow = sorted.slice(currentIdx, Math.min(sorted.length, currentIdx + 24));
    return forwardWindow.filter(seg => seg.audioGenerated && !!seg.audioUrl).length;
  }, [findSegmentIndexForTime, getSequentialReadyCount, getSortedSegments]);

  const demandBasedSelector = useCallback((videoTime: number, sortedSegments: AudioSegment[]): number => {
    if (sortedSegments.length === 0) return -1;

    const lookAheadDemandTime = videoTime + 0.35;
    let idx = getSegmentIndexForVideoTime(lookAheadDemandTime);
    if (idx < 0) idx = getSegmentIndexForVideoTime(videoTime);

    if (idx < 0 || idx >= sortedSegments.length) {
      logError(`[v140 George] ❌ Segment selection failed for video time ${videoTime.toFixed(2)}s; falling back to index 0`);
      return 0;
    }

    return idx;
  }, [getSegmentIndexForVideoTime, logError]);

  const preReleasePlanner = useCallback((videoTime: number, segment: AudioSegment, segmentIndex: number): PreReleasePlan => {
    const segmentDuration = Math.max(0.15, segment.endTime - segment.startTime);
    const startOffset = clamp(videoTime - segment.startTime, 0, Math.max(0, segmentDuration - 0.05));
    const remainingAudio = Math.max(0.05, segmentDuration - startOffset);

    // v143: rate plan is locked from word-rate matching (video natural, TTS adjusted).
    const playbackRate = clamp(
      Number.isFinite(lockedTtsPlaybackRateRef.current) ? lockedTtsPlaybackRateRef.current : 1.0,
      GEORGE_MIN_PLAYBACK_RATE,
      GEORGE_MAX_PLAYBACK_RATE,
    );
    const expectedEndTime = videoTime + (remainingAudio / playbackRate);

    log(`[v143 George] 🧠 Pre-release rate plan seg=${segment.id} lockedTtsRate=${playbackRate.toFixed(3)} startOffset=${startOffset.toFixed(2)}s`);

    return {
      segmentIndex,
      segmentId: segment.id,
      playbackRate,
      startOffset,
      expectedEndTime,
    };
  }, [log]);

  const applyPreReleasePlan = useCallback((plan: PreReleasePlan) => {
    const audioEl = audioElementRef.current;
    if (!audioEl) return;

    const apply = () => {
      try {
        audioEl.playbackRate = plan.playbackRate;
        lastAppliedAudioRateRef.current = plan.playbackRate;
        if (!Number.isNaN(plan.startOffset) && Number.isFinite(plan.startOffset) && Math.abs(audioEl.currentTime - plan.startOffset) > 0.08) {
          audioEl.currentTime = Math.max(0, plan.startOffset);
        }
      } catch (error) {
        logWarn('[v140 George] ⚠️ Failed to apply pre-release offset/rate', error);
      }
    };

    if (audioEl.readyState >= 1) {
      apply();
    } else {
      const onMeta = () => {
        apply();
        audioEl.removeEventListener('loadedmetadata', onMeta);
      };
      audioEl.addEventListener('loadedmetadata', onMeta);
    }

  }, [getSortedSegments]);

  // v100.2: Mark progression watermark immediately when playback is requested
  const markSegmentPlayed = useCallback((segment: AudioSegment, segmentIndex: number, source: string = 'unknown') => {
    const wasAlreadyPlayed = playedSegmentsRef.current.has(segment.id);
    const previousWatermark = lastPlayedTimeRef.current;

    playedSegmentsRef.current.add(segment.id);
    lastPlayedTimeRef.current = Math.max(lastPlayedTimeRef.current, segment.startTime);

    if (wasAlreadyPlayed) {
      log(`[v140 George] ♻️ Segment already marked: ${segment.id} (index ${segmentIndex}) from ${source}; watermark ${previousWatermark.toFixed(2)}s -> ${lastPlayedTimeRef.current.toFixed(2)}s`);
    } else {
      log(`[v140 George] ✅ Marked segment played: ${segment.id} (index ${segmentIndex}) from ${source}; watermark ${previousWatermark.toFixed(2)}s -> ${lastPlayedTimeRef.current.toFixed(2)}s`);
    }
  }, [log]);

  // =====================================================================
  // v85: Preload helpers
  // =====================================================================

  /**
   * v85: preloadNextSegment - Preload the N+1 segment into preloadAudioElementRef.
   * Also triggers preloading of N+2 into preload2AudioElementRef.
   */
  const preloadNextSegment = useCallback((currentSegmentIndex: number) => {
    const sortedSegments = getSortedSegments();
    const nextIndex = currentSegmentIndex + 1;

    if (nextIndex >= sortedSegments.length) {
      log('[v140 George] 🔮 No next segment to preload (last segment playing)');
      preloadedSegmentIdRef.current = null;
      preloadReadyRef.current = false;
      return;
    }

    const nextSegment = sortedSegments[nextIndex];

    // Already preloaded this segment?
    if (preloadedSegmentIdRef.current === nextSegment.id && preloadReadyRef.current) {
      log('[v140 George] 🔮 Next segment already preloaded:', nextSegment.id);
      // Still try to preload N+2
      preloadSegmentN2(nextIndex);
      return;
    }

    // Is the audio generated?
    if (!nextSegment.audioGenerated || !nextSegment.audioUrl || nextSegment.audioUrl === 'browser-tts') {
      log('[v140 George] 🔮 Next segment not ready for preload:', nextSegment.id,
        nextSegment.audioGenerated ? '(browser-tts or no URL)' : '(not generated yet)');
      preloadedSegmentIdRef.current = null;
      preloadReadyRef.current = false;
      return;
    }

    // Create preload element if needed
    if (!preloadAudioElementRef.current) {
      preloadAudioElementRef.current = new Audio();
    }

    log('[v140 George] 🔮 Preloading next segment:', nextSegment.id,
      'startTime:', nextSegment.startTime.toFixed(2));

    preloadedSegmentIdRef.current = nextSegment.id;
    preloadReadyRef.current = false;

    const preloadEl = preloadAudioElementRef.current;
    preloadEl.src = nextSegment.audioUrl;
    preloadEl.preload = 'auto';
    preloadEl.volume = 1;

    const onCanPlay = () => {
      if (preloadedSegmentIdRef.current === nextSegment.id) {
        preloadReadyRef.current = true;
        log('[v140 George] 🔮 ✅ Preload ready:', nextSegment.id);
      }
      preloadEl.removeEventListener('canplaythrough', onCanPlay);
    };
    preloadEl.addEventListener('canplaythrough', onCanPlay);
    preloadEl.load();

    // v85: Also preload N+2
    preloadSegmentN2(nextIndex);
  }, [getSortedSegments]);

  /**
   * v85: preloadSegmentN2 - Preload the N+2 segment into preload2AudioElementRef.
   */
  const preloadSegmentN2 = useCallback((nextIndex: number) => {
    const sortedSegments = getSortedSegments();
    const n2Index = nextIndex + 1;

    if (n2Index >= sortedSegments.length) {
      preloaded2SegmentIdRef.current = null;
      preload2ReadyRef.current = false;
      return;
    }

    const n2Segment = sortedSegments[n2Index];

    // Already preloaded?
    if (preloaded2SegmentIdRef.current === n2Segment.id && preload2ReadyRef.current) {
      return;
    }

    if (!n2Segment.audioGenerated || !n2Segment.audioUrl || n2Segment.audioUrl === 'browser-tts') {
      preloaded2SegmentIdRef.current = null;
      preload2ReadyRef.current = false;
      return;
    }

    if (!preload2AudioElementRef.current) {
      preload2AudioElementRef.current = new Audio();
    }

    log('[v140 George] 🔮🔮 Preloading N+2 segment:', n2Segment.id);

    preloaded2SegmentIdRef.current = n2Segment.id;
    preload2ReadyRef.current = false;

    const el = preload2AudioElementRef.current;
    el.src = n2Segment.audioUrl;
    el.preload = 'auto';
    el.volume = 1;

    const onCanPlay = () => {
      if (preloaded2SegmentIdRef.current === n2Segment.id) {
        preload2ReadyRef.current = true;
        log('[v140 George] 🔮🔮 ✅ N+2 preload ready:', n2Segment.id);
      }
      el.removeEventListener('canplaythrough', onCanPlay);
    };
    el.addEventListener('canplaythrough', onCanPlay);
    el.load();
  }, [getSortedSegments]);

  // =====================================================================
  // v85: timeupdate-based early preload trigger
  // =====================================================================

  const attachTimeUpdatePreload = useCallback((audioEl: HTMLAudioElement) => {
    if (timeUpdateHandlerRef.current) {
      audioEl.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
    }

    const handler = () => {
      if (!isActiveRef.current) return; // v88: gate
      if (!audioEl.duration || isNaN(audioEl.duration)) return;
      const remaining = audioEl.duration - audioEl.currentTime;
      const progressRatio = audioEl.duration > 0 ? (audioEl.currentTime / audioEl.duration) : 0;
      const idx = currentlyPlayingSegmentIndexRef.current;

      if (idx !== null && progressRatio >= 0.5 && halfPreloadTriggeredSegmentRef.current !== idx) {
        halfPreloadTriggeredSegmentRef.current = idx;
        log(`[v140 George] ⏱️ 50% preload trigger for seg index ${idx}`);
        void maintainRollingBufferRef.current('halfway-trigger', idx);
      }

      if (remaining <= PRELOAD_LOOKAHEAD_SECONDS && remaining > 0) {
        if (!preloadReadyRef.current && idx !== null) {
          log('[v140 George] ⏱️ Early preload trigger — ', remaining.toFixed(1), 's remaining');
          preloadNextSegment(idx);
          void maintainRollingBufferRef.current('remaining-lookahead', idx);
        }
      }

      // v95: Pre-emptive advance — trigger preload of next segment when < 0.3s remaining
      if (remaining <= 0.3 && remaining > 0) {
        if (idx !== null) {
          const nextIndex = idx + 1;
          const sortedSegs = getSortedSegments();
          if (nextIndex < sortedSegs.length && !preloadReadyRef.current) {
            log(`[v140 George] ⏭️ Pre-emptive advance: ${remaining.toFixed(2)}s remaining, preloading segment ${nextIndex}`);
            preloadNextSegment(idx);
          }
        }
      }

      // v96: BACKUP END DETECTION via timeupdate
      // If we've reached within 0.05s of the end and the 'ended' event hasn't fired,
      // manually trigger handleAudioEnded. This catches Electron/Chromium bugs where
      // the 'ended' event silently fails to fire.
      if (remaining <= 0.05 && remaining >= 0 && !endDetectionFiredRef.current) {
        log(`[v140 George] ⚠️ timeupdate backup: audio at ${audioEl.currentTime.toFixed(3)}/${audioEl.duration.toFixed(3)}, remaining=${remaining.toFixed(3)}s — triggering handleAudioEnded`);
        handleAudioEndedRef.current();
      }
    };

    timeUpdateHandlerRef.current = handler;
    audioEl.addEventListener('timeupdate', handler);
  }, [preloadNextSegment, getSortedSegments]);

  // =====================================================================
  // handleAudioEnded / handleAudioError
  // =====================================================================

  const getSegmentDurationSeconds = useCallback((segment: AudioSegment | undefined): number => {
    if (!segment) return 0;
    if (Number.isFinite(segment.targetDuration as number) && (segment.targetDuration as number) > 0) {
      return segment.targetDuration as number;
    }
    if (Number.isFinite(segment.endTime) && Number.isFinite(segment.startTime)) {
      return Math.max(0, segment.endTime - segment.startTime);
    }
    return 0;
  }, []);

  const getAudioPositionForIndex = useCallback((index: number): number => {
    if (!Number.isFinite(index) || index <= 0) return 0;
    const sortedSegments = getSortedSegments();
    let total = 0;
    for (let i = 0; i < Math.min(index, sortedSegments.length); i += 1) {
      const knownDuration = segmentDurationByIndexRef.current.get(i);
      total += Number.isFinite(knownDuration as number) && (knownDuration as number) > 0
        ? (knownDuration as number)
        : getSegmentDurationSeconds(sortedSegments[i]);
    }
    return total;
  }, [getSegmentDurationSeconds, getSortedSegments]);

  const getAudioPosition = useCallback((): number => {
    const audioEl = audioElementRef.current;
    if (!audioEl || audioEl.paused || currentlyPlayingSegmentIndexRef.current === null) {
      return audioPositionRef.current;
    }

    const elapsed = Math.max(0, Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0);
    const live = currentSegmentStartAudioPositionRef.current + elapsed;
    return Number.isFinite(live) ? live : audioPositionRef.current;
  }, []);

  const getSegmentAtTime = useCallback((timeInSeconds: number): AudioSegment | null => {
    if (!Number.isFinite(timeInSeconds)) return null;

    const segmentList = getSortedSegments();
    if (segmentList.length === 0) return null;

    const matchingSegments = segmentList.filter((segment) => {
      if (!Number.isFinite(segment.startTime) || !Number.isFinite(segment.endTime)) return false;
      return timeInSeconds >= segment.startTime && timeInSeconds < segment.endTime;
    });

    if (matchingSegments.length > 0) {
      const sortedMatches = [...matchingSegments].sort((a, b) => b.startTime - a.startTime);
      const selectedSegment = sortedMatches[0];

      if (sortedMatches.length > 1) {
        console.log(
          '[v140 George] 🧠 Overlap detected in getSegmentAtTime:',
          `${sortedMatches.length} segments matched at ${timeInSeconds.toFixed(2)}s`
        );
        console.log(
          '[v140 George] 🧠 Selected latest-start segment:',
          selectedSegment.id,
          `(${selectedSegment.startTime.toFixed(2)}s - ${selectedSegment.endTime.toFixed(2)}s)`
        );
      }
      return selectedSegment;
    }

    const mappedIndex = findSegmentIndexForTime(timeInSeconds);
    if (mappedIndex >= 0 && mappedIndex < segmentList.length) {
      return segmentList[mappedIndex];
    }

    return null;
  }, [findSegmentIndexForTime, getSortedSegments]);

  const getTranscriptTextAtTime = useCallback((timeInSeconds: number, source: 'video' | 'audio'): string => {
    const segment = getSegmentAtTime(timeInSeconds);
    if (!segment) {
      return source === 'video' ? '(loading...)' : '(waiting...)';
    }

    const rawText = segment.originalText || segment.text;
    const cleaned = typeof rawText === 'string' ? rawText.trim() : '';
    return cleaned.length > 0 ? cleaned : '(no text)';
  }, [getSegmentAtTime]);


  const buildWordTimestampsFromSegment = useCallback((segment: AudioSegment, source: 'video' | 'audio'): SyncWordTimestamp[] => {
    // v152: Use originalText (source-language) for video row, translated text for audio row
    const sourceText = source === 'video'
      ? (segment.originalText || segment.text || '')
      : (segment.text || segment.originalText || '');

    const cleanedText = typeof sourceText === 'string' ? sourceText.trim() : '';
    if (!cleanedText) return [];

    const words = cleanedText
      .split(/\s+/)
      .map(w => w.replace(/[“”"'`´.,!?;:()[\]{}<>]+/g, '').trim())
      .filter(Boolean);

    if (words.length === 0) return [];

    const segStart = Number.isFinite(segment.startTime) ? segment.startTime : 0;
    const segEnd = Number.isFinite(segment.endTime) && segment.endTime > segStart
      ? segment.endTime
      : segStart + Math.max(1, cleanedText.length / 15);

    const totalDuration = Math.max(0.05, segEnd - segStart);
    const perWordDuration = totalDuration / words.length;

    return words.map((word, index) => {
      const startTime = segStart + (index * perWordDuration);
      const endTime = index === words.length - 1 ? segEnd : startTime + perWordDuration;
      return {
        word,
        startTime,
        endTime,
        relativeIndex: index,
      };
    });
  }, []);

  // v149: Build a CONTINUOUS word stream across multiple segments so scrolling
  // works smoothly instead of being locked to one segment's few words.
  const getWordWindowForTime = useCallback((timeInSeconds: number, source: 'video' | 'audio', beforeCount: number = 3, afterCount: number = 3): { words: SyncWordTimestamp[]; segmentId: string | null } => {
    const segmentList = getSortedSegments();
    if (segmentList.length === 0) return { words: [], segmentId: null };

    // Build a merged word list from ALL segments (sorted by time)
    const allWords: SyncWordTimestamp[] = [];
    let anchorSegmentId: string | null = null;

    for (const seg of segmentList) {
      if (!Number.isFinite(seg.startTime) || !Number.isFinite(seg.endTime)) continue;
      const segWords = buildWordTimestampsFromSegment(seg, source);
      if (segWords.length > 0) {
        allWords.push(...segWords);
        // Track which segment contains our target time
        if (anchorSegmentId === null && timeInSeconds >= seg.startTime && timeInSeconds < seg.endTime) {
          anchorSegmentId = seg.id;
        }
      }
    }

    if (allWords.length === 0) return { words: [], segmentId: anchorSegmentId };

    // Sort by startTime to ensure continuous timeline
    allWords.sort((a, b) => a.startTime - b.startTime);

    // Find the split point: first word that starts after our target time
    let splitIndex = allWords.findIndex((w) => w.startTime > timeInSeconds);
    if (splitIndex < 0) splitIndex = allWords.length;

    const safeBefore = Math.max(0, Math.floor(beforeCount));
    const safeAfter = Math.max(0, Math.floor(afterCount));

    const startIdx = Math.max(0, splitIndex - safeBefore);
    const endIdx = Math.min(allWords.length, splitIndex + safeAfter);

    return {
      words: allWords.slice(startIdx, endIdx),
      segmentId: anchorSegmentId,
    };
  }, [buildWordTimestampsFromSegment, getSortedSegments]);

  const getSyncWordComparison = useCallback((videoTime: number, audioTime: number): SyncWordComparisonData => {
    const adjustedVideoTime = videoTime + videoLineOffset;
    const adjustedAudioTime = audioTime + audioLineOffset;

    // v147: Show 8 words on each side for smooth scrolling calibration
    const videoWindow = getWordWindowForTime(adjustedVideoTime, 'video', 8, 8);
    const audioWindow = getWordWindowForTime(adjustedAudioTime, 'audio', 8, 8);

    return {
      videoWords: videoWindow.words,
      audioWords: audioWindow.words,
      videoSegmentId: videoWindow.segmentId,
      audioSegmentId: audioWindow.segmentId,
      videoTime: adjustedVideoTime,
      audioTime: adjustedAudioTime,
      generatedAt: Date.now(),
    };
  }, [audioLineOffset, getWordWindowForTime, videoLineOffset]);

  const setAudioPlaybackRate = useCallback((rate: number): boolean => {
    const normalized = clamp(rate, GEORGE_MIN_PLAYBACK_RATE, GEORGE_MAX_PLAYBACK_RATE);
    lockedTtsPlaybackRateRef.current = normalized;

    let applied = false;

    const applyToElement = (el: HTMLAudioElement | null) => {
      if (!el) return;
      try {
        el.playbackRate = normalized;
        applied = true;
      } catch (error) {
        logWarn('[v143 George] ⚠️ Failed to set audio playback rate on element', error);
      }
    };

    applyToElement(audioElementRef.current);
    applyToElement(preloadAudioElementRef.current);
    applyToElement(preload2AudioElementRef.current);

    lastAppliedAudioRateRef.current = normalized;

    if (!applied) {
      // No active element yet (pre-start). Keep locked rate so newly created audio uses it.
      console.log('[v143 George] 🎯 Locked TTS playback rate for upcoming audio element:', normalized.toFixed(3));
      return true;
    }

    return true;
  }, [logWarn]);

  const getVideoPlaybackRate = useCallback((): number => {
    // v143: natural source video speed must remain fixed.
    return 1.0;
  }, []);

  const setRateMatchingProfile = useCallback((videoRateWps: number, audioRateWps: number): { applied: boolean; ttsPlaybackSpeed: number } => {
    const safeVideoRate = Number.isFinite(videoRateWps) && videoRateWps > 0 ? videoRateWps : 1;
    const safeAudioRate = Number.isFinite(audioRateWps) && audioRateWps > 0 ? audioRateWps : 1;
    const targetPlaybackRate = clamp(safeVideoRate / safeAudioRate, GEORGE_MIN_PLAYBACK_RATE, GEORGE_MAX_PLAYBACK_RATE);

    targetVideoWordRateRef.current = safeVideoRate;
    targetAudioWordRateRef.current = safeAudioRate;
    targetRateLockedRef.current = true;

    const applied = setAudioPlaybackRate(targetPlaybackRate);

    setSyncStatus(prev => ({
      ...prev,
      videoRate: safeVideoRate,
      audioRate: safeAudioRate,
      ttsPlaybackSpeed: targetPlaybackRate,
      ratesMatched: Math.abs((safeAudioRate * targetPlaybackRate) - safeVideoRate) <= Math.max(0.3, safeVideoRate * 0.15),
      action: applied ? 'RATE_LOCKED_PRESTART' : 'RATE_LOCK_PENDING',
      updatedAt: Date.now(),
    }));

    console.log('[v143 George] 🎚️ Rate profile locked', {
      videoRateWps: safeVideoRate.toFixed(3),
      audioRateWps: safeAudioRate.toFixed(3),
      ttsPlaybackSpeed: targetPlaybackRate.toFixed(3),
      applied,
    });

    return { applied, ttsPlaybackSpeed: targetPlaybackRate };
  }, [setAudioPlaybackRate]);

  const getAudioPositionForSegment = useCallback((segment: AudioSegment): number => {
    console.log('[v140 George] 🎯 getAudioPositionForSegment for segment:', segment.id);
    const sortedSegments = getSortedSegments();
    const segmentIndex = sortedSegments.findIndex(seg => seg.id === segment.id);

    if (segmentIndex === -1) {
      console.warn('[v140 George] ⚠️ getAudioPositionForSegment: segment not found, returning 0');
      return 0;
    }

    const position = getAudioPositionForIndex(segmentIndex);
    console.log('[v140 George] 🎯 getAudioPositionForSegment result:', position.toFixed(2), 's (index', segmentIndex + ')');
    return position;
  }, [getAudioPositionForIndex, getSortedSegments]);

  const getCurrentAudioPosition = useCallback((): number => {
    const position = getAudioPosition();
    console.log('[v140 George] 📍 getCurrentAudioPosition:', position.toFixed(2), 's');
    return position;
  }, [getAudioPosition]);

  const playSegmentAtOffset = useCallback(async (segmentIndex: number, offset: number): Promise<boolean> => {
    console.log('[v140 George] ▶️ playSegmentAtOffset request: index', segmentIndex, 'offset', offset.toFixed(2), 's');

    const videoTimeNow = getVideoTime('play-segment-at-offset');
    const played = await playSegmentByIndexRef.current(segmentIndex, 'word-align-jump', videoTimeNow);
    if (!played) {
      console.warn('[v140 George] ⚠️ playSegmentAtOffset: playSegmentByIndex did not confirm playback');
      return false;
    }

    const audioEl = audioElementRef.current;
    if (!audioEl) {
      console.warn('[v140 George] ⚠️ playSegmentAtOffset: audio element missing after play');
      return false;
    }

    const safeOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
    try {
      audioEl.currentTime = safeOffset;
      console.log('[v140 George] ✅ playSegmentAtOffset set audio.currentTime to', safeOffset.toFixed(2), 's');
      return true;
    } catch (error) {
      logWarn('[v140 George] ⚠️ playSegmentAtOffset failed to apply offset', error);
      return false;
    }
  }, [getVideoTime, logWarn]);

  const jumpAudioToPosition = useCallback(async (targetPos: number, targetSegment: AudioSegment): Promise<boolean> => {
    console.log('[v140 George] 🦘 ═══ JUMP STARTING ═══');
    console.log('[v140 George] 🦘 Target position:', Number.isFinite(targetPos) ? targetPos.toFixed(2) : targetPos, 's');
    console.log('[v140 George] 🦘 Target segment:', targetSegment.id);

    const sortedSegments = getSortedSegments();
    const segmentIndex = sortedSegments.findIndex(s => s.id === targetSegment.id);
    console.log('[v140 George] 🦘 Segment index:', segmentIndex);

    if (segmentIndex === -1) {
      console.error('[v140 George] ❌ Segment not found in array');
      return false;
    }

    const segmentStartPos = getAudioPositionForSegment(targetSegment);
    const offset = Math.max(0, targetPos - segmentStartPos);
    console.log('[v140 George] 🦘 Offset within segment:', offset.toFixed(2), 's');

    if (audioElementRef.current) {
      console.log('[v140 George] 🦘 Pausing current audio');
      audioElementRef.current.pause();
    }

    console.log('[v140 George] 🦘 Playing segment', segmentIndex, 'at offset', offset.toFixed(2), 's');
    const jumped = await playSegmentAtOffset(segmentIndex, offset);

    if (!jumped) {
      console.warn('[v140 George] ⚠️ Jump could not complete playback transition');
      return false;
    }

    currentSequentialIndexRef.current = segmentIndex;
    currentlyPlayingSegmentIndexRef.current = segmentIndex;
    currentSegmentStartAudioPositionRef.current = segmentStartPos;
    audioPositionRef.current = targetPos;
    lastTargetAudioPositionRef.current = targetPos;

    console.log('[v140 George] 🦘 ═══ JUMP COMPLETED ═══');
    return true;
  }, [getAudioPositionForSegment, getSortedSegments, playSegmentAtOffset]);

  const updateSyncStatusDisplay = useCallback((
    videoTime: number,
    audioPosition: number,
    positionDiff: number,
    isPlaying: boolean,
    loopIteration: number,
    videoText: string,
    audioText: string,
  ) => {
    try {
      console.log('[v140 George] 📊 Updating monitor display');
      const safeVideoRate = Number.isFinite(targetVideoWordRateRef.current) && targetVideoWordRateRef.current > 0
        ? targetVideoWordRateRef.current
        : 1.0;
      const safeAudioRate = Number.isFinite(targetAudioWordRateRef.current) && targetAudioWordRateRef.current > 0
        ? targetAudioWordRateRef.current
        : 1.0;
      const safeTtsPlaybackSpeed = Number.isFinite(lockedTtsPlaybackRateRef.current) && lockedTtsPlaybackRateRef.current > 0
        ? lockedTtsPlaybackRateRef.current
        : 1.0;
      const ratesMatched = Math.abs((safeAudioRate * safeTtsPlaybackSpeed) - safeVideoRate) <= Math.max(0.3, (safeVideoRate || videoRate) * 0.15);
      const wordsAligned = positionDiff < JUMP_ALIGNMENT_THRESHOLD_SECONDS;

      setSyncStatus(prev => ({
        ...prev,
        videoTime: Number.isFinite(videoTime) ? videoTime : prev.videoTime,
        audioPosition: Number.isFinite(audioPosition) ? audioPosition : prev.audioPosition,
        targetAudioPosition: Number.isFinite(prev.targetAudioPosition) ? prev.targetAudioPosition : audioPosition,
        positionDiff: Number.isFinite(positionDiff) ? positionDiff : prev.positionDiff,
        drift: Number.isFinite(positionDiff) ? positionDiff : prev.drift,
        videoRate: safeVideoRate,
        audioRate: safeAudioRate,
        ttsPlaybackSpeed: safeTtsPlaybackSpeed,
        ratesMatched,
        wordsAligned,
        status: wordsAligned && ratesMatched ? 'IN SYNC' : 'ALIGNING',
        severity: wordsAligned && ratesMatched ? 'IN_SYNC' : 'ALIGNING',
        color: wordsAligned && ratesMatched ? 'green' : 'yellow',
        outOfSync: !wordsAligned,
        action: prev.action || 'WAITING',
        loopIteration,
        isPlaying,
        videoText: videoText || prev.videoText,
        audioText: audioText || prev.audioText,
        updatedAt: Date.now(),
      }));
    } catch (error) {
      console.error('[v140 George] ❌ Failed to update sync status display:', error);
    }
  }, []);

  const performWordBasedSyncCheck = useCallback(async (videoTimeArg: number, loopIteration: number): Promise<{ drift: number; action: string }> => {
    console.log('[v140 George] ═══════════════════════════════════════');
    console.log('[v140 George] 🔍 STARTING WORD-BASED SYNC CHECK');

    const videoRate = Number.isFinite(targetVideoWordRateRef.current) && targetVideoWordRateRef.current > 0
      ? targetVideoWordRateRef.current
      : 1.0;
    const baseAudioRate = Number.isFinite(targetAudioWordRateRef.current) && targetAudioWordRateRef.current > 0
      ? targetAudioWordRateRef.current
      : 1.0;
    const targetTtsPlaybackSpeed = Number.isFinite(lockedTtsPlaybackRateRef.current) && lockedTtsPlaybackRateRef.current > 0
      ? clamp(lockedTtsPlaybackRateRef.current, GEORGE_MIN_PLAYBACK_RATE, GEORGE_MAX_PLAYBACK_RATE)
      : 1.0;

    if (!targetRateLockedRef.current) {
      console.warn('[v143 George] ⚠️ Rate profile not locked yet; defaulting to 1.0x TTS');
    }

    console.log('[v143 George] 📹 STEP 1: Enforcing natural video + locked TTS rate');
    applyVideoPlaybackRate(1.0);
    setAudioPlaybackRate(targetTtsPlaybackSpeed);

    const currentAudioRate = baseAudioRate;
    const ratesMatchedNow = Math.abs((baseAudioRate * targetTtsPlaybackSpeed) - videoRate) <= Math.max(0.3, videoRate * 0.15);

    console.log('[v143 George] ✅ Rate status', {
      videoRateWps: videoRate.toFixed(3),
      audioRateWps: baseAudioRate.toFixed(3),
      ttsPlaybackSpeed: targetTtsPlaybackSpeed.toFixed(3),
      ratesMatched: ratesMatchedNow,
    });

    console.log('[v143 George] 🇩🇪 STEP 2: Getting current German word');
    try {
      const videoTime = Number.isFinite(videoTimeArg) ? videoTimeArg : getVideoTime('word-sync-check');
      console.log('[v140 George] 📹 Video time:', videoTime.toFixed(2), 's');

      const segment = getSegmentAtTime(videoTime);
      if (!segment) {
        console.log('[v140 George] ⚠️ No segment found at', videoTime.toFixed(2), 's');

        const currentAudioPos = getCurrentAudioPosition();
        setSyncStatus(prev => ({
          ...prev,
          germanWord: '(no segment)',
          videoTime,
          audioPosition: currentAudioPos,
          targetAudioPosition: currentAudioPos,
          positionDiff: 0,
          drift: 0,
          videoRate,
          audioRate: currentAudioRate,
          ttsPlaybackSpeed: targetTtsPlaybackSpeed,
          ratesMatched: ratesMatchedNow,
          wordsAligned: true,
          status: 'ALIGNING',
          severity: 'ALIGNING',
          color: 'yellow',
          outOfSync: false,
          action: 'NO_SEGMENT',
          loopIteration,
          isPlaying: Boolean(isPlayingRef.current),
          updatedAt: Date.now(),
        }));

        console.log('[v140 George] ═══════════════════════════════════════');
        return { drift: 0, action: 'NO_SEGMENT' };
      }

      const germanWord = (segment.originalText || segment.text || '').trim();
      console.log('[v140 George] 🇩🇪 German word:', germanWord || '(empty)');
      console.log('[v140 George] 🆔 Segment ID:', segment.id);

      console.log('[v140 George] 🎵 STEP 3: Finding target audio position');
      const targetAudioPos = getAudioPositionForSegment(segment);
      console.log('[v140 George] 🎯 Target audio position:', targetAudioPos.toFixed(2), 's');

      console.log('[v140 George] 📊 STEP 4: Checking current audio position');
      const currentAudioPos = getCurrentAudioPosition();
      console.log('[v140 George] 📊 Current audio position:', currentAudioPos.toFixed(2), 's');

      const diff = Math.abs(currentAudioPos - targetAudioPos);
      console.log('[v140 George] 📊 Position difference:', diff.toFixed(2), 's');

      let action = 'NORMAL';
      const shouldJump = diff > JUMP_ALIGNMENT_THRESHOLD_SECONDS;
      console.log(`[v140 George] 🦘 Difference > ${JUMP_ALIGNMENT_THRESHOLD_SECONDS.toFixed(1)}s?`, shouldJump ? `Yes (${diff.toFixed(2)} > ${JUMP_ALIGNMENT_THRESHOLD_SECONDS.toFixed(1)})` : `No (${diff.toFixed(2)} <= ${JUMP_ALIGNMENT_THRESHOLD_SECONDS.toFixed(1)})`);

      if (shouldJump) {
        const now = Date.now();
        const hasPreviousJump = lastJumpTimeRef.current > 0;
        const timeSinceLastJump = hasPreviousJump ? now - lastJumpTimeRef.current : Number.POSITIVE_INFINITY;
        console.log('[v140 George] 🦘 Cooldown check: last jump', hasPreviousJump ? `${(timeSinceLastJump / 1000).toFixed(1)}s ago` : 'never');

        if (timeSinceLastJump < JUMP_COOLDOWN_MS) {
          const remainingMs = JUMP_COOLDOWN_MS - timeSinceLastJump;
          console.log('[v140 George] 🚫 Jump on cooldown - waiting', (remainingMs / 1000).toFixed(1), 's more');
          console.log('[v140 George] ⏱️ Will jump again after cooldown expires');
          action = 'COOLDOWN';
        } else {
          console.log('[v140 George] ✅ Cooldown OK - proceeding with jump');
          console.log('[v140 George] 🦘 STEP 5: JUMPING - difference too large');
          console.log('[v140 George] 🦘 Jumping from', currentAudioPos.toFixed(2), 's to', targetAudioPos.toFixed(2), 's');
          console.log('[v140 George] 🦘 JUMP STARTING');
          const jumped = await jumpAudioToPosition(targetAudioPos, segment);
          if (jumped) {
            lastJumpTimeRef.current = now;
            console.log('[v140 George] ✅ Jump completed, cooldown started');
            action = 'JUMPING';
          } else {
            console.warn('[v140 George] ⚠️ Jump requested but failed');
            action = 'JUMP_FAILED';
          }
        }
      } else {
        console.log('[v140 George] ✅ No jump needed - close enough');
      }

      const latestAudioPos = getCurrentAudioPosition();
      const latestDiff = Math.abs(latestAudioPos - targetAudioPos);
      lastAlignmentDiffRef.current = latestDiff;
      lastTargetAudioPositionRef.current = targetAudioPos;
      lastGermanWordRef.current = germanWord;
      lastWordsAlignedRef.current = latestDiff < JUMP_ALIGNMENT_THRESHOLD_SECONDS;
      currentSyncActionRef.current = action;

      setSyncStatus(prev => ({
        ...prev,
        germanWord: germanWord || '(empty)',
        videoTime,
        audioPosition: latestAudioPos,
        targetAudioPosition: targetAudioPos,
        positionDiff: latestDiff,
        drift: latestDiff,
        videoRate,
        audioRate: currentAudioRate,
        ttsPlaybackSpeed: targetTtsPlaybackSpeed,
        ratesMatched: ratesMatchedNow,
        wordsAligned: latestDiff < JUMP_ALIGNMENT_THRESHOLD_SECONDS,
        status: latestDiff < JUMP_ALIGNMENT_THRESHOLD_SECONDS ? 'IN SYNC' : 'ALIGNING',
        severity: latestDiff < JUMP_ALIGNMENT_THRESHOLD_SECONDS ? 'IN_SYNC' : 'ALIGNING',
        color: latestDiff < JUMP_ALIGNMENT_THRESHOLD_SECONDS && ratesMatchedNow ? 'green' : 'yellow',
        outOfSync: latestDiff >= JUMP_ALIGNMENT_THRESHOLD_SECONDS,
        action,
        loopIteration,
        isPlaying: Boolean(isPlayingRef.current),
        updatedAt: Date.now(),
      }));

      console.log('[v140 George] ═══════════════════════════════════════');
      return {
        drift: latestDiff,
        action,
      };

    } catch (error) {
      console.error('[v140 George] ❌ Error in sync check:', error);
      console.log('[v140 George] ═══════════════════════════════════════');
      return {
        drift: 0,
        action: 'ERROR',
      };
    }
  }, [applyVideoPlaybackRate, getAudioPositionForSegment, getCurrentAudioPosition, getSegmentAtTime, getVideoTime, jumpAudioToPosition, setAudioPlaybackRate]);

  const handleAudioEnded = useCallback(() => {
    if (!isActiveRef.current || isPausedRef.current) return;
    if (endDetectionFiredRef.current) {
      log('[v140 George] ⚡ handleAudioEnded skipped — end detection already fired for this segment');
      return;
    }
    endDetectionFiredRef.current = true;

    const sortedSegments = getSortedSegments();
    const currentIndex = currentlyPlayingSegmentIndexRef.current;
    const audioEl = audioElementRef.current;

    if (currentIndex !== null && currentIndex >= 0 && currentIndex < sortedSegments.length) {
      const measuredDuration = Math.max(
        0,
        Number.isFinite(audioEl?.currentTime as number) ? Number(audioEl?.currentTime) : 0,
      );
      const fallbackDuration = getSegmentDurationSeconds(sortedSegments[currentIndex]);
      const finalDuration = measuredDuration > 0 ? measuredDuration : fallbackDuration;
      segmentDurationByIndexRef.current.set(currentIndex, finalDuration);
      audioPositionRef.current = currentSegmentStartAudioPositionRef.current + finalDuration;
      lastCompletedSegmentIndexRef.current = currentIndex;
      log(`[v140 George] 🎵 Audio position: ${audioPositionRef.current.toFixed(2)}s`);
    }

    setState(prev => ({ ...prev, isPlaying: false, currentSegmentId: null }));
    isPlayingRef.current = false;

    if (!autoAdvance || !isEnabledRef.current) {
      currentlyPlayingSegmentIndexRef.current = null;
      return;
    }

    const nextIndex = (currentIndex ?? currentSequentialIndexRef.current) + 1;
    if (nextIndex >= sortedSegments.length) {
      log('[v140 George] ✅ All segments played');
      currentlyPlayingSegmentIndexRef.current = null;
      updatePlaybackState('ENDED', 'all sequential segments played');
      void applyVideoPlaybackRate(1.0);
      void setAudioPlaybackRate(1.0);
      return;
    }

    currentSequentialIndexRef.current = nextIndex;
    log('[v140 George] 🔚 Audio segment ended');
    log(`[v140 George] ▶️ Playing next segment: ${nextIndex}`);
    void playSegmentByIndexRef.current(nextIndex, 'sequential-ended', getVideoTime('sequential-ended'));
  }, [autoAdvance, applyVideoPlaybackRate, getSegmentDurationSeconds, getSortedSegments, getVideoTime, log, setAudioPlaybackRate, updatePlaybackState]);

  const handleAudioError = useCallback((e: Event) => {
    // v99: Guard against orphaned audio element error events with null target
    if (!e.target) {
      logWarn('[v140 George] Audio error with null target — ignoring orphaned event');
      return;
    }
    logError('[v140 George] Audio error:', e);
    currentlyPlayingSegmentIndexRef.current = null;
    setState(prev => ({ ...prev, isPlaying: false, error: 'Audio playback error' }));
  }, []);

  // v96: Keep refs in sync with latest callbacks — THIS IS THE KEY FIX
  // All event listeners use these refs, so they always call the latest version
  useEffect(() => {
    handleAudioEndedRef.current = handleAudioEnded;
  }, [handleAudioEnded]);

  useEffect(() => {
    handleAudioErrorRef.current = handleAudioError;
  }, [handleAudioError]);

  // =====================================================================
  // v85: Deferred audio element setup
  // =====================================================================

  /**
   * v85/v88: initAudioElements — Called when playbackAllowed becomes true.
   * Creates primary audio element + attaches stable handlers.
   * v88: Forces creation even if ref was stale (defensive).
   */
  const initAudioElements = useCallback(() => {
    if (typeof window === 'undefined') return;

    // v88: Always create a fresh audio element if one doesn't exist,
    // even if audioInitializedRef says we're initialized (defensive against stale state)
    if (!audioElementRef.current) {
      console.log('[v143 George] 🔊 Creating new audio element');
      audioElementRef.current = new Audio();
      const lockedRate = clamp(lockedTtsPlaybackRateRef.current || 1, GEORGE_MIN_PLAYBACK_RATE, GEORGE_MAX_PLAYBACK_RATE);
      audioElementRef.current.playbackRate = lockedRate;
      lastAppliedAudioRateRef.current = lockedRate;
    }

    if (audioInitializedRef.current && audioElementRef.current) {
      // Already initialized and element exists — skip listener re-attachment
      return;
    }

    console.log('[v140 George] 🔊 Initializing audio elements (attaching listeners via REF pattern)');

    // v96: CRITICAL FIX — Use ref-based listeners to prevent stale closures
    // Instead of capturing handleAudioEnded directly (which creates a closure),
    // we call handleAudioEndedRef.current() which always resolves to the latest version
    const onEnded = () => { handleAudioEndedRef.current(); };
    const onError = (e: Event) => { handleAudioErrorRef.current(e); };

    // Clean up any existing listeners before adding new ones
    const existingOnEnded = (audioElementRef.current as any)?._v88_onEnded;
    const existingOnError = (audioElementRef.current as any)?._v88_onError;
    if (existingOnEnded) audioElementRef.current!.removeEventListener('ended', existingOnEnded);
    if (existingOnError) audioElementRef.current!.removeEventListener('error', existingOnError);

    // v96: Explicitly disable looping on new audio elements
    audioElementRef.current!.loop = false;

    audioElementRef.current!.addEventListener('ended', onEnded);
    audioElementRef.current!.addEventListener('error', onError);
    (audioElementRef.current as any)._v88_onEnded = onEnded;
    (audioElementRef.current as any)._v88_onError = onError;

    audioInitializedRef.current = true;
  }, []);  // v96: No dependencies needed — we use refs, not closures

  /**
   * v85: Cleanup effect — tears down audio elements on unmount.
   */
  useEffect(() => {
    return () => {
      // v101.3: stop background buffering/generation on unmount/navigation.
      isActiveRef.current = false;
      isEnabledRef.current = false;
      playbackAllowedRef.current = false;
      stoppedRef.current = true;
      if (audioElementRef.current) {
        const onEnded = (audioElementRef.current as any)._v88_onEnded;
        const onError = (audioElementRef.current as any)._v88_onError;
        if (onEnded) audioElementRef.current.removeEventListener('ended', onEnded);
        if (onError) audioElementRef.current.removeEventListener('error', onError);
        if (timeUpdateHandlerRef.current) {
          audioElementRef.current.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
        }
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }
      if (preloadAudioElementRef.current) {
        preloadAudioElementRef.current.pause();
        preloadAudioElementRef.current = null;
      }
      if (preload2AudioElementRef.current) {
        preload2AudioElementRef.current.pause();
        preload2AudioElementRef.current = null;
      }
      preloadedSegmentIdRef.current = null;
      preloadReadyRef.current = false;
      preloaded2SegmentIdRef.current = null;
      preload2ReadyRef.current = false;
      audioInitializedRef.current = false;
      // v99: Legacy watchdog/syncWatchdog/phraseTimeout/transitioningTimeout all REMOVED
      // Only George's interval needs cleanup on unmount
      // v97: Clear George's interval on unmount
      if (georgeIntervalRef.current) {
        clearInterval(georgeIntervalRef.current);
        georgeIntervalRef.current = null;
      }
    };
  }, []);

  // =====================================================================
  // v99: GEORGE THE VIDEO EDITOR — SOLE Playback Controller
  // ALL legacy timers removed: watchdog, syncWatchdog, phraseTimeout, transitioning
  // George's 100ms loop is the ONLY mechanism that controls playback.
  // =====================================================================

  useEffect(() => {
    console.log('[v140 George] 🚀 Initializing word-based sync monitoring');
    console.log(`[v140 George] ⚙️ Sync thresholds: jump>${JUMP_ALIGNMENT_THRESHOLD_SECONDS.toFixed(1)}s, cooldown=${JUMP_COOLDOWN_MS}ms, debounce=100ms (balanced sync)`);

    // Clean up previous George interval
    if (georgeIntervalRef.current) {
      console.log('[v140 George] ⏹️ Stopping word-based sync monitoring (reinitialize)');
      clearInterval(georgeIntervalRef.current);
      georgeIntervalRef.current = null;
    }

    if (!autoAdvance) {
      console.log('[v140 George] ⚠️ Loop exiting: autoAdvance disabled');
      return;
    }
    if (stoppedRef.current) {
      console.log('[v140 George] ⚠️ Loop exiting: hook stopped');
      return;
    }

    // v99: Set isGeorgeActive immediately so overlay renders right away
    setGeorgeBufferStatus(prev => applyRollingBufferToStatus({ ...prev, isGeorgeActive: true, playbackState: playbackStateRef.current, minBufferSize: minBufferSizeRef.current, firstSpeechStart: firstSpeechStartRef.current }));

    georgeLoopIterationRef.current = 0;
    console.log('[v140 George] 🚀 georgeLoop started');
    georgeLoopStartedRef.current = true;

    georgeIntervalRef.current = setInterval(() => {
      georgeLoopIterationRef.current += 1;
      console.log(`[v140 George] 🔄 Loop #${georgeLoopIterationRef.current}`);

      // v151: Always snapshot/update monitor first so paused state keeps final position (no reset to 0)
      const loopVideoTimeRaw = getVideoTime('george-loop-snapshot');
      const loopVideoTime = Number.isFinite(loopVideoTimeRaw) ? loopVideoTimeRaw : currentTimeRef.current;
      const loopAudioPosition = getAudioPosition();
      const loopVideoText = getTranscriptTextAtTime(loopVideoTime, 'video');
      const loopAudioText = getTranscriptTextAtTime(loopAudioPosition, 'audio');

      updateSyncStatusDisplay(
        loopVideoTime,
        loopAudioPosition,
        lastAlignmentDiffRef.current,
        Boolean(isPlayingRef.current) && !isPausedRef.current,
        georgeLoopIterationRef.current,
        loopVideoText,
        loopAudioText,
      );

      // Gate checks
      if (!isActiveRef.current) {
        console.log('[v140 George] ⚠️ Loop exiting: inactive');
        return;
      }
      if (stoppedRef.current) {
        console.log('[v140 George] ⚠️ Loop exiting: stopped');
        return;
      }
      if (isPausedRef.current) {
        console.log('[v140 George] ⏸️ Not playing, skipping word-based sync check (hook paused)');
        return;
      }
      if (!isEnabledRef.current) {
        console.log('[v140 George] ⚠️ Loop exiting: disabled');
        return;
      }

      // v99: transitioningRef guard REMOVED — George should ALWAYS run
      // George needs to monitor even during transitions to update buffer status
      console.log('[v140 George] 🔍 georgeLoop running...');

      const videoTime = getDebouncedVideoTime('george-loop-main');
      const lookAheadTime = videoTime + GEORGE_LOOK_AHEAD_SECONDS;
      const sortedSegments = getSortedSegments();
      if (sortedSegments.length === 0) return;

      const currentPlayingIndex = currentlyPlayingSegmentIndexRef.current;
      const audioEl = audioElementRef.current;
      let lastAction = 'monitoring';

      // v101.3: Smart buffering + auto-start-after-ready gate
      const liveBuffer = getCurrentBufferSize(videoTime);
      currentBufferSizeRef.current = liveBuffer;

      // v101.3: run rolling-buffer maintenance directly from George loop (not only from audio events)
      const nowMs = Date.now();
      const forceRollingCheck = liveBuffer <= ROLLING_CHECK_FORCE_THRESHOLD;
      const rollingCheckDue = nowMs - lastRollingCheckAtRef.current >= ROLLING_CHECK_INTERVAL_MS;
      if (forceRollingCheck || rollingCheckDue) {
        const rollingIndex = currentPlayingIndex ?? findSegmentIndexForTime(videoTime);
        const trigger = forceRollingCheck ? 'george-loop-critical' : 'george-loop';
        log(`[v140 George] 🧭 Rolling scheduler trigger=${trigger} liveBuffer=${liveBuffer} idx=${rollingIndex}`);
        lastRollingCheckAtRef.current = nowMs;
        void maintainRollingBufferRef.current(trigger, rollingIndex);
      }

      if (playbackStateRef.current === 'BUFFERING') {
        if (liveBuffer >= minBufferSizeRef.current) {
          updatePlaybackState('READY', `buffer full ${liveBuffer}/${minBufferSizeRef.current}`);
        } else {
          lastAction = `buffering ${liveBuffer}/${minBufferSizeRef.current}`;
          setGeorgeBufferStatus(applyRollingBufferToStatus({
            currentTime: videoTime,
            lookAheadTime,
            currentSegment: currentPlayingIndex ?? -1,
            targetSegment: findSegmentIndexForTime(videoTime),
            totalSegments: sortedSegments.length,
            playbackRate: audioEl?.playbackRate || 1.0,
            isGeorgeActive: true,
            lastAction,
            playbackState: playbackStateRef.current,
            minBufferSize: minBufferSizeRef.current,
            currentBufferSize: liveBuffer,
            firstSpeechStart: firstSpeechStartRef.current,
            totalGenerated: 0,
            currentSegmentIndex: currentPlayingIndex ?? -1,
            segmentsAhead: 0,
            bufferAheadTarget: ROLLING_BUFFER_AHEAD_TARGET,
            bufferHealth: 'critical',
          }, currentPlayingIndex));
          return;
        }
      }

      if (playbackStateRef.current === 'READY') {
        if (!playbackAllowedRef.current) {
          lastAction = 'ready-wait-click';
          setGeorgeBufferStatus(applyRollingBufferToStatus({
            currentTime: videoTime,
            lookAheadTime,
            currentSegment: currentPlayingIndex ?? -1,
            targetSegment: findSegmentIndexForTime(videoTime),
            totalSegments: sortedSegments.length,
            playbackRate: audioEl?.playbackRate || 1.0,
            isGeorgeActive: true,
            lastAction,
            playbackState: playbackStateRef.current,
            minBufferSize: minBufferSizeRef.current,
            currentBufferSize: liveBuffer,
            firstSpeechStart: firstSpeechStartRef.current,
            totalGenerated: 0,
            currentSegmentIndex: currentPlayingIndex ?? -1,
            segmentsAhead: 0,
            bufferAheadTarget: ROLLING_BUFFER_AHEAD_TARGET,
            bufferHealth: 'critical',
          }, currentPlayingIndex));
          return;
        }

        if (videoTime + 0.02 < firstSpeechStartRef.current) {
          lastAction = `ready-wait-speech@${firstSpeechStartRef.current.toFixed(2)}s`;
          setGeorgeBufferStatus(applyRollingBufferToStatus({
            currentTime: videoTime,
            lookAheadTime,
            currentSegment: currentPlayingIndex ?? -1,
            targetSegment: findSegmentIndexForTime(videoTime),
            totalSegments: sortedSegments.length,
            playbackRate: audioEl?.playbackRate || 1.0,
            isGeorgeActive: true,
            lastAction,
            playbackState: playbackStateRef.current,
            minBufferSize: minBufferSizeRef.current,
            currentBufferSize: liveBuffer,
            firstSpeechStart: firstSpeechStartRef.current,
            totalGenerated: 0,
            currentSegmentIndex: currentPlayingIndex ?? -1,
            segmentsAhead: 0,
            bufferAheadTarget: ROLLING_BUFFER_AHEAD_TARGET,
            bufferHealth: 'critical',
          }, currentPlayingIndex));
          return;
        }

        const selectedIndex = demandBasedSelector(videoTime, sortedSegments);
        if (selectedIndex >= 0 && selectedIndex < sortedSegments.length) {
          preReleasePlanRef.current = preReleasePlanner(videoTime, sortedSegments[selectedIndex], selectedIndex);
          updatePlaybackState('ARMED', `planned ${sortedSegments[selectedIndex].id}`);
          lastAction = `armed ${sortedSegments[selectedIndex].id}`;
        }
      }

      // ─── GEORGE TASK 1: Word-based sync loop (rate match + alignment) ───
      // v140: Relaxed check - run sync whenever video is playing, regardless of audio element state
      const isActivelyPlaying = Boolean(isPlayingRef.current && videoIsPlayingRef.current);
      console.log(`[v140 George] 🔍 isPlaying: ${isActivelyPlaying} (video:${videoIsPlayingRef.current}, audio:${isPlayingRef.current})`);

      if (isActivelyPlaying) {
        if (playbackStateRef.current !== 'PLAYING') {
          updatePlaybackState('PLAYING', 'audio element actively playing');
        }

        const now = Date.now();
        const previousTick = lastVideoTickRef.current;
        const videoMoved = Math.abs(videoTime - previousTick.time) > 0.005;
        const videoLikelyPaused = !videoIsPlayingRef.current || (!videoMoved && (now - previousTick.at) > 1200);
        if (videoMoved) {
          lastVideoTickRef.current = { time: videoTime, at: now };
        }

        if (videoLikelyPaused) {
          currentSyncActionRef.current = '⏸️ WAITING (VIDEO PAUSED)';
          void applyVideoPlaybackRate(1.0);
          void setAudioPlaybackRate(1.0);
          console.log('[v140 George] ⏸️ Not playing, skipping word-based sync check (video likely paused)');
          updateSyncStatusDisplay(
            videoTime,
            getAudioPosition(),
            0,
            false,
            georgeLoopIterationRef.current,
            getTranscriptTextAtTime(videoTime, 'video'),
            getTranscriptTextAtTime(getAudioPosition(), 'audio'),
          );
          lastAction = 'video-paused-hold';
        } else {
          if (syncCheckInFlightRef.current) {
            console.log('[v140 George] ⏳ Skipping sync check (previous check still in flight)');
            lastAction = `sync-check-busy (${lastAlignmentDiffRef.current.toFixed(2)}s)`;
          } else {
            syncCheckInFlightRef.current = true;
            console.log('[v140 George] 🔁 Running performWordBasedSyncCheck inside main George loop');
            void performWordBasedSyncCheck(videoTime, georgeLoopIterationRef.current)
              .then(({ drift, action }) => {
                lastDriftLogAtRef.current = Date.now();
                console.log(`[v140 George] ✅ Main-loop sync check completed: drift=${drift.toFixed(2)}s action=${action}`);
              })
              .catch((error) => {
                console.error('[v140 George] ❌ Main-loop sync check failed:', error);
              })
              .finally(() => {
                syncCheckInFlightRef.current = false;
              });

            lastAction = `sync-check (${lastAlignmentDiffRef.current.toFixed(2)}s)`;
          }
        }
      } else {
        currentSyncActionRef.current = '⏸️ WAITING';
        updateSyncStatusDisplay(
          videoTime,
          getAudioPosition(),
          0,
          false,
          georgeLoopIterationRef.current,
          getTranscriptTextAtTime(videoTime, 'video'),
          getTranscriptTextAtTime(getAudioPosition(), 'audio'),
        );
        console.log('[v140 George] ⏸️ Not playing, skipping word-based sync check');
      }

      // ─── v102.1.0 GEORGE TASK 2: enforce active playback on sequential segment ───
      const playbackStateAllowsStart =
        playbackStateRef.current === 'ARMED' ||
        playbackStateRef.current === 'PLAYING' ||
        playbackStateRef.current === 'READY';

      if (playbackAllowedRef.current && playbackStateAllowsStart) {
        const targetIndex = Math.max(0, Math.min(currentSequentialIndexRef.current, sortedSegments.length - 1));
        if (targetIndex !== -1 && targetIndex < sortedSegments.length) {
          const targetSegment = sortedSegments[targetIndex];
          const currentIndex = currentlyPlayingSegmentIndexRef.current;
          const activeAudioEl = audioElementRef.current;
          const audioActuallyPlaying =
            !!activeAudioEl &&
            !!activeAudioEl.src &&
            !activeAudioEl.paused &&
            !activeAudioEl.ended &&
            activeAudioEl.currentTime > 0;
          const playingCorrectSegment = audioActuallyPlaying && currentIndex === targetIndex;
          const segmentChanged = currentIndex !== targetIndex;
          const shouldTriggerPlayback = segmentChanged || !audioActuallyPlaying || !isPlayingRef.current;

          if (playingCorrectSegment && !shouldTriggerPlayback) {
            isPlayingRef.current = true;
            lastAction = `playing seg${targetIndex}`;
            log(`[v140 George] ✅ False-alarm check: audio element already playing seg_${targetSegment.startTime.toFixed(2)} — no restart`);
          } else {
            const timeSinceLastAttempt = Date.now() - lastAutoAdvanceAttemptRef.current;
            const retryAllowed = segmentChanged || timeSinceLastAttempt > 350;

            if (retryAllowed) {
              if (segmentChanged) {
                log(`[v140 George] 🔄 Segment changed: ${currentIndex ?? 'none'} → ${targetIndex}`);
              }
              log(`[v140 George] ▶️ Playing segment ${targetIndex}`);

              lastAutoAdvanceAttemptRef.current = Date.now();
              lastAction = `play seg${targetIndex}`;

              void playSegmentByIndexRef.current(targetIndex, 'george-loop', videoTime).then((played) => {
                if (played) {
                  const plan = preReleasePlanRef.current?.segmentId === targetSegment.id
                    ? preReleasePlanRef.current
                    : preReleasePlanner(videoTime, targetSegment, targetIndex);
                  applyPreReleasePlan(plan);
                  updatePlaybackState('PLAYING', `started ${targetSegment.id}`);
                }
              }).catch(err => {
                logError('[v140 George] ▶️ ❌ Start playback error:', err);
              });
            }
          }
        }

        // ─── GEORGE TASK 4: Look-ahead preparation ───
        const lookAheadIndex = findSegmentIndexForTime(lookAheadTime);
        if (lookAheadIndex !== -1 && lookAheadIndex < sortedSegments.length) {
          const lookAheadSegment = sortedSegments[lookAheadIndex];
          // Check if this segment's audio is ready
          if (lookAheadSegment.audioGenerated && lookAheadSegment.audioUrl &&
              lookAheadSegment.audioUrl !== 'browser-tts') {
            // Ensure it's preloaded
            if (!preloadReadyRef.current || preloadedSegmentIdRef.current !== lookAheadSegment.id) {
              const now = Date.now();
              if (now - georgeLastLogTimeRef.current > 1000) {
                log(`[v140 George] 👀 Look-ahead: preparing segment ${lookAheadIndex} ` +
                  `(${lookAheadSegment.startTime.toFixed(2)}s) for video time ${lookAheadTime.toFixed(2)}s`);
                georgeLastLogTimeRef.current = now;
              }
              // Trigger preload
              if (lookAheadIndex > 0) {
                preloadNextSegment(lookAheadIndex - 1);
              }
            }
          }
        }
      }

      // ─── v99 GEORGE TASK 5: Update buffer status for UI ───
      const targetIdx = findSegmentIndexForTime(videoTime);
      setGeorgeBufferStatus(applyRollingBufferToStatus({
        currentTime: videoTime,
        lookAheadTime,
        currentSegment: currentPlayingIndex ?? -1,
        targetSegment: targetIdx,
        totalSegments: sortedSegments.length,
        playbackRate: audioEl?.playbackRate || 1.0,
        isGeorgeActive: true,
        lastAction,
        playbackState: playbackStateRef.current,
        minBufferSize: minBufferSizeRef.current,
        currentBufferSize: liveBuffer,
        firstSpeechStart: firstSpeechStartRef.current,
        totalGenerated: 0,
        currentSegmentIndex: currentPlayingIndex ?? -1,
        segmentsAhead: 0,
        bufferAheadTarget: ROLLING_BUFFER_AHEAD_TARGET,
        bufferHealth: 'critical',
      }, currentPlayingIndex));

    }, GEORGE_CHECK_INTERVAL_MS); // George checks every 500ms

    return () => {
      console.log('[v140 George] ⏹️ Stopping word-based sync monitoring loop');
      if (georgeIntervalRef.current) {
        clearInterval(georgeIntervalRef.current);
        georgeIntervalRef.current = null;
      }
      syncCheckInFlightRef.current = false;
      georgeLoopStartedRef.current = false;
    };
  }, [autoAdvance, getSortedSegments, findSegmentIndexForTime, preloadNextSegment, getCurrentBufferSize, getDebouncedVideoTime, getVideoTime, updatePlaybackState, demandBasedSelector, preReleasePlanner, applyPreReleasePlan, applyRollingBufferToStatus, applyVideoPlaybackRate, getAudioPosition, getTranscriptTextAtTime, performWordBasedSyncCheck, setAudioPlaybackRate, updateSyncStatusDisplay, logWarn]);

  useEffect(() => {
    console.log('[v140 George] 🧪 Hook initialized for videoId:', videoId);
  }, [videoId]);

  useEffect(() => {
    console.log('[v140 George] 🧭 Playback state changed:', {
      isPlaying: state.isPlaying,
      isEnabled: state.isEnabled,
      totalSegments: state.totalCount,
      autoAdvance,
    });
  }, [state.isPlaying, state.isEnabled, state.totalCount, autoAdvance]);

  // =====================================================================
  // Voice management
  // =====================================================================

  const initializeVoices = useCallback((speakers: SpeakerWithCustomVoice[]) => {
    log('[v140 George] initializeVoices called with', speakers.length, 'speakers');

    const assignments = new Map<string, VoiceConfig>();
    const customMappings = new Map<string, string>();

    const hasCustomVoices = speakers.some(s => s.customVoice);
    log('[v140 George] Has custom voice assignments:', hasCustomVoices);

    speakers.forEach((speaker, index) => {
      if (speaker.customVoice) {
        const voiceId = speaker.customVoice.toLowerCase();
        const voiceConfig = OPENAI_VOICES.find(v => v.id.toLowerCase() === voiceId);

        if (voiceConfig) {
          assignments.set(speaker.id, voiceConfig);
          customMappings.set(speaker.id, voiceId);
          log('[v140 George] Custom:', speaker.id, '->', voiceConfig.name);
        } else {
          const fallbackConfig: VoiceConfig = {
            id: voiceId,
            name: voiceId.charAt(0).toUpperCase() + voiceId.slice(1),
            gender: 'neutral',
            provider: 'openai'
          };
          assignments.set(speaker.id, fallbackConfig);
          customMappings.set(speaker.id, voiceId);
          log('[v140 George] Custom (fallback):', speaker.id, '->', voiceId);
        }
      } else {
        const diverseVoiceId = DIVERSE_VOICE_ORDER[index % DIVERSE_VOICE_ORDER.length];
        const voiceConfig = OPENAI_VOICES.find(v => v.id === diverseVoiceId);
        if (voiceConfig) {
          assignments.set(speaker.id, voiceConfig);
          log('[v140 George] Auto (diverse):', speaker.id, '->', voiceConfig.name);
        } else {
          const autoAssigned = assignVoicesToSpeakers([speaker], voiceProvider);
          const autoVoice = autoAssigned.assignments.get(speaker.id);
          if (autoVoice) {
            assignments.set(speaker.id, autoVoice);
            log('[v140 George] Auto (lib fallback):', speaker.id, '->', autoVoice.name);
          }
        }
      }
    });

    customVoiceMappingsRef.current = customMappings;
    voiceAssignmentsRef.current = assignments;

    segmentsRef.current.forEach((segment, segmentId) => {
      const voice = assignments.get(segment.speakerId);
      if (voice) {
        segment.voice = voice;
        segmentsRef.current.set(segmentId, segment);
      }
    });

    setState(prev => ({
      ...prev,
      speakers,
      voiceAssignments: assignments,
      customVoiceMappings: customMappings,
      voicesInitialized: true,
      needsAudio: prev.isEnabled,
    }));

    log('[v140 George] Voice assignments complete');
    return assignments;
  }, [voiceProvider]);

  const updateSegmentVoices = useCallback((assignments: VoiceAssignment[]) => {
    log('[v140 George] updateSegmentVoices called with', assignments.length, 'assignments');

    const voiceMap = new Map<string, VoiceConfig>();
    assignments.forEach(a => {
      const voiceConfig = OPENAI_VOICES.find(v => v.id.toLowerCase() === a.voiceId.toLowerCase());
      if (voiceConfig) {
        voiceMap.set(a.speakerId, voiceConfig);
        customVoiceMappingsRef.current.set(a.speakerId, a.voiceId.toLowerCase());
        voiceAssignmentsRef.current.set(a.speakerId, voiceConfig);
      }
    });

    let updatedCount = 0;
    let invalidatedCount = 0;

    segmentsRef.current.forEach((segment, segmentId) => {
      const newVoice = voiceMap.get(segment.speakerId);
      if (newVoice && (!segment.voice || segment.voice.id !== newVoice.id)) {
        segment.voice = newVoice;

        if (segment.audioGenerated && segment.audioUrl && segment.audioUrl !== 'browser-tts') {
          URL.revokeObjectURL(segment.audioUrl);
          invalidatedCount++;
        }

        segment.audioGenerated = false;
        segment.audioUrl = undefined;
        segment.audioError = undefined;
        segmentsRef.current.set(segmentId, segment);

        if (!generationQueueRef.current.includes(segmentId)) {
          generationQueueRef.current.push(segmentId);
        }

        updatedCount++;
      }
    });

    log('[v140 George] Updated', updatedCount, 'segments, invalidated', invalidatedCount, 'audio files');

    // v101.3: Start regeneration immediately during pre-buffering.
    if (isEnabledRef.current && isActiveRef.current && !isGeneratingRef.current && generationQueueRef.current.length > 0) {
      processGenerationQueueRef.current();
    }

    setState(prev => ({
      ...prev,
      generatedCount: Array.from(segmentsRef.current.values()).filter(s => s.audioGenerated).length
    }));
  }, []);

  const getVoiceForSpeakerWithCustom = useCallback((speakerId: string): VoiceConfig | undefined => {
    const refVoice = voiceAssignmentsRef.current.get(speakerId);
    if (refVoice) return refVoice;

    const stateVoice = state.voiceAssignments.get(speakerId);
    if (stateVoice) return stateVoice;

    return getVoiceForSpeaker(speakerId, state.voiceAssignments, undefined);
  }, [state.voiceAssignments]);

  // =====================================================================
  // Queue management
  // =====================================================================

  const sortQueueByProximity = useCallback((referenceTime: number) => {
    if (queueModeRef.current !== 'PROXIMITY') return;
    if (generationQueueRef.current.length <= 1) return;

    generationQueueRef.current.sort((idA, idB) => {
      const segA = segmentsRef.current.get(idA);
      const segB = segmentsRef.current.get(idB);
      if (!segA || !segB) return 0;

      const aIsFuture = segA.startTime >= referenceTime - 1;
      const bIsFuture = segB.startTime >= referenceTime - 1;

      if (aIsFuture && !bIsFuture) return -1;
      if (!aIsFuture && bIsFuture) return 1;

      const distA = Math.abs(segA.startTime - referenceTime);
      const distB = Math.abs(segB.startTime - referenceTime);
      return distA - distB;
    });

    log('[v140 George] Queue reordered by proximity to', referenceTime.toFixed(1),
      '- next:', generationQueueRef.current[0] || 'empty');
  }, [log]);

  const enqueueNextSequentialSegment = useCallback((trigger: string): { segmentId: string | null; readyCount: number; targetCount: number } => {
    const next = getNextSequentialSegment();

    if (!next.segment || next.index < 0) {
      generationQueueRef.current = [];
      if (next.targetCount > 0 && next.readyCount >= next.targetCount) {
        log('[v140 George] Sequential buffer complete: segments 0-29 generated ✅');
      } else {
        log(`[v140 George] Sequential buffer: ${next.readyCount}/${next.targetCount}`);
      }
      return { segmentId: null, readyCount: next.readyCount, targetCount: next.targetCount };
    }

    if (next.index > 29) {
      logError(`[v140 George] ❌ Sequential index violation: ${next.segment.id} has index ${next.index} (>29) during BUFFERING`);
    }

    const nextSegmentId = next.segment.id;
    generationQueueRef.current = [nextSegmentId];
    currentSequentialIndexRef.current = next.index + 1;

    log('[v140 George] Queue mode: SEQUENTIAL (buffering)');
    log(`[v140 George] Sequential: generating seg_${next.index} (index ${next.index}) - ${next.index + 1}/${next.targetCount} [id=${nextSegmentId}] [${trigger}]`);

    return { segmentId: nextSegmentId, readyCount: next.readyCount, targetCount: next.targetCount };
  }, [getNextSequentialSegment, log, logError]);

  // =====================================================================
  // Segment addition + generation
  // =====================================================================

  const addSegments = useCallback((
    segments: Array<{
      text: string;
      originalText?: string;  // v152: source-language text from YouTube captions
      start: number;
      duration: number;
      speakerId?: string;
      speakerGender?: string;
      targetDuration?: number;
    }>,
    currentTime?: number
  ) => {
    let newCount = 0;
    let skippedNaN = 0;

    // v100.2: Fresh segment load => reset forward-only tracking
    if (segmentsRef.current.size === 0) {
      playedSegmentsRef.current.clear();
      lastPlayedTimeRef.current = -1;
    }

    segments.forEach((seg) => {
      if (isNaN(seg.start) || seg.start === null || seg.start === undefined) {
        skippedNaN++;
        logWarn('[v140 George] ⚠️ Skipping segment with NaN start time:', seg.text?.substring(0, 40));
        return;
      }
      if (isNaN(seg.duration) || seg.duration === null || seg.duration === undefined || seg.duration <= 0) {
        skippedNaN++;
        logWarn('[v140 George] ⚠️ Skipping segment with invalid duration:', seg.start, seg.duration);
        return;
      }

      const id = 'seg_' + seg.start.toFixed(2);

      if (!segmentsRef.current.has(id)) {
        const audioSegment: AudioSegment = {
          id,
          text: seg.text,
          originalText: seg.originalText,  // v152: preserve source-language text
          startTime: seg.start,
          endTime: seg.start + seg.duration,
          speakerId: seg.speakerId || 'SPEAKER_0',
          speakerGender: (seg.speakerGender as any) || 'unknown',
          audioGenerated: false,
          targetDuration: seg.targetDuration,
        };

        // v152: Log segment addition with originalText for pipeline verification
        if (seg.originalText) {
          console.log(`[v152 George] Segment ${id}: originalText='${seg.originalText.substring(0, 50)}', text='${seg.text.substring(0, 50)}'`);
        }

        const voice = voiceAssignmentsRef.current.get(audioSegment.speakerId)
          || getVoiceForSpeakerWithCustom(audioSegment.speakerId);
        audioSegment.voice = voice;

        segmentsRef.current.set(id, audioSegment);
        generationQueueRef.current.push(id);
        newCount++;
      }
    });

    if (skippedNaN > 0) {
      log('[v140 George] ⚠️ Filtered out', skippedNaN, 'segments with invalid timing');
    }

    if (newCount > 0) {
      log('[v140 George] Added', newCount, 'new segments, total:', segmentsRef.current.size);
      if (queueModeRef.current === 'SEQUENTIAL' || playbackStateRef.current === 'BUFFERING') {
        enqueueNextSequentialSegment('addSegments');
      } else {
        const refTime = currentTime ?? currentTimeRef.current;
        sortQueueByProximity(refTime);
      }
    }

    const sortedSegments = getSortedSegments();
    if (newCount > 0 || segmentTimesMapRef.current.length === 0) {
      refreshSegmentTimesMap(true);
    }

    if (sortedSegments.length > 0) {
      const detectedSpeechStart = detectSpeechStartTime(sortedSegments);
      firstSpeechStartRef.current = detectedSpeechStart;
      minBufferSizeRef.current = computeMinBufferSize(sortedSegments.length);
      currentBufferSizeRef.current = getCurrentBufferSize(currentTimeRef.current);
      setGeorgeBufferStatus(prev => applyRollingBufferToStatus({
        ...prev,
        firstSpeechStart: detectedSpeechStart,
        minBufferSize: minBufferSizeRef.current,
        currentBufferSize: currentBufferSizeRef.current,
      }));
      log(`[v140 George] 🗣️ Speech detection: first speech at ${detectedSpeechStart.toFixed(2)}s`);
      log(`[v140 George] 📦 Buffer target set: ${minBufferSizeRef.current} segments (total=${sortedSegments.length})`);

      if (queueModeRef.current === 'SEQUENTIAL' || playbackStateRef.current === 'BUFFERING') {
        const init = initializeSequentialBuffer();
        log(`[v140 George] Sequential init status: ready=${init.readyCount}/${init.targetCount}`);
      }
    }

    // v146 FIX: totalCount should reflect the TTS generation target (e.g. 30),
    // not ALL video segments (e.g. 101). Use min(INITIAL_BUFFER_TARGET, totalSegments).
    const generationTarget = Math.min(INITIAL_BUFFER_TARGET, segmentsRef.current.size);
    setState(prev => ({
      ...prev,
      totalCount: generationTarget
    }));

    // v101.3: Auto-start generation as soon as buffering is enabled (before Start Watching).
    if (isEnabledRef.current && isActiveRef.current && !isGeneratingRef.current && newCount > 0) {
      processGenerationQueueRef.current();
    }
  }, [applyRollingBufferToStatus, computeMinBufferSize, detectSpeechStartTime, enqueueNextSequentialSegment, getCurrentBufferSize, getSortedSegments, getVoiceForSpeakerWithCustom, initializeSequentialBuffer, log, refreshSegmentTimesMap, sortQueueByProximity]);

  const generateAudioForSegment = useCallback(async (segmentId: string): Promise<boolean> => {
    const segment = segmentsRef.current.get(segmentId);
    if (!segment || segment.audioGenerated) return true;

    // v101.3: generation now runs during pre-buffering before Start Watching.
    // v88: Don't generate when both enabled + activity gates are closed.
    if (!isEnabledRef.current && !isActiveRef.current) return false;

    if (generatingSegmentIdsRef.current.has(segmentId)) {
      log('[v140 George] 🧵 Segment already generating in parallel, skipping duplicate request:', segmentId);
      return true;
    }

    generatingSegmentIdsRef.current.add(segmentId);

    try {
      const customVoice = customVoiceMappingsRef.current.get(segment.speakerId);
      let voiceToUse = voiceAssignmentsRef.current.get(segment.speakerId) || segment.voice;

      if (customVoice && (!voiceToUse || voiceToUse.id !== customVoice)) {
        voiceToUse = OPENAI_VOICES.find(v => v.id.toLowerCase() === customVoice) || voiceToUse;
      }

      const requestBody: any = {
        text: segment.text,
        voice: voiceToUse,
        videoId,
        segmentId: segment.id,
        speakerId: segment.speakerId,
        targetDuration: segment.targetDuration,
        targetLanguage, // v100: Preserve multi-language support
        ttsModel,       // v100: Pass model preference to route v78
      };

      if (customVoice) {
        requestBody.customVoice = customVoice;
        if (requestBody.voice) {
          requestBody.voice = { ...requestBody.voice, id: customVoice };
        }
      }

      log('[v140 George] TTS request for', segmentId, ':', segment.speakerId, '->', voiceToUse?.name || 'none',
        `(lang: ${targetLanguage})`,
        `(model: ${ttsModel})`,
        segment.targetDuration ? `(targetDuration: ${segment.targetDuration.toFixed(2)}s)` : '(no targetDuration)');

      const response = await fetch('/api/multi-voice-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'TTS generation failed');
      }

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        if (data.useClientSideTTS) {
          segment.audioGenerated = true;
          segment.audioUrl = 'browser-tts';
          segmentsRef.current.set(segmentId, segment);
          return true;
        }
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      segment.audioGenerated = true;
      segment.audioUrl = audioUrl;
      segmentsRef.current.set(segmentId, segment);

      setState(prev => ({
        ...prev,
        generatedCount: prev.generatedCount + 1,
        error: null,
      }));

      // v84/v85: If we're currently playing and this segment is the next one, preload it
      const currentPlayingIdx = currentlyPlayingSegmentIndexRef.current;
      if (currentPlayingIdx !== null && isPlayingRef.current) {
        const sorted = getSortedSegments();
        const nextIdx = currentPlayingIdx + 1;
        const nextNextIdx = currentPlayingIdx + 2;
        if (nextIdx < sorted.length && sorted[nextIdx].id === segmentId) {
          log('[v140 George] 🔮 Just-generated segment is next — triggering preload');
          preloadNextSegment(currentPlayingIdx);
        } else if (nextNextIdx < sorted.length && sorted[nextNextIdx].id === segmentId) {
          log('[v140 George] 🔮🔮 Just-generated segment is N+2 — triggering N+2 preload');
          preloadSegmentN2(currentPlayingIdx + 1);
        }
      }

      return true;

    } catch (error) {
      logError('[v140 George] Generation error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Generation failed';
      segment.audioError = errorMessage;
      segmentsRef.current.set(segmentId, segment);
      setState(prev => ({ ...prev, error: `Buffering failed for ${segmentId}: ${errorMessage}` }));
      return false;
    } finally {
      generatingSegmentIdsRef.current.delete(segmentId);
    }
  }, [videoId, targetLanguage, ttsModel, getSortedSegments, preloadNextSegment, preloadSegmentN2]);

  const batchRequestSegments = useCallback(async (segmentIndices: number[]): Promise<void> => {
    if (segmentIndices.length === 0) return;

    const sorted = getSortedSegments();
    const segmentIds = segmentIndices
      .map(index => sorted[index]?.id)
      .filter((id): id is string => !!id);

    if (segmentIds.length === 0) return;

    // Prevent duplicate sequential requests for the same segments.
    generationQueueRef.current = generationQueueRef.current.filter(id => !segmentIds.includes(id));

    log(`[v140 George] 📦⚡ Batch request start (${segmentIds.length}): ${segmentIds.join(', ')}`);

    const results = await Promise.all(segmentIds.map(async id => {
      const success = await generateAudioForSegment(id);
      return { id, success };
    }));

    const successCount = results.filter(r => r.success).length;
    log(`[v140 George] 📦⚡ Batch request done: ${successCount}/${segmentIds.length} ready`);
  }, [generateAudioForSegment, getSortedSegments]);

  const maintainRollingBuffer = useCallback(async (
    trigger: string,
    currentSegmentIndexInput?: number | null
  ): Promise<void> => {
    if (!isEnabledRef.current || !isActiveRef.current) {
      log(`[v140 George] 🧭 Rolling check (${trigger}) skipped: gate closed (enabled=${isEnabledRef.current}, active=${isActiveRef.current}, playbackAllowed=${playbackAllowedRef.current})`);
      return;
    }

    if (playbackStateRef.current === 'BUFFERING' || queueModeRef.current === 'SEQUENTIAL') {
      queueModeRef.current = 'SEQUENTIAL';
      log('[v140 George] Queue mode: SEQUENTIAL (buffering)');
      const nextSequential = enqueueNextSequentialSegment(`rolling:${trigger}`);
      currentBufferSizeRef.current = nextSequential.readyCount;
      log(`[v140 George] Sequential buffer: ${nextSequential.readyCount}/${nextSequential.targetCount}`);

      if (nextSequential.readyCount >= nextSequential.targetCount && playbackStateRef.current === 'BUFFERING') {
        updatePlaybackState('READY', `sequential buffer complete ${nextSequential.readyCount}/${nextSequential.targetCount}`);
      }

      if (nextSequential.segmentId && !isGeneratingRef.current) {
        processGenerationQueueRef.current();
      }
      return;
    }

    if (queueModeRef.current !== 'PROXIMITY') {
      queueModeRef.current = 'PROXIMITY';
      log('[v140 George] Queue mode: PROXIMITY (playing)');
    }

    if (rollingRefillInProgressRef.current) {
      log(`[v140 George] 🧭 Rolling check (${trigger}) skipped: refill already in progress`);
      return;
    }

    const metrics = getRollingBufferMetrics(currentSegmentIndexInput);
    log(`[v140 George] 🧭 Rolling check (${trigger}) generated=${metrics.totalGenerated}/${metrics.totalSegments} current=${metrics.currentSegmentIndex} ahead=${metrics.segmentsAhead}/${ROLLING_BUFFER_AHEAD_TARGET} health=${metrics.bufferHealth}`);

    if (metrics.segmentsAhead >= ROLLING_BUFFER_AHEAD_TARGET) {
      log(`[v140 George] 🧭 Rolling check (${trigger}) no refill: ahead buffer already healthy (${metrics.segmentsAhead} >= ${ROLLING_BUFFER_AHEAD_TARGET})`);
      return;
    }

    const sorted = getSortedSegments();
    const startIndex = Math.max(0, (metrics.currentSegmentIndex >= 0 ? metrics.currentSegmentIndex + 1 : 0));
    const shortfall = Math.max(1, ROLLING_BUFFER_AHEAD_TARGET - metrics.segmentsAhead);
    const desiredBatch = Math.min(BATCH_REQUEST_MAX, Math.max(BATCH_REQUEST_MIN, shortfall));
    log(`[v140 George] 🧭 Rolling refill planning (${trigger}): shortfall=${shortfall}, desiredBatch=${desiredBatch}, startIndex=${startIndex}`);

    const requestIndices: number[] = [];
    for (let i = startIndex; i < sorted.length && requestIndices.length < desiredBatch; i++) {
      const seg = sorted[i];
      if (!seg) continue;
      if (seg.audioGenerated && !!seg.audioUrl) continue;
      if (generatingSegmentIdsRef.current.has(seg.id)) continue;
      requestIndices.push(i);
    }

    if (requestIndices.length === 0) {
      log(`[v140 George] 🧭 Rolling check (${trigger}) no pending segments available for refill`);
      return;
    }

    const requestIds = requestIndices.map(i => sorted[i]?.id).filter((id): id is string => !!id);
    log(`[v140 George] 🧭 Rolling refill request (${trigger}): idx=[${requestIndices.join(', ')}] ids=[${requestIds.join(', ')}]`);

    rollingRefillInProgressRef.current = true;
    try {
      await batchRequestSegments(requestIndices);
      const refreshedMetrics = getRollingBufferMetrics(currentSegmentIndexInput);
      currentBufferSizeRef.current = getCurrentBufferSize(currentTimeRef.current);
      setGeorgeBufferStatus(prev => applyRollingBufferToStatus({
        ...prev,
        currentBufferSize: currentBufferSizeRef.current,
        lastAction: `rolling refill ${trigger} +${requestIndices.length}`,
        playbackState: playbackStateRef.current,
      }, currentSegmentIndexInput, `rolling-refill:${trigger}`));

      log(`[v140 George] 🧭 Rolling refill result (${trigger}) ahead=${refreshedMetrics.segmentsAhead}/${ROLLING_BUFFER_AHEAD_TARGET} health=${refreshedMetrics.bufferHealth}`);
    } finally {
      rollingRefillInProgressRef.current = false;
    }
  }, [applyRollingBufferToStatus, batchRequestSegments, enqueueNextSequentialSegment, getCurrentBufferSize, getRollingBufferMetrics, getSortedSegments, log, updatePlaybackState]);

  const processGenerationQueue = useCallback(async () => {
    if (!isEnabledRef.current || !isActiveRef.current) {
      return;
    }

    if (isGeneratingRef.current) return;

    if (queueModeRef.current === 'SEQUENTIAL') {
      enqueueNextSequentialSegment('queue-start');
    } else if (generationQueueRef.current.length === 0) {
      return;
    }

    isGeneratingRef.current = true;
    setState(prev => ({ ...prev, isGenerating: true }));

    while (isEnabledRef.current) {
      if (!isEnabledRef.current || !isActiveRef.current) {
        log('[v140 George] ⏸️ Generation halted — enabled/activity gate closed');
        break;
      }
      if (isPausedRef.current) {
        log('[v140 George] ⏸️ Generation paused — halting queue processing');
        break;
      }

      let segmentId: string | null = null;
      let sequentialTargetHint = minBufferSizeRef.current;

      if (queueModeRef.current === 'SEQUENTIAL' || playbackStateRef.current === 'BUFFERING') {
        queueModeRef.current = 'SEQUENTIAL';
        const nextSequential = enqueueNextSequentialSegment('processGenerationQueue');
        sequentialTargetHint = Math.max(1, nextSequential.targetCount);
        segmentId = nextSequential.segmentId;

        if (!segmentId) {
          if (nextSequential.readyCount >= sequentialTargetHint && playbackStateRef.current === 'BUFFERING') {
            log('[v140 George] Sequential buffer complete: segments 0-29 generated ✅');
            updatePlaybackState('READY', `sequential buffer complete ${nextSequential.readyCount}/${sequentialTargetHint}`);
          }
          break;
        }
      } else {
        queueModeRef.current = 'PROXIMITY';
        log('[v140 George] Queue mode: PROXIMITY (playing)');
        if (generationQueueRef.current.length === 0) break;
        sortQueueByProximity(currentTimeRef.current);
        segmentId = generationQueueRef.current.shift() || null;
        if (!segmentId) break;
      }

      await generateAudioForSegment(segmentId);

      const sortedNow = getSortedSegments();
      const sequentialReady = getSequentialReadyCount(sortedNow);
      const sequentialTarget = Math.max(1, getSequentialTargetCount(sortedNow));
      const bufferSize = playbackStateRef.current === 'BUFFERING'
        ? sequentialReady
        : getCurrentBufferSize(currentTimeRef.current);

      currentBufferSizeRef.current = bufferSize;
      const total = Math.max(1, segmentsRef.current.size);

      const progressLabel = playbackStateRef.current === 'BUFFERING'
        ? `Sequential buffer: ${sequentialReady}/${sequentialTarget}`
        : `Buffer progress: ${bufferSize}/${ROLLING_BUFFER_AHEAD_TARGET}`;

      setGeorgeBufferStatus(prev => applyRollingBufferToStatus({
        ...prev,
        currentBufferSize: bufferSize,
        minBufferSize: minBufferSizeRef.current,
        playbackState: playbackStateRef.current,
        totalSegments: total,
        lastAction: progressLabel
      }));

      if (playbackStateRef.current === 'BUFFERING') {
        log(`[v140 George] Sequential buffer: ${sequentialReady}/${sequentialTarget}`);
        if (sequentialReady >= sequentialTarget) {
          log('[v140 George] Sequential buffer complete: segments 0-29 generated ✅');
          updatePlaybackState('READY', `buffer target reached ${sequentialReady}/${sequentialTarget}`);
        }
      } else {
        log(`[v140 George] 📦 Buffer progress: ${bufferSize}/${ROLLING_BUFFER_AHEAD_TARGET} ready`);
      }

      if (queueModeRef.current === 'PROXIMITY' && generationQueueRef.current.length === 0) {
        break;
      }

      await new Promise(r => setTimeout(r, 100));
    }

    isGeneratingRef.current = false;
    setState(prev => ({ ...prev, isGenerating: false }));
  }, [applyRollingBufferToStatus, enqueueNextSequentialSegment, generateAudioForSegment, getCurrentBufferSize, getSequentialReadyCount, getSequentialTargetCount, getSortedSegments, log, sortQueueByProximity, updatePlaybackState]);

  useEffect(() => {
    processGenerationQueueRef.current = processGenerationQueue;
  }, [processGenerationQueue]);

  useEffect(() => {
    maintainRollingBufferRef.current = maintainRollingBuffer;
  }, [maintainRollingBuffer]);

  // =====================================================================
  // Playback controls
  // =====================================================================

  const playSegmentAudio = useCallback(async (segmentId: string) => {
    const segment = segmentsRef.current.get(segmentId);
    if (!segment) return;

    // v87: If not active (stopped), silently exit
    if (!isActiveRef.current) {
      return;
    }

    // v88: Robust audio element initialization
    // Always ensure we have an audio element before trying to play
    if (!audioElementRef.current) {
      if (playbackAllowedRef.current) {
        console.log('[v140 George] 🔧 playSegmentAudio: audio element missing, initializing...');
        initAudioElements();

        // v88: If STILL null after init (shouldn't happen but be defensive)
        if (!audioElementRef.current) {
          console.log('[v140 George] ⚠️ Audio element still null after init — creating inline');
          audioElementRef.current = new Audio();
          // v96: Use ref-based listeners for inline creation too
          const onEnded = () => { handleAudioEndedRef.current(); };
          const onError = (e: Event) => { handleAudioErrorRef.current(e); };
          audioElementRef.current.addEventListener('ended', onEnded);
          audioElementRef.current.addEventListener('error', onError);
          (audioElementRef.current as any)._v88_onEnded = onEnded;
          (audioElementRef.current as any)._v88_onError = onError;
          audioElementRef.current.loop = false;  // v96: Disable looping
          audioInitializedRef.current = true;
        }
      } else {
        console.log('[v140 George] ⛔ playSegmentAudio blocked — playback not yet allowed', {
          playbackAllowed: playbackAllowedRef.current,
          isActive: isActiveRef.current,
          isEnabled: isEnabledRef.current,
          audioElement: !!audioElementRef.current,
        });
        return;
      }
    } else if (!audioInitializedRef.current) {
      // Element exists but listeners not attached
      log('[v140 George] 🔧 Audio element exists but not initialized — attaching listeners');
      initAudioElements();
    }

    if (!segment.audioGenerated) {
      const success = await generateAudioForSegment(segmentId);
      if (!success) return;
    }

    if (segment.audioUrl === 'browser-tts') {
      playBrowserTTS(segment);
      return;
    }

    if (!segment.audioUrl) return;

    try {
      // v90: Safe null checks instead of non-null assertions (prevents crash after unmount)
      const audioEl = audioElementRef.current;
      if (!audioEl) {
        logError('[v140 George] ⚠️ audioElementRef became null before play — aborting');
        return;
      }

      const segIndex = findSegmentIndex(segmentId);
      const audioAlreadyPlayingThisSegment =
        currentlyPlayingSegmentIndexRef.current === segIndex &&
        !!audioEl.src &&
        audioEl.currentTime > 0 &&
        !audioEl.paused &&
        !audioEl.ended;

      if (audioAlreadyPlayingThisSegment) {
        log(`[v140 George] ⏭️ Duplicate play suppressed in playSegmentAudio for ${segment.id} (index ${segIndex})`);
        return;
      }

      // v100.2 CRITICAL FIX: mark segment + watermark BEFORE audio.play()
      currentlyPlayingSegmentIndexRef.current = segIndex;
      currentSequentialIndexRef.current = segIndex;
      currentSegmentStartAudioPositionRef.current = getAudioPositionForIndex(segIndex);
      audioPositionRef.current = currentSegmentStartAudioPositionRef.current;
      markSegmentPlayed(segment, segIndex, 'playSegmentAudio pre-play');
      log(`[v140 George] 🎵 Segment ${segIndex} start audio position: ${currentSegmentStartAudioPositionRef.current.toFixed(2)}s`);

      // v96: Reset end detection guard and disable looping before play
      endDetectionFiredRef.current = false;
      audioEl.loop = false;

      audioEl.src = segment.audioUrl;
      audioEl.volume = 1;
      await audioEl.play();

      // v90: Re-check ref after async play() — component may have unmounted
      if (!isActiveRef.current) {
        audioEl.pause();
        return;
      }

      log('[v140 George] Playing segment:', segmentId, 'index:', segIndex);
      isPlayingRef.current = true;
      setState(prev => ({
        ...prev,
        isPlaying: true,
        currentSegmentId: segmentId
      }));
      halfPreloadTriggeredSegmentRef.current = null;
      void maintainRollingBufferRef.current('segment-start', segIndex);

      // v99: phraseTimeoutRef REMOVED — George's 100ms loop detects stalled playback
      // No timer watchdog set — George Task 3 handles stall recovery

      // v85: Attach timeupdate for early preload trigger
      if (audioElementRef.current) {
        attachTimeUpdatePreload(audioElementRef.current);
      }

      // v84/v85: Trigger preloading of the NEXT segment(s) for gapless transition
      if (segIndex >= 0) {
        preloadNextSegment(segIndex);
      }
    } catch (error) {
      logError('[v140 George] Playback error:', error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        logWarn('[v140 George] Play request interrupted (AbortError) - another play may have been requested');
      }
    }
  }, [generateAudioForSegment, findSegmentIndex, getAudioPositionForIndex, preloadNextSegment, attachTimeUpdatePreload, initAudioElements, markSegmentPlayed]);
  // v96: Removed handleAudioEnded and handleAudioError from deps — we use refs now

  useEffect(() => {
    playSegmentAudioRef.current = playSegmentAudio;
  }, [playSegmentAudio]);

  const playSegmentByIndex = useCallback(async (index: number, source: string, videoTime?: number): Promise<boolean> => {
    const sortedSegments = getSortedSegments();

    if (!Number.isFinite(index) || index < 0) {
      logWarn(`[v140 George] ⚠️ playSegment aborted: invalid index ${index} (${source})`);
      return false;
    }

    if (index >= sortedSegments.length) {
      logWarn(`[v140 George] ⚠️ playSegment aborted: index ${index} out of range (segments=${sortedSegments.length})`);
      return false;
    }

    const segment = sortedSegments[index];
    const safeVideoTime = Number.isFinite(videoTime as number) ? (videoTime as number) : NaN;
    const videoLabel = Number.isFinite(safeVideoTime) ? `${safeVideoTime.toFixed(2)}s` : 'n/a';

    log(`[v140 George] ▶️ playSegment called: index ${index} [${source}] (video=${videoLabel})`);
    log(`[v140 George] 🎵 Loading audio for segment ${index} (${segment.id})`);

    const audioEl = audioElementRef.current;
    const alreadyPlaying =
      !!audioEl &&
      !!audioEl.src &&
      !audioEl.paused &&
      !audioEl.ended &&
      audioEl.currentTime > 0 &&
      currentlyPlayingSegmentIndexRef.current === index;

    if (alreadyPlaying) {
      isPlayingRef.current = true;
      log(`[v140 George] ✅ Audio playing: segment ${index} (already active)`);
      return true;
    }

    try {
      await playSegmentAudioRef.current(segment.id);

      const postAudioEl = audioElementRef.current;
      const nowPlaying =
        !!postAudioEl &&
        !!postAudioEl.src &&
        !postAudioEl.paused &&
        !postAudioEl.ended &&
        postAudioEl.currentTime >= 0 &&
        currentlyPlayingSegmentIndexRef.current === index;

      if (nowPlaying) {
        log(`[v140 George] ✅ Audio playing: segment ${index} ✅`);
      } else {
        logWarn(`[v140 George] ⚠️ playSegment requested index ${index}, but playback is not yet confirmed`);
      }

      return nowPlaying;
    } catch (error) {
      logError(`[v140 George] ❌ playSegment failed for index ${index}:`, error);
      return false;
    }
  }, [getSortedSegments, log, logWarn, logError]);

  useEffect(() => {
    playSegmentByIndexRef.current = playSegmentByIndex;
  }, [playSegmentByIndex]);

  /**
   * v91: pauseAudio — now stops generation queue and suppresses logging
   * Previously only paused the HTMLAudioElement, leaving TTS generation
   * and console output running in the background.
   */
  const pauseAudio = useCallback(() => {
    const pausedAt = getVideoTime('pause-audio');
    console.log(`[v140 George] ⏸️ Video paused at ${pausedAt.toFixed(2)}s`);
    console.log('[v140 George] ⏸️ pauseAudio called — stopping playback, generation, and logging');

    // v91: Set paused flag — suppresses log() output and halts generation
    isPausedRef.current = true;

    // v151: force a final monitor snapshot at pause time so panel keeps actual pause position
    const pausedAudioPosition = getAudioPosition();
    updateSyncStatusDisplay(
      pausedAt,
      pausedAudioPosition,
      Math.abs(pausedAt - pausedAudioPosition),
      false,
      georgeLoopIterationRef.current,
      getTranscriptTextAtTime(pausedAt, 'video'),
      getTranscriptTextAtTime(pausedAudioPosition, 'audio'),
    );

    // Pause audio element
    if (audioElementRef.current) {
      audioElementRef.current.pause();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechSynthesis.pause();
    }

    // v91: Stop generation queue processing
    isGeneratingRef.current = false;

    isPlayingRef.current = false;
    setState(prev => ({ ...prev, isPlaying: false, isGenerating: false }));

    console.log(`[v140 George] ⏸️ Audio paused at ${pausedAt.toFixed(2)}s`);
    console.log('[v140 George] ⏸️ ✅ Paused — generation halted, logging suppressed');
  }, [getAudioPosition, getTranscriptTextAtTime, getVideoTime, updateSyncStatusDisplay]);

  /**
   * v102.1.0: resumeAudio — comprehensive resume with hard realignment + detailed diagnostics
   */
  const resumeAudio = useCallback(() => {
    const rawVideoTime = getVideoTime('resume-audio');
    const currentVideoTime = Number.isFinite(rawVideoTime) && rawVideoTime >= 0
      ? rawVideoTime
      : currentTimeRef.current;

    const sortedSegments = getSortedSegments();
    const correctSegment = getSegmentIndexForVideoTime(currentVideoTime);
    const currentSegment = currentlyPlayingSegmentIndexRef.current;
    const targetSeg = correctSegment >= 0 && correctSegment < sortedSegments.length
      ? sortedSegments[correctSegment]
      : null;

    console.log('[v140 George] 🔄 Resume initiated');
    console.log(`[v140 George] 📹 Video time: ${currentVideoTime.toFixed(2)}s`);
    if (targetSeg) {
      console.log(`[v140 George] 🎯 Target segment: ${correctSegment} (${targetSeg.startTime.toFixed(2)}s - ${targetSeg.endTime.toFixed(2)}s)`);
    } else {
      console.log(`[v140 George] ⚠️ Target segment not found for video time ${currentVideoTime.toFixed(2)}s`);
    }

    // clear paused gate first so normal hook logging/ops can proceed
    isPausedRef.current = false;

    if (!audioElementRef.current) {
      if (playbackAllowedRef.current) {
        console.log('[v140 George] 🔧 Audio element missing - initializing now');
        initAudioElements();
      } else {
        console.log('[v140 George] ⛔ Cannot resume: playback gate is closed');
        return;
      }
    }

    const audioEl = audioElementRef.current;
    if (!audioEl) {
      console.log('[v140 George] ❌ Audio element is null after initialization');
      if (targetSeg) {
        console.log('[v140 George] 🔁 Falling back to playAtTime for recovery');
        void playAtTimeRef.current(currentVideoTime);
      }
      return;
    }

    const hasSrc = !!audioEl.src;
    const paused = audioEl.paused;
    const ended = audioEl.ended;
    const segmentMismatch = correctSegment >= 0 && currentSegment !== correctSegment;

    console.log(`[v140 George] 🔊 Audio element state: paused=${paused}, ended=${ended}, hasSrc=${hasSrc}, currentSegment=${currentSegment}`);

    const playPromise = paused && hasSrc
      ? (() => {
          console.log('[v140 George] ▶️ Calling audio.play()');
          return audioEl.play()
            .then(() => {
              isPlayingRef.current = true;
              setState(prev => ({ ...prev, isPlaying: true }));
              console.log(`[v140 George] ✅ Audio playing successfully at ${currentVideoTime.toFixed(2)}s`);
            })
            .catch((err) => {
              logError('[v140 George] ❌ Audio play failed:', err);
            });
        })()
      : Promise.resolve();

    void playPromise.then(() => {
      if (!hasSrc || ended) {
        console.log(`[v140 George] 🔁 No playable source (hasSrc=${hasSrc}, ended=${ended}) - forcing playAtTime sync`);
        void playAtTimeRef.current(currentVideoTime);
        return;
      }

      if (segmentMismatch) {
        console.log(`[v140 George] 🔁 Segment mismatch detected (current=${currentSegment}, expected=${correctSegment}) - forcing sync`);
        void playAtTimeRef.current(currentVideoTime);
        return;
      }

      if (!paused && !segmentMismatch) {
        console.log(`[v140 George] ✅ Audio already aligned and playing at ${currentVideoTime.toFixed(2)}s`);
      }
    });

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechSynthesis.resume();
    }

    if (isEnabledRef.current && !isGeneratingRef.current && generationQueueRef.current.length > 0) {
      processGenerationQueueRef.current();
    }
  }, [getSegmentIndexForVideoTime, getSortedSegments, initAudioElements]);

  /**
   * v87/v88: stopAudio — COMPREHENSIVE STOP
   * v88: Also clears generation queue, sets stoppedRef, and halts generation
   */
  const stopAudio = useCallback(() => {
    console.log('[v140 George] 🛑 stopAudio called - COMPREHENSIVE STOP');

    // v87: IMMEDIATELY disable activity gate — suppresses all callbacks and logging
    isActiveRef.current = false;

    // v88: Set stopped flag — prevents watchdog useEffect from re-creating interval
    stoppedRef.current = true;

    // v91: Clear paused flag (stop supersedes pause)
    isPausedRef.current = false;

    // v99: Only George's interval needs clearing (all legacy timers removed)

    // v95: Clear session loop counter
    loopCounterRef.current.clear();

    // v100.2: Reset forward-only tracking
    playedSegmentsRef.current.clear();
    lastPlayedTimeRef.current = -1;
    lastBufferHealthRef.current = 'critical';
    playbackStateRef.current = 'BUFFERING';
    queueModeRef.current = 'SEQUENTIAL';
    lastGeneratedIndexRef.current = -1;
    currentSequentialIndexRef.current = 0;
    firstSpeechStartRef.current = 0;
    minBufferSizeRef.current = INITIAL_BUFFER_TARGET;
    currentBufferSizeRef.current = 0;
    preReleasePlanRef.current = null;
    generatingSegmentIdsRef.current.clear();
    videoTimeStuckCountRef.current = 0;
    lastResolvedVideoTimeRef.current = currentTimeRef.current;
    youtubePlayerCacheRef.current = null;
    rollingRefillInProgressRef.current = false;
    lastRollingCheckAtRef.current = 0;
    halfPreloadTriggeredSegmentRef.current = null;

    lastVideoTickRef.current = { time: 0, at: Date.now() };
    lastAppliedVideoRateRef.current = 1.0;
    lastAppliedAudioRateRef.current = 1.0;
    lockedTtsPlaybackRateRef.current = 1.0;
    targetVideoWordRateRef.current = 1.0;
    targetAudioWordRateRef.current = 1.0;
    targetRateLockedRef.current = false;
    audioPositionRef.current = 0;
    currentSegmentStartAudioPositionRef.current = 0;
    lastCompletedSegmentIndexRef.current = -1;
    segmentDurationByIndexRef.current.clear();
    lastDriftLogAtRef.current = 0;
    videoElementCacheRef.current = null;

    void applyVideoPlaybackRate(1.0);
    void setAudioPlaybackRate(1.0);
    // v96: Reset end detection guard
    endDetectionFiredRef.current = false;

    // v97: Clear George's interval
    if (georgeIntervalRef.current) {
      clearInterval(georgeIntervalRef.current);
      georgeIntervalRef.current = null;
    }

    // v101: Reset George buffer status + state machine
    updatePlaybackState('BUFFERING', 'stopAudio reset');
    setGeorgeBufferStatus(prev => applyRollingBufferToStatus({ ...prev, isGeorgeActive: false, lastAction: 'stopped', playbackState: 'BUFFERING', currentBufferSize: 0, bufferHealth: 'critical' }, -1));
    currentSyncActionRef.current = '⏳ Waiting for live sync data';
    lockedTtsPlaybackRateRef.current = 1.0;
    targetVideoWordRateRef.current = 1.0;
    targetAudioWordRateRef.current = 1.0;
    targetRateLockedRef.current = false;
    lastAlignmentDiffRef.current = 0;
    lastTargetAudioPositionRef.current = 0;
    lastGermanWordRef.current = '(waiting...)';
    lastWordsAlignedRef.current = false;
    lastJumpTimeRef.current = 0;
    syncCheckInFlightRef.current = false;
    debouncedVideoTimeRef.current = { time: 0, at: 0 };
    setSyncStatus(prev => ({
      ...prev,
      videoTime: 0,
      audioPosition: 0,
      targetAudioPosition: 0,
      positionDiff: 0,
      drift: 0,
      germanWord: '(waiting...)',
      videoText: '(loading...)',
      audioText: '(waiting...)',
      status: 'ALIGNING',
      severity: 'ALIGNING',
      color: 'yellow',
      outOfSync: true,
      action: '⏳ Waiting for live sync data',
      videoRate: 1,
      audioRate: 1,
      ttsPlaybackSpeed: 1,
      ratesMatched: false,
      wordsAligned: false,
      loopIteration: 0,
      isPlaying: false,
      updatedAt: Date.now(),
    }));

    // v87/v88: Disable all playback and generation gates
    isEnabledRef.current = false;
    playbackAllowedRef.current = false;
    isPlayingRef.current = false;

    // v88: Stop generation — clear queue and reset generating flag
    isGeneratingRef.current = false;
    generationQueueRef.current = [];

    // Stop primary audio element
    if (audioElementRef.current) {
      if (timeUpdateHandlerRef.current) {
        audioElementRef.current.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
        timeUpdateHandlerRef.current = null;
      }
      const onEnded = (audioElementRef.current as any)._v88_onEnded;
      const onError = (audioElementRef.current as any)._v88_onError;
      if (onEnded) audioElementRef.current.removeEventListener('ended', onEnded);
      if (onError) audioElementRef.current.removeEventListener('error', onError);
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.src = '';
      audioElementRef.current = null;
    }

    // Stop both preload elements
    if (preloadAudioElementRef.current) {
      preloadAudioElementRef.current.pause();
      preloadAudioElementRef.current.src = '';
      preloadAudioElementRef.current = null;
    }
    if (preload2AudioElementRef.current) {
      preload2AudioElementRef.current.pause();
      preload2AudioElementRef.current.src = '';
      preload2AudioElementRef.current = null;
    }
    preloadedSegmentIdRef.current = null;
    preloadReadyRef.current = false;
    preloaded2SegmentIdRef.current = null;
    preload2ReadyRef.current = false;

    // v87: Reset audio initialized so next Start Watching re-creates elements
    audioInitializedRef.current = false;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
    }

    currentlyPlayingSegmentIndexRef.current = null;

    setState(prev => ({
      ...prev,
      isPlaying: false,
      isEnabled: false,
      isGenerating: false, // v88: also clear generating state
      currentSegmentId: null,
    }));

    // v94: Clear loop detector
    // v99: transitioningRef REMOVED
    lastPlayedIndexRef.current = -1;
    consecutivePlayCountRef.current = 0;

    console.log('[v140 George] ✅ All activity stopped — George monitor cleared, audio destroyed, generation halted, gates closed');
  }, [applyVideoPlaybackRate, setAudioPlaybackRate, updatePlaybackState]);

  const playBrowserTTS = useCallback((segment: AudioSegment) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const utterance = new SpeechSynthesisUtterance(segment.text);

    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => {
      if (segment.speakerGender === 'female') {
        return v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('samantha');
      } else if (segment.speakerGender === 'male') {
        return v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('alex');
      }
      return false;
    });

    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.rate = 0.9;
    utterance.pitch = segment.speakerGender === 'female' ? 1.1 : 0.9;

    const segIndex = findSegmentIndex(segment.id);
    currentlyPlayingSegmentIndexRef.current = segIndex;

    // v96: Use ref-based callback to avoid stale closure
    utterance.onend = () => {
      handleAudioEndedRef.current();
    };

    speechSynthesis.speak(utterance);

    isPlayingRef.current = true;
    setState(prev => ({
      ...prev,
      isPlaying: true,
      currentSegmentId: segment.id
    }));

    markSegmentPlayed(segment, segIndex, 'browser tts speak');
    halfPreloadTriggeredSegmentRef.current = null;
    void maintainRollingBufferRef.current('segment-start-browser-tts', segIndex);
  }, [findSegmentIndex, markSegmentPlayed]);  // v96: Removed handleAudioEnded dep — using ref

  const updateCurrentTime = useCallback((time: number) => {
    const safeTime = Number.isFinite(time) && time >= 0 ? time : 0;
    currentTimeRef.current = safeTime;

    if (Math.abs(safeTime - lastResolvedVideoTimeRef.current) > 0.005) {
      videoTimeStuckCountRef.current = 0;
    }
    lastResolvedVideoTimeRef.current = safeTime;
    log(`[v140 George] 📹 Video time: ${safeTime.toFixed(2)}s (progressing ✅) [source=parent-update, reason=updateCurrentTime]`);

    // v92: Don't trigger any generation before Start Watching
    if (!playbackAllowedRef.current) return null;

    const segmentList = getSortedSegments();
    const currentIdx = getSegmentIndexForVideoTime(safeTime);

    if (currentIdx >= 0 && currentIdx < segmentList.length) {
      for (let i = currentIdx; i < Math.min(currentIdx + prebufferCount, segmentList.length); i++) {
        const seg = segmentList[i];
        if (!seg.audioGenerated && !generationQueueRef.current.includes(seg.id)) {
          generationQueueRef.current.unshift(seg.id);
        }
      }

      if (!isGeneratingRef.current) {
        processGenerationQueueRef.current();
      }

      return segmentList[currentIdx] ?? null;
    }

    return null;
  }, [getSegmentIndexForVideoTime, getSortedSegments, log, prebufferCount]);

  /**
   * v102.1.0: playAtTime - strictly video-time-based segment selection
   * Returns { segmentIndex, startTime, segmentId } | null
   */
  const playAtTime = useCallback(async (time: number): Promise<PlayAtTimeResult | null> => {
    if (!isActiveRef.current) return null;

    const videoNow = getVideoTime('playAtTime');
    const requestedTime = time;
    const effectiveTime = requestedTime < (videoNow - 0.1) ? videoNow : requestedTime;

    if (effectiveTime !== requestedTime) {
      log(`[v140 George] ⏩ playAtTime time-guard: requested ${requestedTime.toFixed(2)}s is behind video ${videoNow.toFixed(2)}s, using ${effectiveTime.toFixed(2)}s`);
    }

    currentTimeRef.current = Math.max(currentTimeRef.current, effectiveTime);

    const sortedSegments = getSortedSegments();
    if (sortedSegments.length === 0) {
      log('[v140 George] playAtTime: no segments available');
      return null;
    }

    let targetIndex = getSegmentIndexForVideoTime(effectiveTime);
    if (targetIndex < 0 || targetIndex >= sortedSegments.length) {
      logError(`[v140 George] ❌ Segment not found for video time ${effectiveTime.toFixed(2)}s; falling back to nearest boundary`);
      targetIndex = effectiveTime <= sortedSegments[0].startTime ? 0 : sortedSegments.length - 1;
    }

    const finalSegment = sortedSegments[targetIndex];
    const segmentIndex = targetIndex;
    const segmentStart = Number.isFinite(finalSegment.startTime) ? finalSegment.startTime : 0;
    const segmentEnd = Number.isFinite(finalSegment.endTime)
      ? finalSegment.endTime
      : (segmentIndex < sortedSegments.length - 1 ? sortedSegments[segmentIndex + 1].startTime : Infinity);

    const audioEl = audioElementRef.current;
    const audioIsActivelyPlaying = !!audioEl && !!audioEl.src && audioEl.currentTime > 0 && !audioEl.paused && !audioEl.ended;

    log(`[v140 George] 🎯 Video time: ${effectiveTime.toFixed(2)}s`);
    log(`[v140 George] 🎯 Selected ${finalSegment.id} (index ${segmentIndex}) for video time ${effectiveTime.toFixed(2)}s`);
    log(`[v140 George] 🎯 Segment covers ${segmentStart.toFixed(2)}s - ${Number.isFinite(segmentEnd) ? segmentEnd.toFixed(2) : '∞'}s`);

    if (currentlyPlayingSegmentIndexRef.current === segmentIndex && audioIsActivelyPlaying) {
      log(`[v140 George] ⏭️ Duplicate playAtTime suppressed for ${finalSegment.id} (already playing index ${segmentIndex})`);
      return { segmentIndex, startTime: finalSegment.startTime, segmentId: finalSegment.id };
    }

    sortQueueByProximity(effectiveTime);
    currentlyPlayingSegmentIndexRef.current = segmentIndex;

    markSegmentPlayed(finalSegment, segmentIndex, 'playAtTime pre-play');

    if (finalSegment.audioGenerated) {
      log('[v140 George] playAtTime: audio ready, playing immediately');
      await playSegmentAudioRef.current(finalSegment.id);
      return { segmentIndex, startTime: finalSegment.startTime, segmentId: finalSegment.id };
    }

    log('[v140 George] playAtTime: generating on-demand for', finalSegment.id);

    const queueIdx = generationQueueRef.current.indexOf(finalSegment.id);
    if (queueIdx !== -1) generationQueueRef.current.splice(queueIdx, 1);

    const success = await generateAudioForSegment(finalSegment.id);
    if (success) {
      log('[v140 George] playAtTime: on-demand generation complete, playing');
      await playSegmentAudioRef.current(finalSegment.id);
      return { segmentIndex, startTime: finalSegment.startTime, segmentId: finalSegment.id };
    }

    logError('[v140 George] playAtTime: on-demand generation failed for', finalSegment.id);
    currentlyPlayingSegmentIndexRef.current = null;
    return null;
  }, [generateAudioForSegment, getVideoTime, sortQueueByProximity, getSortedSegments, getSegmentIndexForVideoTime, markSegmentPlayed]);

  // v81 FIX: Keep playAtTimeRef always pointing to the latest playAtTime
  useEffect(() => {
    playAtTimeRef.current = playAtTime;
  }, [playAtTime]);

  // =====================================================================
  // Enable / Playback gate / Clear
  // =====================================================================

  const setEnabled = useCallback((enabled: boolean, currentTime?: number) => {
    console.log('[v140 George] setEnabled:', enabled, currentTime !== undefined ? `at time ${currentTime.toFixed(2)}` : '');
    isEnabledRef.current = enabled;

    if (enabled) {
      stoppedRef.current = false;
      isPausedRef.current = false;
      isActiveRef.current = true;
      queueModeRef.current = 'SEQUENTIAL';
      lastGeneratedIndexRef.current = -1;
      currentSequentialIndexRef.current = 0;
      log('[v140 George] Queue mode: SEQUENTIAL (buffering)');
      updatePlaybackState('BUFFERING', 'setEnabled(true)-prebuffer');
      initAudioElements();
    }

    setState(prev => ({
      ...prev,
      isEnabled: enabled,
      needsAudio: enabled,
      error: enabled ? null : prev.error,
    }));

    if (enabled) {
      if (currentTime !== undefined) {
        currentTimeRef.current = currentTime;
        if (queueModeRef.current === 'PROXIMITY') {
          sortQueueByProximity(currentTime);
        }
      }

      initializeSequentialBuffer();
      enqueueNextSequentialSegment('setEnabled');
      if (!isGeneratingRef.current && (generationQueueRef.current.length > 0 || queueModeRef.current === 'SEQUENTIAL')) {
        processGenerationQueueRef.current();
      }

      // v101.3: playback still waits for explicit Start Watching click.
      if (currentTime !== undefined && playbackAllowedRef.current) {
        log('[v140 George] setEnabled: playback already allowed, triggering playAtTime', currentTime.toFixed(2));
        setTimeout(() => {
          if (!isActiveRef.current) return;
          if (isEnabledRef.current && playbackAllowedRef.current) {
            playAtTimeRef.current(currentTime);
          }
        }, 0);
      }
    } else {
      log('[v140 George] Disabling audio');
      if (audioElementRef.current) {
        audioElementRef.current.pause();
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        speechSynthesis.cancel();
      }
      currentlyPlayingSegmentIndexRef.current = null;
    }
  }, [enqueueNextSequentialSegment, initAudioElements, initializeSequentialBuffer, log, sortQueueByProximity, updatePlaybackState]);

  /**
   * v101.3: Playback gate control.
   * setEnabled(true) now starts background pre-buffering and generation on mount.
   * setPlaybackAllowed(true) only opens playback, never starts generation.
   */
  const setPlaybackAllowed = useCallback((allowed: boolean) => {
    console.log(`[v140 George] 🔓 setPlaybackAllowed: ${allowed}`);
    console.log('[v140 George] 📊 State at setPlaybackAllowed:', {
      isEnabled: isEnabledRef.current,
      isActive: isActiveRef.current,
      stopped: stoppedRef.current,
      paused: isPausedRef.current,
      segments: segmentsRef.current.size,
      queueLength: generationQueueRef.current.length,
      audioElement: !!audioElementRef.current,
      audioInitialized: audioInitializedRef.current,
      playbackState: playbackStateRef.current,
    });

    playbackAllowedRef.current = allowed;

    if (allowed) {
      // v101.3: playback gate should only toggle playback behavior.
      // buffering/generation are already running from setEnabled(true).
      stoppedRef.current = false;
      isPausedRef.current = false;
      initAudioElements();
      lastRollingCheckAtRef.current = 0;

      const initialBuffer = getCurrentBufferSize(currentTimeRef.current);
      currentBufferSizeRef.current = initialBuffer;
      if (initialBuffer >= minBufferSizeRef.current) {
        updatePlaybackState('READY', `gate-open with buffer ${initialBuffer}/${minBufferSizeRef.current}`);
      } else {
        updatePlaybackState('BUFFERING', `gate-open waiting buffer ${initialBuffer}/${minBufferSizeRef.current}`);
      }

      console.log(`[v140 George] ▶️ Playback gate opened at video=${currentTimeRef.current.toFixed(2)}s buffer=${initialBuffer}/${minBufferSizeRef.current}`);
      return;
    }

    if (audioElementRef.current) {
      audioElementRef.current.pause();
    }
    isPlayingRef.current = false;
    setState(prev => ({ ...prev, isPlaying: false }));
    updatePlaybackState('BUFFERING', 'playback gate closed');
    console.log('[v140 George] ⏸️ Playback gate closed');
  }, [initAudioElements, getCurrentBufferSize, updatePlaybackState]);

  const clearAll = useCallback(() => {
    // v87: Ensure activity gate is closed
    isActiveRef.current = false;
    stoppedRef.current = true; // v88
    // v94: Clear loop detector
    lastPlayedIndexRef.current = -1;
    consecutivePlayCountRef.current = 0;
    stopAudio();

    for (const segment of segmentsRef.current.values()) {
      if (segment.audioUrl && segment.audioUrl !== 'browser-tts') {
        URL.revokeObjectURL(segment.audioUrl);
      }
    }

    segmentsRef.current.clear();
    segmentTimesMapRef.current = [];
    segmentTimeMapSignatureRef.current = '';
    lastSelectionLogRef.current = { index: -1, timeBucket: -1 };
    generationQueueRef.current = [];
    customVoiceMappingsRef.current.clear();
    voiceAssignmentsRef.current.clear();
    isEnabledRef.current = false;
    lastBufferHealthRef.current = 'critical';
    playbackAllowedRef.current = false;
    currentlyPlayingSegmentIndexRef.current = null;
    playedSegmentsRef.current.clear();
    lastPlayedTimeRef.current = -1;
    playbackStateRef.current = 'BUFFERING';
    queueModeRef.current = 'SEQUENTIAL';
    lastGeneratedIndexRef.current = -1;
    currentSequentialIndexRef.current = 0;
    generatingSegmentIdsRef.current.clear();
    rollingRefillInProgressRef.current = false;
    lastRollingCheckAtRef.current = 0;
    halfPreloadTriggeredSegmentRef.current = null;
    videoTimeStuckCountRef.current = 0;
    lastResolvedVideoTimeRef.current = 0;
    youtubePlayerCacheRef.current = null;
    firstSpeechStartRef.current = 0;
    minBufferSizeRef.current = INITIAL_BUFFER_TARGET;
    currentBufferSizeRef.current = 0;
    preReleasePlanRef.current = null;

    if (preloadAudioElementRef.current) {
      preloadAudioElementRef.current.pause();
      preloadAudioElementRef.current.src = '';
    }
    if (preload2AudioElementRef.current) {
      preload2AudioElementRef.current.pause();
      preload2AudioElementRef.current.src = '';
    }
    preloadedSegmentIdRef.current = null;
    preloadReadyRef.current = false;
    preloaded2SegmentIdRef.current = null;
    preload2ReadyRef.current = false;
    audioInitializedRef.current = false;

    setState({
      isEnabled: false,
      isGenerating: false,
      isPlaying: false,
      currentSegmentId: null,
      generatedCount: 0,
      totalCount: 0,
      error: null,
      voiceProvider,
      speakers: [],
      voiceAssignments: new Map(),
      customVoiceMappings: new Map(),
      needsAudio: false,
      voicesInitialized: false,
    });
  }, [stopAudio, voiceProvider]);

  // v101.3: Edge case — video URL changed while component stayed mounted.
  // Reset playback/buffering state so new segments can pre-buffer cleanly.
  useEffect(() => {
    if (previousVideoIdRef.current === videoId) return;

    console.log(`[v140 George] 🎬 videoId changed: ${previousVideoIdRef.current} -> ${videoId}. Resetting pre-buffer state.`);
    previousVideoIdRef.current = videoId;

    stopAudio();

    for (const segment of segmentsRef.current.values()) {
      if (segment.audioUrl && segment.audioUrl !== 'browser-tts') {
        URL.revokeObjectURL(segment.audioUrl);
      }
    }

    segmentsRef.current.clear();
    segmentTimesMapRef.current = [];
    segmentTimeMapSignatureRef.current = '';
    lastSelectionLogRef.current = { index: -1, timeBucket: -1 };
    generationQueueRef.current = [];
    generatingSegmentIdsRef.current.clear();
    playedSegmentsRef.current.clear();
    lastPlayedTimeRef.current = -1;
    lastBufferHealthRef.current = 'critical';
    playbackAllowedRef.current = false;
    isActiveRef.current = false;
    isEnabledRef.current = false;
    currentBufferSizeRef.current = 0;
    minBufferSizeRef.current = INITIAL_BUFFER_TARGET;
    firstSpeechStartRef.current = 0;
    playbackStateRef.current = 'BUFFERING';
    queueModeRef.current = 'SEQUENTIAL';
    lastGeneratedIndexRef.current = -1;
    currentSequentialIndexRef.current = 0;
    videoTimeStuckCountRef.current = 0;
    lastResolvedVideoTimeRef.current = 0;
    youtubePlayerCacheRef.current = null;

    setPlaybackState('BUFFERING');
    setState(prev => ({
      ...prev,
      isEnabled: false,
      isGenerating: false,
      isPlaying: false,
      currentSegmentId: null,
      generatedCount: 0,
      totalCount: 0,
      error: null,
      needsAudio: false,
    }));

    setGeorgeBufferStatus(prev => applyRollingBufferToStatus({
      ...prev,
      isGeorgeActive: false,
      playbackState: 'BUFFERING',
      minBufferSize: INITIAL_BUFFER_TARGET,
      currentBufferSize: 0,
      firstSpeechStart: 0,
      totalGenerated: 0,
      currentSegmentIndex: -1,
      segmentsAhead: 0,
      totalSegments: 0,
      bufferHealth: 'critical',
      lastAction: 'video-change-reset',
    }, -1, 'video-change-reset'));
    currentSyncActionRef.current = '⏳ Waiting for live sync data';
    lockedTtsPlaybackRateRef.current = 1.0;
    targetVideoWordRateRef.current = 1.0;
    targetAudioWordRateRef.current = 1.0;
    targetRateLockedRef.current = false;
    lastAlignmentDiffRef.current = 0;
    lastTargetAudioPositionRef.current = 0;
    lastGermanWordRef.current = '(waiting...)';
    lastWordsAlignedRef.current = false;
    lastJumpTimeRef.current = 0;
    syncCheckInFlightRef.current = false;
    debouncedVideoTimeRef.current = { time: 0, at: 0 };
    setSyncStatus(prev => ({
      ...prev,
      videoTime: 0,
      audioPosition: 0,
      targetAudioPosition: 0,
      positionDiff: 0,
      drift: 0,
      germanWord: '(waiting...)',
      videoText: '(loading...)',
      audioText: '(waiting...)',
      status: 'ALIGNING',
      severity: 'ALIGNING',
      color: 'yellow',
      outOfSync: true,
      action: '⏳ Waiting for live sync data',
      videoRate: 1,
      audioRate: 1,
      ttsPlaybackSpeed: 1,
      ratesMatched: false,
      wordsAligned: false,
      loopIteration: 0,
      isPlaying: false,
      updatedAt: Date.now(),
    }));
  }, [videoId, stopAudio, applyRollingBufferToStatus]);

  return {
    // State
    isEnabled: state.isEnabled,
    isGenerating: state.isGenerating,
    isPlaying: state.isPlaying,
    currentSegmentId: state.currentSegmentId,
    generatedCount: state.generatedCount,
    totalCount: state.totalCount,
    error: state.error,
    speakers: state.speakers,
    voiceAssignments: state.voiceAssignments,
    customVoiceMappings: state.customVoiceMappings,
    needsAudio: state.needsAudio,
    voicesInitialized: state.voicesInitialized,

    // v81: Expose segment index and auto-advance status
    currentlyPlayingSegmentIndex: currentlyPlayingSegmentIndexRef.current,
    autoAdvanceEnabled: autoAdvance,

    // v98/v101: George's buffer + state machine status for debug overlay
    georgeBufferStatus,
    syncStatus,
    syncMonitor: syncStatus,
    selectedLine,
    videoLineOffset,
    audioLineOffset,
    calibrationLocked,
    lockCalibration,
    setSelectedLine,
    playbackState,
    minBufferSize: minBufferSizeRef.current,
    currentBufferSize: currentBufferSizeRef.current,
    firstSpeechStart: firstSpeechStartRef.current,

    // Methods
    setEnabled,
    setPlaybackAllowed,  // v101.3: Playback gate (separate from pre-buffer generation)
    initializeVoices,
    updateSegmentVoices,
    addSegments,
    setRateMatchingProfile,
    updateCurrentTime,
    getSegmentAtTime,
    getSyncWordComparison,
    playSegmentAudio,
    playAtTime,       // Returns { segmentIndex, startTime, segmentId } | null
    pauseAudio,
    resumeAudio,      // Enhanced to handle ended audio
    stopAudio,        // v88-v99: Comprehensive stop — clears George monitor + end detection guard, audio, generation, gates, paused
    clearAll,
  };
}

// v90-v99: ONLY named export — no default export.
// AudioClarification imports via: import { useAudioTranslation } from '../hooks/useAudioTranslation'
// Having both named + default export caused webpack confusion in Next.js 14.2.35
// which resulted in "is not a function" errors that crashed the dev server.