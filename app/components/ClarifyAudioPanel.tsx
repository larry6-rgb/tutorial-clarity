'use client';

/**
 * ClarifyAudioPanel — PROGRESSIVE WORKFLOW
 * 
 * 1. choosing:    ProcessingOptionsModal (mode + language)
 * 2. processing:  Fetches transcript + translates first 30 segments → ready fast
 * 3. ready:       Big green "Play Clarified Audio" button
 * 4. playing:     Pause button + volume + segment info (YouTube is muted)
 *                 Background: continues translating ahead of playback
 * 5. paused:      Resume button (YouTube is UNmuted)
 * 6. stopped:     Back to start
 * 
 * KEY FEATURES:
 * - SCHEDULER APPROACH: AI audio plays at natural speed (user's chosen speed)
 *   Each segment triggers when video reaches its timestamp. No rate-matching.
 * - MULTI-VOICE: Detects speaker changes via timing gaps, assigns male (onyx)
 *   and female (nova) voices automatically. Voices change when speakers change.
 * - LIVE OPTIONS: Speed changes apply immediately to playing audio.
 * - Progressive translation: 30-segment buffer, then translate ahead of playback
 * - Dual transcript: original (source lang) + translated, switchable by audio mode
 * - Speed control with bright orange styling
 * - Options button opens settings without restarting translation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import ProcessingOptionsModal, { OutputMode } from '@/app/hooks/ProcessingOptionsModal';

export interface ClarifyTranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;  // Speaker ID (e.g., 'speaker_0', 'speaker_1')
}

interface AudioCache {
  [index: number]: {
    url?: string;
    useClientTTS?: boolean;
    generating?: boolean;
    voice?: string;  // Which TTS voice was used for this segment
    generatedAt?: number;  // Timestamp when this entry was created
  };
}

// Speaker voice configuration: maps speaker IDs to 'male' | 'female'
export type SpeakerConfig = Record<string, 'male' | 'female'>;

interface ClarifyAudioPanelProps {
  videoId: string;
  currentTime: number;
  aiPlaybackSpeed?: number;
  speakerConfig?: SpeakerConfig;           // Optional manual voice config per speaker
  onSpeakersDetected?: (speakers: string[]) => void;  // Callback when speakers are detected
  onSubtitleChange?: (subtitle: string | null) => void;
  onMuteYouTube?: (mute: boolean) => void;
  onPlayYouTube?: () => void;
  onTranscriptReady?: (segments: ClarifyTranscriptSegment[]) => void;
  onSegmentChange?: (index: number) => void;
  registerHandlers?: (handlers: { play: () => void; pause: () => void; isPlaying: () => boolean; regenerateVoices: (config?: SpeakerConfig) => void }) => void;
}

// ═══ MULTI-VOICE SYSTEM ═══
// Voice pools for same-gender variety — speakers cycle through these.
// OpenAI voices: 'onyx' (deep male), 'echo' (male), 'fable' (male),
//                'nova' (female), 'shimmer' (female), 'alloy' (neutral)
export const FEMALE_VOICES = ['nova', 'shimmer', 'alloy'];
export const MALE_VOICES   = ['onyx', 'fable', 'echo'];

// Default voice when no speaker detection is possible
const DEFAULT_VOICE = 'onyx';

/**
 * Compute a deterministic voice assignment for every speaker in the config.
 * Speakers are sorted numerically so the mapping is stable regardless of
 * object-key iteration order.  Same-gender speakers cycle through their pool:
 *   Female: nova -> shimmer -> alloy -> nova ...
 *   Male:   onyx -> fable   -> echo  -> onyx ...
 */
export function assignVoicesToSpeakers(config: SpeakerConfig): Record<string, string> {
  const assignments: Record<string, string> = {};
  let femaleIdx = 0;
  let maleIdx = 0;

  const sorted = Object.keys(config).sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] || '0');
    const nb = parseInt(b.match(/\d+/)?.[0] || '0');
    return na - nb;
  });

  for (const id of sorted) {
    if (config[id] === 'female') {
      assignments[id] = FEMALE_VOICES[femaleIdx % FEMALE_VOICES.length];
      femaleIdx++;
    } else {
      assignments[id] = MALE_VOICES[maleIdx % MALE_VOICES.length];
      maleIdx++;
    }
  }
  return assignments;
}

/**
 * Detect speaker changes in transcript using timing gaps.
 * A gap > 1.0s between segments suggests a speaker change.
 * Each gap increments to a NEW speaker (no mod-2 cap).
 */
function detectSpeakers(segments: ClarifyTranscriptSegment[]): ClarifyTranscriptSegment[] {
  if (segments.length === 0) return segments;

  const GAP_THRESHOLD = 1.0; // seconds — lowered from 1.5 to catch more speaker changes
  let currentSpeaker = 0;
  let maxSpeaker = 0;
  const result: ClarifyTranscriptSegment[] = [];
  const gapLog: string[] = [];

  console.log(`[speaker-detection] Analyzing ${segments.length} segments (gap threshold: ${GAP_THRESHOLD}s)...`);

  for (let i = 0; i < segments.length; i++) {
    const seg = { ...segments[i] };

    // If segment already has a speaker tag from API, keep it
    if (seg.speaker) {
      result.push(seg);
      continue;
    }

    if (i === 0) {
      seg.speaker = `speaker_${currentSpeaker}`;
    } else {
      const prevEnd = segments[i - 1].end;
      const gap = seg.start - prevEnd;
      if (gap > GAP_THRESHOLD) {
        currentSpeaker++;          // Always increment — no mod cap
        maxSpeaker = Math.max(maxSpeaker, currentSpeaker);
        gapLog.push(`seg ${i}: gap ${gap.toFixed(1)}s -> speaker_${currentSpeaker}`);
      }
      seg.speaker = `speaker_${currentSpeaker}`;
    }
    result.push(seg);
  }

  // Log speaker distribution
  const speakerCounts: Record<string, number> = {};
  result.forEach(s => { speakerCounts[s.speaker || 'unknown'] = (speakerCounts[s.speaker || 'unknown'] || 0) + 1; });
  console.log(`[speaker-detection] Found ${maxSpeaker + 1} speakers:`, speakerCounts);
  if (gapLog.length <= 20) {
    gapLog.forEach(g => console.log(`[speaker-detection]   ${g}`));
  } else {
    console.log(`[speaker-detection]   ${gapLog.length} gaps found (showing first 10)`);
    gapLog.slice(0, 10).forEach(g => console.log(`[speaker-detection]   ${g}`));
  }

  return result;
}

/**
 * Get the appropriate TTS voice for a segment.
 * When a manual speaker config exists, uses assignVoicesToSpeakers() so that
 * multiple speakers of the same gender get distinct voices from the pool.
 * WITHOUT config: uses a single default voice for ALL speakers (safe default —
 * no guessing genders from speaker IDs).
 */
function getVoiceForSegment(segment: ClarifyTranscriptSegment, config?: SpeakerConfig): string {
  const speakerId = segment.speaker || 'speaker_0';

  // If manual config exists, compute full voice assignment map
  if (config && Object.keys(config).length > 0) {
    const assignments = assignVoicesToSpeakers(config);
    return assignments[speakerId] || DEFAULT_VOICE;
  }

  // No config — single default voice for everyone (don't guess genders)
  return DEFAULT_VOICE;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ClarifyAudioPanel({
  videoId, currentTime, aiPlaybackSpeed = 1, speakerConfig, onSpeakersDetected, onSubtitleChange, onMuteYouTube, onPlayYouTube, onTranscriptReady, onSegmentChange, registerHandlers,
}: ClarifyAudioPanelProps) {

  // ═══ STATE ═══
  type Phase = 'choosing' | 'processing' | 'ready' | 'playing' | 'paused' | 'stopped' | 'error';
  const [phase, setPhase] = useState<Phase>('choosing');
  const [selectedMode, setSelectedMode] = useState<OutputMode | null>(null);
  const [selectedLang, setSelectedLang] = useState('en');
  const [error, setError] = useState('');

  // Dual transcript: original (source language) + translated
  const [originalTranscript, setOriginalTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [translatedTranscript, setTranslatedTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [translatedUpTo, setTranslatedUpTo] = useState(0); // How many segments are translated
  const [totalSegments, setTotalSegments] = useState(0);
  const [needsMoreTranslation, setNeedsMoreTranslation] = useState(false);
  const [isTranslatingMore, setIsTranslatingMore] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('');

  // The "active" transcript = translated when AI playing, original when YouTube
  const [transcript, setTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [currentSegIdx, setCurrentSegIdx] = useState(-1);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [useClientTTS, setUseClientTTS] = useState(false);

  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [showOptionsOverlay, setShowOptionsOverlay] = useState(false);

  // ═══ REFS ═══
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<AudioCache>({});
  const genSetRef = useRef<Set<number>>(new Set());
  const playingIdxRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const volRef = useRef(1.0);
  const mutedRef = useRef(false);
  const txRef = useRef<ClarifyTranscriptSegment[]>([]);
  const originalTxRef = useRef<ClarifyTranscriptSegment[]>([]);
  const translatedTxRef = useRef<ClarifyTranscriptSegment[]>([]);
  const speedRef = useRef(1);
  const speakerConfigRef = useRef<SpeakerConfig | undefined>(speakerConfig);
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);  // SCHEDULER: timing-based sync loop
  const lastScheduledSegRef = useRef(-1);  // SCHEDULER: last segment we triggered playback for
  const translatingMoreRef = useRef(false);
  const regenEpochRef = useRef(0);  // Incremented on each regeneration to invalidate stale generations

  // Keep refs synced
  useEffect(() => { volRef.current = volume / 100; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { txRef.current = transcript; }, [transcript]);
  useEffect(() => {
    const oldSpeed = speedRef.current;
    speedRef.current = aiPlaybackSpeed;
    // Apply immediately to currently playing audio (live update)
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.playbackRate = aiPlaybackSpeed;
      console.log(`[options-update] Speed changed ${oldSpeed}x -> ${aiPlaybackSpeed}x, applied to current audio`);
    } else if (oldSpeed !== aiPlaybackSpeed) {
      console.log(`[options-update] Speed changed ${oldSpeed}x -> ${aiPlaybackSpeed}x, will apply to next segment`);
    }
  }, [aiPlaybackSpeed]);
  useEffect(() => { originalTxRef.current = originalTranscript; }, [originalTranscript]);
  useEffect(() => { translatedTxRef.current = translatedTranscript; }, [translatedTranscript]);
  useEffect(() => {
    speakerConfigRef.current = speakerConfig;
    if (speakerConfig && Object.keys(speakerConfig).length > 0) {
      console.log('[speaker-config] Config updated:', speakerConfig);
    }
  }, [speakerConfig]);

  // Update audio element volume in real-time
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume / 100;
  }, [volume, isMuted]);

  // ═══ SWITCH ACTIVE TRANSCRIPT BASED ON AUDIO MODE ═══
  // When AI audio is playing → show translated transcript
  // When paused/stopped (YouTube audio) → show original transcript
  useEffect(() => {
    if (phase === 'playing') {
      // AI audio active → show translated
      setTranscript(translatedTranscript.length > 0 ? translatedTranscript : originalTranscript);
    } else if (originalTranscript.length > 0 && (phase === 'paused' || phase === 'ready')) {
      // YouTube audio active → show original (source language)
      setTranscript(originalTranscript);
    }
  }, [phase, originalTranscript, translatedTranscript]);

  // ═══ TRACK CURRENT SEGMENT FROM VIDEO TIME ═══
  useEffect(() => {
    if (transcript.length === 0) return;
    let idx = -1;
    for (let i = 0; i < transcript.length; i++) {
      if (currentTime >= transcript[i].start && (!transcript[i + 1] || currentTime < transcript[i + 1].start)) {
        idx = i; break;
      }
    }
    if (idx !== currentSegIdx) {
      setCurrentSegIdx(idx);
      if (idx >= 0) {
        if (onSubtitleChange) onSubtitleChange(transcript[idx].text);
        if (onSegmentChange) onSegmentChange(idx);
      }
    }
  }, [currentTime, transcript, currentSegIdx, onSubtitleChange, onSegmentChange]);

  // ═══ TTS GENERATION (multi-voice) ═══
  const generateSeg = useCallback(async (i: number, text: string) => {
    if (cacheRef.current[i]?.url || cacheRef.current[i]?.useClientTTS || cacheRef.current[i]?.generating) return;
    if (genSetRef.current.has(i)) return;

    // Capture epoch at start — if it changes during generation, discard results
    const startEpoch = regenEpochRef.current;

    genSetRef.current.add(i);
    cacheRef.current[i] = { generating: true };

    try {
      const seg = translatedTxRef.current[i] || txRef.current[i];
      // Multi-voice: pick voice based on speaker config (or single default)
      const voice = seg ? getVoiceForSegment(seg, speakerConfigRef.current) : DEFAULT_VOICE;
      const speakerId = seg?.speaker || 'speaker_0';
      const hasConfig = speakerConfigRef.current && Object.keys(speakerConfigRef.current).length > 0;
      const configGender = speakerConfigRef.current?.[speakerId];
      const gender = configGender || 'unconfigured';
      const source = hasConfig ? 'config' : 'default';

      console.log(`[voice-variety] Seg ${i}: ${speakerId} -> ${gender} (${source}) -> voice="${voice}"`);

      const res = await fetch('/api/multi-voice-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: { id: voice, name: voice, gender, provider: 'openai' },
          videoId, segmentId: `seg_${i}`, speakerId,
          targetDuration: seg ? seg.end - seg.start : undefined,
          targetLanguage: selectedLang, ttsModel: 'tts-1',
        }),
      });

      // Check epoch — if regeneration happened while we were awaiting, discard this result
      if (regenEpochRef.current !== startEpoch) {
        console.log(`[voice-variety] Seg ${i}: DISCARDED (epoch ${startEpoch} -> ${regenEpochRef.current})`);
        genSetRef.current.delete(i);
        return;
      }

      if (!res.ok) {
        console.warn(`[voice-variety] Seg ${i}: TTS API returned ${res.status}`);
        throw new Error(`TTS ${res.status}`);
      }

      const ct = res.headers.get('content-type');
      const returnedVoice = res.headers.get('x-voice-id');
      const now = Date.now();
      if (ct?.includes('application/json')) {
        const data = await res.json();
        if (data.useClientSideTTS) {
          cacheRef.current[i] = { useClientTTS: true, voice, generatedAt: now };
          setUseClientTTS(true);
        }
      } else {
        const blob = await res.blob();
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          cacheRef.current[i] = { url, voice, generatedAt: now };
          console.log(`[voice-variety] Seg ${i}: ✓ OpenAI audio (${blob.size}B) voice="${voice}" server="${returnedVoice}"`);
        } else {
          cacheRef.current[i] = { useClientTTS: true, voice, generatedAt: now };
          setUseClientTTS(true);
        }
      }
    } catch (err) {
      console.error(`[voice-variety] Seg ${i}: TTS failed, client TTS fallback`, err);
      cacheRef.current[i] = { useClientTTS: true, generatedAt: Date.now() };
      setUseClientTTS(true);
    }

    genSetRef.current.delete(i);
    setGeneratedCount(prev => prev + 1);
  }, [videoId, selectedLang]);

  // ═══ PRE-GENERATE AHEAD + PROGRESSIVE TRANSLATION ═══
  useEffect(() => {
    if (phase !== 'playing' || translatedTranscript.length === 0) return;
    const start = Math.max(0, currentSegIdx);
    // Generate TTS for segments ahead of current position
    for (let i = start; i < Math.min(start + 8, translatedTranscript.length); i++) {
      if (!cacheRef.current[i]) generateSeg(i, translatedTranscript[i].text);
    }

    // Request more translation if approaching the edge of translated segments
    if (needsMoreTranslation && !translatingMoreRef.current && currentSegIdx >= translatedUpTo - 15) {
      requestMoreTranslation();
    }
  }, [phase, currentSegIdx, translatedTranscript, generateSeg, needsMoreTranslation, translatedUpTo]);

  // ═══ REQUEST MORE TRANSLATION BATCHES ═══
  const requestMoreTranslation = useCallback(async () => {
    if (translatingMoreRef.current) return;
    translatingMoreRef.current = true;
    setIsTranslatingMore(true);

    try {
      const res = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId, option: 2, targetLanguage: selectedLang,
          startIndex: translatedUpTo, batchSize: 50,
        }),
      });
      if (!res.ok) throw new Error(`Batch failed (${res.status})`);
      const data = await res.json();

      if (data.transcript?.length > 0) {
        const rawNewSegs: ClarifyTranscriptSegment[] = data.transcript.map((s: any, i: number) => ({
          text: s.text || '', start: s.start || 0,
          end: s.end || (data.transcript[i + 1]?.start || (s.start || 0) + 3),
          speaker: s.speaker || undefined,
        }));
        // Detect speakers for new batch (uses gap-based detection)
        const newSegs = detectSpeakers(rawNewSegs);
        setTranslatedTranscript(prev => {
          // Re-detect speakers across the full combined transcript for continuity
          const combined = [...prev, ...newSegs];
          const withSpeakers = detectSpeakers(combined);
          translatedTxRef.current = withSpeakers;
          return withSpeakers;
        });
        setTranslatedUpTo(prev => prev + newSegs.length);
        setNeedsMoreTranslation(!data.done);
        console.log(`[clarify] Got ${newSegs.length} more translated segments (done: ${data.done})`);
      } else {
        setNeedsMoreTranslation(false);
      }
    } catch (err) {
      console.error('[clarify] Failed to fetch more translations:', err);
    }

    translatingMoreRef.current = false;
    setIsTranslatingMore(false);
  }, [videoId, selectedLang, translatedUpTo]);

  // ═══ AUDIO PLAYBACK — SCHEDULER APPROACH ═══
  // Play each segment at the user's chosen speed (NEVER distorted).
  // The scheduler watches video time and triggers segments when video reaches their timestamp.
  // Gaps between segments are natural pauses — no rate-matching needed.

  const currentTimeRef = useRef(currentTime);
  const prevVideoTimeRef = useRef(currentTime);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  // Helper: find the segment index that covers a given video time
  const findSegForTime = useCallback((videoTime: number, segs: ClarifyTranscriptSegment[]): number => {
    for (let i = 0; i < segs.length; i++) {
      if (videoTime >= segs[i].start && (i === segs.length - 1 || videoTime < segs[i + 1].start)) {
        return i;
      }
    }
    if (segs.length > 0 && videoTime < segs[0].start) return 0;
    return segs.length - 1;
  }, []);

  // Play a single segment at user's chosen speed — no rate math, no onended chaining
  const playSeg = useCallback((i: number) => {
    if (i < 0 || i >= translatedTxRef.current.length) return;

    playingIdxRef.current = i;
    lastScheduledSegRef.current = i;
    const cached = cacheRef.current[i];

    if (cached?.url) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      try {
        const a = new Audio(cached.url);
        a.volume = mutedRef.current ? 0 : volRef.current;
        a.playbackRate = speedRef.current;
        audioRef.current = a;

        const seg = translatedTxRef.current[i];
        const age = cached.generatedAt ? `${((Date.now() - cached.generatedAt) / 1000).toFixed(0)}s ago` : 'unknown';
        console.log(`[scheduler] Playing seg ${i} at ${speedRef.current}x (video=${currentTimeRef.current.toFixed(1)}, seg.start=${seg?.start.toFixed(1)}) | voice="${cached.voice || '?'}" speaker=${seg?.speaker || '?'} | source=OpenAI-audio | generated=${age}`);

        a.onended = () => {
          // Segment finished naturally — scheduler will pick up next one
          playingIdxRef.current = -1;
        };
        a.onerror = () => {
          console.warn(`[scheduler] Audio error on seg ${i}, marking for client TTS`);
          if (cached.url) { try { URL.revokeObjectURL(cached.url); } catch {} }
          cached.url = undefined;
          cached.useClientTTS = true;
          playingIdxRef.current = -1;
        };
        a.play().catch(() => { playingIdxRef.current = -1; });
      } catch {
        playingIdxRef.current = -1;
      }
    } else if (cached?.useClientTTS) {
      const seg = translatedTxRef.current[i];
      console.log(`[scheduler] Playing seg ${i} via BROWSER TTS | voice="${cached.voice || 'browser-default'}" speaker=${seg?.speaker || '?'} | source=client-TTS`);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(translatedTxRef.current[i].text);
        u.lang = selectedLang === 'en' ? 'en-US' : selectedLang;
        u.volume = mutedRef.current ? 0 : volRef.current;
        u.rate = speedRef.current;

        // Try to match the assigned voice with a browser voice
        if (cached.voice) {
          const voices = window.speechSynthesis.getVoices();
          const voiceGender = FEMALE_VOICES.includes(cached.voice) ? 'female' : 'male';
          // Pick a browser voice that matches the language and approximate gender
          const langVoices = voices.filter(v => v.lang.startsWith(selectedLang === 'en' ? 'en' : selectedLang));
          if (langVoices.length > 0) {
            // Try to alternate voices for different speakers
            const speakerNum = parseInt(seg?.speaker?.match(/\d+/)?.[0] || '0');
            u.voice = langVoices[speakerNum % langVoices.length];
            console.log(`[scheduler] Browser voice picked: "${u.voice.name}" for ${seg?.speaker} (${voiceGender})`);
          }
        }

        u.onend = () => { playingIdxRef.current = -1; };
        u.onerror = () => { playingIdxRef.current = -1; };
        window.speechSynthesis.speak(u);
      }
    }
    // If no cached audio yet, do nothing — scheduler will retry when cache is ready
  }, [selectedLang]);

  // ═══ SCHEDULER LOOP — watches video time, triggers segments ═══
  useEffect(() => {
    if (phase !== 'playing') {
      if (schedulerRef.current) {
        clearInterval(schedulerRef.current);
        schedulerRef.current = null;
        console.log(`[scheduler] Stopped (phase=${phase})`);
      }
      return;
    }

    console.log(`[scheduler] === SCHEDULER STARTED ===`);
    const SEEK_THRESHOLD = 2.0;  // seconds — detect user seeking

    schedulerRef.current = setInterval(() => {
      if (!isPlayingRef.current) return;

      const segs = translatedTxRef.current;
      if (segs.length === 0) return;

      const videoTime = currentTimeRef.current;
      const prevVideoTime = prevVideoTimeRef.current;
      prevVideoTimeRef.current = videoTime;

      // ─── USER SEEK DETECTION ───
      if (Math.abs(videoTime - prevVideoTime) > SEEK_THRESHOLD) {
        console.log(`[scheduler] USER SEEK detected: ${prevVideoTime.toFixed(1)} -> ${videoTime.toFixed(1)}`);
        // Stop current audio, reset scheduler to find new matching segment
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        playingIdxRef.current = -1;
        lastScheduledSegRef.current = -1;  // Reset so scheduler finds new segment
      }

      // ─── If audio is currently playing, don't interrupt it ───
      if (playingIdxRef.current >= 0) return;

      // ─── Find which segment the video is currently in ───
      const targetIdx = findSegForTime(videoTime, segs);
      if (targetIdx < 0) return;

      // ─── Don't replay the same segment we just played ───
      if (targetIdx === lastScheduledSegRef.current) return;

      // ─── Check if video has reached this segment's start (with small tolerance) ───
      const seg = segs[targetIdx];
      if (videoTime >= seg.start - 0.2) {
        // Check if TTS is ready
        const cached = cacheRef.current[targetIdx];
        if (cached?.url || cached?.useClientTTS) {
          playSeg(targetIdx);
        } else {
          // TTS not ready yet — skip this segment, scheduler will try next one
          console.log(`[scheduler] Seg ${targetIdx} not cached yet, skipping`);
          lastScheduledSegRef.current = targetIdx;
        }
      }
    }, 100);

    return () => {
      if (schedulerRef.current) {
        clearInterval(schedulerRef.current);
        schedulerRef.current = null;
        console.log(`[scheduler] Cleanup`);
      }
    };
  }, [phase, playSeg, findSegForTime]);

  // ═══ USER ACTIONS ═══

  // Speed changes are applied in the aiPlaybackSpeed ref sync useEffect above

  /** User clicks "Play Clarified Audio" or "Resume" — scheduler handles timing */
  const handlePlay = useCallback(() => {
    if (onMuteYouTube) onMuteYouTube(true);
    if (onPlayYouTube) onPlayYouTube();
    isPlayingRef.current = true;
    playingIdxRef.current = -1;
    lastScheduledSegRef.current = -1;  // Let scheduler find the right segment

    console.log(`[scheduler] === PLAY === speed=${speedRef.current}x, videoTime=${currentTimeRef.current.toFixed(1)}`);
    setPhase('playing');
    // Scheduler loop (started by phase useEffect) will pick up the first segment
  }, [onMuteYouTube, onPlayYouTube]);

  /** User clicks "Pause" */
  const handlePause = useCallback(() => {
    isPlayingRef.current = false;
    if (audioRef.current) audioRef.current.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.pause();
    setPhase('paused');
    if (onMuteYouTube) onMuteYouTube(false);
  }, [onMuteYouTube]);

  /** User clicks "Stop" */
  const handleStop = useCallback(() => {
    isPlayingRef.current = false;
    if (schedulerRef.current) { clearInterval(schedulerRef.current); schedulerRef.current = null; }
    lastScheduledSegRef.current = -1;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; audioRef.current = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    Object.values(cacheRef.current).forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
    cacheRef.current = {};
    genSetRef.current.clear();
    setTranscript([]);
    setOriginalTranscript([]);
    setTranslatedTranscript([]);
    setTranslatedUpTo(0);
    setTotalSegments(0);
    setNeedsMoreTranslation(false);
    setGeneratedCount(0);
    setCurrentSegIdx(-1);
    setPhase('stopped');
    if (onMuteYouTube) onMuteYouTube(false);
    if (onTranscriptReady) onTranscriptReady([]);
  }, [onMuteYouTube, onTranscriptReady]);

  /** Clear audio cache and regenerate TTS with current speaker voice config.
   *  Called when the user applies new voice assignments from the speaker config UI.
   *  Keeps transcripts intact — only regenerates the audio.
   *  @param configOverride — If provided, updates the ref immediately (avoids useEffect timing gap) */
  const handleRegenerateVoices = useCallback(async (configOverride?: SpeakerConfig) => {
    console.log('[regenerate] === STARTING REGENERATION ===');

    // 0. Update config ref FIRST (before anything else)
    if (configOverride) {
      speakerConfigRef.current = configOverride;
      console.log('[regenerate] Config override applied:', configOverride);
    }

    // 1. IMMEDIATELY set phase to paused — prevents scheduler useEffect from interfering
    setPhase('paused');

    // 2. Stop ALL current playback
    isPlayingRef.current = false;
    if (schedulerRef.current) { clearInterval(schedulerRef.current); schedulerRef.current = null; }
    lastScheduledSegRef.current = -1;
    playingIdxRef.current = -1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.src = '';  // Force release of audio resource
      audioRef.current = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (onMuteYouTube) onMuteYouTube(false);
    console.log('[regenerate] Playback stopped, scheduler cleared');

    // 3. NUCLEAR CACHE CLEAR — revoke ALL blob URLs, then create fresh objects
    const oldCacheSize = Object.keys(cacheRef.current).length;
    const oldGenSetSize = genSetRef.current.size;
    Object.values(cacheRef.current).forEach(e => {
      if (e.url) { try { URL.revokeObjectURL(e.url); } catch {} }
    });
    // Create NEW object/set instances (not just clearing — ensures no stale references)
    cacheRef.current = {};
    genSetRef.current = new Set();
    setGeneratedCount(0);

    // Increment epoch — any in-flight generateSeg calls from the old epoch will be discarded
    regenEpochRef.current++;
    const thisEpoch = regenEpochRef.current;

    console.log(`[regenerate] Cache cleared: ${oldCacheSize} entries removed, genSet: ${oldGenSetSize} cleared`);
    console.log(`[regenerate] Cache size after clear: ${Object.keys(cacheRef.current).length}`);
    console.log(`[regenerate] Epoch: ${thisEpoch}`);
    console.log('[regenerate] Active config:', JSON.stringify(speakerConfigRef.current));

    // 4. Regenerate ALL translated segments with new voice assignments
    const segs = translatedTxRef.current;
    if (segs.length > 0) {
      // Log speaker distribution
      const dist: Record<string, number> = {};
      segs.forEach(s => { dist[s.speaker || '?'] = (dist[s.speaker || '?'] || 0) + 1; });
      console.log(`[regenerate] Regenerating ALL ${segs.length} segments. Speaker distribution:`, dist);

      // Generate in parallel batches of 8
      for (let batchStart = 0; batchStart < segs.length; batchStart += 8) {
        // Check if a newer regeneration has started — abort if stale
        if (regenEpochRef.current !== thisEpoch) {
          console.log(`[regenerate] Epoch ${thisEpoch} superseded by ${regenEpochRef.current}, aborting`);
          return;
        }
        const batch = segs.slice(batchStart, Math.min(batchStart + 8, segs.length));
        await Promise.allSettled(batch.map((s, j) => generateSeg(batchStart + j, s.text)));
        console.log(`[regenerate] Batch ${batchStart}-${batchStart + batch.length - 1} done`);
      }
      console.log(`[regenerate] All ${segs.length} segments regenerated`);
    }

    console.log(`[regenerate] Final cache size: ${Object.keys(cacheRef.current).length}`);
    console.log('[regenerate] === REGENERATION COMPLETE ===');
  }, [generateSeg, onMuteYouTube]);

  // Register external handlers
  useEffect(() => {
    if (registerHandlers) {
      registerHandlers({
        play: () => handlePlay(),
        pause: () => handlePause(),
        isPlaying: () => isPlayingRef.current,
        regenerateVoices: (config?: SpeakerConfig) => handleRegenerateVoices(config),
      });
    }
  }, [registerHandlers, handlePlay, handlePause, handleRegenerateVoices]);

  /** User selects options from modal -> start processing */
  const handleSelectOption = useCallback(async (mode: OutputMode, lang: string) => {
    setSelectedMode(mode);
    setSelectedLang(lang);
    setPhase('processing');
    setError('');
    setProcessingStage('Fetching transcript...');
    cacheRef.current = {};
    genSetRef.current.clear();
    setGeneratedCount(0);
    setUseClientTTS(false);

    try {
      setProcessingStage('Fetching & translating transcript...');
      const res = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, option: 2, targetLanguage: lang }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || `Failed (${res.status})`); }
      const data = await res.json();

      // Store original transcript (source language — ALL segments)
      if (data.originalTranscript?.length) {
        const origSegs: ClarifyTranscriptSegment[] = data.originalTranscript.map((s: any, i: number) => ({
          text: s.text || '', start: s.start || 0,
          end: s.end || (data.originalTranscript[i + 1]?.start || (s.start || 0) + 3),
        }));
        setOriginalTranscript(origSegs);
        originalTxRef.current = origSegs;
        setTotalSegments(origSegs.length);
        if (onTranscriptReady) onTranscriptReady(origSegs);
      }

      // Store translated buffer (with speaker detection for multi-voice)
      let transSegs: ClarifyTranscriptSegment[] = [];
      if (data.transcript?.length) {
        const rawTransSegs: ClarifyTranscriptSegment[] = data.transcript.map((s: any, i: number) => ({
          text: s.text || '', start: s.start || 0,
          end: s.end || (data.transcript[i + 1]?.start || (s.start || 0) + 3),
          speaker: s.speaker || undefined,
        }));
        transSegs = detectSpeakers(rawTransSegs);
        setTranslatedTranscript(transSegs);
        translatedTxRef.current = transSegs;
        setTranslatedUpTo(transSegs.length);

        // Notify parent about detected speakers for voice config UI
        if (onSpeakersDetected) {
          const uniqueSpeakers = [...new Set(transSegs.map(s => s.speaker).filter(Boolean))] as string[];
          uniqueSpeakers.sort();
          console.log(`[speaker-config] Detected ${uniqueSpeakers.length} speakers:`, uniqueSpeakers);
          onSpeakersDetected(uniqueSpeakers);
        }
      }

      setNeedsMoreTranslation(data.needsMoreTranslation || false);
      setSourceLanguage(data.sourceLanguage || '');

      const total = data.totalSegments || data.originalTranscript?.length || 0;
      const translated = data.translatedCount || data.transcript?.length || 0;
      setProcessingStage(`Ready! ${translated}/${total} segments translated`);

      if (mode !== 'subtitles_only') {
        // Generate first batch of TTS audio
        setProcessingStage('Generating AI audio...');
        const segsForTTS = data.transcript || [];
        const batch = segsForTTS.slice(0, 8);
        const parsedBatch = batch.map((s: any) => s.text || '');
        await Promise.allSettled(parsedBatch.map((text: string, i: number) => generateSeg(i, text)));

        setProcessingStage('Ready! Scheduler mode - natural speed playback');
        setPhase('ready');
      } else {
        setPhase('ready');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      setPhase('error');
    }
  }, [videoId, onTranscriptReady, onSpeakersDetected, generateSeg]);

  /** handleRestart — full restart (re-choose options) */
  const handleRestart = useCallback(() => {
    handleStop();
    setError('');
    setPhase('choosing');
  }, [handleStop]);

  /** handleOptions — open options overlay WITHOUT restarting */
  const handleOptions = useCallback(() => {
    setShowOptionsOverlay(true);
  }, []);

  /** handleOptionsApply — apply new options from overlay */
  const handleOptionsApply = useCallback((mode: OutputMode, lang: string) => {
    setShowOptionsOverlay(false);
    // Only reprocess if language changed
    if (lang !== selectedLang) {
      handleSelectOption(mode, lang);
    } else {
      setSelectedMode(mode);
    }
  }, [selectedLang, handleSelectOption]);

  // Keep a ref to onMuteYouTube so cleanup doesn't re-fire on every prop change
  const onMuteYouTubeRef = useRef(onMuteYouTube);
  useEffect(() => { onMuteYouTubeRef.current = onMuteYouTube; }, [onMuteYouTube]);

  // Cleanup on unmount ONLY
  useEffect(() => {
    return () => {
      if (schedulerRef.current) { clearInterval(schedulerRef.current); schedulerRef.current = null; }
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      Object.values(cacheRef.current).forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
      if (onMuteYouTubeRef.current) onMuteYouTubeRef.current(false);
    };
  }, []);

  // ═══ COMPUTED ═══
  const audioMode = selectedMode === 'audio_only' || selectedMode === 'audio_and_subtitles';
  const langLabel = (code: string) => ({ en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' }[code] || code.toUpperCase());
  const isAiActive = phase === 'playing';
  const activeTranscriptLang = isAiActive ? selectedLang : (sourceLanguage || 'source');

  // ═══ RENDER ═══
  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>

      {/* ─── OPTIONS OVERLAY (doesn't restart) ─── */}
      {showOptionsOverlay && (
        <div style={{ position: 'relative', zIndex: 10 }}>
          <div style={{
            padding: '12px', backgroundColor: '#1e293b', borderRadius: '8px',
            border: '1px solid #475569', marginBottom: '10px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Settings</span>
              <button onClick={() => setShowOptionsOverlay(false)} style={{
                background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '16px',
              }}>x</button>
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '6px' }}>
              Changing language will reprocess the video.
            </div>
            <ProcessingOptionsModal
              isOpen={true} onClose={() => setShowOptionsOverlay(false)}
              onSelectOption={handleOptionsApply}
              initialMode={selectedMode || undefined} initialLanguage={selectedLang}
            />
          </div>
        </div>
      )}

      {/* ─── CHOOSING ─── */}
      {phase === 'choosing' && !showOptionsOverlay && (
        <ProcessingOptionsModal
          isOpen={true} onClose={() => setPhase('stopped')}
          onSelectOption={handleSelectOption}
          initialMode={selectedMode || undefined} initialLanguage={selectedLang}
        />
      )}

      {/* ─── STOPPED ─── */}
      {phase === 'stopped' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
            Clarify Audio is not active.
          </p>
          <button onClick={handleRestart} style={{
            width: '100%', padding: '10px', backgroundColor: '#2563eb', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
          }}>🎯 Choose Processing Options</button>
        </div>
      )}

      {/* ─── ERROR ─── */}
      {phase === 'error' && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(220,38,38,0.15)', border: '1px solid #dc2626',
            borderRadius: '6px', fontSize: '11px', color: '#fca5a5', marginBottom: '10px',
          }}>{'❌'} {error}</div>
          <button onClick={handleRestart} style={{
            width: '100%', padding: '10px', backgroundColor: '#2563eb', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
          }}>{'🔄'} Try Again</button>
        </div>
      )}

      {/* ─── PROCESSING ─── */}
      {phase === 'processing' && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#60a5fa', marginBottom: '8px', textAlign: 'center' }}>
            {processingStage.startsWith('Generating') ? '🎵 Generating Audio...' :
             processingStage.includes('translating') ? '🌐 Translating...' :
             '📝 Fetching Transcript...'}
          </div>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ width: '100%', height: '8px', backgroundColor: '#374151', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                width: translatedUpTo > 0 ? `${Math.min(100, (translatedUpTo / Math.max(totalSegments, 1)) * 100)}%` : '30%',
                height: '100%', backgroundColor: '#3b82f6', borderRadius: '4px',
                transition: 'width 0.3s ease',
                animation: translatedUpTo === 0 ? 'pulse 1.5s ease-in-out infinite' : undefined,
              }} />
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
            {processingStage || 'Fetching transcript...'}
          </div>
        </div>
      )}

      {/* ─── READY ─── */}
      {phase === 'ready' && !showOptionsOverlay && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#22c55e', marginBottom: '4px' }}>
              {'✅'} Audio Ready
            </div>
            <div style={{ fontSize: '10px', color: '#9ca3af' }}>
              {translatedUpTo}/{totalSegments} segments translated · {useClientTTS ? 'Browser voices' : 'OpenAI voices'} · {langLabel(selectedLang)}
            </div>
            {needsMoreTranslation && (
              <div style={{ fontSize: '9px', color: '#60a5fa', marginTop: '2px' }}>
                More segments will translate during playback
              </div>
            )}
          </div>

          {/* Transcript language indicator */}
          {sourceLanguage && sourceLanguage !== selectedLang && (
            <div style={{
              padding: '4px 8px', marginBottom: '8px', borderRadius: '4px',
              backgroundColor: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)',
              fontSize: '10px', color: '#93c5fd', textAlign: 'center',
            }}>
              {'📖'} Showing {langLabel(sourceLanguage)} transcript (YouTube audio)
            </div>
          )}

          {audioMode && (
            <button onClick={handlePlay} style={{
              width: '100%', padding: '14px', backgroundColor: '#22c55e', color: 'white',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontSize: '16px', fontWeight: 'bold', marginBottom: '10px',
              boxShadow: '0 2px 8px rgba(34,197,94,0.3)',
            }}>
              {'▶'} Play Clarified Audio
            </button>
          )}

          {!audioMode && (
            <div style={{
              padding: '10px', backgroundColor: '#1e3a5f', borderRadius: '8px',
              textAlign: 'center', fontSize: '12px', marginBottom: '10px',
            }}>
              {'📝'} Subtitles are active
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleStop} style={{
              flex: 1, padding: '7px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
            }}>{'⏹'} Stop</button>
            <button onClick={handleOptions} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>{'⚙️'} Options</button>
          </div>
        </div>
      )}

      {/* ─── PLAYING ─── */}
      {phase === 'playing' && !showOptionsOverlay && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(34,197,94,0.15)', border: '1px solid #22c55e',
            borderRadius: '8px', marginBottom: '10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#22c55e', marginBottom: '2px' }}>
              {'🔊'} Playing Clarified Audio
            </div>
            <div style={{ fontSize: '10px', color: '#86efac' }}>
              YouTube muted · {translatedUpTo}/{totalSegments} translated · {generatedCount} TTS ready
              {isTranslatingMore && ' · translating more...'}
            </div>
          </div>

          {/* Transcript language indicator */}
          <div style={{
            padding: '4px 8px', marginBottom: '8px', borderRadius: '4px',
            backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
            fontSize: '10px', color: '#86efac', textAlign: 'center',
          }}>
            {'🌐'} Showing {langLabel(selectedLang)} transcript (AI audio) · {aiPlaybackSpeed}x speed
          </div>

          <button onClick={handlePause} style={{
            width: '100%', padding: '12px', backgroundColor: '#f59e0b', color: 'white',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontWeight: 'bold', marginBottom: '8px',
          }}>
            {'⏸'} Pause
          </button>

          {/* Volume */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <button onClick={() => { setIsMuted(!isMuted); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'white', padding: '2px' }}>
              {isMuted ? '🔇' : '🔊'}
            </button>
            <input type="range" min={0} max={100} value={isMuted ? 0 : volume}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                setVolume(v);
                if (v > 0 && isMuted) setIsMuted(false);
              }}
              style={{ flex: 1, accentColor: '#22c55e', height: '4px' }}
            />
            <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '28px' }}>{isMuted ? 0 : volume}%</span>
          </div>

          {/* Current segment info */}
          {currentSegIdx >= 0 && transcript[currentSegIdx] && (
            <div style={{
              padding: '6px 8px', backgroundColor: '#1f2937', borderRadius: '6px',
              fontSize: '11px', color: '#d1d5db', marginBottom: '8px', textAlign: 'center',
            }}>
              <span style={{ color: '#60a5fa', marginRight: '4px' }}>[{fmtTime(transcript[currentSegIdx].start)}]</span>
              {transcript[currentSegIdx].text}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleStop} style={{
              flex: 1, padding: '7px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
            }}>{'⏹'} Stop</button>
            <button onClick={handleOptions} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>{'⚙️'} Options</button>
          </div>
        </div>
      )}

      {/* ─── PAUSED ─── */}
      {phase === 'paused' && !showOptionsOverlay && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b',
            borderRadius: '8px', marginBottom: '10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#f59e0b', marginBottom: '2px' }}>
              {'⏸'} Audio Paused
            </div>
            <div style={{ fontSize: '10px', color: '#fcd34d' }}>
              YouTube audio is back to normal
            </div>
          </div>

          {/* Transcript language indicator */}
          {sourceLanguage && sourceLanguage !== selectedLang && (
            <div style={{
              padding: '4px 8px', marginBottom: '8px', borderRadius: '4px',
              backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              fontSize: '10px', color: '#fcd34d', textAlign: 'center',
            }}>
              {'📖'} Showing {langLabel(sourceLanguage)} transcript (YouTube audio)
            </div>
          )}

          <button onClick={handlePlay} style={{
            width: '100%', padding: '12px', backgroundColor: '#22c55e', color: 'white',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontWeight: 'bold', marginBottom: '8px',
          }}>
            {'▶'} Resume Clarified Audio
          </button>

          {/* Current segment info */}
          {currentSegIdx >= 0 && transcript[currentSegIdx] && (
            <div style={{
              padding: '6px 8px', backgroundColor: '#1f2937', borderRadius: '6px',
              fontSize: '11px', color: '#d1d5db', marginBottom: '8px', textAlign: 'center',
            }}>
              <span style={{ color: '#60a5fa', marginRight: '4px' }}>[{fmtTime(transcript[currentSegIdx].start)}]</span>
              {transcript[currentSegIdx].text}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleStop} style={{
              flex: 1, padding: '7px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
            }}>{'⏹'} Stop</button>
            <button onClick={handleOptions} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>{'⚙️'} Options</button>
          </div>
        </div>
      )}
    </div>
  );
}
