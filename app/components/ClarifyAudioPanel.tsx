'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import ProcessingOptionsModal, { OutputMode } from '@/app/hooks/ProcessingOptionsModal';

export interface ClarifyTranscriptSegment {
  text: string;
  start: number;
  end: number;
}

interface AudioCache {
  [segmentIndex: number]: {
    url?: string;
    useClientTTS?: boolean;
    generating?: boolean;
    error?: string;
  };
}

interface ClarifyAudioPanelProps {
  videoId: string;
  currentTime: number;
  onSubtitleChange?: (subtitle: string | null) => void;
  onMuteYouTube?: (mute: boolean) => void;
  onTranscriptReady?: (segments: ClarifyTranscriptSegment[]) => void;
  onSegmentChange?: (index: number) => void;
}

const VOICES = ['nova', 'echo', 'shimmer', 'fable', 'alloy', 'onyx'];

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ClarifyAudioPanel({ videoId, currentTime, onSubtitleChange, onMuteYouTube, onTranscriptReady, onSegmentChange }: ClarifyAudioPanelProps) {
  // Phase management
  const [phase, setPhase] = useState<'choosing' | 'processing' | 'active' | 'stopped' | 'error'>('choosing');
  const [selectedMode, setSelectedMode] = useState<OutputMode | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [error, setError] = useState<string | null>(null);

  // Processing state
  const [processingStep, setProcessingStep] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);

  // Transcript
  const [transcript, setTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);

  // Audio state
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [useClientTTS, setUseClientTTS] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState('');

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<AudioCache>({});
  const currentPlayingIndexRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(0.8);
  const isMutedRef = useRef(false);
  const transcriptRef = useRef<ClarifyTranscriptSegment[]>([]);
  const generatingSetRef = useRef<Set<number>>(new Set());
  const phaseRef = useRef(phase);

  // Keep refs in sync
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { volumeRef.current = volume / 100; }, [volume]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Update audio element volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume / 100;
    }
  }, [volume, isMuted]);

  // Find current segment based on video time
  useEffect(() => {
    if (transcript.length === 0) return;
    let idx = -1;
    for (let i = 0; i < transcript.length; i++) {
      if (currentTime >= transcript[i].start && (!transcript[i + 1] || currentTime < transcript[i + 1].start)) {
        idx = i;
        break;
      }
    }
    if (idx !== currentSegmentIndex) {
      setCurrentSegmentIndex(idx);
      if (idx >= 0) {
        if (onSubtitleChange) onSubtitleChange(transcript[idx].text);
        if (onSegmentChange) onSegmentChange(idx);
      }
    }
  }, [currentTime, transcript, currentSegmentIndex, onSubtitleChange, onSegmentChange]);

  // ─── TTS Generation ───

  const generateSegmentAudio = useCallback(async (index: number, text: string): Promise<boolean> => {
    if (audioCacheRef.current[index]?.url || audioCacheRef.current[index]?.useClientTTS) return true;
    if (audioCacheRef.current[index]?.generating) return false;
    if (generatingSetRef.current.has(index)) return false;

    generatingSetRef.current.add(index);
    audioCacheRef.current[index] = { generating: true };

    try {
      const voiceId = VOICES[index % VOICES.length];
      const seg = transcriptRef.current[index];

      const response = await fetch('/api/multi-voice-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: { id: voiceId, name: voiceId, gender: 'neutral', provider: 'openai' },
          videoId,
          segmentId: `seg_${index}`,
          speakerId: `speaker_${index % 3}`,
          targetDuration: seg ? (seg.end - seg.start) : undefined,
          targetLanguage: selectedLanguage,
          ttsModel: 'tts-1',
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `TTS failed (${response.status})`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        if (data.useClientSideTTS) {
          audioCacheRef.current[index] = { useClientTTS: true };
          setUseClientTTS(true);
          setGeneratedCount(prev => prev + 1);
          generatingSetRef.current.delete(index);
          return true;
        }
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('Empty audio response');
      const url = URL.createObjectURL(blob);
      audioCacheRef.current[index] = { url };
      setGeneratedCount(prev => prev + 1);
      generatingSetRef.current.delete(index);
      return true;

    } catch (err) {
      console.error(`[ClarifyAudio] TTS error seg ${index}:`, err);
      audioCacheRef.current[index] = { error: String(err), useClientTTS: true };
      setUseClientTTS(true);
      setGeneratedCount(prev => prev + 1);
      generatingSetRef.current.delete(index);
      return true; // fallback available
    }
  }, [videoId, selectedLanguage]);

  // Pre-generate segments ahead of playback
  useEffect(() => {
    if (phase !== 'active' || transcript.length === 0 || selectedMode === 'subtitles_only') return;
    const startIdx = Math.max(0, currentSegmentIndex);
    for (let i = startIdx; i < Math.min(startIdx + 5, transcript.length); i++) {
      if (!audioCacheRef.current[i]) generateSegmentAudio(i, transcript[i].text);
    }
  }, [phase, currentSegmentIndex, transcript, selectedMode, generateSegmentAudio]);

  // ─── Audio Playback ───

  const playSegment = useCallback((index: number) => {
    if (index < 0 || index >= transcriptRef.current.length) {
      setIsPlaying(false);
      setPlaybackStatus('Finished');
      return;
    }

    const cached = audioCacheRef.current[index];
    currentPlayingIndexRef.current = index;
    setPlaybackStatus(`Playing seg ${index + 1}/${transcriptRef.current.length}`);

    if (cached?.url) {
      // OpenAI TTS audio
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      const audio = new Audio(cached.url);
      audio.volume = isMutedRef.current ? 0 : volumeRef.current;
      audioRef.current = audio;

      audio.onended = () => {
        if (isPlayingRef.current && phaseRef.current === 'active') {
          playSegment(index + 1);
        }
      };
      audio.onerror = (e) => {
        console.error('[ClarifyAudio] Audio element error:', e);
        // Try next segment
        if (isPlayingRef.current) playSegment(index + 1);
      };

      audio.play().then(() => {
        console.log(`[ClarifyAudio] ▶ Playing seg ${index} via OpenAI TTS`);
      }).catch(err => {
        console.error('[ClarifyAudio] Play blocked:', err);
        setPlaybackStatus('⚠️ Click page first (autoplay blocked)');
      });

    } else if (cached?.useClientTTS) {
      // Browser speechSynthesis
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(transcriptRef.current[index].text);
        utterance.lang = selectedLanguage === 'en' ? 'en-US' : selectedLanguage;
        utterance.rate = 1.0;
        utterance.volume = isMutedRef.current ? 0 : volumeRef.current;

        utterance.onend = () => {
          if (isPlayingRef.current && phaseRef.current === 'active') {
            playSegment(index + 1);
          }
        };
        utterance.onerror = () => {
          if (isPlayingRef.current) playSegment(index + 1);
        };

        window.speechSynthesis.speak(utterance);
        console.log(`[ClarifyAudio] ▶ Playing seg ${index} via Browser TTS`);
      }
    } else {
      // Not ready yet — wait and retry
      setPlaybackStatus(`Waiting for seg ${index + 1}...`);
      setTimeout(() => {
        if (isPlayingRef.current && phaseRef.current === 'active') playSegment(index);
      }, 500);
    }
  }, [selectedLanguage]);

  // Sync: when user seeks video far from current TTS position, re-sync
  useEffect(() => {
    if (!isPlaying || phase !== 'active' || selectedMode === 'subtitles_only') return;
    if (currentSegmentIndex >= 0 && Math.abs(currentPlayingIndexRef.current - currentSegmentIndex) > 2) {
      playSegment(currentSegmentIndex);
    }
  }, [currentSegmentIndex, isPlaying, phase, selectedMode, playSegment]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      if (audioRef.current) audioRef.current.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.pause();
      setIsPlaying(false);
      setPlaybackStatus('Paused');
    } else {
      setIsPlaying(true);
      if ('speechSynthesis' in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else {
        playSegment(currentSegmentIndex >= 0 ? currentSegmentIndex : 0);
      }
    }
  }, [isPlaying, currentSegmentIndex, playSegment]);

  // ─── Processing Flow ───

  const handleSelectOption = useCallback(async (outputMode: OutputMode, langCode: string) => {
    console.log(`[ClarifyAudioPanel] Selected: mode=${outputMode}, lang=${langCode}`);
    setSelectedMode(outputMode);
    setSelectedLanguage(langCode);
    setPhase('processing');
    setError(null);
    setProcessingStep('📝 Fetching transcript...');
    setProcessingProgress(10);
    audioCacheRef.current = {};
    generatingSetRef.current.clear();
    setGeneratedCount(0);
    setUseClientTTS(false);
    setPlaybackStatus('');

    // Mute YouTube when we'll play our own audio
    if (outputMode !== 'subtitles_only' && onMuteYouTube) {
      onMuteYouTube(true);
    }

    try {
      setProcessingProgress(25);
      const response = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, option: 2, targetLanguage: langCode }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Processing failed (${response.status})`);
      }

      const data = await response.json();
      if (!data.transcript || data.transcript.length === 0) {
        throw new Error('No transcript segments found for this video');
      }

      console.log(`[ClarifyAudioPanel] ✓ Got ${data.transcript.length} transcript segments`);

      const segments: ClarifyTranscriptSegment[] = data.transcript.map((seg: any, i: number) => ({
        text: seg.text || '',
        start: seg.start || 0,
        end: seg.end || (data.transcript[i + 1]?.start || (seg.start || 0) + 3),
      }));

      setTranscript(segments);
      setProcessingProgress(60);
      if (onTranscriptReady) onTranscriptReady(segments);

      if (outputMode !== 'subtitles_only') {
        setProcessingStep('🔊 Generating audio...');
        setProcessingProgress(80);

        // Generate first batch
        const batch = segments.slice(0, 5);
        await Promise.allSettled(batch.map((seg, i) => generateSegmentAudio(i, seg.text)));

        setProcessingStep('✅ Ready — audio will play automatically');
        setProcessingProgress(100);
        setPhase('active');

        // AUTO-START playback after a tiny delay for state to settle
        setTimeout(() => {
          if (phaseRef.current === 'active') {
            setIsPlaying(true);
            isPlayingRef.current = true;
            playSegment(0);
          }
        }, 300);

      } else {
        setProcessingStep('✅ Subtitles ready!');
        setProcessingProgress(100);
        setPhase('active');
      }

    } catch (err) {
      console.error('[ClarifyAudioPanel] Processing error:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
      setPhase('error');
    }
  }, [videoId, onMuteYouTube, onTranscriptReady, generateSegmentAudio, playSegment]);

  const handleStop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; audioRef.current = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    Object.values(audioCacheRef.current).forEach(entry => { if (entry.url) URL.revokeObjectURL(entry.url); });
    audioCacheRef.current = {};
    generatingSetRef.current.clear();
    setPhase('stopped');
    setTranscript([]);
    setIsPlaying(false);
    setGeneratedCount(0);
    setCurrentSegmentIndex(-1);
    setPlaybackStatus('');
    if (onMuteYouTube) onMuteYouTube(false); // Unmute YouTube
    if (onTranscriptReady) onTranscriptReady([]);
  }, [onMuteYouTube, onTranscriptReady]);

  const handleRestart = useCallback(() => {
    handleStop();
    setError(null);
    setPhase('choosing');
  }, [handleStop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      Object.values(audioCacheRef.current).forEach(entry => { if (entry.url) URL.revokeObjectURL(entry.url); });
    };
  }, []);

  // ─── RENDER ───

  const audioMode = selectedMode === 'audio_only' || selectedMode === 'audio_and_subtitles';
  const subtitleMode = selectedMode === 'subtitles_only' || selectedMode === 'audio_and_subtitles';

  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>

      {phase === 'choosing' && (
        <ProcessingOptionsModal
          isOpen={true}
          onClose={() => setPhase('stopped')}
          onSelectOption={handleSelectOption}
          initialMode={selectedMode || undefined}
          initialLanguage={selectedLanguage}
        />
      )}

      {phase === 'stopped' && (
        <div>
          <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px', textAlign: 'center' }}>
            Clarify Audio is not active.
          </p>
          <button onClick={handleRestart} style={{
            width: '100%', padding: '10px 16px', backgroundColor: '#2563eb', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
          }}>
            🎯 Choose Processing Options
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(220,38,38,0.15)', border: '1px solid #dc2626',
            borderRadius: '6px', fontSize: '11px', color: '#fca5a5', marginBottom: '10px',
          }}>
            ❌ {error}
          </div>
          <button onClick={handleRestart} style={{
            width: '100%', padding: '10px 16px', backgroundColor: '#2563eb', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
          }}>
            🔄 Try Again
          </button>
        </div>
      )}

      {phase === 'processing' && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af', marginBottom: '3px' }}>
            <span>{processingStep}</span>
            <span>{Math.round(processingProgress)}%</span>
          </div>
          <div style={{ width: '100%', height: '6px', backgroundColor: '#374151', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${processingProgress}%`, height: '100%', backgroundColor: '#3b82f6',
              borderRadius: '3px', transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
      )}

      {phase === 'active' && (
        <div>
          {/* Mode indicator */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '8px', padding: '6px 8px', backgroundColor: '#1e3a5f', borderRadius: '6px', fontSize: '11px',
          }}>
            <span>
              {selectedMode === 'subtitles_only' && '📝 Subtitles'}
              {selectedMode === 'audio_only' && '🔊 Audio'}
              {selectedMode === 'audio_and_subtitles' && '🎬 Audio + Subs'}
            </span>
            <span style={{ color: '#60a5fa' }}>{selectedLanguage.toUpperCase()}</span>
          </div>

          {/* TTS status + generation count */}
          {audioMode && (
            <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '6px' }}>
              <span>{useClientTTS ? '🌐 Browser TTS' : '🤖 OpenAI TTS'} · {generatedCount}/{transcript.length}</span>
            </div>
          )}

          {/* Volume control — simple, no confusing play button */}
          {audioMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: isPlaying ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                {isPlaying ? '▶ Playing' : '⏸ Paused'}
              </span>
              <button
                onClick={togglePlayPause}
                style={{
                  padding: '3px 10px', fontSize: '10px', fontWeight: 'bold',
                  backgroundColor: isPlaying ? '#374151' : '#2563eb', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                }}
              >
                {isPlaying ? 'Pause' : 'Resume'}
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={() => { setIsMuted(!isMuted); if (audioRef.current) audioRef.current.volume = !isMuted ? 0 : volume / 100; }}
                style={{ padding: '2px 6px', backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
                {isMuted ? '🔇' : '🔊'}
              </button>
              <input type="range" min={0} max={100} value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setVolume(v);
                  if (v > 0 && isMuted) setIsMuted(false);
                  if (audioRef.current) audioRef.current.volume = v / 100;
                }}
                style={{ width: '60px', accentColor: '#3b82f6', height: '4px' }}
              />
            </div>
          )}

          {/* Playback status line */}
          {audioMode && playbackStatus && (
            <div style={{ fontSize: '9px', color: '#6b7280', marginBottom: '6px' }}>
              {playbackStatus}
            </div>
          )}

          {/* Current subtitle */}
          {subtitleMode && currentSegmentIndex >= 0 && transcript[currentSegmentIndex] && (
            <div style={{
              padding: '8px', backgroundColor: '#1f2937', borderRadius: '6px', fontSize: '12px',
              textAlign: 'center', color: '#e5e7eb', marginBottom: '8px', lineHeight: '1.4', border: '1px solid #374151',
            }}>
              <span style={{ fontSize: '10px', color: '#60a5fa', marginRight: '6px' }}>
                [{formatTimestamp(transcript[currentSegmentIndex].start)}]
              </span>
              {transcript[currentSegmentIndex].text}
            </div>
          )}

          {/* Segment info */}
          <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '8px', borderTop: '1px solid #374151', paddingTop: '6px' }}>
            📜 {transcript.length} segments
            {currentSegmentIndex >= 0 && (
              <span style={{ color: '#60a5fa', marginLeft: '8px' }}>
                #{currentSegmentIndex + 1} [{formatTimestamp(transcript[currentSegmentIndex].start)}]
              </span>
            )}
          </div>

          {/* Stop / Options */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleStop} style={{
              flex: 1, padding: '7px 12px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
            }}>
              ⏹ Stop
            </button>
            <button onClick={handleRestart} style={{
              flex: 1, padding: '7px 12px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>
              🔄 Options
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
