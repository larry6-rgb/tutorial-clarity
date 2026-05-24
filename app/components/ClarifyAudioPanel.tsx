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
 * - Progressive translation: 30-segment buffer, then translate ahead of playback
 * - Dual transcript: original (source lang) + translated, switchable by audio mode
 * - Single consistent voice (no male/female switching)
 * - Speed control with bright orange styling
 * - Options button opens settings without restarting translation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import ProcessingOptionsModal, { OutputMode } from '@/app/hooks/ProcessingOptionsModal';

export interface ClarifyTranscriptSegment {
  text: string;
  start: number;
  end: number;
}

interface AudioCache {
  [index: number]: {
    url?: string;
    useClientTTS?: boolean;
    generating?: boolean;
    audioDuration?: number;  // actual duration of the TTS audio blob in seconds
  };
}

interface ClarifyAudioPanelProps {
  videoId: string;
  currentTime: number;
  aiPlaybackSpeed?: number;
  onSubtitleChange?: (subtitle: string | null) => void;
  onMuteYouTube?: (mute: boolean) => void;
  onPlayYouTube?: () => void;
  onTranscriptReady?: (segments: ClarifyTranscriptSegment[]) => void;
  onSegmentChange?: (index: number) => void;
  registerHandlers?: (handlers: { play: () => void; pause: () => void; isPlaying: () => boolean }) => void;
}

// Use a SINGLE consistent voice for all segments
// 'onyx' = deep male voice (good for male speakers, which is the common case)
// Other options: 'echo' (male), 'fable' (male), 'nova' (female), 'shimmer' (female), 'alloy' (neutral)
const TTS_VOICE = 'onyx';

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ClarifyAudioPanel({
  videoId, currentTime, aiPlaybackSpeed = 1, onSubtitleChange, onMuteYouTube, onPlayYouTube, onTranscriptReady, onSegmentChange, registerHandlers,
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
  const globalRateRef = useRef(1);  // TRAIN SYNC: one global rate for ALL segments
  const elasticRateRef = useRef(1); // final playbackRate = globalRate × userSpeed × fineMultiplier
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const translatingMoreRef = useRef(false);
  const initialHookupDoneRef = useRef(false); // true after first play alignment

  // Keep refs synced
  useEffect(() => { volRef.current = volume / 100; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { txRef.current = transcript; }, [transcript]);
  useEffect(() => {
    console.log(`[train-sync] User speed changed: ${speedRef.current} → ${aiPlaybackSpeed}`);
    speedRef.current = aiPlaybackSpeed;
    // Recalculate final rate = globalRate × newUserSpeed
    const finalRate = Math.round(globalRateRef.current * aiPlaybackSpeed * 100) / 100;
    elasticRateRef.current = finalRate;
    if (audioRef.current) {
      audioRef.current.playbackRate = finalRate;
      console.log(`[train-sync] Updated: global=${globalRateRef.current.toFixed(2)} × user=${aiPlaybackSpeed} = ${finalRate}`);
    }
  }, [aiPlaybackSpeed]);
  useEffect(() => { originalTxRef.current = originalTranscript; }, [originalTranscript]);
  useEffect(() => { translatedTxRef.current = translatedTranscript; }, [translatedTranscript]);

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

  // ═══ AUDIO DURATION PROBE — measure blob duration for global rate calc ═══
  const probeAudioDuration = useCallback((url: string): Promise<number> => {
    return new Promise((resolve) => {
      const temp = new Audio(url);
      const timeout = setTimeout(() => { resolve(0); }, 3000); // 3s timeout
      temp.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        resolve(temp.duration && isFinite(temp.duration) ? temp.duration : 0);
      }, { once: true });
      temp.addEventListener('error', () => { clearTimeout(timeout); resolve(0); }, { once: true });
      temp.load();
    });
  }, []);

  // ═══ TTS GENERATION (single voice) — now probes audio duration ═══
  const generateSeg = useCallback(async (i: number, text: string) => {
    if (cacheRef.current[i]?.url || cacheRef.current[i]?.useClientTTS || cacheRef.current[i]?.generating) return;
    if (genSetRef.current.has(i)) return;
    genSetRef.current.add(i);
    cacheRef.current[i] = { generating: true };

    try {
      const seg = translatedTxRef.current[i] || txRef.current[i];
      const res = await fetch('/api/multi-voice-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: { id: TTS_VOICE, name: TTS_VOICE, gender: 'neutral', provider: 'openai' },
          videoId, segmentId: `seg_${i}`, speakerId: 'spk_0',
          targetDuration: seg ? seg.end - seg.start : undefined,
          targetLanguage: selectedLang, ttsModel: 'tts-1',
        }),
      });

      if (!res.ok) throw new Error(`TTS ${res.status}`);

      const ct = res.headers.get('content-type');
      if (ct?.includes('application/json')) {
        const data = await res.json();
        if (data.useClientSideTTS) {
          cacheRef.current[i] = { useClientTTS: true };
          setUseClientTTS(true);
        }
      } else {
        const blob = await res.blob();
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          // Probe audio duration for global rate calculation
          const audioDuration = await probeAudioDuration(url);
          cacheRef.current[i] = { url, audioDuration };
          if (audioDuration > 0) {
            console.log(`[train-sync] Seg ${i}: audio=${audioDuration.toFixed(2)}s probed`);
          }
        } else {
          cacheRef.current[i] = { useClientTTS: true };
          setUseClientTTS(true);
        }
      }
    } catch {
      cacheRef.current[i] = { useClientTTS: true };
      setUseClientTTS(true);
    }

    genSetRef.current.delete(i);
    setGeneratedCount(prev => prev + 1);
  }, [videoId, selectedLang, probeAudioDuration]);

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
        const newSegs: ClarifyTranscriptSegment[] = data.transcript.map((s: any, i: number) => ({
          text: s.text || '', start: s.start || 0,
          end: s.end || (data.transcript[i + 1]?.start || (s.start || 0) + 3),
        }));
        setTranslatedTranscript(prev => {
          const updated = [...prev, ...newSegs];
          translatedTxRef.current = updated;
          return updated;
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

  // ═══ AUDIO PLAYBACK — TRAIN SYNC: one global rate for all segments ═══
  // Final playbackRate = globalRate × userSpeed × fineMultiplier (from elastic)
  const playSeg = useCallback((i: number) => {
    if (i < 0 || i >= translatedTxRef.current.length) {
      isPlayingRef.current = false;
      setPhase('paused');
      if (onMuteYouTube) onMuteYouTube(false);
      return;
    }

    playingIdxRef.current = i;
    const cached = cacheRef.current[i];

    if (cached?.url) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      try {
        const a = new Audio(cached.url);
        a.volume = mutedRef.current ? 0 : volRef.current;
        audioRef.current = a;

        // TRAIN SYNC: Use ONE global rate × user speed for ALL segments
        const finalRate = Math.round(globalRateRef.current * speedRef.current * 100) / 100;
        elasticRateRef.current = finalRate;
        a.playbackRate = finalRate;
        console.log(`[train-sync] Seg ${i}: global=${globalRateRef.current} × user=${speedRef.current} = ${finalRate}`);

        // Lock speed — allow elastic fine-tuning but prevent browser drift
        a.addEventListener('ratechange', () => {
          const desired = elasticRateRef.current;
          if (desired && Math.abs(a.playbackRate - desired) > 0.01) {
            a.playbackRate = desired;
          }
        });

        a.onended = () => { if (isPlayingRef.current) playSeg(i + 1); };
        a.onerror = () => {
          console.warn(`[clarify] Audio error on seg ${i}, skipping`);
          if (cached.url) { try { URL.revokeObjectURL(cached.url); } catch {} }
          cached.url = undefined;
          cached.useClientTTS = true;
          if (isPlayingRef.current) playSeg(i + 1);
        };
        a.play().catch(() => { if (isPlayingRef.current) playSeg(i + 1); });
      } catch {
        if (isPlayingRef.current) playSeg(i + 1);
      }
    } else if (cached?.useClientTTS) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(translatedTxRef.current[i].text);
        u.lang = selectedLang === 'en' ? 'en-US' : selectedLang;
        u.volume = mutedRef.current ? 0 : volRef.current;
        u.rate = globalRateRef.current * speedRef.current;
        u.onend = () => { if (isPlayingRef.current) playSeg(i + 1); };
        u.onerror = () => { if (isPlayingRef.current) playSeg(i + 1); };
        window.speechSynthesis.speak(u);
      }
    } else if (i >= translatedTxRef.current.length) {
      setTimeout(() => { if (isPlayingRef.current) playSeg(i); }, 800);
    } else {
      setTimeout(() => { if (isPlayingRef.current) playSeg(i); }, 400);
    }
  }, [selectedLang, onMuteYouTube]);

  // ═══ TRAIN SYNC: Elastic fine-tuning on global rate ═══
  // Global rate handles ~95% of sync. This loop does ±2% fine-tuning.
  // Only jumps on manual user seeking (detected by video time discontinuity).
  const currentTimeRef = useRef(currentTime);
  const prevVideoTimeRef = useRef(currentTime);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  const syncTickRef = useRef(0);
  const jumpCooldownRef = useRef(0);

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

  useEffect(() => {
    if (phase !== 'playing') {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
        elasticRateRef.current = speedRef.current;
        console.log(`[train-sync] Elastic stopped (phase=${phase})`);
      }
      return;
    }

    console.log(`[train-sync] === ELASTIC FINE-TUNING STARTED (globalRate=${globalRateRef.current}) ===`);
    syncTickRef.current = 0;

    const SEEK_THRESHOLD = 5.0;    // seconds — detect user seeking (video time jumps)
    const FINE_THRESHOLD = 0.5;    // seconds — below this = in sync, no adjustment
    const JUMP_COOLDOWN_MS = 2000;

    syncIntervalRef.current = setInterval(() => {
      syncTickRef.current++;
      const verbose = syncTickRef.current % 20 === 1; // ~3s

      if (!isPlayingRef.current) return;

      const audio = audioRef.current;
      const aiSegIdx = playingIdxRef.current;
      const segs = translatedTxRef.current;

      if (!audio || aiSegIdx < 0 || aiSegIdx >= segs.length) {
        if (verbose) console.log(`[train-sync] tick ${syncTickRef.current}: waiting (audio=${!!audio}, seg=${aiSegIdx}/${segs.length})`);
        return;
      }

      const aiSeg = segs[aiSegIdx];
      const videoTime = currentTimeRef.current;

      // Detect user seeking: video time jumped significantly since last check
      const videoTimeDelta = Math.abs(videoTime - prevVideoTimeRef.current);
      prevVideoTimeRef.current = videoTime;
      const now = Date.now();
      const cooldownActive = (now - jumpCooldownRef.current) < JUMP_COOLDOWN_MS;

      // USER SEEK DETECTION: video time jumped >5s in one tick = user seeked
      if (videoTimeDelta > SEEK_THRESHOLD && !cooldownActive) {
        const targetSegIdx = findSegForTime(videoTime, segs);
        console.log(`[train-sync] ⚡ USER SEEK: video jumped ${videoTimeDelta.toFixed(1)}s, re-aligning to seg ${targetSegIdx} (videoTime=${videoTime.toFixed(1)})`);
        jumpCooldownRef.current = now;
        elasticRateRef.current = globalRateRef.current * speedRef.current;
        if (audio) { audio.pause(); audio.onended = null; }
        playSeg(targetSegIdx);
        return;
      }

      // Calculate drift
      let aiVideoPos: number;
      if (audio.duration && audio.duration > 0 && !audio.paused) {
        const segVideoDuration = aiSeg.end - aiSeg.start;
        const audioFraction = audio.currentTime / audio.duration;
        aiVideoPos = aiSeg.start + audioFraction * segVideoDuration;
      } else {
        aiVideoPos = aiSeg.start;
      }

      const drift = aiVideoPos - videoTime; // + = AI ahead, - = AI behind
      const absDrift = Math.abs(drift);
      const globalRate = globalRateRef.current;
      const userSpeed = speedRef.current;

      // ─── ELASTIC FINE-TUNING: tiny ±2-4% adjustments ───
      let fineMultiplier = 1.0;

      if (drift > FINE_THRESHOLD) {
        // AI ahead — slow down slightly
        if (drift > 2.0) fineMultiplier = 0.96;
        else if (drift > 1.0) fineMultiplier = 0.98;
        else fineMultiplier = 0.99;
      } else if (drift < -FINE_THRESHOLD) {
        // AI behind — speed up slightly
        if (drift < -2.0) fineMultiplier = 1.04;
        else if (drift < -1.0) fineMultiplier = 1.02;
        else fineMultiplier = 1.01;
      }

      // Final rate = globalRate × userSpeed × fineMultiplier
      const newRate = Math.round(globalRate * userSpeed * fineMultiplier * 100) / 100;
      const oldRate = elasticRateRef.current;

      if (verbose) {
        const status = absDrift > FINE_THRESHOLD ? 'FINE-TUNE' : 'IN-SYNC';
        console.log(`[train-sync] tick ${syncTickRef.current}: [${status}] video=${videoTime.toFixed(1)}, aiPos=${aiVideoPos.toFixed(1)}, drift=${drift.toFixed(2)}s, global=${globalRate}, fine=${fineMultiplier}, final=${newRate} (user=${userSpeed})`);
      }

      if (Math.abs(newRate - oldRate) > 0.005) {
        elasticRateRef.current = newRate;
        if (audio && !audio.paused) {
          audio.playbackRate = newRate;
        }
        if (Math.abs(fineMultiplier - 1.0) > 0.005) {
          console.log(`[train-sync] FINE: drift=${drift.toFixed(2)}s, ${globalRate} × ${userSpeed} × ${fineMultiplier} = ${newRate}`);
        }
      }
    }, 150);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
        console.log(`[train-sync] Elastic cleanup`);
      }
    };
  }, [phase, playSeg, findSegForTime]);

  // ═══ USER ACTIONS ═══

  // Speed changes are applied in the aiPlaybackSpeed ref sync useEffect above

  /** User clicks "Play Clarified Audio" or "Resume" — TRAIN SYNC: ONE initial hookup */
  const handlePlay = useCallback(() => {
    if (onMuteYouTube) onMuteYouTube(true);
    if (onPlayYouTube) onPlayYouTube();
    isPlayingRef.current = true;

    // Calculate initial rate = globalRate × userSpeed
    const initialRate = Math.round(globalRateRef.current * speedRef.current * 100) / 100;
    elasticRateRef.current = initialRate;

    setPhase('playing');

    // TRAIN SYNC: Jump to segment matching current video position
    const startIdx = currentSegIdx >= 0 ? currentSegIdx : 0;
    initialHookupDoneRef.current = true;
    console.log(`[train-sync] ═══ INITIAL HOOKUP ═══ jumped to seg ${startIdx}, globalRate=${globalRateRef.current}, finalRate=${initialRate} (user=${speedRef.current})`);
    playSeg(startIdx);
  }, [currentSegIdx, playSeg, onMuteYouTube, onPlayYouTube]);

  /** User clicks "Pause" */
  const handlePause = useCallback(() => {
    isPlayingRef.current = false;
    if (audioRef.current) audioRef.current.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.pause();
    setPhase('paused');
    if (onMuteYouTube) onMuteYouTube(false);
  }, [onMuteYouTube]);

  // Register external handlers
  useEffect(() => {
    if (registerHandlers) {
      registerHandlers({
        play: () => handlePlay(),
        pause: () => handlePause(),
        isPlaying: () => isPlayingRef.current,
      });
    }
  }, [registerHandlers, handlePlay, handlePause]);

  /** User clicks "Stop" */
  const handleStop = useCallback(() => {
    isPlayingRef.current = false;
    if (syncIntervalRef.current) { clearInterval(syncIntervalRef.current); syncIntervalRef.current = null; }
    globalRateRef.current = 1;
    initialHookupDoneRef.current = false;
    elasticRateRef.current = speedRef.current;
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

  // ═══ GLOBAL RATE CALCULATION — the "train speed matching" ═══
  const calculateGlobalRate = useCallback((segs: ClarifyTranscriptSegment[]) => {
    let totalAiDuration = 0;
    let totalVideoDuration = 0;
    let measuredCount = 0;

    for (let i = 0; i < segs.length; i++) {
      const cached = cacheRef.current[i];
      if (cached?.audioDuration && cached.audioDuration > 0) {
        const videoDur = segs[i].end - segs[i].start;
        if (videoDur > 0) {
          totalAiDuration += cached.audioDuration;
          totalVideoDuration += videoDur;
          measuredCount++;
        }
      }
    }

    if (measuredCount < 2 || totalVideoDuration === 0) {
      console.log(`[train-sync] Not enough data for global rate (${measuredCount} segments measured), using 1.0`);
      globalRateRef.current = 1;
      return 1;
    }

    // Global rate = how fast to play AI audio so it fits the video timeline
    let rate = totalAiDuration / totalVideoDuration;

    // Cap to sane range
    if (rate > 2.0) {
      console.warn(`[train-sync] Global rate ${rate.toFixed(2)} capped to 2.0`);
      rate = 2.0;
    } else if (rate < 0.5) {
      console.warn(`[train-sync] Global rate ${rate.toFixed(2)} capped to 0.5`);
      rate = 0.5;
    }

    rate = Math.round(rate * 100) / 100;
    globalRateRef.current = rate;

    console.log(`[train-sync] ═══ GLOBAL RATE CALCULATED ═══`);
    console.log(`[train-sync]   ${measuredCount} segments measured`);
    console.log(`[train-sync]   Total AI audio: ${totalAiDuration.toFixed(2)}s`);
    console.log(`[train-sync]   Total video time: ${totalVideoDuration.toFixed(2)}s`);
    console.log(`[train-sync]   Global rate: ${rate} (AI is ${rate > 1 ? 'slower' : 'faster'} than video)`);
    console.log(`[train-sync]   At user 1x: play at ${rate}x`);
    console.log(`[train-sync]   At user 1.5x: play at ${(rate * 1.5).toFixed(2)}x`);

    return rate;
  }, []);

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
    globalRateRef.current = 1;
    initialHookupDoneRef.current = false;

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

      // Store translated buffer
      let transSegs: ClarifyTranscriptSegment[] = [];
      if (data.transcript?.length) {
        transSegs = data.transcript.map((s: any, i: number) => ({
          text: s.text || '', start: s.start || 0,
          end: s.end || (data.transcript[i + 1]?.start || (s.start || 0) + 3),
        }));
        setTranslatedTranscript(transSegs);
        translatedTxRef.current = transSegs;
        setTranslatedUpTo(transSegs.length);
      }

      setNeedsMoreTranslation(data.needsMoreTranslation || false);
      setSourceLanguage(data.sourceLanguage || '');

      const total = data.totalSegments || data.originalTranscript?.length || 0;
      const translated = data.translatedCount || data.transcript?.length || 0;
      setProcessingStage(`Ready! ${translated}/${total} segments translated`);

      if (mode !== 'subtitles_only') {
        // Generate first batch of TTS audio (with duration probing)
        setProcessingStage('Generating AI audio...');
        const segsForTTS = data.transcript || [];
        const batch = segsForTTS.slice(0, 8);
        const parsedBatch = batch.map((s: any) => s.text || '');
        await Promise.allSettled(parsedBatch.map((text: string, i: number) => generateSeg(i, text)));

        // ═══ TRAIN SYNC: Calculate global rate from first batch ═══
        const globalRate = calculateGlobalRate(transSegs);
        setProcessingStage(`Ready! Global rate: ${globalRate}x`);

        setPhase('ready');
      } else {
        setPhase('ready');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      setPhase('error');
    }
  }, [videoId, onTranscriptReady, generateSeg, calculateGlobalRate]);

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
      if (syncIntervalRef.current) { clearInterval(syncIntervalRef.current); syncIntervalRef.current = null; }
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
