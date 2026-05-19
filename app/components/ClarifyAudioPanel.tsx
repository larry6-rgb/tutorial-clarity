'use client';

import { useState, useEffect } from 'react';
import { useClarifyAudio } from '@/app/hooks/useClarifyAudio';

interface ClarifyAudioPanelProps {
  videoId: string;
  currentTime: number;
  onSubtitleChange?: (subtitle: string | null) => void;
}

const LANGUAGES = [
  { code: 'en', label: '🇺🇸 English' },
  { code: 'es', label: '🇪🇸 Spanish' },
  { code: 'fr', label: '🇫🇷 French' },
  { code: 'de', label: '🇩🇪 German' },
  { code: 'it', label: '🇮🇹 Italian' },
  { code: 'pt', label: '🇧🇷 Portuguese' },
  { code: 'ja', label: '🇯🇵 Japanese' },
  { code: 'ko', label: '🇰🇷 Korean' },
  { code: 'zh', label: '🇨🇳 Chinese' },
];

export function ClarifyAudioPanel({ videoId, currentTime, onSubtitleChange }: ClarifyAudioPanelProps) {
  const [state, actions] = useClarifyAudio({ videoId });
  const [volume, setVolumeLocal] = useState(100);
  const [isMuted, setIsMutedLocal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');

  // Sync currentTime from parent into the hook
  useEffect(() => {
    if (state.isActive) {
      actions.updateTime(currentTime);
    }
  }, [currentTime, state.isActive, actions]);

  // Notify parent of subtitle changes
  useEffect(() => {
    if (onSubtitleChange) {
      onSubtitleChange(state.currentSubtitle || null);
    }
  }, [state.currentSubtitle, onSubtitleChange]);

  const handleStart = async () => {
    actions.setTargetLanguage(selectedLanguage);
    await actions.start(currentTime);
  };

  const handleStop = () => {
    actions.stop();
  };

  const handlePlayPause = () => {
    if (state.isAudioPlaying) {
      actions.pause();
    } else {
      actions.resume();
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolumeLocal(newVolume);
    actions.setAudioVolume(newVolume / 100);
    if (newVolume > 0 && isMuted) {
      setIsMutedLocal(false);
      actions.setAudioMuted(false);
    }
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMutedLocal(newMuted);
    actions.setAudioMuted(newMuted);
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value;
    setSelectedLanguage(lang);
    actions.setTargetLanguage(lang);
  };

  const bufferProgress = state.bufferStatus?.bufferedUntil || 0;
  const bufferHealth = state.bufferStatus?.bufferHealth || 0;

  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>
      {/* Language Selection — only when not active */}
      {!state.isActive && (
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
            Target Language
          </label>
          <select
            value={selectedLanguage}
            onChange={handleLanguageChange}
            style={{
              width: '100%',
              padding: '6px 8px',
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '5px',
              color: 'white',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Start/Stop Button */}
      {!state.isActive ? (
        <button
          onClick={handleStart}
          disabled={state.isProcessing}
          style={{
            width: '100%',
            padding: '8px 16px',
            backgroundColor: state.isProcessing ? '#374151' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: state.isProcessing ? 'wait' : 'pointer',
            fontSize: '13px',
            fontWeight: 'bold',
            opacity: state.isProcessing ? 0.7 : 1,
          }}
        >
          {state.isProcessing ? '⏳ Starting...' : '🚀 Start Clarification'}
        </button>
      ) : (
        <button
          onClick={handleStop}
          style={{
            width: '100%',
            padding: '8px 16px',
            backgroundColor: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 'bold',
          }}
        >
          ⏹ Stop Clarification
        </button>
      )}

      {/* Processing Status */}
      {state.isActive && (
        <div style={{ marginTop: '12px' }}>
          {/* Processing step indicator */}
          {state.isProcessing && state.currentStep && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af', marginBottom: '3px' }}>
                <span>{state.currentStep}</span>
                <span>{Math.round(state.processingProgress)}%</span>
              </div>
              <div style={{ width: '100%', height: '6px', backgroundColor: '#374151', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  width: `${state.processingProgress}%`,
                  height: '100%',
                  backgroundColor: '#3b82f6',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

          {/* Buffer Health */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', marginBottom: '6px' }}>
            <span style={{ color: '#9ca3af' }}>Buffer Health</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '60px', height: '5px', backgroundColor: '#374151', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  width: `${bufferHealth * 100}%`,
                  height: '100%',
                  backgroundColor: bufferHealth > 0.7 ? '#22c55e' : bufferHealth > 0.4 ? '#eab308' : '#ef4444',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <span style={{ color: '#9ca3af', minWidth: '30px', textAlign: 'right' }}>
                {Math.round(bufferHealth * 100)}%
              </span>
            </div>
          </div>

          {/* Audio Controls */}
          <div style={{ borderTop: '1px solid #374151', paddingTop: '8px', marginTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={handlePlayPause}
                disabled={state.isBuffering}
                style={{
                  padding: '4px 10px',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: '1px solid #4b5563',
                  borderRadius: '4px',
                  cursor: state.isBuffering ? 'wait' : 'pointer',
                  fontSize: '14px',
                  opacity: state.isBuffering ? 0.5 : 1,
                }}
              >
                {state.isAudioPlaying ? '⏸' : '▶️'}
              </button>

              <button
                onClick={handleMuteToggle}
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
                onChange={handleVolumeChange}
                style={{ flex: 1, accentColor: '#3b82f6' }}
              />
              <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '24px', textAlign: 'right' }}>
                {isMuted ? 0 : volume}
              </span>
            </div>
          </div>

          {/* Current Subtitle */}
          {state.currentSubtitle && (
            <div style={{
              marginTop: '8px',
              padding: '6px 8px',
              backgroundColor: '#1f2937',
              borderRadius: '4px',
              fontSize: '11px',
              textAlign: 'center',
              color: '#e5e7eb',
            }}>
              {state.currentSubtitle}
            </div>
          )}

          {/* Sync Info */}
          {state.syncState && (
            <div style={{
              marginTop: '6px',
              padding: '6px',
              backgroundColor: '#1f2937',
              borderRadius: '4px',
              fontSize: '10px',
              color: '#9ca3af',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Sync Offset</span>
                <span style={{ color: '#e5e7eb' }}>{state.syncState.currentOffset.toFixed(2)}s</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                <span>Sync Points</span>
                <span style={{ color: '#e5e7eb' }}>{state.syncState.syncPoints.length}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {state.error && (
        <div style={{
          marginTop: '8px',
          padding: '6px 8px',
          backgroundColor: 'rgba(220, 38, 38, 0.15)',
          border: '1px solid #dc2626',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#fca5a5',
        }}>
          ❌ {state.error}
        </div>
      )}
    </div>
  );
}
