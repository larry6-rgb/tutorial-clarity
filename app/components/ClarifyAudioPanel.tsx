'use client';

/**
 * ClarifyAudioPanel — SIMPLE WORKFLOW
 * 
 * 1. choosing:    ProcessingOptionsModal (mode + language)
 * 2. processing:  Progress bar "Generating: 12/226 segments"
 * 3. ready:       Big green "▶ Play Clarified Audio" button
 * 4. playing:     "⏸ Pause" button + volume + segment info (YouTube is muted)
 * 5. paused:      "▶ Resume" button (YouTube is UNmuted)
 * 6. stopped:     Back to start
 * 
 * CRITICAL RULES:
 * - YouTube is NEVER muted except when user clicks Play/Resume
 * - YouTube is ALWAYS unmuted when user clicks Pause/Stop
 * - NO auto-play, NO auto-mute, NO useEffect-based muting
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
}

const VOICES = ['nova', 'echo', 'shimmer', 'fable', 'alloy', 'onyx'];

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ClarifyAudioPanel({
  videoId, currentTime, aiPlaybackSpeed = 1, onSubtitleChange, onMuteYouTube, onPlayYouTube, onTranscriptReady, onSegmentChange,
}: ClarifyAudioPanelProps) {

  // ═══ STATE ═══
  type Phase = 'choosing' | 'processing' | 'ready' | 'playing' | 'paused' | 'stopped' | 'error';
  const [phase, setPhase] = useState<Phase>('choosing');
  const [selectedMode, setSelectedMode] = useState<OutputMode | null>(null);
  const [selectedLang, setSelectedLang] = useState('en');
  const [error, setError] = useState('');

  const [transcript, setTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [currentSegIdx, setCurrentSegIdx] = useState(-1);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [useClientTTS, setUseClientTTS] = useState(false);

  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);

  // ═══ REFS ═══
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<AudioCache>({});
  const genSetRef = useRef<Set<number>>(new Set());
  const playingIdxRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const volRef = useRef(0.8);
  const mutedRef = useRef(false);
  const txRef = useRef<ClarifyTranscriptSegment[]>([]);

  const speedRef = useRef(1);

  // Keep refs synced
  useEffect(() => { volRef.current = volume / 100; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { txRef.current = transcript; }, [transcript]);
  useEffect(() => { speedRef.current = aiPlaybackSpeed; }, [aiPlaybackSpeed]);

  // Update audio element volume in real-time
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume / 100;
  }, [volume, isMuted]);

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

  // ═══ TTS GENERATION ═══
  const generateSeg = useCallback(async (i: number, text: string) => {
    if (cacheRef.current[i]?.url || cacheRef.current[i]?.useClientTTS || cacheRef.current[i]?.generating) return;
    if (genSetRef.current.has(i)) return;
    genSetRef.current.add(i);
    cacheRef.current[i] = { generating: true };

    try {
      const voice = VOICES[i % VOICES.length];
      const seg = txRef.current[i];
      const res = await fetch('/api/multi-voice-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, voice: { id: voice, name: voice, gender: 'neutral', provider: 'openai' },
          videoId, segmentId: `seg_${i}`, speakerId: `spk_${i % 3}`,
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
        cacheRef.current[i] = { url: blob.size > 0 ? URL.createObjectURL(blob) : undefined, useClientTTS: blob.size === 0 };
        if (blob.size === 0) setUseClientTTS(true);
      }
    } catch {
      cacheRef.current[i] = { useClientTTS: true };
      setUseClientTTS(true);
    }

    genSetRef.current.delete(i);
    setGeneratedCount(prev => prev + 1);
  }, [videoId, selectedLang]);

  // Pre-generate ahead of current position (only when playing)
  useEffect(() => {
    if (phase !== 'playing' || transcript.length === 0) return;
    const start = Math.max(0, currentSegIdx);
    for (let i = start; i < Math.min(start + 8, transcript.length); i++) {
      if (!cacheRef.current[i]) generateSeg(i, transcript[i].text);
    }
  }, [phase, currentSegIdx, transcript, generateSeg]);

  // ═══ AUDIO PLAYBACK ═══
  const playSeg = useCallback((i: number) => {
    if (i < 0 || i >= txRef.current.length) {
      // Finished all segments
      isPlayingRef.current = false;
      setPhase('paused');
      // UNMUTE YOUTUBE when AI audio finishes
      if (onMuteYouTube) onMuteYouTube(false);
      return;
    }

    playingIdxRef.current = i;
    const cached = cacheRef.current[i];

    if (cached?.url) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      const a = new Audio(cached.url);
      a.volume = mutedRef.current ? 0 : volRef.current;
      a.playbackRate = speedRef.current;
      audioRef.current = a;
      a.onended = () => { if (isPlayingRef.current) playSeg(i + 1); };
      a.onerror = () => { if (isPlayingRef.current) playSeg(i + 1); };
      a.play().catch(() => {});
    } else if (cached?.useClientTTS) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(txRef.current[i].text);
        u.lang = selectedLang === 'en' ? 'en-US' : selectedLang;
        u.volume = mutedRef.current ? 0 : volRef.current;
        u.rate = speedRef.current;
        u.onend = () => { if (isPlayingRef.current) playSeg(i + 1); };
        u.onerror = () => { if (isPlayingRef.current) playSeg(i + 1); };
        window.speechSynthesis.speak(u);
      }
    } else {
      // Not ready — wait and retry
      setTimeout(() => { if (isPlayingRef.current) playSeg(i); }, 400);
    }
  }, [selectedLang, onMuteYouTube]);

  // Re-sync when user seeks video far from current TTS
  useEffect(() => {
    if (phase !== 'playing') return;
    if (currentSegIdx >= 0 && Math.abs(playingIdxRef.current - currentSegIdx) > 2) {
      playSeg(currentSegIdx);
    }
  }, [currentSegIdx, phase, playSeg]);

  // ═══ USER ACTIONS ═══

  // Apply speed changes to currently playing audio in real-time
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = aiPlaybackSpeed;
  }, [aiPlaybackSpeed]);

  /** User clicks "▶ Play Clarified Audio" or "▶ Resume" */
  const handlePlay = useCallback(() => {
    // MUTE YOUTUBE — only here, on explicit user action
    if (onMuteYouTube) onMuteYouTube(true);
    // ALSO START the YouTube video so it plays alongside AI audio
    if (onPlayYouTube) onPlayYouTube();
    isPlayingRef.current = true;
    setPhase('playing');
    const startIdx = currentSegIdx >= 0 ? currentSegIdx : 0;
    playSeg(startIdx);
  }, [currentSegIdx, playSeg, onMuteYouTube, onPlayYouTube]);

  /** User clicks "⏸ Pause" */
  const handlePause = useCallback(() => {
    isPlayingRef.current = false;
    if (audioRef.current) audioRef.current.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.pause();
    setPhase('paused');
    // UNMUTE YOUTUBE — immediately on pause
    if (onMuteYouTube) onMuteYouTube(false);
  }, [onMuteYouTube]);

  /** User clicks "⏹ Stop" */
  const handleStop = useCallback(() => {
    isPlayingRef.current = false;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; audioRef.current = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    Object.values(cacheRef.current).forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
    cacheRef.current = {};
    genSetRef.current.clear();
    setTranscript([]);
    setGeneratedCount(0);
    setCurrentSegIdx(-1);
    setPhase('stopped');
    // UNMUTE YOUTUBE — immediately on stop
    if (onMuteYouTube) onMuteYouTube(false);
    if (onTranscriptReady) onTranscriptReady([]);
  }, [onMuteYouTube, onTranscriptReady]);

  /** User selects options from modal → start processing */
  const handleSelectOption = useCallback(async (mode: OutputMode, lang: string) => {
    setSelectedMode(mode);
    setSelectedLang(lang);
    setPhase('processing');
    setError('');
    cacheRef.current = {};
    genSetRef.current.clear();
    setGeneratedCount(0);
    setUseClientTTS(false);

    // NOTE: YouTube stays UNMUTED during processing. User hears normal video audio.

    try {
      const res = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, option: 2, targetLanguage: lang }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || `Failed (${res.status})`); }
      const data = await res.json();
      if (!data.transcript?.length) throw new Error('No transcript segments found');

      const segs: ClarifyTranscriptSegment[] = data.transcript.map((s: any, i: number) => ({
        text: s.text || '', start: s.start || 0,
        end: s.end || (data.transcript[i + 1]?.start || (s.start || 0) + 3),
      }));
      setTranscript(segs);
      txRef.current = segs;
      if (onTranscriptReady) onTranscriptReady(segs);

      if (mode !== 'subtitles_only') {
        // Generate first batch of audio segments
        const batch = segs.slice(0, 8);
        await Promise.allSettled(batch.map((s, i) => generateSeg(i, s.text)));
        setPhase('ready'); // Show "Play Clarified Audio" button
      } else {
        setPhase('ready');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      setPhase('error');
    }
  }, [videoId, onTranscriptReady, generateSeg]);

  const handleRestart = useCallback(() => {
    handleStop();
    setError('');
    setPhase('choosing');
  }, [handleStop]);

  // Cleanup on unmount — unmute YouTube
  useEffect(() => {
    const muteRef = onMuteYouTube;
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      Object.values(cacheRef.current).forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
      if (muteRef) muteRef(false);
    };
  }, [onMuteYouTube]);

  // ═══ COMPUTED ═══
  const audioMode = selectedMode === 'audio_only' || selectedMode === 'audio_and_subtitles';

  // ═══ RENDER ═══
  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>

      {/* ─── CHOOSING ─── */}
      {phase === 'choosing' && (
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
          }}>❌ {error}</div>
          <button onClick={handleRestart} style={{
            width: '100%', padding: '10px', backgroundColor: '#2563eb', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
          }}>🔄 Try Again</button>
        </div>
      )}

      {/* ─── PROCESSING ─── */}
      {phase === 'processing' && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#60a5fa', marginBottom: '8px', textAlign: 'center' }}>
            🔄 Processing Audio...
          </div>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ width: '100%', height: '8px', backgroundColor: '#374151', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                width: transcript.length > 0 ? `${Math.min(100, (generatedCount / transcript.length) * 100)}%` : '30%',
                height: '100%', backgroundColor: '#3b82f6', borderRadius: '4px',
                transition: 'width 0.3s ease',
                animation: transcript.length === 0 ? 'pulse 1.5s ease-in-out infinite' : undefined,
              }} />
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
            {transcript.length > 0
              ? `${generatedCount}/${transcript.length} segments generated`
              : 'Fetching transcript...'}
          </div>
        </div>
      )}

      {/* ─── READY (audio generated, waiting for user to click Play) ─── */}
      {phase === 'ready' && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#22c55e', marginBottom: '4px' }}>
              ✅ Audio Ready
            </div>
            <div style={{ fontSize: '10px', color: '#9ca3af' }}>
              {transcript.length} segments · {useClientTTS ? 'Browser voices' : 'OpenAI voices'} · {selectedLang.toUpperCase()}
            </div>
          </div>

          {audioMode && (
            <button onClick={handlePlay} style={{
              width: '100%', padding: '14px', backgroundColor: '#22c55e', color: 'white',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontSize: '16px', fontWeight: 'bold', marginBottom: '10px',
              boxShadow: '0 2px 8px rgba(34,197,94,0.3)',
            }}>
              ▶ Play Clarified Audio
            </button>
          )}

          {!audioMode && (
            <div style={{
              padding: '10px', backgroundColor: '#1e3a5f', borderRadius: '8px',
              textAlign: 'center', fontSize: '12px', marginBottom: '10px',
            }}>
              📝 Subtitles are active — see transcript bar below video
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleStop} style={{
              flex: 1, padding: '7px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
            }}>⏹ Stop</button>
            <button onClick={handleRestart} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>🔄 Options</button>
          </div>
        </div>
      )}

      {/* ─── PLAYING ─── */}
      {phase === 'playing' && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(34,197,94,0.15)', border: '1px solid #22c55e',
            borderRadius: '8px', marginBottom: '10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#22c55e', marginBottom: '2px' }}>
              🔊 Playing Clarified Audio
            </div>
            <div style={{ fontSize: '10px', color: '#86efac' }}>
              YouTube audio is muted · {generatedCount}/{transcript.length} generated
            </div>
          </div>

          <button onClick={handlePause} style={{
            width: '100%', padding: '12px', backgroundColor: '#f59e0b', color: 'white',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontWeight: 'bold', marginBottom: '8px',
          }}>
            ⏸ Pause
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
            }}>⏹ Stop</button>
            <button onClick={handleRestart} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>🔄 Options</button>
          </div>
        </div>
      )}

      {/* ─── PAUSED ─── */}
      {phase === 'paused' && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b',
            borderRadius: '8px', marginBottom: '10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#f59e0b', marginBottom: '2px' }}>
              ⏸ Audio Paused
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
            ▶ Resume Clarified Audio
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
            }}>⏹ Stop</button>
            <button onClick={handleRestart} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>🔄 Options</button>
          </div>
        </div>
      )}
    </div>
  );
}
