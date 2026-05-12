
"use client";

import { useState, useEffect, useRef } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  RotateCw, 
  Bookmark,
  Settings,
  Volume2,
  Maximize2,
  Minimize2,
  GripVertical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { YouTubePlayerState, ControlPanelPosition } from '@/lib/types';
import { formatTime } from '@/lib/youtube-utils';

interface ControlPanelProps {
  playerState: YouTubePlayerState;
  onPlayPause: () => void; // Combined play/pause function
  onSeek: (seconds: number) => void;
  onSpeedChange: (rate: number) => void;
  onBookmark: () => void;
  onSettings?: () => void;
  position?: ControlPanelPosition;
  onPositionChange?: (position: ControlPanelPosition) => void;
  className?: string;
}

const SPEED_OPTIONS = [
  { value: '0.25', label: '0.25x' },
  { value: '0.5', label: '0.5x' },
  { value: '0.75', label: '0.75x' },
  { value: '1', label: '1x' },
  { value: '1.25', label: '1.25x' },
  { value: '1.5', label: '1.5x' },
  { value: '1.75', label: '1.75x' },
  { value: '2', label: '2x' }
];

export default function ControlPanel({
  playerState,
  onPlayPause,
  onSeek,
  onSpeedChange,
  onBookmark,
  onSettings,
  position = { x: 20, y: 20 },
  onPositionChange,
  className = ""
}: ControlPanelProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragControls = useDragControls();

  const handlePlayPause = () => {
    onPlayPause();
  };

  const handleSeek = (value: number[]) => {
    const seconds = (value[0] / 100) * playerState.duration;
    onSeek(seconds);
  };

  const handleSpeedChange = (value: string) => {
    onSpeedChange(parseFloat(value));
  };

  const handleSkip = (seconds: number) => {
    const newTime = Math.max(0, Math.min(playerState.duration, playerState.currentTime + seconds));
    onSeek(newTime);
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const handleDragEnd = (event: any, info: any) => {
    setIsDragging(false);
    onPositionChange?.({
      x: position.x + info.offset.x,
      y: position.y + info.offset.y
    });
  };

  const progressPercentage = playerState.duration > 0 
    ? (playerState.currentTime / playerState.duration) * 100 
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg shadow-2xl ${className}`}
    >
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-medium">Tutorial Controls</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsMinimized(!isMinimized)}
            className="text-white/60 hover:text-white hover:bg-white/10 p-1 h-auto"
          >
            {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </Button>
        </div>

        {!isMinimized && (
          <>
            {/* Main controls */}
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={handlePlayPause}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {playerState.isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </Button>
              
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSkip(-10)}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <RotateCcw size={16} />
                10s
              </Button>
              
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSkip(10)}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <RotateCw size={16} />
                10s
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={onBookmark}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <Bookmark size={16} />
              </Button>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <Slider
                value={[progressPercentage]}
                onValueChange={handleSeek}
                max={100}
                step={0.1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-white/70">
                <span>{formatTime(playerState.currentTime)}</span>
                <span>{formatTime(playerState.duration)}</span>
              </div>
            </div>

            {/* Speed control */}
            <div className="flex items-center gap-3">
              <span className="text-white/70 text-sm">Speed:</span>
              <Select value={playerState.playbackRate.toString()} onValueChange={handleSpeedChange}>
                <SelectTrigger className="w-20 bg-white/10 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPEED_OPTIONS.map((speed) => (
                    <SelectItem key={speed.value} value={speed.value}>
                      {speed.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {onSettings && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onSettings}
                  className="border-white/20 text-white hover:bg-white/10 ml-auto"
                >
                  <Settings size={16} />
                </Button>
              )}
            </div>

            {/* Keyboard hints */}
            <div className="text-xs text-white/50 space-y-1 border-t border-white/10 pt-3">
              <div>Spacebar: Play/Pause</div>
              <div>← →: Skip 10s | ↑ ↓: Speed</div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
