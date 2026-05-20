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
  const [phase, setPhase] = useState<'choosing' | 'processing' | 'active' | 'stopped' | 'error'>('choosing');
  const [selectedMode, setSelectedMode] = useState<OutputMode | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [error, setError] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [transcript, setTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [useClientTTS, setUseClientTTS] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState('');
  // Track whether we've muted YouTube so we can restore on stop
  const [youTubeMuted, setYouTubeMuted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<AudioCache>({});
  const currentPlayingIndexRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(0.8);
  const isMutedRef = useRef(false);
  const transcriptRef = useRef<ClarifyTranscriptSegment[]>([]);
  const generatingSetRef = useRef<Set<number>>(new Set());
  const phaseRef = useRef(phase);
  const onMuteYouTubeRef = useRef(onMuteYouTube);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { volumeRef.current = volume / 100; }, [volume]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { onMuteYouTubeRef.current = onMuteYouTube; }, [onMuteYouTube]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume / 100;
  }, [volume, isMuted]);

  // Find current segment based on video time
  useEffect(() => {
    if (transcript.length === 0) return;
    let idx = -1;
    for (let i = 0; i < transcript.length; i++) {
      if (currentTime >= transcript[i].start && (!transcript[i + 1] || currentTime < transcript[i + 1].start)) {
        idx = i; break;
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

  // ─── MUTE YOUTUBE ONLY WHEN AI AUDIO IS ACTIVELY PLAYING ───
  // This is the key fix: only mute/unmute based on isPlaying state, not on panel open
  useEffect(() => {
    const audioMode = selectedMode === 'audio_only' || selectedMode === 'audio_and_subtitles';
    if (!audioMode || phase !== 'active') {
      // Not in audio mode or not active → make sure YouTube is unmuted
      if (youTubeMuted && onMuteYouTube) {
        onMuteYouTube(false);
        setYouTubeMuted(false);
      }
      return;
    }
    if (isPlaying && !youTubeMuted) {
      // AI audio started playing → mute YouTube
      if (onMuteYouTube) onMuteYouTube(true);
      setYouTubeMuted(true);
    } else if (!isPlaying && youTubeMuted) {
      // AI audio paused/stopped → unmute YouTube
      if (onMuteYouTube) onMuteYouTube(false);
      setYouTubeMuted(false);
    }
  }, [isPlaying, phase, selectedMode, youTubeMuted, onMuteYouTube]);

  // ─── TTS Generation ───
  const generateSegmentAudio = useCallback(async (index: number, text: string): Promise<boolean> => {
    if (audioCacheRef.current[index]?.url || audioCacheRef.current[index]?.useClientTTS) return true;
    if (audioCacheRef.current[index]?.generating || generatingSetRef.current.has(index)) return false;

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
          videoId, segmentId: `seg_${index}`, speakerId: `speaker_${index % 3}`,
          targetDuration: seg ? (seg.end - seg.start) : undefined,
          targetLanguage: selectedLanguage, ttsModel: 'tts-1',
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
      audioCacheRef.current[index] = { url: URL.createObjectURL(blob) };
      setGeneratedCount(prev => prev + 1);
      generatingSetRef.current.delete(index);
      return true;
    } catch (err) {
      audioCacheRef.current[index] = { error: String(err), useClientTTS: true };
      setUseClientTTS(true);
      setGeneratedCount(prev => prev + 1);
      generatingSetRef.current.delete(index);
      return true;
    }
  }, [videoId, selectedLanguage]);

  // Pre-generate segments ahead
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
    setPlaybackStatus(`Seg ${index + 1}/${transcriptRef.current.length}`);

    if (cached?.url) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      const audio = new Audio(cached.url);
      audio.volume = isMutedRef.current ? 0 : volumeRef.current;
      audioRef.current = audio;
      audio.onended = () => { if (isPlayingRef.current && phaseRef.current === 'active') playSegment(index + 1); };
      audio.onerror = () => { if (isPlayingRef.current) playSegment(index + 1); };
      audio.play().catch(() => setPlaybackStatus('⚠️ Click page to enable audio'));
    } else if (cached?.useClientTTS) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(transcriptRef.current[index].text);
        u.lang = selectedLanguage === 'en' ? 'en-US' : selectedLanguage;
        u.volume = isMutedRef.current ? 0 : volumeRef.current;
        u.onend = () => { if (isPlayingRef.current && phaseRef.current === 'active') playSegment(index + 1); };
        u.onerror = () => { if (isPlayingRef.current) playSegment(index + 1); };
        window.speechSynthesis.speak(u);
      }
    } else {
      setPlaybackStatus(`Generating seg ${index + 1}...`);
      setTimeout(() => { if (isPlayingRef.current && phaseRef.current === 'active') playSegment(index); }, 500);
    }
  }, [selectedLanguage]);

  // Re-sync when user seeks video
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

    // NOTE: Do NOT mute YouTube here. It will be muted automatically
    // when isPlaying becomes true (via the useEffect above).

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
      if (!data.transcript || data.transcript.length === 0) throw new Error('No transcript segments found');

      const segments: ClarifyTranscriptSegment[] = data.transcript.map((seg: any, i: number) => ({
        text: seg.text || '', start: seg.start || 0,
        end: seg.end || (data.transcript[i + 1]?.start || (seg.start || 0) + 3),
      }));

      setTranscript(segments);
      setProcessingProgress(60);
      if (onTranscriptReady) onTranscriptReady(segments);

      if (outputMode !== 'subtitles_only') {
        setProcessingStep('🔊 Generating audio...');
        setProcessingProgress(80);
        await Promise.allSettled(segments.slice(0, 5).map((seg, i) => generateSegmentAudio(i, seg.text)));
        setProcessingStep('✅ Ready — AI audio will auto-play');
        setProcessingProgress(100);
        setPhase('active');

        // Auto-start TTS playback (this will trigger YouTube mute via the effect)
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
      setError(err instanceof Error ? err.message : 'Processing failed');
      setPhase('error');
    }
  }, [videoId, onTranscriptReady, generateSegmentAudio, playSegment]);

  const handleStop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; audioRef.current = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    Object.values(audioCacheRef.current).forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
    audioCacheRef.current = {};
    generatingSetRef.current.clear();
    setPhase('stopped');
    setTranscript([]);
    setIsPlaying(false); // This will trigger YouTube unmute via the effect
    setGeneratedCount(0);
    setCurrentSegmentIndex(-1);
    setPlaybackStatus('');
    setYouTubeMuted(false);
    // Explicitly unmute YouTube immediately on stop
    if (onMuteYouTube) onMuteYouTube(false);
    if (onTranscriptReady) onTranscriptReady([]);
  }, [onMuteYouTube, onTranscriptReady]);

  const handleRestart = useCallback(() => {
    handleStop();
    setError(null);
    setPhase('choosing');
  }, [handleStop]);

  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      Object.values(audioCacheRef.current).forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
      // Unmute YouTube on unmount
      if (onMuteYouTubeRef.current) onMuteYouTubeRef.current(false);
    };
  }, []);

  const audioMode = selectedMode === 'audio_only' || selectedMode === 'audio_and_subtitles';
  const subtitleMode = selectedMode === 'subtitles_only' || selectedMode === 'audio_and_subtitles';

  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>

      {phase === 'choosing' && (
        <ProcessingOptionsModal
          isOpen={true} onClose={() => setPhase('stopped')} onSelectOption={handleSelectOption}
          initialMode={selectedMode || undefined} initialLanguage={selectedLanguage}
        />
      )}

      {phase === 'stopped' && (
        <div>
          <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px', textAlign: 'center' }}>
            Clarify Audio is not active. YouTube audio is normal.
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

          {/* TTS status */}
          {audioMode && (
            <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '6px' }}>
              {useClientTTS ? '🌐 Browser TTS' : '🤖 OpenAI TTS'} · {generatedCount}/{transcript.length} generated
            </div>
          )}

          {/* AI Audio status — text only, NO confusing button */}
          {audioMode && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
              padding: '6px 8px', backgroundColor: isPlaying ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.1)',
              borderRadius: '6px', border: isPlaying ? '1px solid #22c55e' : '1px solid #4b5563',
            }}>
              <span style={{ fontSize: '12px' }}>{isPlaying ? '🔊' : '🔇'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: isPlaying ? '#22c55e' : '#9ca3af' }}>
                  AI Audio: {isPlaying ? 'Playing' : 'Paused'}
                </div>
                <div style={{ fontSize: '9px', color: '#6b7280' }}>
                  {isPlaying ? 'YouTube is muted while AI speaks' : 'YouTube audio is active'}
                </div>
              </div>
              {/* Volume slider for AI audio */}
              <button onClick={() => { setIsMuted(!isMuted); if (audioRef.current) audioRef.current.volume = !isMuted ? 0 : volume / 100; }}
                style={{ padding: '2px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'white' }}>
                {isMuted ? '🔇' : '🔊'}
              </button>
              <input type="range" min={0} max={100} value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setVolume(v);
                  if (v > 0 && isMuted) setIsMuted(false);
                  if (audioRef.current) audioRef.current.volume = v / 100;
                }}
                style={{ width: '50px', accentColor: '#3b82f6', height: '3px' }}
              />
            </div>
          )}

          {/* Status */}
          {audioMode && playbackStatus && (
            <div style={{ fontSize: '9px', color: '#6b7280', marginBottom: '6px' }}>{playbackStatus}</div>
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
