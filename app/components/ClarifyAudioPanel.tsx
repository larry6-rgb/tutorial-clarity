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
 * - SINGLE VOICE: Every segment uses the same TTS voice (DEFAULT_VOICE) —
 *   speaker detection/multi-voice was removed 2026-07-24 (unreliable in
 *   production, see project memory for the full history).
 * - LIVE OPTIONS: Speed changes apply immediately to playing audio.
 * - Progressive translation: 30-segment buffer, then translate ahead of playback
 * - Dual transcript: original (source lang) + translated, switchable by audio mode
 * - Speed control with bright orange styling
 * - Options button opens settings without restarting translation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ProcessingOptionsModal, { OutputMode } from '@/app/hooks/ProcessingOptionsModal';
import ClarificationLimitPopup from '@/app/components/ClarificationLimitPopup';
import type { SubscriptionStatus } from '@/lib/subscription';

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
    voice?: string;  // Which TTS voice was used for this segment
    generatedAt?: number;  // Timestamp when this entry was created
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
  onAiActiveChange?: (active: boolean, language: string) => void;
  registerHandlers?: (handlers: { play: () => void; pause: () => void; isPlaying: () => boolean; testAudioBlobs: () => void; hasAudioBlobs: () => boolean }) => void;
  onStop?: () => void;  // fires when the user hits Stop
}

// Every segment uses this single TTS voice — no per-speaker detection/assignment.
const DEFAULT_VOICE = 'onyx';

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ClarifyAudioPanel({
  videoId, currentTime, aiPlaybackSpeed = 1, onSubtitleChange, onMuteYouTube, onPlayYouTube, onTranscriptReady, onSegmentChange, onAiActiveChange, registerHandlers, onStop,
}: ClarifyAudioPanelProps) {

  const router = useRouter();

  // ═══ STATE ═══
  type Phase = 'choosing' | 'processing' | 'ready' | 'buffering' | 'playing' | 'paused' | 'stopped' | 'error';
  const BUFFER_THRESHOLD = 15; // segments that must be TTS-ready before playback opens
  const [phase, setPhase] = useState<Phase>('choosing');
  const [selectedMode, setSelectedMode] = useState<OutputMode | null>(null);
  const [selectedLang, setSelectedLang] = useState('en');
  const [error, setError] = useState('');

  // ═══ SESSION ENFORCEMENT ═══
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null);
  const [sessionPopup, setSessionPopup] = useState<'warning' | 'limit' | null>(null);
  const pendingOptionRef = useRef<{ mode: OutputMode; lang: string } | null>(null);

  useEffect(() => {
    fetch('/api/subscription-status')
      .then(r => r.json())
      .then(setSubStatus)
      .catch(() => null);
  }, []);

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
  // Buffer readiness is checked against the segments actually needed to start
  // playback (from wherever the video currently is), not always segment 0 —
  // see bufferStartIdxRef below. This state drives the "X/Y ready" UI so it
  // reflects the real gate instead of a misleading total generation count.
  const [bufferStatus, setBufferStatus] = useState({ ready: 0, threshold: BUFFER_THRESHOLD });

  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [showOptionsOverlay, setShowOptionsOverlay] = useState(false);

  // ═══ REFS ═══
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<AudioCache>({});
  const genSetRef = useRef<Set<number>>(new Set());
  const playingIdxRef = useRef(-1);
  // Segment index the video was actually at when the user hit Play — the
  // buffer must fill THIS segment forward, not always from 0 (the video is
  // rarely still at time 0 by the time Play is clicked).
  const bufferStartIdxRef = useRef(0);
  const isPlayingRef = useRef(false);
  const volRef = useRef(1.0);
  const mutedRef = useRef(false);
  const txRef = useRef<ClarifyTranscriptSegment[]>([]);
  const originalTxRef = useRef<ClarifyTranscriptSegment[]>([]);
  const translatedTxRef = useRef<ClarifyTranscriptSegment[]>([]);
  const speedRef = useRef(1);
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

  // ═══ TTS GENERATION (single voice) ═══
  const generateSeg = useCallback(async (i: number, text: string) => {
    // ── CACHE CHECK ──
    const cacheEntry = cacheRef.current[i];
    if (cacheEntry?.url || cacheEntry?.useClientTTS || cacheEntry?.generating) {
      return;
    }
    if (genSetRef.current.has(i)) {
      return;
    }

    // Capture epoch at start — if it changes during generation, discard results
    const startEpoch = regenEpochRef.current;

    genSetRef.current.add(i);
    cacheRef.current[i] = { generating: true };

    try {
      const rawSegTranslated = translatedTxRef.current[i];
      const rawSegTx = txRef.current[i];
      const seg = rawSegTranslated || rawSegTx;

      const voice = DEFAULT_VOICE;
      const gender = 'male';

      // ═══ REQUEST BODY — voice is a PLAIN STRING (not an object!) ═══
      const requestBody = {
        text,
        voice,              // ← plain string, e.g. "onyx"
        gender,             // ← "male" or "female"
        videoId,
        segmentId: `seg_${i}`,
        targetDuration: seg ? seg.end - seg.start : undefined,
        targetLanguage: selectedLang,
        ttsModel: 'tts-1',
      };

      const bodyJson = JSON.stringify(requestBody);

      // ── Fetch with client-side retry for transient errors ──
      let res: Response | null = null;
      let fetchError: string = '';
      const CLIENT_RETRIES = 2;

      for (let attempt = 1; attempt <= CLIENT_RETRIES; attempt++) {
        try {
          res = await fetch('/api/multi-voice-tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyJson,
          });

          // Check epoch — if regeneration happened while we were awaiting, discard
          if (regenEpochRef.current !== startEpoch) {
            console.log(`[voice-variety] Seg ${i}: DISCARDED (epoch ${startEpoch} -> ${regenEpochRef.current})`);
            genSetRef.current.delete(i);
            return;
          }

          if (res.ok) break; // Success

          // Read error response body for debugging
          let errorBody = '';
          try {
            errorBody = await res.text();
            const errorJson = JSON.parse(errorBody);
            console.error(`[TTS-ERROR] Seg ${i} attempt ${attempt}/${CLIENT_RETRIES}: HTTP ${res.status}`, errorJson);
            fetchError = `HTTP ${res.status}: ${errorJson.error || errorJson.message || errorBody.substring(0, 100)}`;
          } catch {
            console.error(`[TTS-ERROR] Seg ${i} attempt ${attempt}/${CLIENT_RETRIES}: HTTP ${res.status} body=${errorBody.substring(0, 100)}`);
            fetchError = `HTTP ${res.status}: ${errorBody.substring(0, 100)}`;
          }

          // Retry on 5xx (server transient errors)
          if (attempt < CLIENT_RETRIES && res.status >= 500) {
            console.log(`[TTS-ERROR] Seg ${i}: Retrying in ${attempt * 300}ms...`);
            await new Promise(r => setTimeout(r, attempt * 300));
            res = null;
          }

        } catch (netErr) {
          fetchError = netErr instanceof Error ? netErr.message : String(netErr);
          console.error(`[TTS-ERROR] Seg ${i} attempt ${attempt}/${CLIENT_RETRIES}: Network error:`, fetchError);
          if (attempt < CLIENT_RETRIES) {
            await new Promise(r => setTimeout(r, attempt * 300));
          }
        }
      }

      if (!res || !res.ok) {
        console.error(`[TTS-ERROR] Seg ${i}: All ${CLIENT_RETRIES} attempts failed: ${fetchError}`);
        throw new Error(`TTS failed: ${fetchError}`);
      }

      const ct = res.headers.get('content-type');
      const returnedVoice = res.headers.get('x-voice-used') || res.headers.get('x-voice-id');
      const requestId = res.headers.get('x-request-id');
      const now = Date.now();

      // Verify voice match
      if (returnedVoice && returnedVoice !== voice) {
        console.error(`[MISMATCH] Seg ${i}: sent="${voice}" server="${returnedVoice}" (${requestId})`);
      } else {
        console.log(`[DIAGNOSTIC] Seg ${i}: ✅ voice="${voice}" confirmed by server (${requestId})`);
      }

      if (ct?.includes('application/json')) {
        const data = await res.json();
        if (data.useClientSideTTS) {
          console.log(`[voice-variety] Seg ${i}: Server says use client TTS (reason: ${data.reason || '?'})`);
          cacheRef.current[i] = { useClientTTS: true, voice, generatedAt: now };
          setUseClientTTS(true);
        }
      } else {
        const blob = await res.blob();
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          cacheRef.current[i] = { url, voice, generatedAt: now };
          console.log(`[voice-variety] Seg ${i}: ✅ ${blob.size}B voice="${voice}" server="${returnedVoice}"`);
        } else {
          cacheRef.current[i] = { useClientTTS: true, voice, generatedAt: now };
          setUseClientTTS(true);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TTS-ERROR] Seg ${i}: FINAL FAILURE — falling back to client TTS. Error: ${errMsg}`);
      cacheRef.current[i] = { useClientTTS: true, generatedAt: Date.now() };
      setUseClientTTS(true);
    }

    genSetRef.current.delete(i);
    setGeneratedCount(prev => prev + 1);
  }, [videoId, selectedLang]);

  // ═══ BUFFER MONITOR — opens outlet valve when tank reaches threshold ═══
  useEffect(() => {
    if (phase !== 'buffering') return;

    // Count ready segments starting from bufferStartIdxRef (the segment the
    // video was actually at when Play was clicked) — must be SEQUENTIAL from
    // there so the segment that plays FIRST is guaranteed ready (avoids
    // leading silence). Checking from a hardcoded 0 here was the bug: if the
    // video wasn't at time 0, TTS generation (which tracks live video
    // position) never touched segments 0-N, so this check could never pass
    // even though plenty of *other* segments had generated successfully.
    const startIdx = bufferStartIdxRef.current;
    const threshold = Math.min(BUFFER_THRESHOLD, translatedTranscript.length - startIdx);
    let readyCount = 0;
    for (let i = startIdx; i < startIdx + threshold; i++) {
      const e = cacheRef.current[i];
      if (e?.url || e?.useClientTTS) readyCount++;
      else break;  // stop at first gap — segments must be contiguous from startIdx
    }
    setBufferStatus({ ready: readyCount, threshold });
    console.log(`[buffer] Tank level: ${readyCount}/${threshold} sequential segments ready (from seg ${startIdx})`);

    if (readyCount >= threshold) {
      console.log(`[buffer] ✅ Buffer full — opening outlet valve (starting playback)`);
      isPlayingRef.current = true;
      setPhase('playing');
    }
  }, [phase, generatedCount, translatedTranscript.length]);

  // ═══ PRE-GENERATE AHEAD + PROGRESSIVE TRANSLATION ═══
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'buffering') return;
    if (translatedTranscript.length === 0) return;
    // While buffering, anchor to bufferStartIdxRef rather than currentSegIdx —
    // currentSegIdx tracks the currently-displayed `transcript` state, which
    // isn't switched to translatedTranscript until phase reaches 'playing',
    // so it can be misaligned during 'buffering' itself.
    const start = phase === 'buffering' ? bufferStartIdxRef.current : Math.max(0, currentSegIdx);
    // Generate TTS for segments ahead of current position — 20-segment lookahead (~60s buffer)
    for (let i = start; i < Math.min(start + 20, translatedTranscript.length); i++) {
      if (!cacheRef.current[i]) {
        generateSeg(i, translatedTranscript[i].text);
      }
    }

    // Request more translation if approaching the edge of translated segments
    if (needsMoreTranslation && !translatingMoreRef.current && currentSegIdx >= translatedUpTo - 30) {
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
        }));
        setTranslatedTranscript(prev => {
          const combined = [...prev, ...rawNewSegs];
          translatedTxRef.current = combined;
          return combined;
        });
        setTranslatedUpTo(prev => prev + rawNewSegs.length);
        setNeedsMoreTranslation(!data.done);
        console.log(`[clarify] Got ${rawNewSegs.length} more translated segments (done: ${data.done})`);
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

  // Play a single segment — rate-matched to video segment duration, then chains to next segment
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
        a.playbackRate = speedRef.current;  // initial rate — adjusted on loadedmetadata
        audioRef.current = a;

        const seg = translatedTxRef.current[i];
        const segVideoDuration = (seg?.end || 0) - (seg?.start || 0);  // seconds in video time

        // ── RATE MATCH: tiny nudge only — TTS plays at natural speed, voice stays consistent ──
        a.addEventListener('loadedmetadata', () => {
          if (a.duration > 0 && segVideoDuration > 0) {
            const realTimeAvailable = segVideoDuration / speedRef.current;
            const rate = a.duration / realTimeAvailable;
            // Clamp tightly to ±10% — large mismatches absorbed by natural pauses between segments
            a.playbackRate = Math.min(1.1, Math.max(0.9, rate));
          }
        });

        a.onended = () => {
          playingIdxRef.current = -1;
          if (!isPlayingRef.current) return;
          const nextIdx = i + 1;
          const segs = translatedTxRef.current;
          if (nextIdx >= segs.length) return;
          const videoNow = currentTimeRef.current;
          const nextSeg = segs[nextIdx];
          const drift = videoNow - (nextSeg?.start || 0);

          if (drift > 3) {
            // Audio well behind video — let scheduler jump forward to correct segment
            console.log(`[sync] Audio behind ${drift.toFixed(1)}s — returning control to scheduler`);
          } else if (drift < -0.3) {
            // TTS finished early — video hasn't reached next segment yet.
            // Do NOT chain: let the scheduler trigger it when video time arrives.
            console.log(`[sync] TTS done early, video at ${videoNow.toFixed(1)}s next seg starts ${(nextSeg?.start || 0).toFixed(1)}s — holding for scheduler`);
          } else {
            // Video is at or near the next segment boundary — chain directly.
            const currentSeg = segs[i];
            const videoGap = nextSeg ? nextSeg.start - (currentSeg?.end || 0) : 99;
            if (videoGap <= 2.0) {
              const nextCached = cacheRef.current[nextIdx];
              if (nextCached?.url || nextCached?.useClientTTS) {
                playSeg(nextIdx);
              }
            } else {
              console.log(`[sync] Video gap ${videoGap.toFixed(1)}s — holding for scheduler`);
            }
          }
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
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(translatedTxRef.current[i].text);
        u.lang = selectedLang === 'en' ? 'en-US' : selectedLang;
        u.volume = mutedRef.current ? 0 : volRef.current;
        u.rate = speedRef.current;

        // Use a single consistent browser voice for the language
        const voices = window.speechSynthesis.getVoices();
        const langVoices = voices.filter(v => v.lang.startsWith(selectedLang === 'en' ? 'en' : selectedLang));
        if (langVoices.length > 0) u.voice = langVoices[0];

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

    // ═══ ONE-TIME DIAGNOSTIC: Segment/Timestamp alignment check ═══
    {
      const segs = translatedTxRef.current;
      let overlaps = 0, outOfOrder = 0, bigGaps = 0;
      for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i + 1].start < segs[i].start) outOfOrder++;
        if (segs[i].end > segs[i + 1].start + 0.1) overlaps++;
        if (segs[i + 1].start - segs[i].end > 5) bigGaps++;
      }
      console.log(`[scheduler-diag] ${segs.length} segments — overlaps=${overlaps} outOfOrder=${outOfOrder} bigGaps=${bigGaps}`);
    }

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

      // ─── CONTINUOUS DRIFT CORRECTION ───
      // While audio is playing, gently nudge playback rate to keep in sync with video.
      // Proportional controller: each 100ms tick, measure drift and adjust rate.
      if (playingIdxRef.current >= 0 && audioRef.current) {
        const a = audioRef.current;
        const seg = translatedTxRef.current[playingIdxRef.current];

        // ── MACRO DRIFT CHECK: if video has moved to a different segment, re-sync now ──
        // Gentle rate nudging can't recover from large gaps (e.g. speed change mid-play).
        const videoSegIdx = findSegForTime(videoTime, translatedTxRef.current);
        if (videoSegIdx >= 0 && videoSegIdx !== playingIdxRef.current) {
          const segGap = videoSegIdx - playingIdxRef.current;
          if (segGap > 1) {  // audio is behind video by 2+ segments — hard re-sync forward
            // Negative segGap means audio is ahead — let rate correction slow it down, never jump back
            console.log(`[scheduler] Macro drift: playing seg ${playingIdxRef.current}, video at seg ${videoSegIdx} — re-syncing`);
            a.pause();
            a.onended = null;
            playingIdxRef.current = -1;
            lastScheduledSegRef.current = -1;
            // Fall through to let scheduler pick the correct segment below
          } else {
            return;  // 1 segment off — let drift correction handle it
          }
        } else {
          // No continuous rate adjustment — pre-fitted TTS speed + loadedmetadata rate match
          // handle sync at segment start. Continuous correction caused audible oscillation.
          return;
        }
      }

      // ─── Find which segment the video is currently in ───
      const targetIdx = findSegForTime(videoTime, segs);
      if (targetIdx < 0) return;

      // ─── Don't replay the same segment we just played or are currently playing ───
      if (targetIdx === lastScheduledSegRef.current) return;
      if (targetIdx === playingIdxRef.current) return;

      // ─── Check if video has reached this segment's start (with small tolerance) ───
      const seg = segs[targetIdx];
      if (videoTime >= seg.start - 0.2) {
        // Check if TTS is ready
        const cached = cacheRef.current[targetIdx];
        if (cached?.url || cached?.useClientTTS) {
          playSeg(targetIdx);
        } else {
          // TTS not ready yet — do NOT mark as scheduled, scheduler will retry next tick
          if (cacheRef.current[targetIdx]?.generating) {
            console.log(`[scheduler] Seg ${targetIdx} still generating, will retry`);
          } else {
            console.log(`[scheduler] Seg ${targetIdx} not cached yet, will retry`);
          }
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

  /** User clicks "Play Clarified Audio" or "Resume" — fill buffer first, then open outlet */
  const handlePlay = useCallback(() => {
    if (onMuteYouTube) onMuteYouTube(true);
    if (onPlayYouTube) onPlayYouTube();
    isPlayingRef.current = false;  // not playing yet — buffering
    playingIdxRef.current = -1;
    lastScheduledSegRef.current = -1;

    // Anchor the buffer fill to wherever the video actually is right now —
    // not segment 0. The video is almost never still at time 0 by the time
    // the user clicks Play (they've been reading the options modal, the
    // video kept playing in the background, etc.), so generation needs to
    // target the segments that will actually play next.
    const segs = translatedTxRef.current.length > 0 ? translatedTxRef.current : txRef.current;
    bufferStartIdxRef.current = segs.length > 0 ? findSegForTime(currentTimeRef.current, segs) : 0;
    console.log(`[buffer] === BUFFERING === starting from segment ${bufferStartIdxRef.current} (video at ${currentTimeRef.current.toFixed(1)}s), filling ${BUFFER_THRESHOLD} segments before playback opens...`);
    setPhase('buffering');
    // Buffering effect will watch the cache and switch to 'playing' when threshold is met
  }, [onMuteYouTube, onPlayYouTube, findSegForTime]);

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
    if (onStop) onStop();
  }, [onMuteYouTube, onTranscriptReady, onStop]);

  // ═══ DIAGNOSTIC: Audio blob test — plays cached blobs one-by-one so you can hear if voices are correct ═══
  // NOTE: Must be defined BEFORE registerHandlers useEffect for dependency tracking
  const testAudioBlobs = useCallback(() => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🧪 AUDIO BLOB TEST');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    const cache = cacheRef.current;
    const keys = Object.keys(cache).map(Number).sort((a, b) => a - b);

    if (keys.length === 0) {
      console.error('❌ NO AUDIO BLOBS FOUND!');
      console.error('Generate audio first before testing.');
      return;
    }

    const totalBlobs = keys.length;
    const totalSegments = translatedTxRef.current.length;

    console.log(`📊 Total audio blobs in cache: ${totalBlobs}`);
    console.log(`📊 Total transcript segments: ${totalSegments}`);

    if (totalBlobs !== totalSegments) {
      console.warn(`⚠️  Mismatch: ${totalBlobs} blobs but ${totalSegments} segments!`);
    }

    // ── INDEX ALIGNMENT CHECK ──
    console.log('');
    console.log('🔍 INDEX ALIGNMENT CHECK');
    const missingIndices: number[] = [];
    const emptyBlobs: number[] = [];
    for (let i = 0; i < totalSegments; i++) {
      if (!cache[i]) {
        missingIndices.push(i);
      } else if (!cache[i].url) {
        emptyBlobs.push(i);
      }
    }
    if (missingIndices.length > 0) {
      console.error(`❌ ${missingIndices.length} segments have NO cached blob!`);
      console.error('   Missing indices:', missingIndices.slice(0, 20).join(', '), missingIndices.length > 20 ? '...' : '');
    } else {
      console.log('✅ All segment indices have a cached blob');
    }
    if (emptyBlobs.length > 0) {
      console.warn(`⚠️  ${emptyBlobs.length} blobs have no URL (still generating?)`);
    }

    // ── STORAGE VERIFICATION (first 10) ──
    console.log('');
    console.log('📦 STORAGE VERIFICATION (first 10):');
    const storageCheck = keys.slice(0, 10).map(idx => {
      const entry = cache[idx];
      const seg = translatedTxRef.current[idx];
      const cachedVoice = entry?.voice || '(none)';
      const voiceMatch = cachedVoice === DEFAULT_VOICE;
      return { idx, expectedVoice: DEFAULT_VOICE, cachedVoice, voiceMatch, hasUrl: !!entry?.url, text: (seg?.text || '').substring(0, 40) };
    });

    storageCheck.forEach(item => {
      const matchIcon = item.voiceMatch ? '✅' : '❌';
      console.log(`${matchIcon} [${item.idx}] expected=${item.expectedVoice}, cached=${item.cachedVoice}, url=${item.hasUrl}`);
      console.log(`   "${item.text}..."`);
    });

    // ── VOICE DISTRIBUTION ──
    const voiceDistribution: Record<string, number> = {};
    keys.forEach(idx => {
      const v = cache[idx]?.voice || '(none)';
      voiceDistribution[v] = (voiceDistribution[v] || 0) + 1;
    });
    console.log('');
    console.log('Voice distribution across all blobs:');
    Object.entries(voiceDistribution).forEach(([voice, count]) => {
      console.log(`  ${voice}: ${count} blobs`);
    });

    // ── PLAY FIRST 5 BLOBS ──
    const testCount = Math.min(5, keys.length);
    console.log('');
    console.log(`Playing first ${testCount} blobs with 4-second gaps...`);
    console.log('Listen carefully and note if voice matches expectation!');
    console.log('');

    const testKeys = keys.slice(0, testCount);
    testKeys.forEach((segIdx, order) => {
      const entry = cache[segIdx];
      const seg = translatedTxRef.current[segIdx];

      if (entry?.url) {
        setTimeout(() => {
          console.log('');
          console.log(`▶️  PLAYING BLOB ${segIdx}:`);
          console.log(`   Text: "${(seg?.text || '').substring(0, 60)}"`);
          console.log(`   Expected Voice: ${DEFAULT_VOICE}`);
          console.log(`   Cached Voice: ${entry.voice || '(none)'}`);
          console.log(`   Duration: ${((seg?.end || 0) - (seg?.start || 0)).toFixed(1)}s`);
          console.log('');
          console.log(`   👂 LISTEN NOW - Should sound like ${DEFAULT_VOICE.toUpperCase()}`);

          const audio = new Audio(entry.url);
          audio.play().catch(e => console.error(`   ❌ Play failed for ${segIdx}:`, e));
          audio.onended = () => console.log(`   ✅ Blob ${segIdx} finished playing`);
          audio.onerror = (e) => console.error(`   ❌ Blob ${segIdx} playback error:`, e);
        }, order * 4000);
      } else {
        console.warn(`⚠️  Blob ${segIdx}: No URL — skipping playback`);
      }
    });

    // Summary after all blobs finish
    setTimeout(() => {
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('🧪 TEST COMPLETE');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
      console.log('Questions to answer:');
      console.log('1. Did each blob play with the expected voice?');
      console.log('2. Were there any blobs that played the WRONG voice?');
      console.log('3. Did any blob sound like it switched voices mid-playback?');
      console.log('');
      console.log('If blobs play CORRECT voices → Scheduler/playback bug');
      console.log('If blobs play WRONG voices   → Generation/storage bug');
      console.log('');
    }, testCount * 4000 + 2000);
  }, []);

  // Also expose on window for console access
  useEffect(() => {
    (window as any).testAudioBlobs = testAudioBlobs;
    return () => { delete (window as any).testAudioBlobs; };
  }, [testAudioBlobs]);

  // Register external handlers
  useEffect(() => {
    if (registerHandlers) {
      registerHandlers({
        play: () => handlePlay(),
        pause: () => handlePause(),
        isPlaying: () => isPlayingRef.current,
        testAudioBlobs,
        hasAudioBlobs: () => Object.keys(cacheRef.current).some(k => !!cacheRef.current[parseInt(k)]?.url),
      });
    }
  }, [registerHandlers, handlePlay, handlePause, testAudioBlobs]);


  /** Actually run the processing after session check passes */
  const runProcessing = useCallback(async (mode: OutputMode, lang: string) => {
    // Record session usage
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature: 'clarify_audio', videoId }),
    }).then(r => r.json()).then(data => {
      if (data.sessionsUsed !== undefined) {
        setSubStatus(prev => prev ? { ...prev, sessionsUsed: data.sessionsUsed, sessionsRemaining: Math.max(0, (prev.sessionsLimit) - data.sessionsUsed) } : prev);
      }
    }).catch(() => null);

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

      // Store translated buffer
      if (data.transcript?.length) {
        const transSegs: ClarifyTranscriptSegment[] = data.transcript.map((s: any, i: number) => ({
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
        setProcessingStage('Generating AI audio...');
        const segsForTTS = data.transcript || [];
        const batch = segsForTTS.slice(0, 8);
        await Promise.allSettled(batch.map((s: any, i: number) => generateSeg(i, s.text || '')));

        setProcessingStage('Ready! Scheduler mode - natural speed playback');
        setPhase('ready');
      } else {
        setPhase('ready');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      setPhase('error');
    }
  }, [videoId, onTranscriptReady, generateSeg]);

  /** User selects options from modal -> check session limits before processing */
  const handleSelectOption = useCallback((mode: OutputMode, lang: string) => {
    if (!subStatus || subStatus.plan === 'trial' || !subStatus.premiumAllowed) {
      // No status yet or trial — let it through (server will gate if truly expired)
      runProcessing(mode, lang);
      return;
    }
    if (subStatus.sessionBlocked) {
      pendingOptionRef.current = { mode, lang };
      setSessionPopup('limit');
      return;
    }
    if (subStatus.sessionWarning) {
      pendingOptionRef.current = { mode, lang };
      setSessionPopup('warning');
      return;
    }
    runProcessing(mode, lang);
  }, [subStatus, runProcessing]);

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

  // Tell the parent when a Clarify Audio session is underway, so the Scroll
  // Transcript bar (the only transcript with click-to-define word selection)
  // can switch from the source language to the translated language —
  // otherwise a non-source-language speaker has no way to know which words
  // to click once AI audio is playing English over their video.
  // Deliberately NOT just `isAiActive` (phase === 'playing'): users pause to
  // freeze the bar in place so they can click a word precisely, which would
  // otherwise flip the bar straight back to the source language at the exact
  // moment they need the translated one.
  const translationSessionActive = phase === 'playing' || phase === 'paused' || phase === 'buffering';
  useEffect(() => {
    if (onAiActiveChange) onAiActiveChange(translationSessionActive, selectedLang);
  }, [translationSessionActive, selectedLang, onAiActiveChange]);

  // ═══ RENDER ═══
  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>

      {/* ─── SESSION LIMIT POPUP ─── */}
      {sessionPopup === 'limit' && (
        <ClarificationLimitPopup
          type="limit"
          remainingMinutes={0}
          onStop={() => { setSessionPopup(null); pendingOptionRef.current = null; }}
          onBuyMore={() => router.push('/subscribe')}
        />
      )}

      {/* ─── SESSION WARNING POPUP ─── */}
      {sessionPopup === 'warning' && subStatus && (
        <ClarificationLimitPopup
          type="warning"
          remainingMinutes={subStatus.sessionsRemaining}
          onContinue={() => {
            setSessionPopup(null);
            const pending = pendingOptionRef.current;
            pendingOptionRef.current = null;
            if (pending) runProcessing(pending.mode, pending.lang);
          }}
          onStop={() => { setSessionPopup(null); pendingOptionRef.current = null; }}
        />
      )}

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
          {/sign in/i.test(error) && (
            <button
              onClick={() => router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`)}
              style={{
                width: '100%', padding: '10px', backgroundColor: '#16a34a', color: 'white',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
                marginBottom: '8px',
              }}>{'🔑'} Sign In</button>
          )}
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
          <div style={{ fontSize: '10px', color: '#60a5fa', textAlign: 'center', marginTop: '8px' }}>
            {'⏳'} Please be patient — even though computers are fast, the AI needs a couple of minutes to translate and generate speech.
          </div>
        </div>
      )}

      {/* ─── READY ─── */}
      {phase === 'ready' && !showOptionsOverlay && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#22c55e', marginBottom: '4px' }}>
              {'✅ Audio Ready'}
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

      {/* ─── BUFFERING ─── */}
      {phase === 'buffering' && !showOptionsOverlay && (
        <div>
          <div style={{
            padding: '12px', backgroundColor: 'rgba(96,165,250,0.15)', border: '1px solid #60a5fa',
            borderRadius: '8px', marginBottom: '10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#60a5fa', marginBottom: '6px' }}>
              ⏳ Filling audio buffer…
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
              {bufferStatus.ready} / {bufferStatus.threshold} segments ready
            </div>
            <div style={{
              height: '6px', backgroundColor: '#1e293b', borderRadius: '3px', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: '3px', backgroundColor: '#60a5fa',
                width: `${bufferStatus.threshold > 0 ? Math.min(100, (bufferStatus.ready / bufferStatus.threshold) * 100) : 0}%`,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <div style={{ fontSize: '10px', color: '#60a5fa', marginTop: '6px' }}>
              Playback will start automatically when buffer is full
            </div>
          </div>
          <button onClick={handleStop} style={{
            width: '100%', padding: '7px', backgroundColor: '#dc2626', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
          }}>⏹ Cancel</button>
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
