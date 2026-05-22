'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ProcessingOptionsModal, { OutputMode } from './ProcessingOptionsModal';
import { useChunkedTranscription, TranscriptSegment, SpeakerInfo } from '../hooks/useChunkedTranscription';
import { useNotifications } from '../hooks/useNotifications';
import NotificationContainer from './NotificationContainer';
import { useAudioTranslation } from '../hooks/useAudioTranslation';
import SpeakerVoiceAssignment, { DetectedSpeaker, VoiceAssignment } from './SpeakerVoiceAssignment';

/**
 * AudioClarification v129 - Update Badge to HOOK v96
 * 
 * v129 CHANGES from v128:
 * 
 * 1. UPDATED: Visible RED badge now shows "HOOK v96" (was "HOOK v95").
 *    Confirms the stale-closure-fixed hook is deployed and running.
 * 
 * 2. All console logs updated from [v128] to [v129].
 * 
 * INHERITED from v128:
 * - Visible RED version indicator badge (fixed position, high z-index)
 * 
 * INHERITED from v127:
 * - Fix Button Visibility (chicken-and-egg deadlock fix)
 * - "Start Watching" button appears immediately when audio is enabled
 * - All v92+ hook compatibility (strict playbackAllowed gate)
 * - safePlayAtTime defense-in-depth wrapper
 * - guardedPlayAtTime with userInitiatedProcessingRef check
 * - resumeAudio guard
 * - Emergency Stop button
 * - Text-length-based segment timing adaptation
 * - Gap/overlap coverage analysis
 * - Duration matching summary logging
 * 
 * HOOK COMPATIBILITY: useAudioTranslation v96 (stale closure fix + timeupdate backup)
 * 
 * SYNCHRONIZED FILES (v129 package):
 * - AudioClarification_v129.tsx (this file)
 * - useAudioTranslation_v96.ts (stale closure fix + timeupdate backup)
 * - useChunkedTranscription_v75.ts (unchanged)
 * - ProcessingOptionsModal_v75.tsx (unchanged)
 * - SpeakerVoiceAssignment_v75.tsx (unchanged)
 * - voiceAssignment_v75.ts (unchanged)
 * - multi-voice-tts_route_v75.ts (unchanged)
 * - page_v77.tsx (unchanged)
 * 
 * USAGE:
 * - Use with useAudioTranslation_v96.ts (stale closure fix + timeupdate backup)
 * - Click "Start Watching" to begin (triggers setPlaybackAllowed(true))
 * - Press spacebar to pause/resume
 * - Click "🛑 STOP ALL" for emergency stop (triggers setPlaybackAllowed(false))
 * - Look for RED "HOOK v96" badge to confirm correct version is running
 */

// Voice pool for diverse assignment (matches OpenAI TTS voices)
const VOICE_POOL = [
  { id: 'nova', name: 'Nova', gender: 'female' },
  { id: 'echo', name: 'Echo', gender: 'male' },
  { id: 'shimmer', name: 'Shimmer', gender: 'female' },
  { id: 'fable', name: 'Fable', gender: 'male' },
  { id: 'onyx', name: 'Onyx', gender: 'male' },
  { id: 'alloy', name: 'Alloy', gender: 'neutral' },
];

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish (Español)' },
  { code: 'fr', name: 'French (Français)' },
  { code: 'de', name: 'German (Deutsch)' },
  { code: 'it', name: 'Italian (Italiano)' },
  { code: 'pt', name: 'Portuguese (Português)' },
  { code: 'zh', name: 'Chinese (中文)' },
  { code: 'ja', name: 'Japanese (日本語)' },
  { code: 'ko', name: 'Korean (한국어)' },
  { code: 'ru', name: 'Russian (Русский)' },
  { code: 'ar', name: 'Arabic (العربية)' },
  { code: 'hi', name: 'Hindi (हिंदी)' },
  { code: 'vi', name: 'Vietnamese (Tiếng Việt)' }
];

interface AudioClarificationProps {
  videoId: string;
  currentTime: number;
  duration?: number;
  isPlaying?: boolean;
  onSubtitleChange: (subtitle: string) => void;
  onPauseVideo: () => void;
  onResumeVideo: () => void;
  onSeekVideo?: (time: number) => void;
  onMuteYouTube?: () => void;
  onUnmuteYouTube?: () => void;
}

// Phrase unit for display
interface PhraseUnit {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  displayEnd: number;
  words: WordTiming[];
  sentenceIndex: number;
  speakerId?: string;
  speakerGender?: string;
}

interface WordTiming {
  word: string;
  startTime: number;
  endTime: number;
}

// === HELPER FUNCTIONS ===

function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSpeakerLabel(speakerId: string | undefined, format: 'full' | 'short' = 'full'): string {
  if (!speakerId) return 'Unknown';
  const num = parseInt(speakerId.replace('SPEAKER_', ''), 10);
  if (isNaN(num)) return speakerId;
  const humanNumber = num + 1;
  return format === 'short' ? `S${humanNumber}` : `Speaker ${humanNumber}`;
}

function parseTimeInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length === 2) {
      const mins = parseInt(parts[0], 10);
      const secs = parseInt(parts[1], 10);
      if (!isNaN(mins) && !isNaN(secs) && mins >= 0 && secs >= 0 && secs < 60) {
        return mins * 60 + secs;
      }
    }
    return null;
  }
  
  const num = parseFloat(trimmed);
  return isNaN(num) || num < 0 ? null : num;
}

function splitIntoSentences(text: string): string[] {
  const sentences = text
    .replace(/([.!?])\s+/g, '$1|SPLIT|')
    .split('|SPLIT|')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  if (sentences.length === 0) return [text.trim()];
  
  const merged: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length < 20 && merged.length > 0) {
      merged[merged.length - 1] += ' ' + sentence;
    } else {
      merged.push(sentence);
    }
  }
  
  return merged.length > 0 ? merged : [text.trim()];
}

function splitIntoPhrases(sentence: string): string[] {
  const breakPatterns = [
    /,\s+/,
    /\s+(and|but|or|so|yet)\s+/i,
    /\s+(because|although|if|when|while|since|unless|after|before|that|which|who)\s+/i,
  ];
  
  let phrases: string[] = [sentence];
  
  for (const pattern of breakPatterns) {
    const newPhrases: string[] = [];
    
    for (const phrase of phrases) {
      const words = phrase.split(/\s+/).filter(w => w.length > 0);
      
      if (words.length > 8) {
        const parts = phrase.split(pattern);
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.length > 0) newPhrases.push(trimmed);
        }
      } else {
        newPhrases.push(phrase);
      }
    }
    
    phrases = newPhrases;
  }
  
  const finalPhrases: string[] = [];
  const TARGET_WORDS = 6;
  const MIN_WORDS = 3;
  
  for (const phrase of phrases) {
    const words = phrase.split(/\s+/).filter(w => w.length > 0);
    
    if (words.length <= 8) {
      finalPhrases.push(phrase);
    } else {
      for (let i = 0; i < words.length; i += TARGET_WORDS) {
        const chunk = words.slice(i, i + TARGET_WORDS);
        if (chunk.length < MIN_WORDS && finalPhrases.length > 0) {
          finalPhrases[finalPhrases.length - 1] += ' ' + chunk.join(' ');
        } else {
          finalPhrases.push(chunk.join(' '));
        }
      }
    }
  }
  
  const mergedPhrases: string[] = [];
  for (const phrase of finalPhrases) {
    const words = phrase.split(/\s+/).filter(w => w.length > 0);
    if (words.length < MIN_WORDS && mergedPhrases.length > 0) {
      mergedPhrases[mergedPhrases.length - 1] += ' ' + phrase;
    } else {
      mergedPhrases.push(phrase);
    }
  }
  
  return mergedPhrases.length > 0 ? mergedPhrases : [sentence];
}

function createWordTimings(text: string, startTime: number, endTime: number): WordTiming[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];
  
  const duration = endTime - startTime;
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  
  let currentTime = startTime;
  const timings: WordTiming[] = [];
  
  for (const word of words) {
    const wordDuration = (word.length / totalChars) * duration;
    timings.push({
      word,
      startTime: currentTime,
      endTime: currentTime + wordDuration
    });
    currentTime += wordDuration;
  }
  
  return timings;
}

/**
 * v81: Helper - resolve a numeric value from multiple possible sources.
 * Handles NaN, undefined, null, and millisecond-to-second conversion.
 */
function resolveNumber(...candidates: Array<number | undefined | null>): number | null {
  for (const val of candidates) {
    if (val != null && typeof val === 'number' && !isNaN(val) && isFinite(val)) {
      return val;
    }
  }
  return null;
}

/**
 * v81: Robust segment timing resolver - handles ALL known TranscriptSegment formats:
 *   - {start, duration} from transcribe-chunk route
 *   - {start, end} from v69-FIXED / mapped assemblyai format
 *   - {startMs, endMs} from raw assemblyai route v5 (milliseconds)
 *   - NaN/undefined fallback: estimate from text length + array position
 */
function resolveSegmentTiming(
  seg: TranscriptSegment,
  index: number,
  totalSegments: number,
  totalDurationEstimate: number
): { start: number; duration: number } {
  const raw = seg as any;
  
  // v85: Detailed diagnostic logging for first segment
  if (index === 0) {
    console.log('[v129] 🔍 First segment timing resolution:', {
      'seg.start': seg.start,
      'seg.start type': typeof seg.start,
      'seg.start isNaN': typeof seg.start === 'number' && isNaN(seg.start),
      'raw.startMs': raw.startMs,
      'raw.end': raw.end,
      'raw.endMs': raw.endMs,
      'raw.duration': raw.duration,
      'totalSegments': totalSegments,
      'totalDurationEstimate': totalDurationEstimate,
    });
  }
  
  // === Resolve START time ===
  let startSec = resolveNumber(
    seg.start,                                       // Standard: start in seconds
    raw.startMs != null ? raw.startMs / 1000 : undefined,  // assemblyai v5: startMs in ms
    raw.startTime,                                   // Alternative field name
  );
  
  // === Resolve END time (to compute duration) ===
  let endSec = resolveNumber(
    (seg as any).end,                                // v69-FIXED format: end in seconds
    raw.endMs != null ? raw.endMs / 1000 : undefined,      // assemblyai v5: endMs in ms
    raw.endTime,                                     // Alternative field name
  );
  
  // === Resolve DURATION directly ===
  let durationSec = resolveNumber(
    raw.duration,                                    // transcribe-chunk format: duration in seconds
    raw.durationMs != null ? raw.durationMs / 1000 : undefined,
  );
  
  // v91: Calculate average duration once for consistent fallback
  const avgDuration = totalDurationEstimate / Math.max(totalSegments, 1);

  // === Compute best duration from available data ===
  if (durationSec == null && endSec != null && startSec != null) {
    durationSec = endSec - startSec;
  } else if (durationSec == null && endSec != null && startSec == null) {
    // We have end but no start - use avgDuration for continuous coverage
    durationSec = avgDuration;
  }
  
  // === Fallback: estimate start from position (evenly distributed) ===
  if (startSec == null) {
    startSec = index * avgDuration;
  }
  
  // === v91 CRITICAL FIX: Use avgDuration for fallback duration ===
  // Previously used word-count-based: (wordCount / 150) * 60 which created ~3s segments
  // with ~15s spacing → HUGE GAPS. avgDuration ensures continuous coverage.
  if (durationSec == null || durationSec <= 0) {
    durationSec = avgDuration;
    console.log(`[v129] ⚠ Fallback duration for segment ${index}: ${durationSec.toFixed(2)}s (avgDuration ensures continuous coverage)`);
  }
  
  // === v85 CRITICAL: Final NaN guard - NEVER return NaN ===
  if (startSec == null || isNaN(startSec) || !isFinite(startSec)) {
    startSec = index * avgDuration;
    console.log(`[v129] ⚠ Fallback start for segment ${index}: ${startSec.toFixed(2)}s`);
  }
  
  if (durationSec == null || isNaN(durationSec) || !isFinite(durationSec) || durationSec <= 0) {
    durationSec = avgDuration;
    console.log(`[v129] ⚠ Final fallback duration for segment ${index}: ${durationSec.toFixed(2)}s`);
  }
  
  return { start: startSec, duration: durationSec };
}

/**
 * v81: Adapter - convert TranscriptSegment to phrase processing format.
 * Robust to ALL segment formats (replaces v75 adapter).
 */
function adaptSegmentForPhrases(
  segment: TranscriptSegment,
  index: number = 0,
  totalSegments: number = 1,
  totalDurationEstimate: number = 600
): {
  start: number;
  duration: number;
  text: string;
  speakerId?: string;
  speakerGender?: string;
} {
  const raw = segment as any;
  const timing = resolveSegmentTiming(segment, index, totalSegments, totalDurationEstimate);
  
  return {
    start: timing.start,
    duration: timing.duration,
    text: segment.text,
    speakerId: segment.speaker ?? raw.speakerId,
    speakerGender: raw.speakerGender,
  };
}

/**
 * v153 FIX #2: Adapter - convert segments for useAudioTranslation.addSegments.
 * 
 * CRITICAL CHANGE from v104/v129:
 * v129 used TEXT-LENGTH-BASED synthetic cumulative timing that IGNORED real
 * YouTube caption timestamps. This caused massive drift after ~252 seconds
 * because pauses, music breaks, and gaps in the real video were not reflected
 * in the synthetic timeline. George would then stutter trying to correct.
 * 
 * v153 FIX: Preserve the ORIGINAL YouTube caption timestamps (start, duration)
 * from the transcript segments. Only fall back to word-count estimation when
 * the original timestamps are genuinely missing (NaN/undefined).
 * 
 * This keeps TTS audio aligned with the actual video timeline rather than
 * a fabricated one.
 */
let _hasLoggedSegmentShape = false;
function adaptSegmentsForAudio(segments: TranscriptSegment[], targetLanguage: string = 'en'): Array<{
  text: string;
  start: number;
  duration: number;
  speakerId?: string;
  speakerGender?: string;
  targetLanguage?: string;
  targetDuration?: number;
}> {
  if (segments.length === 0) return [];

  // Diagnostic log on first call
  if (!_hasLoggedSegmentShape && segments.length > 0) {
    _hasLoggedSegmentShape = true;
    const sample = segments[0] as any;
    console.log('[v153] 🔍 Segment shape diagnostic (first segment):', {
      keys: Object.keys(sample),
      start: sample.start,
      end: sample.end,
      duration: sample.duration,
      startMs: sample.startMs,
      endMs: sample.endMs,
      text: sample.text?.substring(0, 40) + '...',
      startType: typeof sample.start,
      startIsNaN: typeof sample.start === 'number' && isNaN(sample.start),
    });
  }
  
  // Estimate total duration from last segment (needed only for fallback)
  let totalDurationEstimate = 600; // default 10 min
  for (let i = segments.length - 1; i >= 0; i--) {
    const raw = segments[i] as any;
    const end = resolveNumber(raw.end, raw.endMs != null ? raw.endMs / 1000 : undefined);
    const start = resolveNumber(raw.start, raw.startMs != null ? raw.startMs / 1000 : undefined);
    const dur = resolveNumber(raw.duration);
    if (end != null) { totalDurationEstimate = end; break; }
    if (start != null && dur != null) { totalDurationEstimate = start + dur; break; }
  }
  
  console.log('[v153] 📊 Adapting segments — PRESERVING original YouTube timestamps...');
  
  let usedOriginalCount = 0;
  let usedFallbackCount = 0;
  
  const adapted = segments.map((seg, index) => {
    const raw = seg as any;
    
    // === v153 FIX #2 CORE: Use REAL timestamps from YouTube captions ===
    // Resolve original start time
    const origStart = resolveNumber(
      seg.start,
      raw.startMs != null ? raw.startMs / 1000 : undefined,
      raw.startTime
    );
    
    // Resolve original end time
    const origEnd = resolveNumber(
      raw.end,
      raw.endMs != null ? raw.endMs / 1000 : undefined,
      raw.endTime
    );
    
    // Resolve original duration
    const origDuration = resolveNumber(
      raw.duration,
      raw.durationMs != null ? raw.durationMs / 1000 : undefined
    );
    
    // Determine best start time: prefer original, fall back to position estimate
    let startTime: number;
    let segDuration: number;
    let timingSource: string;
    
    if (origStart != null) {
      // We have a real YouTube timestamp — USE IT
      startTime = origStart;
      
      if (origDuration != null && origDuration > 0) {
        segDuration = origDuration;
        timingSource = 'original-start+duration';
      } else if (origEnd != null && origEnd > origStart) {
        segDuration = origEnd - origStart;
        timingSource = 'original-start+end';
      } else {
        // Have start but no duration — estimate from word count
        const wordCount = (seg.text || '').split(/\s+/).filter(w => w.length > 0).length;
        segDuration = Math.max((wordCount / 150) * 60, 0.5);
        timingSource = 'original-start+wordEstDuration';
      }
      usedOriginalCount++;
    } else {
      // No real timestamp — fall back to position-based estimate
      const avgDuration = totalDurationEstimate / Math.max(segments.length, 1);
      startTime = index * avgDuration;
      segDuration = avgDuration;
      timingSource = 'fallback-positional';
      usedFallbackCount++;
      if (index < 3) {
        console.warn(`[v153] ⚠ Segment ${index} has no original timestamp, using positional fallback: ${startTime.toFixed(2)}s`);
      }
    }
    
    return {
      text: seg.text,
      start: startTime,
      duration: segDuration,
      speakerId: seg.speaker ?? raw.speakerId,
      speakerGender: raw.speakerGender,
      targetLanguage: targetLanguage,
      targetDuration: segDuration,
      _timingSource: timingSource, // diagnostic only
    };
  });
  
  // Log timing source distribution
  console.log(`[v153] 🎯 Timing sources: original=${usedOriginalCount}, fallback=${usedFallbackCount} of ${segments.length} total`);
  if (usedFallbackCount > 0 && usedOriginalCount > 0) {
    console.warn(`[v153] ⚠ Mixed timing sources — ${usedFallbackCount} segments missing original timestamps`);
  } else if (usedFallbackCount === segments.length) {
    console.warn(`[v153] ⚠ ALL segments missing original timestamps — using positional fallback`);
  } else {
    console.log(`[v153] ✅ All ${segments.length} segments using original YouTube timestamps`);
  }
  
  console.log(`[v153] 🌐 Enforcing target language '${targetLanguage}' for all ${adapted.length} TTS segments`);
  
  // Segment timing summary
  if (adapted.length > 0) {
    const avgDur = adapted.reduce((sum, s) => sum + s.duration, 0) / adapted.length;
    const minDur = Math.min(...adapted.map(s => s.duration));
    const maxDur = Math.max(...adapted.map(s => s.duration));
    console.log('[v153] 📊 Segment timing summary:');
    console.log(`[v153]   Total segments: ${adapted.length}`);
    console.log(`[v153]   Video duration estimate: ${totalDurationEstimate}s`);
    console.log(`[v153]   Avg duration: ${avgDur.toFixed(2)}s, range: ${minDur.toFixed(2)}s - ${maxDur.toFixed(2)}s`);
    
    // Log first 3 and last 3
    console.log('[v153] First 3 segments:');
    adapted.slice(0, 3).forEach((seg, i) => {
      console.log(`  [${i}] ${seg.start.toFixed(2)}s + ${seg.duration.toFixed(2)}s = ${(seg.start + seg.duration).toFixed(2)}s — "${seg.text.substring(0, 40)}..."`);
    });
    if (adapted.length > 3) {
      console.log('[v153] Last 3 segments:');
      adapted.slice(-3).forEach((seg, i) => {
        const idx = adapted.length - 3 + i;
        console.log(`  [${idx}] ${seg.start.toFixed(2)}s + ${seg.duration.toFixed(2)}s = ${(seg.start + seg.duration).toFixed(2)}s — "${seg.text.substring(0, 40)}..."`);
      });
    }
    
    // Check for large gaps (expected with real timestamps — pauses/music/silence)
    let gapCount = 0;
    let totalGapTime = 0;
    for (let i = 1; i < adapted.length; i++) {
      const prevEnd = adapted[i-1].start + adapted[i-1].duration;
      const gap = adapted[i].start - prevEnd;
      if (gap > 5.0) {
        gapCount++;
        totalGapTime += gap;
      }
    }
    if (gapCount > 0) {
      console.log(`[v153] 📊 ${gapCount} natural gaps >5s (total ${totalGapTime.toFixed(1)}s) — these are real pauses/music in the video`);
    }
    
    const firstStart = adapted[0].start;
    const lastEnd = adapted[adapted.length - 1].start + adapted[adapted.length - 1].duration;
    console.log(`[v153] 📊 Coverage: ${firstStart.toFixed(2)}s → ${lastEnd.toFixed(2)}s`);
  }
  
  return adapted;
}

function processIntoPhrases(transcript: TranscriptSegment[]): PhraseUnit[] {
  const phrases: PhraseUnit[] = [];
  let phraseId = 0;
  let sentenceIndex = 0;
  
  // v81: Estimate total duration for fallback timing
  let totalDurationEstimate = 600;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const raw = transcript[i] as any;
    const end = resolveNumber(raw.end, raw.endMs != null ? raw.endMs / 1000 : undefined);
    const start = resolveNumber(raw.start, raw.startMs != null ? raw.startMs / 1000 : undefined);
    const dur = resolveNumber(raw.duration);
    if (end != null) { totalDurationEstimate = end; break; }
    if (start != null && dur != null) { totalDurationEstimate = start + dur; break; }
  }
  
  for (let segIdx = 0; segIdx < transcript.length; segIdx++) {
    const rawSegment = transcript[segIdx];
    const segment = adaptSegmentForPhrases(rawSegment, segIdx, transcript.length, totalDurationEstimate);
    const segmentStart = segment.start;
    const sentenceTexts = splitIntoSentences(segment.text);
    const totalSegmentChars = sentenceTexts.reduce((sum, s) => sum + s.length, 0);
    
    let currentSegmentTime = segmentStart;
    
    for (const sentenceText of sentenceTexts) {
      const sentenceDuration = (sentenceText.length / totalSegmentChars) * segment.duration;
      const sentenceStart = currentSegmentTime;
      
      const phraseTexts = splitIntoPhrases(sentenceText);
      const totalPhraseChars = phraseTexts.reduce((sum, p) => sum + p.length, 0);
      
      let currentPhraseTime = sentenceStart;
      
      for (const phraseText of phraseTexts) {
        const phraseDuration = (phraseText.length / totalPhraseChars) * sentenceDuration;
        const phraseStart = currentPhraseTime;
        const phraseEnd = currentPhraseTime + phraseDuration;
        
        phrases.push({
          id: `p${phraseId++}`,
          text: phraseText,
          startTime: phraseStart,
          endTime: phraseEnd,
          displayEnd: phraseEnd,
          words: createWordTimings(phraseText, phraseStart, phraseEnd),
          sentenceIndex: sentenceIndex,
          speakerId: segment.speakerId,
          speakerGender: segment.speakerGender
        });
        
        currentPhraseTime = phraseEnd;
      }
      
      currentSegmentTime += sentenceDuration;
      sentenceIndex++;
    }
  }
  
  for (let i = 0; i < phrases.length - 1; i++) {
    phrases[i].displayEnd = phrases[i + 1].startTime;
  }
  
  if (phrases.length > 0) {
    phrases[phrases.length - 1].displayEnd = phrases[phrases.length - 1].endTime + 2;
  }
  
  return phrases;
}

function findPhraseAtTime(phrases: PhraseUnit[], time: number): { phrase: PhraseUnit | null; index: number } {
  if (phrases.length === 0) return { phrase: null, index: -1 };
  
  if (time < phrases[0].startTime || time >= phrases[phrases.length - 1].displayEnd) {
    return { phrase: null, index: -1 };
  }
  
  let left = 0;
  let right = phrases.length - 1;
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const p = phrases[mid];
    
    if (time >= p.startTime && time < p.displayEnd) {
      return { phrase: p, index: mid };
    } else if (time < p.startTime) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  
  return { phrase: null, index: -1 };
}

function getSpeakerColor(speakerId: string | undefined): string {
  if (!speakerId) return 'text-white';
  const speakerNum = parseInt(speakerId.replace('SPEAKER_', ''), 10);
  const colors = ['text-blue-300', 'text-green-300', 'text-yellow-300', 'text-pink-300', 'text-purple-300'];
  return colors[speakerNum % colors.length];
}

function getGenderIcon(gender: string | undefined): string {
  switch (gender) {
    case 'male': return '👨';
    case 'female': return '👩';
    case 'neutral': return '🧑';
    default: return '🗣️';
  }
}

/**
 * v75: Smart diverse voice assignment
 */
function assignDiverseVoices(speakers: SpeakerInfo[]): Map<string, { id: string; name: string }> {
  const assignments = new Map<string, { id: string; name: string }>();
  const usedVoiceIds = new Set<string>();
  
  const maleVoices = VOICE_POOL.filter(v => v.gender === 'male');
  const femaleVoices = VOICE_POOL.filter(v => v.gender === 'female');
  const neutralVoices = VOICE_POOL.filter(v => v.gender === 'neutral');
  
  for (const speaker of speakers) {
    let candidatePool: typeof VOICE_POOL;
    
    if (speaker.gender === 'male') {
      candidatePool = [...maleVoices, ...neutralVoices, ...femaleVoices];
    } else if (speaker.gender === 'female') {
      candidatePool = [...femaleVoices, ...neutralVoices, ...maleVoices];
    } else {
      candidatePool = [...VOICE_POOL];
    }
    
    const voice = candidatePool.find(v => !usedVoiceIds.has(v.id));
    
    if (voice) {
      assignments.set(speaker.id, { id: voice.id, name: voice.name });
      usedVoiceIds.add(voice.id);
      console.log(`[v129] voiceAssignment: ${speaker.id} (${speaker.gender}) -> ${voice.name}`);
    } else {
      const fallback = VOICE_POOL[speakers.indexOf(speaker) % VOICE_POOL.length];
      assignments.set(speaker.id, { id: fallback.id, name: fallback.name });
      console.log(`[v129] voiceAssignment (wrap): ${speaker.id} -> ${fallback.name}`);
    }
  }
  
  return assignments;
}

export default function AudioClarification({
  videoId,
  currentTime,
  duration = 0,
  isPlaying = false,
  onSubtitleChange,
  onPauseVideo,
  onResumeVideo,
  onSeekVideo,
  onMuteYouTube,
  onUnmuteYouTube
}: AudioClarificationProps) {
  // === UI STATE ===
  const [showModal, setShowModal] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  
  const [pendingOutputMode, setPendingOutputMode] = useState<OutputMode | null>(null);
  const [hasAutoEnabled, setHasAutoEnabled] = useState(false);
  
  // Voice assignment state
  const [showVoiceAssignment, setShowVoiceAssignment] = useState(false);
  const [customVoiceAssignments, setCustomVoiceAssignments] = useState<VoiceAssignment[] | null>(null);
  const [voiceAssignmentCompleted, setVoiceAssignmentCompleted] = useState(false);
  
  // v75: Speaker readiness tracking
  const [speakersReadyForAssignment, setSpeakersReadyForAssignment] = useState(false);
  const processedDiarizationRef = useRef(false);
  const prevSpeakerCountRef = useRef<number>(0);
  
  // v75: Track auto-assigned voice map for display
  const [autoVoiceMap, setAutoVoiceMap] = useState<Map<string, { id: string; name: string }>>(new Map());
  
  // Track if user has actually started playback
  const [userHasStartedPlayback, setUserHasStartedPlayback] = useState(false);
  const userHasStartedPlaybackRef = useRef(false);
  
  // v75: Track detected speakers locally
  const [localDetectedSpeakers, setLocalDetectedSpeakers] = useState<DetectedSpeaker[]>([]);
  
  // v75: Track audio enabled state via ref for sync
  const audioEnabledRef = useRef<boolean>(false);
  
  // v123 CRITICAL: Guard to prevent auto-start on Fast Refresh / mount
  // Audio NEVER starts until user clicks "Start Watching"
  const userInitiatedProcessingRef = useRef(false);
  
  // v123 CRITICAL: Initialization guard - blocks ALL audio on mount
  const hasInitializedRef = useRef(false);
  
  // v75: Skip auto-enable during initial processing to prevent loop
  const [isInitialProcessing, setIsInitialProcessing] = useState(false);
  
  // v83: Autoplay policy workaround - simplified from v82
  // Removed showStartAudioPrompt state (now computed via useMemo as shouldShowStartAudio)
  const [audioHasPlayed, setAudioHasPlayed] = useState(false);
  const [videoHasStarted, setVideoHasStarted] = useState(false); // v99: Track if video has started
  const [showStartButton, setShowStartButton] = useState(false); // v112: Dedicated Start Watching button visibility state
  
  // v75 FIX: Track first render and mount state to prevent false playback detection
  const isFirstRenderRef = useRef(true);
  const hasMountedRef = useRef(false);
  const mountTimeRef = useRef<number>(0);
  const lastPlaybackCheckTimeRef = useRef<number>(0);
  
  const { notifications, addNotification, removeNotification } = useNotifications();

  // === CHUNKED TRANSCRIPTION (v70 - AssemblyAI) ===
  const {
    allSegments,
    chunks,
    loadedRange,
    isInitializing,
    isLoadingChunk,
    error,
    totalSegmentsLoaded,
    bufferAheadSeconds,
    isReady,
    speakers,
    speakerCount,
    hasSpeakerInfo,
    startTranscription,
    stopTranscription,
    updatePlaybackPosition
  } = useChunkedTranscription();

  // === AUDIO TRANSLATION ===
  // v94: Pass targetLanguage to audio translation hook so TTS requests
  // can enforce the correct output language (prevents language switching)
  const audioTranslation = useAudioTranslation({
    videoId,
    voiceProvider: 'openai',
    prebufferCount: 3,
    // v94: targetLanguage flows through to TTS requests
    // TODO: useAudioTranslation hook needs to accept and use this parameter
    // to include targetLanguage in the /api/multi-voice-tts request body.
    // For now, we pass it through adaptSegmentsForAudio on each segment.
    targetLanguage: targetLanguage,
  });

  // === PHRASE STATE ===
  const [phrases, setPhrases] = useState<PhraseUnit[]>([]);
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(-1);
  const [displayedSubtitle, setDisplayedSubtitle] = useState('');
  const [displayMode, setDisplayMode] = useState<'karaoke' | 'full'>('karaoke');
  
  // === LOOP MODE STATE ===
  const [loopModeEnabled, setLoopModeEnabled] = useState(false);
  const [loopStartTime, setLoopStartTime] = useState<number | null>(null);
  const [loopEndTime, setLoopEndTime] = useState<number | null>(null);
  const [loopStartInput, setLoopStartInput] = useState('');
  const [loopEndInput, setLoopEndInput] = useState('');
  const [loopCount, setLoopCount] = useState(0);
  const lastLoopTriggerRef = useRef(0);

  // === REFS ===
  const currentTimeRef = useRef(currentTime);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  const lastPlayedPhraseRef = useRef<string | null>(null);
  const prevIsPlayingRef = useRef<boolean>(false);
  // v122: REMOVED isPlayingRef (was only used by periodic sync interval, now removed)
  // v122: REMOVED syncIntervalRef (periodic sync interval removed - v80 handles transitions)
  const ignoreNextPauseRef = useRef<boolean>(false); // v97: Suppress false pause events after play
  const pauseSyncPrevPlayingRef = useRef<boolean>(false); // v115: Independent prev-state for pause/resume effect
  const lastTriggeredPhraseIdRef = useRef<string | null>(null);
  const lastTriggeredTimeRef = useRef<number>(0);
  const currentlyPlayingSegmentRef = useRef<string | null>(null);
  // v122: REMOVED currentlyPlayingSegmentIndexRef (periodic sync removed - v80 handles transitions)
  // v122: REMOVED avgSegmentDurationRef (periodic sync removed - v80 handles transitions)
  // v122: REMOVED adaptedSegmentsRef (periodic sync removed - v80 handles transitions)
  
  // v100: Guard against first segment stutter - prevents multiple playAtTime calls at audio start
  const initialPlayGuardRef = useRef<boolean>(false);
  const initialPlayGuardTimerRef = useRef<NodeJS.Timeout | null>(null);
  // v112: Removed macroSetupAttemptedRef (YouTube Play Button Macro removed)

  // v75: Keep audioEnabled ref in sync
  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  // v122: REMOVED isPlayingRef sync (was for periodic sync interval, now removed)

  // v75 FIX: Track component mount
  // v123: Also enforce initialization guard - NO audio on mount/Fast Refresh
  useEffect(() => {
    mountTimeRef.current = Date.now();
    hasMountedRef.current = true;
    console.log('[v129] Component mounted at', mountTimeRef.current);
    
    // v123 CRITICAL: Ensure audio is disabled on mount
    // This prevents Fast Refresh from auto-starting audio
    if (!hasInitializedRef.current) {
      console.log('[v129] 🚫 Initialization guard active - blocking all audio on mount');
      hasInitializedRef.current = true;
      // Force audio off on mount
      audioEnabledRef.current = false;
      userInitiatedProcessingRef.current = false;
    }
    
    const timer = setTimeout(() => {
      isFirstRenderRef.current = false;
      console.log('[v129] First render period ended, playback detection now active');
    }, 500);
    
    return () => {
      clearTimeout(timer);
      hasMountedRef.current = false;
    };
  }, []);

  // =====================================================================
  // v75 (from v74) CRITICAL FIX: PLAYBACK DETECTION
  // v102: Added extensive diagnostic logging
  // =====================================================================
  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    const nowPlaying = isPlaying;
    const now = Date.now();
    
    // v102: Log every isPlaying change for diagnostics
    if (wasPlaying !== nowPlaying) {
      console.log('[v129] 🔍 isPlaying changed:', {
        from: wasPlaying,
        to: nowPlaying,
        currentTime,
        audioEnabled,
        videoHasStarted,
        audioHasPlayed,
        userHasStartedPlayback: userHasStartedPlaybackRef.current,
        audioTranslationIsPlaying: audioTranslation?.isPlaying,
        generatedCount: audioTranslation?.generatedCount || 0,
        allSegmentsCount: allSegments.length
      });
    }
    
    if (isFirstRenderRef.current) {
      console.log('[v129] Skipping playback detection - first render period');
      return;
    }
    
    const timeSinceMount = now - mountTimeRef.current;
    if (timeSinceMount < 500) {
      console.log('[v129] Skipping playback detection - component just mounted', timeSinceMount, 'ms ago');
      return;
    }
    
    const timeSinceLastCheck = now - lastPlaybackCheckTimeRef.current;
    if (timeSinceLastCheck < 500) {
      if (timeSinceLastCheck < 50) {
        console.log('[v129] Skipping playback detection - debounce 500ms, elapsed:', timeSinceLastCheck, 'ms');
      }
      return;
    }
    lastPlaybackCheckTimeRef.current = now;
    
    if (!wasPlaying && nowPlaying && !userHasStartedPlaybackRef.current) {
      // v96 FIX: Don't wait for currentTime > 0 - start immediately when video plays
      // The old check "currentTime > 0" prevented audio from starting because the
      // video play event fires when currentTime is still 0
      console.log('[v129] ✓ User initiated playback - audio can now play (time:', currentTime, ')');
      setUserHasStartedPlayback(true);
      userHasStartedPlaybackRef.current = true;
    }
    
    prevIsPlayingRef.current = nowPlaying;
  }, [isPlaying, currentTime]);

  // =====================================================================
  // v75: SPEAKER DETECTION - adapted for v70 AssemblyAI format
  // =====================================================================
  useEffect(() => {
    const speakersLength = speakers?.length || 0;
    
    console.log('[v129] Speaker detection state updated:', {
      hasSpeakerInfo,
      speakerCount,
      speakersLength,
      processedDiarization: processedDiarizationRef.current
    });
    
    if (speakerCount !== prevSpeakerCountRef.current) {
      console.log(`[v129] 🔄 Speaker count updated: ${prevSpeakerCountRef.current} → ${speakerCount}`);
      prevSpeakerCountRef.current = speakerCount;
    }
    
    if (hasSpeakerInfo && speakers && speakersLength > 0 && !processedDiarizationRef.current) {
      console.log('[v129] ✓ Speakers detected! Building detected speakers list...');
      
      const detectedList: DetectedSpeaker[] = speakers.map(s => ({
        id: s.id,
        gender: (s.gender as 'male' | 'female' | 'neutral' | 'unknown') || 'unknown',
        totalSpeakingTime: s.totalSpeakingTime,
        segmentCount: s.segmentCount
      }));
      
      console.log('[v129] Detected speakers:', detectedList.map(s => `${s.id} (${s.gender})`).join(', '));
      
      setLocalDetectedSpeakers(detectedList);
      processedDiarizationRef.current = true;
      setSpeakersReadyForAssignment(true);
      console.log('[v129] ✓ Set speakersReadyForAssignment = true');
    }
  }, [hasSpeakerInfo, speakerCount, speakers]);

  // =====================================================================
  // v75: AUTO-PLAY TRIGGER (v83: reduced logging to prevent console spam)
  // =====================================================================
  useEffect(() => {
    const needsAudio = pendingOutputMode === 'audio_only' || pendingOutputMode === 'audio_and_subtitles';
    
    if (isInitialProcessing) {
      return;
    }
    
    if (
      speakersReadyForAssignment && 
      localDetectedSpeakers.length > 0 && 
      needsAudio &&
      !voiceAssignmentCompleted
    ) {
      console.log('[v129] ✅ Speakers ready - auto-assigning diverse voices!');
      
      const diverseVoices = assignDiverseVoices(speakers);
      setAutoVoiceMap(diverseVoices);
      
      const speakerData = speakers.map(s => {
        const voice = diverseVoices.get(s.id);
        return {
          id: s.id,
          gender: s.gender,
          total_speaking_time: s.totalSpeakingTime || 0,
          customVoice: voice?.id
        };
      });
      
      // v94: Log voice assignments with explicit language enforcement
      console.log('[v129] 🌐 Enforcing English language for all TTS generation');
      console.log('[v129] Voice assignments:', 
        speakerData.map(s => `${s.id} → ${s.customVoice} (${targetLanguage})`).join(', '));
      
      audioTranslation.initializeVoices(speakerData);
      
      setTimeout(() => {
        setVoiceAssignmentCompleted(true);
        console.log('[v129] ✓ voiceAssignmentCompleted set to true');
      }, 100);
      
      addNotification({
        type: 'success',
        title: '🎤 Voices Auto-Assigned',
        message: `${speakers.length} speaker${speakers.length !== 1 ? 's' : ''} detected with unique voices`,
        duration: 4000
      });
    } else if (needsAudio && !speakersReadyForAssignment && pendingOutputMode) {
      console.log('[v129] ⏳ Waiting for speaker detection...');
    }
  }, [
    speakersReadyForAssignment, 
    localDetectedSpeakers, 
    pendingOutputMode, 
    voiceAssignmentCompleted, 
    speakerCount,
    hasSpeakerInfo,
    speakers,
    isInitialProcessing
  ]);

  // Handle manual voice assignment (from "Change voices" link)
  const handleApplyVoices = useCallback((assignments: VoiceAssignment[]) => {
    console.log('[v129] User applied custom voice assignments:', assignments);
    
    assignments.forEach(a => {
      console.log(`[v129] Voice mapping: ${formatSpeakerLabel(a.speakerId)} (${a.speakerId}) → ${a.voiceName} (${a.voiceId})`);
    });
    
    setCustomVoiceAssignments(assignments);
    setVoiceAssignmentCompleted(true);
    setShowVoiceAssignment(false);
    
    const newMap = new Map<string, { id: string; name: string }>();
    assignments.forEach(a => newMap.set(a.speakerId, { id: a.voiceId, name: a.voiceName }));
    setAutoVoiceMap(newMap);
    
    if (speakers && speakers.length > 0) {
      const speakerData = speakers.map(s => {
        const assignment = assignments.find(a => a.speakerId === s.id);
        return {
          id: s.id,
          gender: s.gender,
          total_speaking_time: s.totalSpeakingTime || 0,
          customVoice: assignment?.voiceId
        };
      });
      
      console.log('[v129] Re-initializing voices with custom assignments');
      audioTranslation.initializeVoices(speakerData);
      
      if (allSegments.length > 0) {
        audioTranslation.updateSegmentVoices(assignments);
      }
    }
    
    addNotification({
      type: 'success',
      title: '✓ Voices Updated!',
      message: `${assignments.length} custom voice${assignments.length !== 1 ? 's' : ''} applied`,
      duration: 4000
    });
  }, [speakers, allSegments, addNotification]);

  // Handle auto voice assignment (from modal)
  const handleUseAutoAssignment = useCallback(() => {
    console.log('[v129] User chose automatic voice assignment from modal');
    setVoiceAssignmentCompleted(true);
    setShowVoiceAssignment(false);
    setCustomVoiceAssignments(null);
    
    if (speakers && speakers.length > 0) {
      const diverseVoices = assignDiverseVoices(speakers);
      setAutoVoiceMap(diverseVoices);
      
      const speakerData = speakers.map(s => {
        const voice = diverseVoices.get(s.id);
        return {
          id: s.id,
          gender: s.gender,
          total_speaking_time: s.totalSpeakingTime || 0,
          customVoice: voice?.id
        };
      });
      audioTranslation.initializeVoices(speakerData);
    }
    
    addNotification({
      type: 'info',
      title: '🤖 Auto-Assignment',
      message: 'Using automatic diverse voice matching',
      duration: 3000
    });
  }, [speakers, addNotification]);

  // =====================================================================
  // v109: AUTO-ENABLE - Prepares audio (feeds segments, starts TTS generation)
  // but does NOT start playback. Playback starts ONLY when user clicks YouTube play.
  // =====================================================================
  useEffect(() => {
    if (isReady && pendingOutputMode === 'subtitles_only' && !hasAutoEnabled) {
      console.log('[v129] Processing complete! Auto-enabling subtitles only');
      setSubtitlesEnabled(true);
      
      setHasAutoEnabled(true);
      setIsInitialProcessing(false);
      return;
    }
    
    const needsAudio = pendingOutputMode === 'audio_only' || pendingOutputMode === 'audio_and_subtitles';
    
    if (isReady && needsAudio && voiceAssignmentCompleted && !hasAutoEnabled) {
      console.log('[v129] ✅ Processing complete + voices assigned → preparing audio (NOT starting playback)');
      
      const enableSubtitles = pendingOutputMode === 'audio_and_subtitles';
      
      if (enableSubtitles) {
        setSubtitlesEnabled(true);
        console.log('[v129] Auto-enabled subtitles');
      }
      
      // Set audioEnabled to start TTS generation
      audioEnabledRef.current = true;
      setAudioEnabled(true);
      
      // Feed adapted segments to audio translation for TTS generation
      if (allSegments.length > 0) {
        const adapted = adaptSegmentsForAudio(allSegments, targetLanguage);
        audioTranslation.addSegments(adapted, currentTimeRef.current);
        // v122: Removed adaptedSegmentsRef/avgSegmentDurationRef updates (no periodic sync)
        console.log('[v129] Fed', adapted.length, 'segments for TTS generation (currentTime:', currentTimeRef.current.toFixed(2), ')');
      }
      
      // v124 ROOT CAUSE FIX: Call setEnabled(true) with NO currentTime argument.
      // In v123, setEnabled(true, 0) passed currentTime=0. The v80 hook checks
      // `currentTime !== undefined` — 0 !== undefined is TRUE — so it called
      // playAtTime(0) via setTimeout(0), bypassing the frontend guard entirely.
      // By passing NO second arg, currentTime is `undefined`, and the hook
      // only starts TTS generation without triggering playAtTime.
      audioTranslation.setEnabled(true);
      console.log('[v129] ✅ Audio enabled for TTS generation ONLY (no currentTime arg = no playAtTime)');
      
      // v109: Do NOT mute YouTube yet - wait until user clicks play
      // Previously muted here, but that was confusing since nothing was playing yet
      
      // v127: Start Watching button will show immediately (no generation wait)
      console.log('[v129] ✅ Audio enabled - Start Watching button will appear immediately');
      
      setHasAutoEnabled(true);
      setIsInitialProcessing(false);
    }
  }, [isReady, pendingOutputMode, hasAutoEnabled, voiceAssignmentCompleted, speakers, allSegments, onMuteYouTube, addNotification]);

  // =====================================================================
  // v79 FIX: Playback verification - uses playAtTime() for effective recovery
  // 
  // v77 recovery was ineffective because it re-called setEnabled/addSegments
  // which were no-ops (already enabled, segments already added).
  // v79 recovery calls playAtTime() which actively finds and plays the segment
  // at the current video time.
  // =====================================================================
  useEffect(() => {
    // v123: Also gate recovery on user-initiated flag
    if (!audioEnabled || !isPlaying || !userHasStartedPlaybackRef.current || !userInitiatedProcessingRef.current) return;
    
    const verifyTimer = setTimeout(() => {
      if (audioEnabledRef.current && !audioTranslation.isPlaying && !audioTranslation.isGenerating && userInitiatedProcessingRef.current) {
        const videoTime = currentTimeRef.current;
        console.warn('[v129] ⚠️ Audio verification: enabled for 3s but no audio playing at time', videoTime.toFixed(2));
        
        // v85 FIX (from v84): Re-feed segments before playAtTime in case they were never added
        // This handles the case where auto-enable fed segments but they were lost,
        // or where the manual Start Video path was used without proper feeding
        if (allSegments.length > 0) {
          const adapted = adaptSegmentsForAudio(allSegments, targetLanguage);
          audioTranslation.addSegments(adapted, currentTimeRef.current);
          // v122: Removed adaptedSegmentsRef/avgSegmentDurationRef updates (no periodic sync)
          console.log('[v129] Recovery: re-fed', adapted.length, 'segments to audio hook');
        }
        
        console.log('[v129] Recovery: calling guardedPlayAtTime(' + videoTime.toFixed(2) + ')');
        guardedPlayAtTime(videoTime, 'recovery-3s-timer');
      }
    }, 3000);
    
    return () => clearTimeout(verifyTimer);
  }, [audioEnabled, isPlaying, allSegments]);

  // =====================================================================
  // v83: SIMPLIFIED AUTOPLAY DETECTION
  // Instead of a complex useEffect with timers (which caused infinite loops in v82),
  // we track audioHasPlayed via a simple effect that only watches isPlaying.
  // The "Start Video" button visibility is computed directly (no useEffect/setState loop).
  // =====================================================================
  useEffect(() => {
    // Once audio actually plays, mark it so the directive label disappears
    if (audioTranslation.isPlaying && !audioHasPlayed) {
      console.log('[v129] ✅ Audio is now playing! Marking audioHasPlayed.');
      setAudioHasPlayed(true);
    }
  }, [audioTranslation.isPlaying, audioHasPlayed]);

  // v124: safePlayAtTime - defense-in-depth wrapper around audioTranslation.playAtTime
  // This is the ONLY function that should call audioTranslation.playAtTime directly.
  // ALL other code paths (guardedPlayAtTime, recovery, handleStartWatching) go through this.
  // Even if a bug introduces a new playAtTime call, this catches it.
  const safePlayAtTime = useCallback((time: number, source: string) => {
    if (!userInitiatedProcessingRef.current) {
      console.log(`[v129] ⛔ safePlayAtTime BLOCKED (${time.toFixed(2)}) from ${source} - user has not clicked Start Watching`);
      return;
    }
    console.log(`[v129] ✅ safePlayAtTime(${time.toFixed(2)}) from ${source} - ALLOWED`);
    audioTranslation.playAtTime(time);
  }, [audioTranslation]);

  // v100: Guarded playAtTime - prevents the first segment from stuttering/repeating
  // When audio first starts, multiple code paths can call playAtTime simultaneously:
  //   1. setEnabled(true, videoTime) → internally calls playAtTime via setTimeout(0)
  //   2. Explicit playAtTime() call right after setEnabled
  //   3. YouTube play event handler → startAudioMacro → another playAtTime
  //   4. Recovery timer (3s) → yet another playAtTime
  // This guard ensures only the FIRST playAtTime call goes through in the initial 2s window.
  const guardedPlayAtTime = useCallback((time: number, source: string) => {
    // v124: userInitiatedProcessingRef check is now in safePlayAtTime too (defense-in-depth)
    if (!userInitiatedProcessingRef.current) {
      console.log(`[v129] ⛔ Blocked guardedPlayAtTime(${time.toFixed(2)}) from ${source} - not user-initiated`);
      return;
    }
    
    // v106: Reduced logging - only log the essentials
    if (initialPlayGuardRef.current) {
      // v106: Don't log blocked calls - they're expected and spammy
      return;
    }
    
    console.log(`[v129] 🎵 guardedPlayAtTime(${time.toFixed(2)}) from ${source}`);
    
    // v106: Set guard and proceed
    initialPlayGuardRef.current = true;
    
    // Clear any existing guard timer
    if (initialPlayGuardTimerRef.current) {
      clearTimeout(initialPlayGuardTimerRef.current);
    }
    
    // Release the guard after 2 seconds so normal segment transitions work
    initialPlayGuardTimerRef.current = setTimeout(() => {
      initialPlayGuardRef.current = false;
      initialPlayGuardTimerRef.current = null;
      console.log('[v129] 🔓 Initial play guard released (2s elapsed)');
    }, 2000);
    
    // v124: Use safePlayAtTime instead of direct audioTranslation.playAtTime
    safePlayAtTime(time, source + '→guarded');
  }, [safePlayAtTime]);

  // v127: Compute whether to show directive label directly (no useEffect timer)
  // v127 FIX: Removed generatedCount > 0 condition — button shows immediately when audio enabled.
  // Previously this caused deadlock: button waited for generation, but generation waited for button.
  const shouldShowStartAudio = useMemo(() => {
    return (
      audioEnabled &&
      hasAutoEnabled &&
      !audioHasPlayed &&
      !audioTranslation.isPlaying
    );
  }, [audioEnabled, hasAutoEnabled, audioHasPlayed, audioTranslation.isPlaying]);

  // =====================================================================
  // v127: START WATCHING BUTTON VISIBILITY
  // 
  // v127 FIX: Shows the "Start Watching" button IMMEDIATELY when audio is enabled.
  // Previously waited for generatedCount > 0, but v92 hook gates generation behind
  // playbackAllowed=true, which is only set by clicking this button = DEADLOCK.
  // 
  // NEW FLOW: audioEnabled + hasAutoEnabled → show button → user clicks →
  //           setPlaybackAllowed(true) → generation starts → audio plays
  // Button is hidden ONLY by handleStartWatching (user clicked the button).
  // =====================================================================
  const buttonShownRef = useRef(false);
  
  useEffect(() => {
    // v127: Show button as soon as audio is enabled, don't wait for generatedCount
    const audioReady = audioEnabled && hasAutoEnabled;
    
    if (audioReady && !audioHasPlayed && !buttonShownRef.current) {
      console.log('[v129] ✅ Audio enabled - showing Start Watching button immediately (no generation wait)');
      buttonShownRef.current = true;
      setShowStartButton(true);
    }
  }, [audioEnabled, hasAutoEnabled, audioHasPlayed]);


  // v112: handleStartWatching - called when user clicks "Start Watching" button
  // This is the ONLY path to start video + audio playback.
  // v112 FIX: Uses onResumeVideo() instead of document.querySelector('video').play()
  // because querySelector can't reach into the cross-origin YouTube iframe.
  const playbackStartedRef = useRef(false);
  
  const handleStartWatching = useCallback(() => {
    // v115: Guard against duplicate calls (e.g., double-click)
    if (playbackStartedRef.current) {
      console.log('[v129] ⚠️ Playback already started, ignoring duplicate call');
      return;
    }
    playbackStartedRef.current = true;
    
    // v123 CRITICAL: Mark as user-initiated - this unlocks guardedPlayAtTime
    userInitiatedProcessingRef.current = true;
    console.log('[v129] ✅ User-initiated processing flag SET');
    
    console.log('[v129] 🎬 Start Watching button clicked');
    console.log('[v129] 🎬 State:', {
      audioEnabled,
      audioHasPlayed,
      videoHasStarted,
      allSegmentsCount: allSegments.length,
      audioTranslationIsPlaying: audioTranslation?.isPlaying,
      audioTranslationGeneratedCount: audioTranslation?.generatedCount || 0
    });
    
    // Hide button immediately
    setShowStartButton(false);
    setAudioHasPlayed(true);
    setVideoHasStarted(true);
    
    // Mark playback as started
    userHasStartedPlaybackRef.current = true;
    setUserHasStartedPlayback(true);
    
    // Set ignore-pause flag to prevent YouTube's play/pause oscillation from killing audio
    if (!ignoreNextPauseRef.current) {
      ignoreNextPauseRef.current = true;
      console.log('[v129] Setting ignoreNextPause=true (1500ms grace period)');
      setTimeout(() => {
        ignoreNextPauseRef.current = false;
        console.log('[v129] Grace period ended, pause events now honored');
      }, 1500);
    }
    
    // Feed segments to audio hook BEFORE calling setEnabled
    if (allSegments.length > 0) {
      const adapted = adaptSegmentsForAudio(allSegments, targetLanguage);
      audioTranslation.addSegments(adapted, 0);
      // v122: Removed adaptedSegmentsRef/avgSegmentDurationRef updates (no periodic sync)
      console.log('[v129] Fed', adapted.length, 'segments to audio hook');
    }
    
    // Mute YouTube so user hears translated audio, not original
    if (onMuteYouTube) {
      console.log('[v129] Muting YouTube');
      onMuteYouTube();
    }
    
    // v112 FIX: Start video playback using onResumeVideo() callback
    // This calls playerRef.current.playVideo() on the page side via YouTube IFrame API.
    // Previous approach (document.querySelector('video').play()) failed because
    // the video element is inside a cross-origin YouTube iframe and can't be accessed.
    if (onResumeVideo) {
      console.log('[v129] ✅ Starting video playback via onResumeVideo (YouTube IFrame API)');
      onResumeVideo();
    } else {
      console.log('[v129] ⚠️ onResumeVideo not available');
    }
    
    // v124: Enable audio generation without triggering hook's internal playAtTime.
    // We use setEnabled(true) with NO currentTime to avoid double-play.
    // guardedPlayAtTime(0) below is the single, controlled path to start playback.
    audioTranslation.setEnabled(true);
    console.log('[v129] ✅ Audio enabled (no currentTime → no hook-internal playAtTime)');
    
    // v126 CRITICAL: Allow playback in the hook BEFORE calling guardedPlayAtTime.
    // The v82 hook gates ALL playback (watchdog, auto-advance, playAtTime via setEnabled)
    // behind playbackAllowedRef. Without this call, guardedPlayAtTime would work but
    // the watchdog and auto-advance would remain blocked.
    audioTranslation.setPlaybackAllowed(true);
    console.log('[v129] ✅ Playback gate OPENED in hook (watchdog + auto-advance now active)');
    
    // v124: Single controlled playAtTime call through the guarded path.
    // guardedPlayAtTime checks userInitiatedProcessingRef (set above) and has
    // the initial-play guard to prevent stutter from multiple simultaneous calls.
    guardedPlayAtTime(0, 'handleStartWatching');
    console.log('[v129] ✅ Explicitly called guardedPlayAtTime(0) to start audio');
    
    // v115: REMOVED safety net setTimeout that was in v113.
    // The safety net called playAtTime(0) again after 2s, bypassing guardedPlayAtTime,
    // which caused audio to restart and stutter. guardedPlayAtTime(0) above is sufficient.
  }, [audioTranslation, onMuteYouTube, onResumeVideo, allSegments, audioEnabled, audioHasPlayed, videoHasStarted, guardedPlayAtTime]);

  // === PAUSE/RESUME SYNC ===
  // v115 FIX: Use dedicated pauseSyncPrevPlayingRef instead of shared prevIsPlayingRef.
  // v123 FIX: Enhanced with YouTube mute/unmute on pause/resume
  useEffect(() => {
    const wasPlaying = pauseSyncPrevPlayingRef.current;
    const nowPlaying = isPlaying;
    
    if (!audioEnabled || !userHasStartedPlaybackRef.current) {
      pauseSyncPrevPlayingRef.current = nowPlaying;
      return;
    }
    
    // v123: Only process actual transitions
    if (wasPlaying === nowPlaying) {
      return;
    }
    
    if (wasPlaying && !nowPlaying) {
      // v97 FIX: Ignore false pause events right after play starts
      if (ignoreNextPauseRef.current) {
        console.log('[v129] Ignoring pause event (grace period after play)');
        pauseSyncPrevPlayingRef.current = nowPlaying;
        return;
      }
      console.log('[v129] ⏸️ Video paused - pausing translated audio and stopping sync');
      audioTranslation.pauseAudio();
      
      // v123: Unmute YouTube on pause so user can hear original if they want
      // (This is optional - some users may prefer silence on pause)
      console.log('[v129] 🔊 Video paused - YouTube audio available');
    } else if (!wasPlaying && nowPlaying) {
      // v124: Guard resumeAudio - only resume if user has clicked Start Watching
      if (!userInitiatedProcessingRef.current) {
        console.log('[v129] ⛔ Blocked resumeAudio - user has not clicked Start Watching');
        pauseSyncPrevPlayingRef.current = nowPlaying;
        return;
      }
      
      console.log('[v129] ▶️ Video resumed - resuming translated audio');
      
      // v123 CRITICAL: Re-mute YouTube BEFORE resuming translated audio
      // This prevents both audios playing simultaneously
      if (onMuteYouTube) {
        console.log('[v129] 🔇 Re-muting YouTube on resume');
        onMuteYouTube();
      }
      
      audioTranslation.resumeAudio();
    }
    
    pauseSyncPrevPlayingRef.current = nowPlaying;
  }, [isPlaying, audioEnabled, onMuteYouTube]);

  // =====================================================================
  // v123: YouTube Mute Enforcement - ensures YouTube stays muted while translated audio plays
  // Checks periodically to prevent YouTube from auto-unmuting
  // =====================================================================
  useEffect(() => {
    if (!audioTranslation.isPlaying || !userInitiatedProcessingRef.current || !onMuteYouTube) {
      return;
    }
    
    // Enforce mute immediately
    onMuteYouTube();
    
    // Check every 2s to make sure YouTube stays muted
    const muteCheckInterval = setInterval(() => {
      if (audioTranslation.isPlaying && userInitiatedProcessingRef.current) {
        console.log('[v129] 🔇 YouTube mute enforcement check - ensuring muted');
        onMuteYouTube();
      }
    }, 2000);
    
    return () => clearInterval(muteCheckInterval);
  }, [audioTranslation.isPlaying, onMuteYouTube]);

  // === v112: REMOVED YouTube Play Button Macro ===
  // Previously: Complex useEffect that tried to find video elements, attach play listeners,
  // retry up to 20 times, and auto-start audio on play detection.
  // Now: handleStartWatching button click is the ONLY path to start playback.
  // No video element detection, no retry loops, no fallback macro, no watchdog timers.

  // === v122: PERIODIC AUDIO SYNC REMOVED ===
  // v115 had a periodic sync interval that called playAtTime on segment boundaries.
  // This conflicted with v80 hook's auto-advance, causing stuttering.
  // v122: ALL segment transitions are now handled by the v80 hook's auto-advance.
  // Frontend only handles: initial start (guardedPlayAtTime), pause, and resume.

  // === INITIALIZE VOICES WHEN SPEAKERS DETECTED (for toggle-back-on scenarios) ===
  useEffect(() => {
    if (speakers && speakers.length > 0 && audioEnabled && voiceAssignmentCompleted) {
      if (customVoiceAssignments) {
        const speakerData = speakers.map(s => {
          const assignment = customVoiceAssignments.find(a => a.speakerId === s.id);
          return {
            id: s.id,
            gender: s.gender,
            total_speaking_time: s.totalSpeakingTime || 0,
            customVoice: assignment?.voiceId
          };
        });
        audioTranslation.initializeVoices(speakerData);
      } else {
        const diverseVoices = assignDiverseVoices(speakers);
        const speakerData = speakers.map(s => {
          const voice = diverseVoices.get(s.id);
          return {
            id: s.id,
            gender: s.gender,
            total_speaking_time: s.totalSpeakingTime || 0,
            customVoice: voice?.id
          };
        });
        audioTranslation.initializeVoices(speakerData);
      }
      
      console.log('[v129] Initialized voices for', speakers.length, 'speakers');
    }
  }, [speakers, audioEnabled, voiceAssignmentCompleted, customVoiceAssignments]);

  // === PROCESS SEGMENTS INTO PHRASES ===
  useEffect(() => {
    if (allSegments.length === 0) {
      setPhrases([]);
      return;
    }

    const processedPhrases = processIntoPhrases(allSegments);
    setPhrases(processedPhrases);
    
    // v79: Feed adapted segments with currentTime for priority ordering
    if (audioEnabled && allSegments.length > 0) {
      const adapted = adaptSegmentsForAudio(allSegments, targetLanguage);
      audioTranslation.addSegments(adapted, currentTimeRef.current);
      // v122: Removed adaptedSegmentsRef/avgSegmentDurationRef updates (no periodic sync)
    }
    
    console.log('[v129] Processed', processedPhrases.length, 'phrases from', allSegments.length, 'segments');
  }, [allSegments, audioEnabled]);

  // === UPDATE PLAYBACK POSITION ===
  useEffect(() => {
    if (isReady && (subtitlesEnabled || audioEnabled)) {
      updatePlaybackPosition(currentTime);
    }
  }, [currentTime, isReady, subtitlesEnabled, audioEnabled, updatePlaybackPosition]);

  // === SUBTITLE DISPLAY LOGIC ===
  useEffect(() => {
    if (!isReady || phrases.length === 0) {
      if (displayedSubtitle !== '') {
        setDisplayedSubtitle('');
        onSubtitleChange('');
      }
      return;
    }
    
    if (!subtitlesEnabled) {
      if (displayedSubtitle !== '') {
        setDisplayedSubtitle('');
        onSubtitleChange('');
      }
      return;
    }
    
    const time = currentTime;
    const { phrase, index } = findPhraseAtTime(phrases, time);
    
    if (!phrase) {
      if (displayedSubtitle !== '') {
        setDisplayedSubtitle('');
        onSubtitleChange('');
        setCurrentPhraseIndex(-1);
      }
      return;
    }
    
    setCurrentPhraseIndex(index);
    
    if (displayMode === 'full') {
      if (displayedSubtitle !== phrase.text) {
        setDisplayedSubtitle(phrase.text);
        onSubtitleChange(phrase.text);
      }
    } else {
      const words = phrase.words;
      
      let visibleText = '';
      for (const w of words) {
        if (time >= w.startTime) {
          visibleText += (visibleText ? ' ' : '') + w.word;
        }
      }
      
      if (displayedSubtitle !== visibleText) {
        setDisplayedSubtitle(visibleText);
        onSubtitleChange(visibleText);
      }
    }
  }, [currentTime, phrases, subtitlesEnabled, displayMode, isReady]);

  // === v122: AUDIO TRIGGER LOGIC REMOVED ===
  // v115 had a useEffect that watched currentTime and called playSegmentAudio
  // to trigger audio for each segment. This conflicted with v80's auto-advance.
  // v122: ALL segment playback is now handled by the v80 hook.
  // The hook's auto-advance plays the next segment when the current one ends.

  // === LOOP MODE ===
  useEffect(() => {
    if (!loopModeEnabled || loopStartTime === null || loopEndTime === null) return;
    if (!onSeekVideo) return;
    
    if (currentTime >= loopEndTime) {
      const now = Date.now();
      if (now - lastLoopTriggerRef.current > 1000) {
        lastLoopTriggerRef.current = now;
        setLoopCount(prev => prev + 1);
        onSeekVideo(loopStartTime);
        currentlyPlayingSegmentRef.current = null;
        lastTriggeredPhraseIdRef.current = null;
      }
    }
  }, [currentTime, loopModeEnabled, loopStartTime, loopEndTime, onSeekVideo]);

  const handleToggleLoopMode = useCallback(() => {
    if (loopModeEnabled) {
      setLoopModeEnabled(false);
      setLoopStartTime(null);
      setLoopEndTime(null);
      setLoopCount(0);
      addNotification({ type: 'info', title: 'Loop Disabled', message: 'Normal playback resumed', duration: 3000 });
    } else {
      const startParsed = parseTimeInput(loopStartInput);
      const endParsed = parseTimeInput(loopEndInput);
      
      if (startParsed === null || endParsed === null) {
        addNotification({ type: 'error', title: 'Invalid Times', message: 'Enter valid times (e.g., 0:30 or 30)', duration: 4000 });
        return;
      }
      
      if (startParsed >= endParsed) {
        addNotification({ type: 'error', title: 'Invalid Range', message: 'Start time must be before end time', duration: 4000 });
        return;
      }
      
      setLoopStartTime(startParsed);
      setLoopEndTime(endParsed);
      setLoopModeEnabled(true);
      setLoopCount(0);
      
      if (onSeekVideo) {
        onSeekVideo(startParsed);
      }
      
      addNotification({ type: 'success', title: '🔄 Loop Active', message: `Looping ${formatTime(startParsed)} - ${formatTime(endParsed)}`, duration: 4000 });
    }
  }, [loopModeEnabled, loopStartInput, loopEndInput, onSeekVideo, addNotification]);

  // === TOGGLE SUBTITLES ===
  const handleToggleSubtitles = useCallback(() => {
    if (subtitlesEnabled) {
      setSubtitlesEnabled(false);
      setDisplayedSubtitle('');
      onSubtitleChange('');
      addNotification({ type: 'info', title: '📝 Subtitles Off', message: 'Subtitles hidden', duration: 3000 });
    } else {
      setSubtitlesEnabled(true);
      addNotification({ type: 'success', title: '📝 Subtitles On', message: 'Showing translated text', duration: 3000 });
    }
  }, [subtitlesEnabled, onSubtitleChange, addNotification]);

  // v80: handleToggleAudio REMOVED - Audio On/Off button was redundant in audio-only mode.
  // Audio auto-enables when processing completes. Use "Stop & Reset" to disable.

  // =====================================================================
  // v75: Handle option selection
  // =====================================================================
  const handleSelectOption = async (outputMode: OutputMode, langCode: string) => {
    console.log('[v129] handleSelectOption:', { outputMode, langCode });
    
    setIsInitialProcessing(true);
    
    setPendingOutputMode(outputMode);
    setHasAutoEnabled(false);
    
    processedDiarizationRef.current = false;
    prevSpeakerCountRef.current = 0;
    setSpeakersReadyForAssignment(false);
    setLocalDetectedSpeakers([]);
    
    setVoiceAssignmentCompleted(false);
    setCustomVoiceAssignments(null);
    setShowVoiceAssignment(false);
    setAutoVoiceMap(new Map());
    
    setAudioEnabled(false);
    audioEnabledRef.current = false;
    
    setUserHasStartedPlayback(false);
    userHasStartedPlaybackRef.current = false;
    
    // v83: Reset autoplay workaround state
    setAudioHasPlayed(false);
    // v112: Reset button visibility
    setShowStartButton(false);
    buttonShownRef.current = false; // v112: Reset ref so button can show again
    setVideoHasStarted(false);
    
    setShowModal(false);
    setTargetLanguage(langCode);
    
    let processingMsg = 'Loading with AssemblyAI speaker detection...';
    if (outputMode === 'subtitles_only') {
      processingMsg = 'Generating subtitles via AssemblyAI...';
    } else if (outputMode === 'audio_only') {
      processingMsg = 'Preparing audio translation...';
    } else {
      processingMsg = 'Preparing audio + subtitles...';
    }
    
    addNotification({
      type: 'info',
      title: '🎬 Starting AssemblyAI Transcription',
      message: processingMsg,
      duration: 5000
    });
    
    try {
      // v94: Log explicit language enforcement for transcription + TTS pipeline
      console.log(`[v129] 🌐 Starting transcription with targetLanguage='${langCode}' - ALL TTS output will be in ${langCode === 'en' ? 'English' : langCode}`);
      console.log('[v129] 🌐 Language enforcement: TTS will generate audio in target language regardless of source audio language');
      
      await startTranscription({
        videoId,
        targetLanguage: langCode,
        videoDuration: duration,
        chunkDuration: 180,
        bufferAhead: 120
      });
      
      setTimeout(() => {
        setIsInitialProcessing(false);
        console.log('[v129] ✓ Initial processing complete, cleared flag');
      }, 500);
      
    } catch (err) {
      console.error('[v129] Processing error:', err);
      setPendingOutputMode(null);
      setIsInitialProcessing(false);
      addNotification({
        type: 'error',
        title: 'Processing Failed',
        message: String(err),
        duration: 8000
      });
    }
  };

  // === v123: EMERGENCY STOP - immediate stop of everything ===
  const handleEmergencyStop = useCallback(() => {
    console.log('[v129] 🛑 EMERGENCY STOP activated');
    
    // Stop all audio immediately
    audioTranslation.stopAudio?.();
    audioTranslation.pauseAudio?.();
    
    // Pause video
    onPauseVideo?.();
    
    // Unmute YouTube
    if (onUnmuteYouTube) {
      console.log('[v129] 🔊 Emergency: Unmuting YouTube');
      onUnmuteYouTube();
    }
    
    // Disable audio
    setAudioEnabled(false);
    audioEnabledRef.current = false;
    
    // Reset user-initiated flag - this blocks all future playAtTime calls
    userInitiatedProcessingRef.current = false;
    playbackStartedRef.current = false;
    
    // v126: Close playback gate in hook - stops watchdog and auto-advance
    audioTranslation.setPlaybackAllowed?.(false);
    
    // Reset playback state
    setUserHasStartedPlayback(false);
    userHasStartedPlaybackRef.current = false;
    setAudioHasPlayed(false);
    setShowStartButton(false);
    buttonShownRef.current = false;
    setVideoHasStarted(false);
    
    // Reset play guard
    initialPlayGuardRef.current = false;
    if (initialPlayGuardTimerRef.current) {
      clearTimeout(initialPlayGuardTimerRef.current);
      initialPlayGuardTimerRef.current = null;
    }
    
    console.log('[v129] ✅ Emergency stop complete - all audio stopped, YouTube unmuted');
    
    addNotification({
      type: 'info',
      title: '🛑 Emergency Stop',
      message: 'All audio stopped, YouTube audio restored',
      duration: 4000
    });
  }, [audioTranslation, onPauseVideo, onUnmuteYouTube, addNotification]);

  // === STOP ===
  const handleStop = useCallback(() => {
    stopTranscription();
    audioTranslation.clearAll();
    setSubtitlesEnabled(false);
    setAudioEnabled(false);
    audioEnabledRef.current = false;
    // v123: Reset user-initiated flag on full stop
    userInitiatedProcessingRef.current = false;
    // v126: Close playback gate in hook
    audioTranslation.setPlaybackAllowed?.(false);
    setPendingOutputMode(null);
    setHasAutoEnabled(false);
    setIsInitialProcessing(false);
    
    processedDiarizationRef.current = false;
    prevSpeakerCountRef.current = 0;
    setSpeakersReadyForAssignment(false);
    setLocalDetectedSpeakers([]);
    
    setVoiceAssignmentCompleted(false);
    setCustomVoiceAssignments(null);
    setShowVoiceAssignment(false);
    setAutoVoiceMap(new Map());
    
    setUserHasStartedPlayback(false);
    userHasStartedPlaybackRef.current = false;
    
    // v83: Reset autoplay workaround state
    setAudioHasPlayed(false);
    // v112: Reset button visibility
    setShowStartButton(false);
    buttonShownRef.current = false; // v112: Reset ref so button can show again
    setVideoHasStarted(false);
    
    setDisplayedSubtitle('');
    onSubtitleChange('');
    setLoopModeEnabled(false);
    setLoopStartTime(null);
    setLoopEndTime(null);
    setLoopCount(0);
    
    currentlyPlayingSegmentRef.current = null;
    // v122: Removed currentlyPlayingSegmentIndexRef reset (ref removed)
    lastPlayedPhraseRef.current = null;
    lastTriggeredPhraseIdRef.current = null;
    
    // v100: Reset initial play guard so next playback works normally
    initialPlayGuardRef.current = false;
    if (initialPlayGuardTimerRef.current) {
      clearTimeout(initialPlayGuardTimerRef.current);
      initialPlayGuardTimerRef.current = null;
    }
    
    if (onUnmuteYouTube) {
      console.log('[v129] Unmuting YouTube audio on stop');
      onUnmuteYouTube();
    }
    
    addNotification({ type: 'info', title: 'Stopped', message: 'YouTube audio restored', duration: 3000 });
  }, [stopTranscription, onSubtitleChange, addNotification, onUnmuteYouTube]);

  // Calculate stats
  const stats = useMemo(() => {
    if (phrases.length === 0) return null;
    const first = phrases[0];
    const last = phrases[phrases.length - 1];
    const avgDuration = phrases.reduce((sum, p) => sum + (p.endTime - p.startTime), 0) / phrases.length;
    
    return {
      totalPhrases: phrases.length,
      coverageStart: first.startTime,
      coverageEnd: last.displayEnd,
      avgDuration
    };
  }, [phrases]);

  const bufferStatus = useMemo(() => {
    const loadedChunks = chunks.filter(c => c.status === 'ready' || c.status === 'loaded').length;
    const loadingChunks = chunks.filter(c => c.status === 'loading').length;
    const failedChunks = chunks.filter(c => c.status === 'error').length;
    
    return { loadedChunks, loadingChunks, failedChunks, total: chunks.length };
  }, [chunks]);

  const currentPhrase = currentPhraseIndex >= 0 ? phrases[currentPhraseIndex] : null;

  const detectedSpeakers: DetectedSpeaker[] = localDetectedSpeakers;

  // === RENDER ===
  return (
    <div className="w-full bg-gray-900 rounded-xl shadow-xl overflow-hidden">
      <NotificationContainer notifications={notifications} onDismiss={removeNotification} />
      
      {/* v123: Emergency Stop Button - fixed position, always visible when audio is enabled */}
      {audioEnabled && userInitiatedProcessingRef.current && (
        <button
          onClick={handleEmergencyStop}
          style={{
            position: 'fixed',
            top: '10px',
            right: '10px',
            zIndex: 100000,
            backgroundColor: '#dc2626',
            color: 'white',
            padding: '8px 16px',
            border: '2px solid #fca5a5',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
            boxShadow: '0 4px 12px rgba(220, 38, 38, 0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          🛑 STOP ALL
        </button>
      )}
      
      {/* v128: VISIBLE VERSION INDICATOR — proves which hook version is running */}
      <div style={{
        position: 'fixed',
        top: '10px',
        left: '10px',
        backgroundColor: '#ff0000',
        color: '#ffffff',
        padding: '8px 16px',
        fontSize: '20px',
        fontWeight: 'bold',
        zIndex: 99999,
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        fontFamily: 'monospace',
        border: '2px solid #ffcccc',
        pointerEvents: 'none',
      }}>
        HOOK v96
      </div>

      {/* Header - v108 */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-3">
        <h3 className="text-white font-semibold text-lg">
          🎙️ Audio Clarification <span className="text-purple-200 text-sm font-normal">v129</span>
        </h3>
        <p className="text-purple-200 text-xs">v129 Stale Closure Fix</p>
      </div>
      
      {/* Buffer Status Banner */}
      {isReady && (
        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="text-gray-400">
                Buffer: <span className="text-green-400 font-mono">{formatTime(loadedRange.end)}</span>
              </span>
              {hasSpeakerInfo && speakers && (
                <span className="text-gray-400">
                  Speakers: <span className="text-purple-400">{speakers.length}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isLoadingChunk && (
                <span className="text-blue-400 flex items-center gap-1">
                  <span className="animate-pulse">●</span> Loading...
                </span>
              )}
              {audioTranslation.isGenerating && (
                <span className="text-purple-400 flex items-center gap-1">
                  <span className="animate-pulse">●</span> Generating audio...
                </span>
              )}
            </div>
          </div>
          <div className="mt-1 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
              style={{ width: `${duration > 0 ? (loadedRange.end / duration) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
      
      {/* Speaker Info with voice assignments */}
      {isReady && hasSpeakerInfo && speakers && speakers.length > 0 && (
        <div className="bg-gray-800/50 px-4 py-2 border-b border-gray-700">
          <div className="flex flex-wrap gap-2 text-xs">
            {speakers.map(speaker => {
              const voiceInfo = autoVoiceMap.get(speaker.id);
              const customAssignment = customVoiceAssignments?.find(a => a.speakerId === speaker.id);
              const displayVoice = customAssignment?.voiceName || voiceInfo?.name;
              return (
                <span 
                  key={speaker.id}
                  className={`px-2 py-1 rounded-full ${getSpeakerColor(speaker.id)} bg-gray-700/50`}
                >
                  {getGenderIcon(speaker.gender)} {formatSpeakerLabel(speaker.id, 'short')}
                  {displayVoice && (
                    <span className="ml-1 text-purple-300">→{displayVoice}</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Main Content */}
      <div className="p-4 space-y-4">
        {/* Initial State */}
        {!isReady && !isInitializing && (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">Click below to start audio clarification</p>
            <button
              onClick={() => setShowModal(true)}
              className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-lg font-semibold hover:from-purple-600 hover:to-blue-600 transition-all"
            >
              🎧 Start Audio Clarification
            </button>
          </div>
        )}
        
        {/* v76+: Multi-Step Processing Progress Indicator */}
        {(isInitializing || (isInitialProcessing && !hasAutoEnabled) || (pendingOutputMode && !isReady)) && (() => {
          const needsAudio = pendingOutputMode === 'audio_only' || pendingOutputMode === 'audio_and_subtitles';
          const step1Done = !isInitializing && isReady;
          const step2Done = speakersReadyForAssignment;
          const step3Done = voiceAssignmentCompleted;
          const step4Done = hasAutoEnabled;
          
          let currentStep = 1;
          let progressPercent = 10;
          let stepMessage = 'Uploading audio & starting transcription...';
          
          if (step1Done && needsAudio) {
            currentStep = 2;
            progressPercent = 35;
            stepMessage = 'Analyzing speakers in audio...';
          }
          if (step2Done && needsAudio) {
            currentStep = 3;
            progressPercent = 60;
            stepMessage = 'Assigning unique voices to speakers...';
          }
          if (step3Done && needsAudio) {
            currentStep = 4;
            progressPercent = 80;
            stepMessage = 'Generating translated speech audio...';
          }
          if (step4Done) {
            progressPercent = 100;
            stepMessage = 'Ready! Press YouTube ▶ play button to start.';
          }
          if (pendingOutputMode === 'subtitles_only') {
            if (step1Done) {
              progressPercent = 100;
              stepMessage = 'Subtitles ready!';
            } else {
              progressPercent = 30;
              stepMessage = 'Transcribing audio for subtitles...';
            }
          }
          if (isInitializing) {
            progressPercent = 20;
            stepMessage = 'Uploading audio to AssemblyAI for transcription...';
          }
          
          const totalSteps = needsAudio ? 4 : 1;
          
          return (
            <div className="py-4">
              <div className="bg-gray-800 border border-purple-500/30 rounded-xl p-6 space-y-5 shadow-lg shadow-purple-500/10">
                {/* Animated header with large spinner */}
                <div className="flex items-center gap-4 justify-center">
                  <div className="relative flex-shrink-0">
                    <div className="w-14 h-14 border-4 border-purple-500/20 rounded-full"></div>
                    <div className="absolute inset-0 w-14 h-14 border-4 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg">{step4Done ? '✅' : '🎧'}</span>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold text-lg">Processing Audio</h4>
                    <p className="text-purple-300 text-sm animate-pulse">{stepMessage}</p>
                  </div>
                </div>
                
                {/* Step indicators (only for audio modes) */}
                {needsAudio && (
                  <div className="space-y-3 px-2">
                    {/* Step 1: Transcription */}
                    <div className="flex items-center gap-3">
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        step1Done ? 'bg-green-500 text-white' : isInitializing ? 'bg-purple-500 text-white animate-pulse' : 'bg-gray-700 text-gray-500'
                      }`}>
                        {step1Done ? '✓' : isInitializing ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : '1'}
                      </div>
                      <span className={`text-sm ${step1Done ? 'text-green-400' : isInitializing ? 'text-white font-medium' : 'text-gray-500'}`}>
                        Transcribing audio via AssemblyAI
                      </span>
                      {isInitializing && (
                        <span className="text-xs text-purple-400 ml-auto">~15-20s</span>
                      )}
                      {step1Done && (
                        <span className="text-xs text-green-500 ml-auto">Done ✓</span>
                      )}
                    </div>
                    
                    {/* Step 2: Speaker Detection */}
                    <div className="flex items-center gap-3">
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        step2Done ? 'bg-green-500 text-white' : (step1Done && !step2Done) ? 'bg-purple-500 text-white animate-pulse' : 'bg-gray-700 text-gray-500'
                      }`}>
                        {step2Done ? '✓' : (step1Done && !step2Done) ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : '2'}
                      </div>
                      <span className={`text-sm ${step2Done ? 'text-green-400' : (step1Done && !step2Done) ? 'text-white font-medium' : 'text-gray-500'}`}>
                        Detecting speakers
                      </span>
                      {step2Done && speakerCount > 0 && (
                        <span className="text-xs text-green-500 ml-auto">{speakerCount} speaker{speakerCount !== 1 ? 's' : ''} found ✓</span>
                      )}
                    </div>
                    
                    {/* Step 3: Voice Assignment */}
                    <div className="flex items-center gap-3">
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        step3Done ? 'bg-green-500 text-white' : (step2Done && !step3Done) ? 'bg-purple-500 text-white animate-pulse' : 'bg-gray-700 text-gray-500'
                      }`}>
                        {step3Done ? '✓' : (step2Done && !step3Done) ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : '3'}
                      </div>
                      <span className={`text-sm ${step3Done ? 'text-green-400' : (step2Done && !step3Done) ? 'text-white font-medium' : 'text-gray-500'}`}>
                        Assigning voices to speakers
                      </span>
                      {step3Done && (
                        <span className="text-xs text-green-500 ml-auto">Voices assigned ✓</span>
                      )}
                    </div>
                    
                    {/* Step 4: TTS Generation */}
                    <div className="flex items-center gap-3">
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        step4Done ? 'bg-green-500 text-white' : (step3Done && !step4Done) ? 'bg-purple-500 text-white animate-pulse' : 'bg-gray-700 text-gray-500'
                      }`}>
                        {step4Done ? '✓' : (step3Done && !step4Done) ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : '4'}
                      </div>
                      <span className={`text-sm ${step4Done ? 'text-green-400' : (step3Done && !step4Done) ? 'text-white font-medium' : 'text-gray-500'}`}>
                        Generating translated speech
                      </span>
                      {step4Done && (
                        <span className="text-xs text-green-500 ml-auto">Ready ✓</span>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Subtitles-only: simpler indicator */}
                {pendingOutputMode === 'subtitles_only' && (
                  <div className="space-y-3 px-2">
                    <div className="flex items-center gap-3">
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        step1Done ? 'bg-green-500 text-white' : 'bg-purple-500 text-white animate-pulse'
                      }`}>
                        {step1Done ? '✓' : (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        )}
                      </div>
                      <span className={`text-sm ${step1Done ? 'text-green-400' : 'text-white font-medium'}`}>
                        Transcribing audio for subtitles
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 rounded-full transition-all duration-1000 ease-out"
                      style={{ 
                        width: `${progressPercent}%`,
                        backgroundSize: '200% 100%',
                        animation: step4Done ? 'none' : 'shimmer 2s linear infinite'
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Step {Math.min(currentStep, totalSteps)} of {totalSteps}</span>
                    <span>{progressPercent}%</span>
                  </div>
                </div>
                
                {/* Estimated time message */}
                {!step4Done && (
                  <p className="text-gray-500 text-xs text-center">
                    ⏱️ This typically takes 15-30 seconds depending on video length
                  </p>
                )}
              </div>
              
              {/* CSS for shimmer animation */}
              <style>{`
                @keyframes shimmer {
                  0% { background-position: 200% 0; }
                  100% { background-position: -200% 0; }
                }
              `}</style>
            </div>
          );
        })()}
        
        {/* Ready State */}
        {isReady && (
          <div className="space-y-4">
            
            {/* v75: YouTube muted + auto-playing indicator */}
            {audioEnabled && (
              <div className="bg-green-900/40 border border-green-500/50 rounded-lg p-3 text-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-green-400">🔇</span>
                  <span className="text-green-300">
                    YouTube muted • Translated audio {userHasStartedPlayback ? 'playing' : 'ready'}
                  </span>
                </div>
                {audioTranslation.isPlaying && (
                  <span className="text-green-400 animate-pulse">▶ Playing</span>
                )}
              </div>
            )}
            
            {/* v127: Ready notice - shown briefly before button appears (during auto-enable phase) */}
            {audioEnabled && !audioHasPlayed && !showStartButton && (
              <div className="bg-blue-900/40 border border-blue-500/50 rounded-lg p-3 text-sm flex items-center gap-2">
                <span className="text-blue-400">⏳</span>
                <span className="text-blue-300">Preparing audio clarification...</span>
              </div>
            )}
            
            {/* v112: START WATCHING BUTTON - Full-screen overlay with large centered button */}
            {showStartButton && (
              <div 
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  zIndex: 99999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  cursor: 'pointer'
                }}
                onClick={handleStartWatching}
              >
                <style>{`
                  @keyframes v112ButtonPulse {
                    0%, 100% { transform: scale(1); box-shadow: 0 10px 40px rgba(22, 163, 74, 0.4); }
                    50% { transform: scale(1.03); box-shadow: 0 15px 50px rgba(22, 163, 74, 0.6); }
                  }
                `}</style>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartWatching();
                  }}
                  style={{
                    fontSize: '2rem',
                    padding: '1.5rem 3rem',
                    borderRadius: '1rem',
                    background: 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: 'white',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    boxShadow: '0 10px 40px rgba(22, 163, 74, 0.4)',
                    border: 'none',
                    pointerEvents: 'auto',
                    animation: 'v112ButtonPulse 2s ease-in-out infinite',
                    letterSpacing: '0.5px',
                    lineHeight: 1.4
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '2.5rem' }}>▶</span>
                    <span>Start Watching</span>
                  </div>
                </button>
              </div>
            )}
            
            {/* Subtitle Control - v80: Audio button removed (auto-enables, use Stop & Reset to disable) */}
            <div>
              <button
                onClick={handleToggleSubtitles}
                className={`w-full py-3 rounded-lg font-semibold text-base transition-all flex items-center justify-center gap-2 ${
                  subtitlesEnabled
                    ? 'bg-blue-500 hover:bg-blue-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                <span>📝</span>
                Subtitles {subtitlesEnabled ? 'On' : 'Off'}
              </button>
            </div>
            
            {/* Voice Assignments Display + Change link */}
            {voiceAssignmentCompleted && speakers && speakers.length > 0 && (
              <div className="bg-purple-900/30 border border-purple-500/30 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-purple-300 text-sm">
                    🎤 {customVoiceAssignments ? 'Custom' : 'Auto'} voices: {
                      speakers.map(s => {
                        const voice = autoVoiceMap.get(s.id);
                        return `${formatSpeakerLabel(s.id, 'short')}→${voice?.name || '?'}`;
                      }).join(', ')
                    }
                  </span>
                  <button
                    onClick={() => setShowVoiceAssignment(true)}
                    className="text-purple-400 hover:text-purple-300 text-xs underline"
                  >
                    Change voices
                  </button>
                </div>
              </div>
            )}
            
            {/* Audio Generation Status */}
            {audioEnabled && (
              <div className="bg-purple-900/30 rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between text-purple-300">
                  <span>Audio generated: {audioTranslation.generatedCount}/{audioTranslation.totalCount}</span>
                  {audioTranslation.isGenerating && (
                    <span className="animate-pulse">Generating...</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Display Mode */}
            {subtitlesEnabled && (
              <div className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3">
                <span className="text-gray-300 text-sm">Display Mode:</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDisplayMode('karaoke')}
                    className={`px-3 py-1 text-xs rounded ${
                      displayMode === 'karaoke' 
                        ? 'bg-purple-500 text-white' 
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    Karaoke
                  </button>
                  <button
                    onClick={() => setDisplayMode('full')}
                    className={`px-3 py-1 text-xs rounded ${
                      displayMode === 'full' 
                        ? 'bg-purple-500 text-white' 
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    Full Text
                  </button>
                </div>
              </div>
            )}
            
            {/* Current Phrase Info */}
            {stats && (
              <div className="text-xs text-gray-500 flex justify-between items-center">
                <span>
                  Time: {formatTime(currentTime)} Phrase: {currentPhraseIndex >= 0 ? currentPhraseIndex + 1 : '-'} - Coverage: {formatTime(stats.coverageEnd)}
                </span>
              </div>
            )}
            
            {/* Loop Mode */}
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-gray-300 text-sm">🔄 Loop Mode</span>
                {loopModeEnabled && (
                  <span className="text-green-400 text-xs">({loopCount} loops)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={loopStartInput}
                  onChange={(e) => setLoopStartInput(e.target.value)}
                  placeholder="Start"
                  className="w-20 px-2 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:border-purple-500 focus:outline-none"
                  disabled={loopModeEnabled}
                />
                <span className="text-gray-500">-</span>
                <input
                  type="text"
                  value={loopEndInput}
                  onChange={(e) => setLoopEndInput(e.target.value)}
                  placeholder="End"
                  className="w-20 px-2 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:border-purple-500 focus:outline-none"
                  disabled={loopModeEnabled}
                />
                <button
                  onClick={handleToggleLoopMode}
                  className={`px-3 py-1 text-sm rounded transition-all ${
                    loopModeEnabled
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-purple-500 hover:bg-purple-600 text-white'
                  }`}
                >
                  {loopModeEnabled ? 'Stop Loop' : 'Start Loop'}
                </button>
              </div>
            </div>
            
            {/* Stop Button */}
            <button
              onClick={handleStop}
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-all"
            >
              ⏹ Stop & Reset
            </button>
          </div>
        )}
        
        {/* Error */}
        {error && (
          <div className="bg-red-900/40 border border-red-500/50 rounded-lg p-3 text-red-300 text-sm">
            Error: {error}
          </div>
        )}
      </div>
      
      {/* Processing Options Modal */}
      {showModal && (
        <ProcessingOptionsModal
          onSelectOption={handleSelectOption}
          onClose={() => setShowModal(false)}
          isOpen={showModal}
        />
      )}
      
      {/* Voice Assignment Modal (only when user clicks "Change voices") */}
      {showVoiceAssignment && detectedSpeakers.length > 0 && (
        <SpeakerVoiceAssignment
          speakers={detectedSpeakers}
          onApply={handleApplyVoices}
          onUseAuto={handleUseAutoAssignment}
          existingAssignments={customVoiceAssignments || undefined}
        />
      )}
    </div>
  );
}