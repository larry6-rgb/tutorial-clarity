'use client';

import React, { useState, useMemo } from 'react';

/**
 * Detected speaker info from diarization.
 * Used by useAudioClarification to build the speaker list for voice assignment.
 */
export interface DetectedSpeaker {
  id: string;
  gender: 'male' | 'female' | 'neutral' | 'unknown';
  totalSpeakingTime: number;
  segmentCount: number;
}

/**
 * Maps a detected speaker to a chosen voice.
 */
export interface VoiceAssignment {
  speakerId: string;
  voiceId: string;
  voiceName: string;
}

// OpenAI TTS voices available for assignment
const AVAILABLE_VOICES = [
  { id: 'nova', name: 'Nova', gender: 'female', description: 'Warm & friendly female' },
  { id: 'shimmer', name: 'Shimmer', gender: 'female', description: 'Clear & expressive female' },
  { id: 'alloy', name: 'Alloy', gender: 'neutral', description: 'Balanced & versatile' },
  { id: 'echo', name: 'Echo', gender: 'male', description: 'Smooth & natural male' },
  { id: 'fable', name: 'Fable', gender: 'male', description: 'Storyteller male' },
  { id: 'onyx', name: 'Onyx', gender: 'male', description: 'Deep & authoritative male' },
];

interface SpeakerVoiceAssignmentProps {
  speakers: DetectedSpeaker[];
  onApply: (assignments: VoiceAssignment[]) => void;
  onUseAuto: () => void;
  existingAssignments?: VoiceAssignment[];
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function getSuggestedVoice(speaker: DetectedSpeaker, index: number): string {
  // Suggest based on gender, with round-robin for same-gender speakers
  const maleVoices = ['echo', 'fable', 'onyx'];
  const femaleVoices = ['nova', 'shimmer'];
  const neutralVoices = ['alloy'];

  if (speaker.gender === 'male') {
    return maleVoices[index % maleVoices.length];
  } else if (speaker.gender === 'female') {
    return femaleVoices[index % femaleVoices.length];
  } else {
    return neutralVoices[0];
  }
}

function formatSpeakerLabel(speakerId: string): string {
  // Convert speaker_0 → Speaker 1, speaker_1 → Speaker 2, etc.
  const match = speakerId.match(/(\d+)/);
  if (match) {
    return `Speaker ${parseInt(match[1]) + 1}`;
  }
  return speakerId;
}

const GENDER_ICONS: Record<string, string> = {
  male: '👨',
  female: '👩',
  neutral: '🧑',
  unknown: '🎤',
};

export default function SpeakerVoiceAssignment({
  speakers,
  onApply,
  onUseAuto,
  existingAssignments,
}: SpeakerVoiceAssignmentProps) {
  // Initialize voice selections from existing assignments or auto-suggest
  const [voiceSelections, setVoiceSelections] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    speakers.forEach((speaker, index) => {
      const existing = existingAssignments?.find(a => a.speakerId === speaker.id);
      initial[speaker.id] = existing?.voiceId || getSuggestedVoice(speaker, index);
    });
    return initial;
  });

  // Sort speakers by speaking time (most to least)
  const sortedSpeakers = useMemo(() => {
    return [...speakers].sort((a, b) => b.totalSpeakingTime - a.totalSpeakingTime);
  }, [speakers]);

  const handleVoiceChange = (speakerId: string, voiceId: string) => {
    setVoiceSelections(prev => ({ ...prev, [speakerId]: voiceId }));
  };

  const handleApply = () => {
    const assignments: VoiceAssignment[] = Object.entries(voiceSelections).map(([speakerId, voiceId]) => {
      const voice = AVAILABLE_VOICES.find(v => v.id === voiceId);
      return {
        speakerId,
        voiceId,
        voiceName: voice?.name || voiceId,
      };
    });
    onApply(assignments);
  };

  // Check if any two speakers share the same voice
  const hasDuplicates = useMemo(() => {
    const values = Object.values(voiceSelections);
    return new Set(values).size !== values.length;
  }, [voiceSelections]);

  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 animate-scale-in">
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-bold text-white">🎤 Assign Voices to Speakers</h2>
          <p className="text-xs text-gray-400 mt-1">
            {speakers.length} speaker{speakers.length !== 1 ? 's' : ''} detected. Choose a voice for each, or use auto-assignment.
          </p>
        </div>

        {/* Speaker List */}
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1 mb-5">
          {sortedSpeakers.map((speaker, index) => {
            const genderIcon = GENDER_ICONS[speaker.gender] || '🎤';
            const selectedVoice = AVAILABLE_VOICES.find(v => v.id === voiceSelections[speaker.id]);

            return (
              <div
                key={speaker.id}
                className="bg-gray-800/70 border border-gray-700 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{genderIcon}</span>
                    <div>
                      <span className="text-sm font-medium text-white">
                        {formatSpeakerLabel(speaker.id)}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">
                        {speaker.gender} · {formatTime(speaker.totalSpeakingTime)} · {speaker.segmentCount} segments
                      </span>
                    </div>
                  </div>
                </div>

                <select
                  value={voiceSelections[speaker.id] || ''}
                  onChange={(e) => handleVoiceChange(speaker.id, e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {AVAILABLE_VOICES.map(voice => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} — {voice.description}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {/* Duplicate warning */}
        {hasDuplicates && speakers.length > 1 && (
          <div className="mb-4 p-2 bg-yellow-900/30 border border-yellow-700 rounded-lg">
            <p className="text-xs text-yellow-300">
              ⚠️ Multiple speakers share the same voice. Consider assigning different voices for clarity.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onUseAuto}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-600 text-gray-300 text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            🤖 Auto-Assign
          </button>
          <button
            onClick={handleApply}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors shadow-lg"
          >
            ✓ Apply Voices
          </button>
        </div>
      </div>
    </div>
  );
}
