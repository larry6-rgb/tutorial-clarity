'use client';

import { useState, useEffect, useCallback } from 'react';
import ProcessingOptionsModal, { OutputMode } from '@/app/hooks/ProcessingOptionsModal';

interface ClarifyAudioPanelProps {
  videoId: string;
  currentTime: number;
  onSubtitleChange?: (subtitle: string | null) => void;
  onMuteYouTube?: (mute: boolean) => void;
}

/**
 * ClarifyAudioPanel — The entry point for the audio clarification feature.
 * 
 * Flow:
 * 1. Panel opens → ProcessingOptionsModal shown immediately
 * 2. User selects output mode + target language → clicks "Start Processing"
 * 3. Panel begins the clarification process via useClarifyAudio hook
 * 4. Shows progress, controls, subtitles during processing
 * 
 * The useClarifyAudio hook is only initialized AFTER the user confirms their options.
 */
export function ClarifyAudioPanel({ videoId, currentTime, onSubtitleChange, onMuteYouTube }: ClarifyAudioPanelProps) {
  // Phase: 'choosing' (modal open) → 'processing' (clarification active) → 'error'
  const [phase, setPhase] = useState<'choosing' | 'processing' | 'stopped' | 'error'>('choosing');
  const [selectedMode, setSelectedMode] = useState<OutputMode | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [error, setError] = useState<string | null>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('');

  // Audio state
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);

  // Notify parent of subtitle changes
  useEffect(() => {
    if (onSubtitleChange) {
      onSubtitleChange(currentSubtitle || null);
    }
  }, [currentSubtitle, onSubtitleChange]);

  // Find current subtitle based on currentTime
  useEffect(() => {
    if (transcript.length === 0) return;
    const seg = transcript.find((s, i) => {
      const next = transcript[i + 1];
      return currentTime >= s.start && (!next || currentTime < next.start);
    });
    setCurrentSubtitle(seg?.text || '');
  }, [currentTime, transcript]);

  // Handle user selecting options from the modal
  const handleSelectOption = useCallback(async (outputMode: OutputMode, langCode: string) => {
    console.log(`[ClarifyAudioPanel] User selected: mode=${outputMode}, lang=${langCode}`);
    setSelectedMode(outputMode);
    setSelectedLanguage(langCode);
    setPhase('processing');
    setError(null);
    setIsProcessing(true);
    setProcessingStep('📝 Transcribing speech to text...');
    setProcessingProgress(10);

    // Mute YouTube if we're doing audio output
    if (outputMode !== 'subtitles_only' && onMuteYouTube) {
      onMuteYouTube(true);
    }

    try {
      // Step 1: Fetch transcript via process-video
      setProcessingStep('📝 Transcribing speech to text...');
      setProcessingProgress(25);

      const response = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          option: 2,
          targetLanguage: langCode,
        }),
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
      setTranscript(data.transcript);
      setProcessingProgress(60);

      // Step 2: If audio mode, prepare TTS
      if (outputMode !== 'subtitles_only') {
        setProcessingStep('🔊 Preparing audio generation...');
        setProcessingProgress(70);
        // Audio generation happens on-demand per segment via multi-voice-tts
        // For now, mark as ready
        setProcessingStep('✅ Ready! Audio will generate as you play.');
        setProcessingProgress(100);
      } else {
        setProcessingStep('✅ Subtitles ready!');
        setProcessingProgress(100);
      }

      setIsProcessing(false);

    } catch (err) {
      console.error('[ClarifyAudioPanel] Processing error:', err);
      const message = err instanceof Error ? err.message : 'Processing failed';
      setError(message);
      setPhase('error');
      setIsProcessing(false);
    }
  }, [videoId, onMuteYouTube]);

  // Handle closing the modal without selecting
  const handleCloseModal = useCallback(() => {
    setPhase('stopped');
  }, []);

  // Handle stop
  const handleStop = useCallback(() => {
    setPhase('stopped');
    setTranscript([]);
    setCurrentSubtitle('');
    setIsProcessing(false);
    setProcessingProgress(0);
    if (onMuteYouTube) onMuteYouTube(false);
  }, [onMuteYouTube]);

  // Handle restart — show modal again
  const handleRestart = useCallback(() => {
    handleStop();
    setError(null);
    setPhase('choosing');
  }, [handleStop]);

  // ─── RENDER ───

  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>

      {/* Phase: Choosing — show ProcessingOptionsModal */}
      {phase === 'choosing' && (
        <ProcessingOptionsModal
          isOpen={true}
          onClose={handleCloseModal}
          onSelectOption={handleSelectOption}
        />
      )}

      {/* Phase: Stopped — show restart button */}
      {phase === 'stopped' && (
        <div>
          <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px', textAlign: 'center' }}>
            Clarify Audio is not active.
          </p>
          <button
            onClick={handleRestart}
            style={{
              width: '100%',
              padding: '10px 16px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold',
            }}
          >
            🎯 Choose Processing Options
          </button>
        </div>
      )}

      {/* Phase: Error — show error + retry */}
      {phase === 'error' && (
        <div>
          <div style={{
            padding: '8px',
            backgroundColor: 'rgba(220, 38, 38, 0.15)',
            border: '1px solid #dc2626',
            borderRadius: '6px',
            fontSize: '11px',
            color: '#fca5a5',
            marginBottom: '10px',
          }}>
            ❌ {error}
          </div>
          <button
            onClick={handleRestart}
            style={{
              width: '100%',
              padding: '10px 16px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold',
            }}
          >
            🔄 Try Again
          </button>
        </div>
      )}

      {/* Phase: Processing — show progress + controls */}
      {phase === 'processing' && (
        <div>
          {/* Mode indicator */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            padding: '6px 8px',
            backgroundColor: '#1e3a5f',
            borderRadius: '6px',
            fontSize: '11px',
          }}>
            <span>
              {selectedMode === 'subtitles_only' && '📝 Subtitles Only'}
              {selectedMode === 'audio_only' && '🔊 Audio Only'}
              {selectedMode === 'audio_and_subtitles' && '🎬 Audio + Subtitles'}
            </span>
            <span style={{ color: '#60a5fa' }}>
              {selectedLanguage.toUpperCase()}
            </span>
          </div>

          {/* Processing progress */}
          {isProcessing && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af', marginBottom: '3px' }}>
                <span>{processingStep}</span>
                <span>{Math.round(processingProgress)}%</span>
              </div>
              <div style={{ width: '100%', height: '6px', backgroundColor: '#374151', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  width: `${processingProgress}%`,
                  height: '100%',
                  backgroundColor: '#3b82f6',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

          {/* Transcript info */}
          {transcript.length > 0 && !isProcessing && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
              color: '#9ca3af',
              marginBottom: '8px',
            }}>
              <span>✅ {transcript.length} segments loaded</span>
              <span>{processingStep}</span>
            </div>
          )}

          {/* Current Subtitle Display */}
          {currentSubtitle && (selectedMode === 'subtitles_only' || selectedMode === 'audio_and_subtitles') && (
            <div style={{
              padding: '8px',
              backgroundColor: '#1f2937',
              borderRadius: '6px',
              fontSize: '12px',
              textAlign: 'center',
              color: '#e5e7eb',
              marginBottom: '8px',
              lineHeight: '1.4',
              border: '1px solid #374151',
            }}>
              {currentSubtitle}
            </div>
          )}

          {/* Audio Controls — only for audio modes */}
          {(selectedMode === 'audio_only' || selectedMode === 'audio_and_subtitles') && !isProcessing && transcript.length > 0 && (
            <div style={{ borderTop: '1px solid #374151', paddingTop: '8px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => setIsAudioPlaying(!isAudioPlaying)}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: '#374151',
                    color: 'white',
                    border: '1px solid #4b5563',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  {isAudioPlaying ? '⏸' : '▶️'}
                </button>

                <button
                  onClick={() => setIsMuted(!isMuted)}
                  style={{
                    padding: '4px 8px',
                    backgroundColor: 'transparent',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  {isMuted ? '🔇' : '🔊'}
                </button>

                <input
                  type="range"
                  min={0}
                  max={100}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setVolume(v);
                    if (v > 0 && isMuted) setIsMuted(false);
                  }}
                  style={{ flex: 1, accentColor: '#3b82f6' }}
                />
                <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '24px', textAlign: 'right' }}>
                  {isMuted ? 0 : volume}
                </span>
              </div>
            </div>
          )}

          {/* Stop / Change Options buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button
              onClick={handleStop}
              style={{
                flex: 1,
                padding: '8px 12px',
                backgroundColor: '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
            >
              ⏹ Stop
            </button>
            <button
              onClick={handleRestart}
              style={{
                flex: 1,
                padding: '8px 12px',
                backgroundColor: '#374151',
                color: 'white',
                border: '1px solid #4b5563',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              🔄 Options
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
