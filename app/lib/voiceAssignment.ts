/**
 * Voice Assignment Module v75 - SYNCHRONIZED PACKAGE
 * 
 * v75 UPDATES:
 * - All console.log markers updated to [v75]
 * - Consistent with all other v68 files
 * - Maps speakers to appropriate TTS voices based on gender
 * - Ensures consistent voice assignment throughout a video
 * 
 * SYNCHRONIZED FILES (all must use v75):
 * - AudioClarification_v75.tsx
 * - useChunkedTranscription_v75.ts
 * - useAudioTranslation_v75.ts
 * - SpeakerVoiceAssignment_v75.tsx
 * - voiceAssignment_v75.ts (this file)
 */

import { Speaker } from './speakerDiarization';

export type VoiceProvider = 'openai' | 'elevenlabs' | 'browser';

export interface VoiceConfig {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'neutral';
  provider: VoiceProvider;
  style?: string;
}

const OPENAI_VOICES: VoiceConfig[] = [
  { id: 'nova', name: 'Nova', gender: 'female', provider: 'openai' },
  { id: 'shimmer', name: 'Shimmer', gender: 'female', provider: 'openai' },
  { id: 'alloy', name: 'Alloy', gender: 'neutral', provider: 'openai' },
  { id: 'echo', name: 'Echo', gender: 'male', provider: 'openai' },
  { id: 'fable', name: 'Fable', gender: 'male', provider: 'openai' },
  { id: 'onyx', name: 'Onyx', gender: 'male', provider: 'openai' },
];

const ELEVENLABS_VOICES: VoiceConfig[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', provider: 'elevenlabs' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'female', provider: 'elevenlabs' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female', provider: 'elevenlabs' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'female', provider: 'elevenlabs' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', provider: 'elevenlabs' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'male', provider: 'elevenlabs' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', provider: 'elevenlabs' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'neutral', provider: 'elevenlabs' },
];

const BROWSER_VOICES: VoiceConfig[] = [
  { id: 'browser-female-1', name: 'Browser Female', gender: 'female', provider: 'browser' },
  { id: 'browser-male-1', name: 'Browser Male', gender: 'male', provider: 'browser' },
  { id: 'browser-neutral', name: 'Browser Default', gender: 'neutral', provider: 'browser' },
];

export interface VoiceAssignment {
  speakerId: string;
  voice: VoiceConfig;
  speakerGender: string;
}

export interface VoiceAssignmentResult {
  assignments: Map<string, VoiceConfig>;
  primaryVoice: VoiceConfig;
}

export function getVoicesForProvider(provider: VoiceProvider): VoiceConfig[] {
  switch (provider) {
    case 'openai':
      return OPENAI_VOICES;
    case 'elevenlabs':
      return ELEVENLABS_VOICES;
    case 'browser':
      return BROWSER_VOICES;
    default:
      return OPENAI_VOICES;
  }
}

function selectVoiceForGender(
  gender: 'male' | 'female' | 'neutral' | 'unknown',
  voices: VoiceConfig[],
  usedVoices: Set<string>
): VoiceConfig {
  let candidates: VoiceConfig[];
  
  switch (gender) {
    case 'male':
      candidates = voices.filter(v => v.gender === 'male');
      break;
    case 'female':
      candidates = voices.filter(v => v.gender === 'female');
      break;
    default:
      candidates = voices.filter(v => v.gender === 'neutral');
      if (candidates.length === 0) {
        candidates = voices;
      }
  }
  
  if (candidates.length === 0) {
    candidates = voices;
  }
  
  const unusedCandidates = candidates.filter(v => !usedVoices.has(v.id));
  if (unusedCandidates.length > 0) {
    return unusedCandidates[0];
  }
  
  return candidates[0];
}

export function assignVoicesToSpeakers(
  speakers: Speaker[],
  provider: VoiceProvider = 'openai',
  existingAssignments?: Map<string, VoiceConfig>
): VoiceAssignmentResult {
  const voices = getVoicesForProvider(provider);
  const assignments = new Map<string, VoiceConfig>();
  const usedVoices = new Set<string>();
  
  if (existingAssignments && existingAssignments.size > 0) {
    for (const [speakerId, voice] of existingAssignments.entries()) {
      assignments.set(speakerId, voice);
      usedVoices.add(voice.id);
      console.log('[v75 voiceAssignment] Preserving existing:', speakerId, '->', voice.name);
    }
  }
  
  const sortedSpeakers = [...speakers].sort(
    (a, b) => b.total_speaking_time - a.total_speaking_time
  );
  
  for (const speaker of sortedSpeakers) {
    if (assignments.has(speaker.id)) {
      continue;
    }
    
    const voice = selectVoiceForGender(speaker.gender, voices, usedVoices);
    assignments.set(speaker.id, voice);
    usedVoices.add(voice.id);
    
    console.log('[v75 voiceAssignment] NEW:', speaker.id, '(' + speaker.gender + ') ->', voice.name);
  }
  
  const primaryVoice = sortedSpeakers.length > 0
    ? assignments.get(sortedSpeakers[0].id)!
    : voices[0];
  
  return { assignments, primaryVoice };
}

export function getVoiceForSpeaker(
  speakerId: string,
  assignments: Map<string, VoiceConfig>,
  defaultVoice?: VoiceConfig
): VoiceConfig {
  return assignments.get(speakerId) || defaultVoice || OPENAI_VOICES[0];
}

export function getTTSSettings(voice: VoiceConfig): Record<string, any> {
  switch (voice.provider) {
    case 'openai':
      return {
        model: 'tts-1-hd',
        voice: voice.id,
        speed: 0.95,
      };
      
    case 'elevenlabs':
      return {
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      };
      
    case 'browser':
      return {
        rate: 0.9,
        pitch: voice.gender === 'female' ? 1.1 : 0.9,
        volume: 1.0,
      };
      
    default:
      return {};
  }
}
