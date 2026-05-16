// [v153] Tutorial Clarity — ClarifyAudioPanel — Sync Fix #3: Start from currentTime
// Install to: components/ClarifyAudioPanel.tsx
'use client';

import { useState } from 'react';
import { useClarifyAudio } from '@/hooks/useClarifyAudio';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Volume2, VolumeX, Play, Pause, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ClarifyAudioPanelProps {
  videoId: string;
  currentTime: number;
  onSubtitleChange?: (subtitle: string | null) => void;
}

export function ClarifyAudioPanel({ videoId, currentTime, onSubtitleChange }: ClarifyAudioPanelProps) {
  const [state, actions] = useClarifyAudio(videoId, currentTime);
  const [volume, setVolumeState] = useState(100);
  const [isMuted, setIsMutedState] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [isPlaying, setIsPlaying] = useState(false);

  // Notify parent of subtitle changes
  if (onSubtitleChange && state.currentSubtitle !== null) {
    onSubtitleChange(state.currentSubtitle);
  }

  // v153 FIX #3: Pass the CURRENT video time so TTS starts from where
  // the user is watching, not always from 0:00
  const handleStart = async () => {
    console.log(`[v153] ClarifyAudioPanel.handleStart() — starting from currentTime=${currentTime.toFixed(2)}s`);
    actions.setTargetLanguage(selectedLanguage);
    await actions.start(currentTime);
  };

  const handleStop = () => {
    actions.stop();
    setIsPlaying(false);
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      actions.pause();
      setIsPlaying(false);
    } else {
      actions.resume();
      setIsPlaying(true);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolumeState(newVolume);
    actions.setAudioVolume(newVolume / 100);
    if (newVolume > 0 && isMuted) {
      setIsMutedState(false);
      actions.setAudioMuted(false);
    }
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMutedState(newMuted);
    actions.setAudioMuted(newMuted);
  };

  const handleLanguageChange = (language: string) => {
    setSelectedLanguage(language);
    actions.setTargetLanguage(language);
  };

  // Calculate progress percentages
  const videoProgress = currentTime;
  const bufferProgress = (state.bufferStatus as any)?.bufferedUntil || 0;
  const bufferHealth = (state.bufferStatus as any)?.bufferHealth || 0;

  return (
    <div className="space-y-4 p-4 bg-gray-900 rounded-lg">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Clarify Audio</h3>
        
        {/* Language Selection */}
        {!state.isActive && (
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Target Language</label>
            <Select value={selectedLanguage} onValueChange={handleLanguageChange}>
              <SelectTrigger className="w-full bg-gray-800 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="de">German</SelectItem>
                <SelectItem value="it">Italian</SelectItem>
                <SelectItem value="pt">Portuguese</SelectItem>
                <SelectItem value="ja">Japanese</SelectItem>
                <SelectItem value="ko">Korean</SelectItem>
                <SelectItem value="zh">Chinese</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Start/Stop Button */}
        {!state.isActive ? (
          <Button 
            onClick={handleStart} 
            className="w-full"
            disabled={state.isProcessing}
          >
            {state.isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              'Start Clarification'
            )}
          </Button>
        ) : (
          <Button 
            onClick={handleStop} 
            variant="destructive"
            className="w-full"
          >
            Stop Clarification
          </Button>
        )}
      </div>

      {/* Processing Status */}
      {state.isActive && (
        <div className="space-y-3">
          {/* Processing Progress */}
          {state.isProcessing && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Processing</span>
                <span>{Math.round(state.processingProgress)}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${state.processingProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Dual Progress Bars */}
          <div className="space-y-2">
            {/* Video Progress Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Video Playback</span>
                <span>{Math.round(videoProgress)}s</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div 
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: `${Math.min(100, (videoProgress / 300) * 100)}%` }}
                />
              </div>
            </div>

            {/* Audio Buffer Progress Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Audio Buffer</span>
                <span>{Math.round(bufferProgress)}s</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div 
                  className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (bufferProgress / 300) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Buffer Health Indicator */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Buffer Health</span>
            <div className="flex items-center gap-2">
              <div className="w-20 bg-gray-800 rounded-full h-1.5">
                <div 
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    bufferHealth > 0.7 ? 'bg-green-500' :
                    bufferHealth > 0.4 ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${bufferHealth * 100}%` }}
                />
              </div>
              <span className="text-gray-400 w-10 text-right">
                {Math.round(bufferHealth * 100)}%
              </span>
            </div>
          </div>

          {/* Sync Status */}
          {state.syncState && (
            <div className="text-xs space-y-1 p-2 bg-gray-800 rounded">
              <div className="flex justify-between">
                <span className="text-gray-400">Sync Offset</span>
                <span className="text-white">{state.syncState.currentOffset.toFixed(2)}s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Sync Points</span>
                <span className="text-white">{state.syncState.syncPoints.length}</span>
              </div>
              {state.syncState.syncPoints.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Last Confidence</span>
                  <span className="text-white">
                    {Math.round(state.syncState.syncPoints[state.syncState.syncPoints.length - 1].confidence * 100)}%
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Audio Controls */}
          <div className="space-y-2 pt-2 border-t border-gray-800">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handlePlayPause}
                disabled={state.isBuffering}
                className="flex-shrink-0"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleMuteToggle}
                className="flex-shrink-0"
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>

              <Slider
                value={[isMuted ? 0 : volume]}
                onValueChange={handleVolumeChange}
                max={100}
                step={1}
                className="flex-1"
              />
              <span className="text-xs text-gray-400 w-8 text-right">
                {isMuted ? 0 : volume}
              </span>
            </div>
          </div>

          {/* Current Subtitle Display */}
          {state.currentSubtitle && (
            <div className="p-2 bg-gray-800 rounded text-xs text-white text-center">
              {state.currentSubtitle}
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {state.error && (
        <div className="p-2 bg-red-900/20 border border-red-500 rounded text-xs text-red-400">
          {state.error}
        </div>
      )}
    </div>
  );
}


export default ClarifyAudioPanel;
