
"use client";

import { useState } from 'react';
import { ChevronDown, ChevronUp, Menu, X } from 'lucide-react';
import { toast } from 'sonner';

interface ControlMenuProps {
  player: any;
  playbackRate: number;
  isMuted: boolean;
  onSpeedChange: (speed: number) => void;
  onMuteToggle: () => void;
}

export default function ControlMenu({
  player,
  playbackRate,
  isMuted,
  onSpeedChange,
  onMuteToggle
}: ControlMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setActiveSection(activeSection === section ? null : section);
  };

  const handleTutorialClick = () => {
    toast.info('📚 Tutorial feature coming soon!', {
      duration: 2000,
      position: 'bottom-center'
    });
  };

  return (
    <div className="fixed top-20 right-6 z-50">
      {/* Menu Toggle Button */}
      <button
        onClick={(e) => {
          (e.currentTarget as HTMLButtonElement).blur();
          setIsMenuOpen(!isMenuOpen);
        }}
        onKeyDown={(e) => {
          // Prevent spacebar from toggling menu - spacebar is for video control only
          if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            e.stopPropagation();
            console.log('🔴 Spacebar blocked on Menu button');
          }
        }}
        tabIndex={-1}
        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3 font-semibold text-lg transition-all hover:scale-105"
      >
        {isMenuOpen ? (
          <>
            <X className="w-6 h-6" />
            <span>Close Menu</span>
          </>
        ) : (
          <>
            <Menu className="w-6 h-6" />
            <span>Menu</span>
          </>
        )}
      </button>

      {/* Menu Panel */}
      {isMenuOpen && (
        <div className="mt-4 bg-gray-800 border-2 border-gray-700 rounded-lg shadow-2xl overflow-hidden w-96 max-h-[80vh] overflow-y-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
            <h2 className="text-xl font-bold text-white">Tutorial Clarity Controls</h2>
            <p className="text-sm text-blue-100 mt-1">Select a feature to use</p>
          </div>

          {/* Menu Items */}
          <div className="divide-y divide-gray-700">
            {/* Tutorial */}
            <div className="p-4 hover:bg-gray-700/50 transition-colors">
              <button
                onClick={(e) => {
                  (e.currentTarget as HTMLButtonElement).blur();
                  handleTutorialClick();
                }}
                className="w-full text-left flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📚</span>
                  <span className="text-white font-semibold">Tutorial</span>
                </div>
                <span className="text-xs bg-yellow-600 text-white px-2 py-1 rounded">Coming Soon</span>
              </button>
            </div>

            {/* Playback Speed */}
            <div className="p-4">
              <button
                onClick={(e) => {
                  (e.currentTarget as HTMLButtonElement).blur();
                  toggleSection('speed');
                }}
                className="w-full text-left flex items-center justify-between hover:bg-gray-700/50 rounded p-2 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎚️</span>
                  <span className="text-white font-semibold">Playback Speed</span>
                </div>
                {activeSection === 'speed' ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {activeSection === 'speed' && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                      <button
                        key={speed}
                        onClick={(e) => {
                          console.log('🔵🔵🔵 SPEED BUTTON CLICKED:', speed);
                          (e.currentTarget as HTMLButtonElement).blur();
                          console.log('🔵 About to call onSpeedChange with:', speed);
                          onSpeedChange(speed);
                          console.log('🔵 onSpeedChange called successfully');
                        }}
                        className={`px-3 py-2 rounded-lg font-semibold transition-all ${
                          playbackRate === speed
                            ? 'bg-blue-600 text-white shadow-lg scale-105'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                  <p className="text-sm text-gray-400 text-center">
                    Current: <span className="text-blue-400 font-semibold">{playbackRate}x</span>
                  </p>
                </div>
              )}
            </div>

            {/* Audio Control */}
            <div className="p-4">
              <button
                onClick={(e) => {
                  (e.currentTarget as HTMLButtonElement).blur();
                  toggleSection('audio');
                }}
                className="w-full text-left flex items-center justify-between hover:bg-gray-700/50 rounded p-2 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔊</span>
                  <span className="text-white font-semibold">Audio Control</span>
                </div>
                {activeSection === 'audio' ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {activeSection === 'audio' && (
                <div className="mt-4">
                  <button
                    onClick={(e) => {
                      console.log('🟢🟢🟢 MUTE BUTTON CLICKED');
                      (e.currentTarget as HTMLButtonElement).blur();
                      console.log('🟢 About to call onMuteToggle');
                      onMuteToggle();
                      console.log('🟢 onMuteToggle called successfully');
                    }}
                    className={`w-full px-4 py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-3 ${
                      isMuted
                        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        : 'bg-green-600 text-white hover:bg-green-700 shadow-lg'
                    }`}
                  >
                    {isMuted ? (
                      <>
                        <span className="text-2xl">🔇</span>
                        <span>Unmute</span>
                      </>
                    ) : (
                      <>
                        <span className="text-2xl">🔊</span>
                        <span>Mute</span>
                      </>
                    )}
                  </button>
                  <p className="text-sm text-gray-400 mt-2 text-center">
                    Status: <span className={`font-semibold ${isMuted ? 'text-gray-400' : 'text-green-400'}`}>
                      {isMuted ? 'Muted' : 'On'}
                    </span>
                  </p>
                </div>
              )}
            </div>

            {/* Keyboard Shortcuts Info */}
            <div className="border-t border-gray-700">
              <button
                onClick={() => toggleSection('shortcuts')}
                className="w-full p-4 bg-gray-900/50 hover:bg-gray-800/50 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">⌨️</span>
                  <span className="text-white font-semibold">Keyboard Shortcuts</span>
                </div>
                {activeSection === 'shortcuts' ? (
                  <ChevronUp className="text-gray-400" size={20} />
                ) : (
                  <ChevronDown className="text-gray-400" size={20} />
                )}
              </button>
              
              {activeSection === 'shortcuts' && (
                <div className="p-4 bg-gray-900/30 space-y-2 text-sm text-gray-400">
                  <div className="flex justify-between items-center">
                    <span>Play/Pause:</span>
                    <span className="bg-gray-700 px-2 py-1 rounded text-white font-mono">Spacebar</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Rewind 10 sec:</span>
                    <span className="bg-gray-700 px-2 py-1 rounded text-white font-mono">← Left</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Forward 10 sec:</span>
                    <span className="bg-gray-700 px-2 py-1 rounded text-white font-mono">→ Right</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Rewind 30 sec:</span>
                    <span className="bg-gray-700 px-2 py-1 rounded text-white font-mono">Shift+← Left</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Forward 30 sec:</span>
                    <span className="bg-gray-700 px-2 py-1 rounded text-white font-mono">Shift+→ Right</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Speed Up:</span>
                    <span className="bg-gray-700 px-2 py-1 rounded text-white font-mono">↑ Up</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Slow Down:</span>
                    <span className="bg-gray-700 px-2 py-1 rounded text-white font-mono">↓ Down</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
