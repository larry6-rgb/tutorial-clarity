'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import ProcessingOptionsModal, { OutputMode } from '@/app/hooks/ProcessingOptionsModal';

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

interface AudioCache {
  [segmentIndex: number]: {
    url?: string;          // Object URL for OpenAI TTS audio
    useClientTTS?: boolean; // Use browser speechSynthesis instead
    generating?: boolean;
    error?: string;
  };
}

interface ClarifyAudioPanelProps {
  videoId: string;
  currentTime: number;
  onSubtitleChange?: (subtitle: string | null) => void;
  onMuteYouTube?: (mute: boolean) => void;
  onTranscriptReady?: (segments: TranscriptSegment[]) => void;
  onSegmentChange?: (index: number) => void;
  onPlaySegment?: (index: number) => void;
}

// Round-robin voices for variety
const VOICES = ['nova', 'echo', 'shimmer', 'fable', 'alloy', 'onyx'];

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ClarifyAudioPanel({ videoId, currentTime, onSubtitleChange, onMuteYouTube, onTranscriptReady, onSegmentChange, onPlaySegment }: ClarifyAudioPanelProps) {
  // Phase management
  const [phase, setPhase] = useState<'choosing' | 'processing' | 'active' | 'stopped' | 'error'>('choosing');
  const [selectedMode, setSelectedMode] = useState<OutputMode | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [error, setError] = useState<string | null>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);

  // Transcript
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);

  // Audio state
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [generatingCount, setGeneratingCount] = useState(0);
  const [useClientTTS, setUseClientTTS] = useState(false);

  // Refs for audio management
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<AudioCache>({});
  const currentPlayingIndexRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(0.8);
  const isMutedRef = useRef(false);
  const transcriptRef = useRef<TranscriptSegment[]>([]);
  const generatingSetRef = useRef<Set<number>>(new Set());
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { volumeRef.current = volume / 100; }, [volume]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

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
      const seg = transcript[i];
      const nextSeg = transcript[i + 1];
      if (currentTime >= seg.start && (!nextSeg || currentTime < nextSeg.start)) {
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

  // Auto-scroll transcript to current segment
  useEffect(() => {
    if (currentSegmentIndex < 0 || !transcriptScrollRef.current) return;
    const el = transcriptScrollRef.current.querySelector(`[data-clarify-idx="${currentSegmentIndex}"]`) as HTMLElement;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentSegmentIndex]);

  // ─── TTS Generation ───

  const generateSegmentAudio = useCallback(async (index: number, text: string) => {
    if (audioCacheRef.current[index]?.url || audioCacheRef.current[index]?.generating || audioCacheRef.current[index]?.useClientTTS) {
      return; // Already generated, generating, or using client TTS
    }
    if (generatingSetRef.current.has(index)) return;

    generatingSetRef.current.add(index);
    audioCacheRef.current[index] = { generating: true };
    setGeneratingCount(prev => prev + 1);

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
          setGeneratingCount(prev => Math.max(0, prev - 1));
          generatingSetRef.current.delete(index);
          return;
        }
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      audioCacheRef.current[index] = { url };
      setGeneratedCount(prev => prev + 1);
      setGeneratingCount(prev => Math.max(0, prev - 1));

    } catch (err) {
      console.error(`[ClarifyAudio] TTS error for segment ${index}:`, err);
      audioCacheRef.current[index] = { error: err instanceof Error ? err.message : 'TTS failed', useClientTTS: true };
      setUseClientTTS(true);
      setGeneratedCount(prev => prev + 1);
      setGeneratingCount(prev => Math.max(0, prev - 1));
    }

    generatingSetRef.current.delete(index);
  }, [videoId, selectedLanguage]);

  // Pre-generate audio for segments near current position
  useEffect(() => {
    if (phase !== 'active' || transcript.length === 0) return;
    if (selectedMode === 'subtitles_only') return;

    const LOOKAHEAD = 5; // Pre-generate 5 segments ahead
    const startIdx = Math.max(0, currentSegmentIndex);

    for (let i = startIdx; i < Math.min(startIdx + LOOKAHEAD, transcript.length); i++) {
      if (!audioCacheRef.current[i]) {
        generateSegmentAudio(i, transcript[i].text);
      }
    }
  }, [phase, currentSegmentIndex, transcript, selectedMode, generateSegmentAudio]);

  // ─── Audio Playback ───

  const playSegment = useCallback((index: number) => {
    if (index < 0 || index >= transcriptRef.current.length) return;

    const cached = audioCacheRef.current[index];

    if (cached?.url) {
      // Play OpenAI TTS audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(cached.url);
      audio.volume = isMutedRef.current ? 0 : volumeRef.current;
      audioRef.current = audio;
      currentPlayingIndexRef.current = index;

      audio.onended = () => {
        // Play next segment
        const nextIdx = index + 1;
        if (nextIdx < transcriptRef.current.length && isPlayingRef.current) {
          playSegment(nextIdx);
        }
      };

      audio.play().catch(err => {
        console.error('[ClarifyAudio] Play error:', err);
      });
    } else if (cached?.useClientTTS || useClientTTS) {
      // Use browser speechSynthesis
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(transcriptRef.current[index].text);
        utterance.lang = selectedLanguage === 'en' ? 'en-US' : selectedLanguage;
        utterance.rate = 1.0;
        utterance.volume = isMutedRef.current ? 0 : volumeRef.current;
        currentPlayingIndexRef.current = index;

        utterance.onend = () => {
          const nextIdx = index + 1;
          if (nextIdx < transcriptRef.current.length && isPlayingRef.current) {
            playSegment(nextIdx);
          }
        };

        window.speechSynthesis.speak(utterance);
      }
    } else {
      // Not yet generated — wait and retry
      console.log(`[ClarifyAudio] Segment ${index} not ready, waiting...`);
      setTimeout(() => {
        if (isPlayingRef.current) {
          playSegment(index);
        }
      }, 500);
    }
  }, [selectedLanguage, useClientTTS]);

  // Sync playback with video time — when user seeks, jump to correct segment
  useEffect(() => {
    if (!isPlaying || phase !== 'active') return;
    if (selectedMode === 'subtitles_only') return;

    // If the playing segment is way off from the video position, re-sync
    if (currentSegmentIndex >= 0 && Math.abs(currentPlayingIndexRef.current - currentSegmentIndex) > 2) {
      playSegment(currentSegmentIndex);
    }
  }, [currentSegmentIndex, isPlaying, phase, selectedMode, playSegment]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      // Pause
      if (audioRef.current) audioRef.current.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.pause();
      setIsPlaying(false);
    } else {
      // Play from current segment
      setIsPlaying(true);
      if ('speechSynthesis' in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else {
        const startIdx = currentSegmentIndex >= 0 ? currentSegmentIndex : 0;
        playSegment(startIdx);
      }
    }
  }, [isPlaying, currentSegmentIndex, playSegment]);

  // ─── Processing Flow ───

  const handleSelectOption = useCallback(async (outputMode: OutputMode, langCode: string) => {
    console.log(`[ClarifyAudioPanel] User selected: mode=${outputMode}, lang=${langCode}`);
    setSelectedMode(outputMode);
    setSelectedLanguage(langCode);
    setPhase('processing');
    setError(null);
    setIsProcessing(true);
    setProcessingStep('📝 Fetching transcript...');
    setProcessingProgress(10);
    audioCacheRef.current = {};
    generatingSetRef.current.clear();
    setGeneratedCount(0);
    setGeneratingCount(0);
    setUseClientTTS(false);

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

      // Normalize segments to have .end
      const segments: TranscriptSegment[] = data.transcript.map((seg: any, i: number) => {
        const start = seg.start || 0;
        const end = seg.end || (data.transcript[i + 1]?.start || start + 3);
        return { text: seg.text || '', start, end };
      });

      setTranscript(segments);
      setProcessingProgress(60);

      // Notify parent for horizontal transcript display
      if (onTranscriptReady) {
        onTranscriptReady(segments);
      }

      if (outputMode !== 'subtitles_only') {
        setProcessingStep('🔊 Starting audio generation...');
        setProcessingProgress(80);

        // Pre-generate first few segments immediately
        const INITIAL_BATCH = 5;
        const promises = segments.slice(0, INITIAL_BATCH).map((seg, i) =>
          generateSegmentAudio(i, seg.text)
        );
        await Promise.allSettled(promises);

        setProcessingStep('✅ Ready! Click ▶ to play.');
      } else {
        setProcessingStep('✅ Subtitles ready!');
      }

      setProcessingProgress(100);
      setIsProcessing(false);
      setPhase('active');

    } catch (err) {
      console.error('[ClarifyAudioPanel] Processing error:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
      setPhase('error');
      setIsProcessing(false);
    }
  }, [videoId, onMuteYouTube, onTranscriptReady, generateSegmentAudio]);

  const handleStop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    // Clean up object URLs
    Object.values(audioCacheRef.current).forEach(entry => {
      if (entry.url) URL.revokeObjectURL(entry.url);
    });
    audioCacheRef.current = {};
    generatingSetRef.current.clear();
    setPhase('stopped');
    setTranscript([]);
    setIsPlaying(false);
    setGeneratedCount(0);
    setGeneratingCount(0);
    setCurrentSegmentIndex(-1);
    if (onMuteYouTube) onMuteYouTube(false);
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
      if (audioRef.current) audioRef.current.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      Object.values(audioCacheRef.current).forEach(entry => {
        if (entry.url) URL.revokeObjectURL(entry.url);
      });
    };
  }, []);

  // ─── RENDER ───

  const audioMode = selectedMode === 'audio_only' || selectedMode === 'audio_and_subtitles';
  const subtitleMode = selectedMode === 'subtitles_only' || selectedMode === 'audio_and_subtitles';

  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>

      {/* Phase: Choosing */}
      {phase === 'choosing' && (
        <ProcessingOptionsModal
          isOpen={true}
          onClose={() => setPhase('stopped')}
          onSelectOption={handleSelectOption}
          initialMode={selectedMode || undefined}
          initialLanguage={selectedLanguage}
        />
      )}

      {/* Phase: Stopped */}
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

      {/* Phase: Error */}
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

      {/* Phase: Processing */}
      {phase === 'processing' && (
        <div>
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
        </div>
      )}

      {/* Phase: Active */}
      {phase === 'active' && (
        <div>
          {/* Mode + Language indicator */}
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

          {/* Audio generation status */}
          {audioMode && (
            <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {useClientTTS ? '🌐 Browser TTS' : '🤖 OpenAI TTS'}
                {' · '}
                {generatedCount}/{transcript.length} generated
              </span>
              {generatingCount > 0 && (
                <span style={{ color: '#60a5fa' }}>⏳ {generatingCount} generating...</span>
              )}
            </div>
          )}

          {/* Audio Controls */}
          {audioMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', padding: '6px 0' }}>
              <button onClick={handlePlayPause} style={{
                padding: '6px 14px', backgroundColor: isPlaying ? '#dc2626' : '#22c55e', color: 'white',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold',
                minWidth: '46px',
              }}>
                {isPlaying ? '⏸' : '▶'}
              </button>

              <button onClick={() => { setIsMuted(!isMuted); if (audioRef.current) audioRef.current.volume = !isMuted ? 0 : volume/100; }}
                style={{ padding: '4px 8px', backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer', fontSize: '16px' }}>
                {isMuted ? '🔇' : '🔊'}
              </button>

              <input type="range" min={0} max={100} value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setVolume(v);
                  if (v > 0 && isMuted) setIsMuted(false);
                  if (audioRef.current) audioRef.current.volume = v / 100;
                }}
                style={{ flex: 1, accentColor: '#3b82f6', height: '4px' }}
              />
              <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '28px', textAlign: 'right' }}>
                {isMuted ? 0 : volume}%
              </span>
            </div>
          )}

          {/* Current subtitle in sidebar */}
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

          {/* Transcript info (bar renders below video via onTranscriptReady) */}
          <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '8px', borderTop: '1px solid #374151', paddingTop: '6px' }}>
            📜 {transcript.length} segments
            {currentSegmentIndex >= 0 && (
              <span style={{ color: '#60a5fa', marginLeft: '8px' }}>
                #{currentSegmentIndex + 1}: [{formatTimestamp(transcript[currentSegmentIndex].start)}]
              </span>
            )}
            <br />
            <span style={{ fontSize: '9px', color: '#4b5563' }}>Transcript bar shown below video ↓</span>
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
