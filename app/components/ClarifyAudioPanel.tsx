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
  const globalRateRef = useRef(1);  // TRAIN SYNC: raw rate from words/sec matching
  const playRateRef = useRef(1);   // Actual playback rate = max(globalRate, MIN_SPEECH_RATE)
  const elasticRateRef = useRef(1); // final playbackRate = playRate × userSpeed × fineMultiplier
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const translatingMoreRef = useRef(false);
  const initialHookupDoneRef = useRef(false); // true after first play alignment

  // Keep refs synced
  useEffect(() => { volRef.current = volume / 100; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { txRef.current = transcript; }, [transcript]);
  useEffect(() => {
    console.log(`[train-sync] User speed changed: ${speedRef.current} -> ${aiPlaybackSpeed}`);
    speedRef.current = aiPlaybackSpeed;
    // Recalculate: playRate x userSpeed (elastic will fine-tune from here)
    const finalRate = Math.round(playRateRef.current * aiPlaybackSpeed * 1000) / 1000;
    elasticRateRef.current = finalRate;
    if (audioRef.current) {
      audioRef.current.playbackRate = finalRate;
      console.log(`[train-sync] Updated: playRate=${playRateRef.current} x user=${aiPlaybackSpeed} = ${finalRate}`);
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

  // ═══ AUDIO PLAYBACK — HYBRID: play at natural speed, wait when AI finishes early ═══
  // MIN_SPEECH_RATE = 0.75x — below this, speech sounds unnatural/robotic.
  // When globalRate < 0.75 (AI shorter than video), we play at 0.75x and WAIT
  // for video to catch up between segments. This gives natural-sounding speech.
  const MIN_SPEECH_RATE = 0.75;

  // Schedule next segment — waits for video to catch up if AI finished early
  const scheduleNextSeg = useCallback((i: number) => {
    if (!isPlayingRef.current) return;
    const segs = translatedTxRef.current;
    const nextIdx = i + 1;
    if (nextIdx >= segs.length) {
      isPlayingRef.current = false;
      setPhase('paused');
      if (onMuteYouTube) onMuteYouTube(false);
      return;
    }

    // If playRate > globalRate (we're playing faster than needed), wait for video
    if (playRateRef.current > globalRateRef.current) {
      const nextSegStart = segs[nextIdx].start;
      const videoTime = currentTimeRef.current;

      if (videoTime < nextSegStart - 0.3) {
        // Video hasn't reached next segment — poll until it does
        console.log(`[train-sync] Seg ${i} done early, video=${videoTime.toFixed(1)}, waiting for seg${nextIdx}.start=${nextSegStart.toFixed(1)}`);
        const pollId = setInterval(() => {
          if (!isPlayingRef.current) { clearInterval(pollId); return; }
          if (currentTimeRef.current >= nextSegStart - 0.3) {
            clearInterval(pollId);
            console.log(`[train-sync] Video reached ${currentTimeRef.current.toFixed(1)}, playing seg ${nextIdx}`);
            playSeg(nextIdx);
          }
        }, 100);
        // Safety timeout
        const waitMs = Math.min(((nextSegStart - videoTime) / speedRef.current) * 1000 + 500, 8000);
        setTimeout(() => {
          clearInterval(pollId);
          if (isPlayingRef.current && playingIdxRef.current === i) {
            console.log(`[train-sync] Wait timeout, playing seg ${nextIdx} anyway`);
            playSeg(nextIdx);
          }
        }, waitMs);
        return;
      }
    }

    // No wait needed — play immediately
    playSeg(nextIdx);
  }, [onMuteYouTube]);

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

        // HYBRID: play at playRate (never below MIN_SPEECH_RATE) x userSpeed
        const finalRate = Math.round(playRateRef.current * speedRef.current * 1000) / 1000;
        elasticRateRef.current = finalRate;
        a.playbackRate = finalRate;
        console.log(`[train-sync] Seg ${i}: playRate=${playRateRef.current} x user=${speedRef.current} = ${finalRate} (raw global=${globalRateRef.current})`);

        // Lock speed — allow elastic fine-tuning but prevent browser drift
        a.addEventListener('ratechange', () => {
          const desired = elasticRateRef.current;
          if (desired && Math.abs(a.playbackRate - desired) > 0.01) {
            a.playbackRate = desired;
          }
        });

        a.onended = () => { scheduleNextSeg(i); };
        a.onerror = () => {
          console.warn(`[clarify] Audio error on seg ${i}, skipping`);
          if (cached.url) { try { URL.revokeObjectURL(cached.url); } catch {} }
          cached.url = undefined;
          cached.useClientTTS = true;
          if (isPlayingRef.current) scheduleNextSeg(i);
        };
        a.play().catch(() => { if (isPlayingRef.current) scheduleNextSeg(i); });
      } catch {
        if (isPlayingRef.current) scheduleNextSeg(i);
      }
    } else if (cached?.useClientTTS) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(translatedTxRef.current[i].text);
        u.lang = selectedLang === 'en' ? 'en-US' : selectedLang;
        u.volume = mutedRef.current ? 0 : volRef.current;
        u.rate = playRateRef.current * speedRef.current;
        u.onend = () => { scheduleNextSeg(i); };
        u.onerror = () => { if (isPlayingRef.current) scheduleNextSeg(i); };
        window.speechSynthesis.speak(u);
      }
    } else if (i >= translatedTxRef.current.length) {
      setTimeout(() => { if (isPlayingRef.current) playSeg(i); }, 800);
    } else {
      setTimeout(() => { if (isPlayingRef.current) playSeg(i); }, 400);
    }
  }, [selectedLang, onMuteYouTube, scheduleNextSeg]);

  // ═══ ELASTIC SYNC: drift correction + seek detection ═══
  // Rate matching handles ~95% of sync. This loop handles residual drift + user seeking.
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

    console.log(`[train-sync] === ELASTIC SYNC STARTED (globalRate=${globalRateRef.current}) ===`);
    syncTickRef.current = 0;

    const SEEK_THRESHOLD = 5.0;       // seconds — detect user seeking (video time jumps between ticks)
    const LARGE_DRIFT_THRESHOLD = 5.0; // seconds — trigger re-sync jump
    const FINE_THRESHOLD = 0.5;        // seconds — below this = in sync, no adjustment
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
        console.log(`[train-sync] USER SEEK: video jumped ${videoTimeDelta.toFixed(1)}s, re-aligning to seg ${targetSegIdx} (videoTime=${videoTime.toFixed(1)})`);
        jumpCooldownRef.current = now;
        elasticRateRef.current = globalRateRef.current * speedRef.current;
        if (audio) { audio.pause(); audio.onended = null; }
        playSeg(targetSegIdx);
        return;
      }

      // Calculate where AI audio is in "video content time"
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

      // ─── LARGE DRIFT CORRECTION: jump AI to match video position ───
      if (absDrift > LARGE_DRIFT_THRESHOLD && !cooldownActive) {
        const targetSegIdx = findSegForTime(videoTime, segs);
        console.log(`[train-sync] LARGE DRIFT: ${drift.toFixed(1)}s (AI ${drift > 0 ? 'ahead' : 'behind'}) — RE-SYNCING to seg ${targetSegIdx} (video=${videoTime.toFixed(1)})`);
        jumpCooldownRef.current = now;
        elasticRateRef.current = globalRate * userSpeed;
        if (audio) { audio.pause(); audio.onended = null; }
        playSeg(targetSegIdx);
        return;
      }

      // ─── ELASTIC FINE-TUNING: ±2-8% adjustments based on drift magnitude ───
      const playRate = playRateRef.current;
      let fineMultiplier = 1.0;

      if (drift > FINE_THRESHOLD) {
        // AI ahead — slow down
        if (drift > 3.0) fineMultiplier = 0.92;
        else if (drift > 2.0) fineMultiplier = 0.94;
        else if (drift > 1.0) fineMultiplier = 0.96;
        else fineMultiplier = 0.98;
      } else if (drift < -FINE_THRESHOLD) {
        // AI behind — speed up
        if (drift < -3.0) fineMultiplier = 1.08;
        else if (drift < -2.0) fineMultiplier = 1.06;
        else if (drift < -1.0) fineMultiplier = 1.04;
        else fineMultiplier = 1.02;
      }

      // Final rate = playRate x userSpeed x fineMultiplier
      const newRate = Math.round(playRate * userSpeed * fineMultiplier * 1000) / 1000;
      const oldRate = elasticRateRef.current;

      if (verbose) {
        const status = absDrift > LARGE_DRIFT_THRESHOLD ? 'JUMP-PENDING' :
                       absDrift > FINE_THRESHOLD ? 'FINE-TUNE' : 'IN-SYNC';
        console.log(`[train-sync] tick ${syncTickRef.current}: [${status}] video=${videoTime.toFixed(1)}, aiPos=${aiVideoPos.toFixed(1)}, drift=${drift.toFixed(2)}s, playRate=${playRate}, fine=${fineMultiplier}, final=${newRate} (user=${userSpeed})`);
      }

      if (Math.abs(newRate - oldRate) > 0.003) {
        elasticRateRef.current = newRate;
        if (audio && !audio.paused) {
          audio.playbackRate = newRate;
        }
        if (Math.abs(fineMultiplier - 1.0) > 0.005) {
          console.log(`[train-sync] FINE: drift=${drift.toFixed(2)}s, ${playRate} x ${userSpeed} x ${fineMultiplier} = ${newRate}`);
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

    // Calculate initial rate = playRate x userSpeed
    const initialRate = Math.round(playRateRef.current * speedRef.current * 1000) / 1000;
    elasticRateRef.current = initialRate;

    setPhase('playing');

    // Jump to segment matching current video position
    const startIdx = currentSegIdx >= 0 ? currentSegIdx : 0;
    initialHookupDoneRef.current = true;
    console.log(`[train-sync] === INITIAL HOOKUP === seg ${startIdx}, globalRate=${globalRateRef.current}, playRate=${playRateRef.current}, finalRate=${initialRate} (user=${speedRef.current})`);
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
    playRateRef.current = 1;
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

  // ═══ GLOBAL RATE CALCULATION — words/sec rate matching + MIN SPEECH RATE ═══
  //
  // STEP 1: Calculate raw globalRate from words/sec matching
  //   videoWPS = totalWords / totalVideoDuration (how fast video speaks)
  //   aiWPS    = totalWords / totalAiDuration    (how fast AI speaks at 1.0x)
  //   globalRate = videoWPS / aiWPS              (rate to match paces)
  //
  // STEP 2: Set playRate = max(globalRate, MIN_SPEECH_RATE)
  //   If globalRate < 0.75, play at 0.75x and use waiting to fill the gap.
  //   Speech below 0.75x sounds unnatural and robotic.
  //
  const calculateGlobalRate = useCallback((segs: ClarifyTranscriptSegment[]) => {
    console.log('[train-sync] ===== GLOBAL RATE CALCULATION START =====');
    const sampleSize = Math.min(8, segs.length);
    console.log(`[train-sync] Sampling first ${sampleSize} of ${segs.length} segments`);

    let totalWords = 0;
    let totalAiDuration = 0;
    let totalVideoDuration = 0;
    let measuredCount = 0;

    for (let i = 0; i < sampleSize; i++) {
      const cached = cacheRef.current[i];
      const videoDur = segs[i].end - segs[i].start;
      const aiDur = cached?.audioDuration || 0;
      const words = segs[i].text.split(/\s+/).filter((w: string) => w.length > 0).length;

      if (aiDur > 0 && videoDur > 0.1) {
        totalWords += words;
        totalAiDuration += aiDur;
        totalVideoDuration += videoDur;
        measuredCount++;
        console.log(`[train-sync]   Seg ${i}: "${segs[i].text.substring(0, 50)}" ${words}w, videoDur=${videoDur.toFixed(2)}s, aiDur=${aiDur.toFixed(2)}s, ratio=${(aiDur/videoDur).toFixed(3)}`);
      } else {
        console.log(`[train-sync]   Seg ${i}: SKIPPED (aiDur=${aiDur.toFixed(2)}, videoDur=${videoDur.toFixed(2)})`);
      }
    }

    console.log('[train-sync] === TOTALS ===');
    console.log(`[train-sync]   Measured segments: ${measuredCount}`);
    console.log(`[train-sync]   Total words: ${totalWords}`);
    console.log(`[train-sync]   Total video duration: ${totalVideoDuration.toFixed(2)}s`);
    console.log(`[train-sync]   Total AI duration: ${totalAiDuration.toFixed(2)}s`);

    if (measuredCount < 2 || totalVideoDuration === 0 || totalAiDuration === 0 || totalWords === 0) {
      console.log(`[train-sync] Not enough data, using globalRate=1.0, playRate=1.0`);
      globalRateRef.current = 1;
      playRateRef.current = 1;
      return 1;
    }

    // Calculate speaking rates
    const videoWPS = totalWords / totalVideoDuration;
    const aiWPS = totalWords / totalAiDuration;

    console.log(`[train-sync]   Video WPS: ${totalWords} / ${totalVideoDuration.toFixed(2)} = ${videoWPS.toFixed(3)} words/sec`);
    console.log(`[train-sync]   AI WPS:    ${totalWords} / ${totalAiDuration.toFixed(2)} = ${aiWPS.toFixed(3)} words/sec`);

    // globalRate = videoWPS / aiWPS (how to match paces)
    let rawRate = videoWPS / aiWPS;
    console.log(`[train-sync]   Raw rate:  ${videoWPS.toFixed(3)} / ${aiWPS.toFixed(3)} = ${rawRate.toFixed(4)}`);

    // Cross-check: totalAiDuration / totalVideoDuration should equal rawRate
    const durationRatio = totalAiDuration / totalVideoDuration;
    console.log(`[train-sync]   Cross-check: aiDur/videoDur = ${totalAiDuration.toFixed(2)}/${totalVideoDuration.toFixed(2)} = ${durationRatio.toFixed(4)} (should equal raw rate)`);

    // Cap to safe browser range
    if (rawRate > 2.5) { console.warn(`[train-sync] Raw rate ${rawRate.toFixed(3)} capped to 2.5`); rawRate = 2.5; }
    else if (rawRate < 0.25) { console.warn(`[train-sync] Raw rate ${rawRate.toFixed(3)} capped to 0.25`); rawRate = 0.25; }

    const globalRate = Math.round(rawRate * 1000) / 1000;
    globalRateRef.current = globalRate;

    // playRate = actual rate used for audio playback (min 0.75x for natural speech)
    const playRate = Math.max(globalRate, MIN_SPEECH_RATE);
    playRateRef.current = playRate;

    // Verification
    const aiAtGlobal = aiWPS * globalRate;
    const aiAtPlay = aiWPS * playRate;
    const needsWaiting = playRate > globalRate;

    console.log('[train-sync] ===== RESULTS =====');
    console.log(`[train-sync]   Global rate: ${globalRate}x (raw pace-matching rate)`);
    console.log(`[train-sync]   Play rate:   ${playRate}x (actual audio playback, min ${MIN_SPEECH_RATE}x)`);
    console.log(`[train-sync]   AI at global: ${aiWPS.toFixed(2)} x ${globalRate} = ${aiAtGlobal.toFixed(2)} wps ${Math.abs(aiAtGlobal - videoWPS) < 0.1 ? '= MATCHED' : '(close to video ' + videoWPS.toFixed(2) + ')'}`);
    console.log(`[train-sync]   AI at play:   ${aiWPS.toFixed(2)} x ${playRate} = ${aiAtPlay.toFixed(2)} wps`);
    if (needsWaiting) {
      console.log(`[train-sync]   MODE: HYBRID - play at ${playRate}x + wait between segments`);
      console.log(`[train-sync]   (globalRate ${globalRate} < min ${MIN_SPEECH_RATE}, so waiting fills the gap)`);
    } else {
      console.log(`[train-sync]   MODE: DIRECT - play at ${playRate}x, no waiting needed`);
    }
    console.log(`[train-sync]   At user 1.25x: play at ${(playRate * 1.25).toFixed(3)}x`);
    console.log('[train-sync] ===== END =====');

    return globalRate;
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
    playRateRef.current = 1;
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
        setProcessingStage(`Ready! Play rate: ${playRateRef.current}x (global: ${globalRate}x)`);

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
