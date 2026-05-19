'use client';

import React, { useState } from 'react';

/**
 * Output mode determines what the clarification produces:
 * - 'subtitles_only': Only translated subtitles (no audio)
 * - 'audio_only': Only AI-generated audio (no subtitles overlay)
 * - 'audio_and_subtitles': Both AI audio and subtitles
 */
export type OutputMode = 'subtitles_only' | 'audio_only' | 'audio_and_subtitles';

// Common target languages for translation
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
  { code: 'ru', label: '🇷🇺 Russian' },
  { code: 'ar', label: '🇸🇦 Arabic' },
  { code: 'hi', label: '🇮🇳 Hindi' },
];

interface ProcessingOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOption: (outputMode: OutputMode, langCode: string) => void;
}

const OUTPUT_OPTIONS: { mode: OutputMode; icon: string; title: string; description: string }[] = [
  {
    mode: 'subtitles_only',
    icon: '📝',
    title: 'Subtitles Only',
    description: 'Translated subtitles overlaid on the video. Quick and lightweight.',
  },
  {
    mode: 'audio_only',
    icon: '🔊',
    title: 'Audio Only',
    description: 'AI-generated speech replaces original audio. Multiple voices for different speakers.',
  },
  {
    mode: 'audio_and_subtitles',
    icon: '🎬',
    title: 'Audio + Subtitles',
    description: 'Full experience — translated audio with matching subtitles. Most immersive.',
  },
];

export default function ProcessingOptionsModal({ isOpen, onClose, onSelectOption }: ProcessingOptionsModalProps) {
  const [selectedMode, setSelectedMode] = useState<OutputMode>('audio_and_subtitles');
  const [selectedLanguage, setSelectedLanguage] = useState('en');

  if (!isOpen) return null;

  const handleStart = () => {
    onSelectOption(selectedMode, selectedLanguage);
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">🎯 Processing Options</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Language Selection */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Target Language
          </label>
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        {/* Output Mode Selection */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Output Mode
          </label>
          <div className="space-y-2">
            {OUTPUT_OPTIONS.map(option => (
              <button
                key={option.mode}
                onClick={() => setSelectedMode(option.mode)}
                className={`
                  w-full text-left p-3 rounded-lg border transition-all duration-150
                  ${selectedMode === option.mode
                    ? 'bg-blue-900/40 border-blue-500 ring-1 ring-blue-500/50'
                    : 'bg-gray-800/50 border-gray-700 hover:border-gray-500'
                  }
                `}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{option.icon}</span>
                  <span className={`font-medium text-sm ${selectedMode === option.mode ? 'text-blue-300' : 'text-gray-200'}`}>
                    {option.title}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1 ml-7">{option.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-600 text-gray-300 text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors shadow-lg"
          >
            🚀 Start Processing
          </button>
        </div>
      </div>
    </div>
  );
}
