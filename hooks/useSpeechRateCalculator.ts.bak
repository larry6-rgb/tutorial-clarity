/**
 * useSpeechRateCalculator - George's Speech Rate Calculator
 * Adapted from useAudioTranslation v102.3.2
 * 
 * Calculates speech rate from transcript segments with word-level timing.
 * Used for diagnostic analysis and TTS speed calibration.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
};

type WordHistoryEntry = {
  word: string;
  time: number;
  index: number;
};

export interface SpeechRateResult {
  wordsPerSecond: number;
  timeSpan: number;
  wordCount: number;
  firstWord: string;
  lastWord: string;
  startTime: number;
  endTime: number;
}

const MAX_WORDS_TO_TRACK = 10; // Increased from 5 for better accuracy

function normalizeWord(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  return '';
}

function readTimeValue(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

export function useSpeechRateCalculator() {
  const [isCalculating, setIsCalculating] = useState(false);
  const [currentSpeechRate, setCurrentSpeechRate] = useState<number | null>(null);
  const [wordCount, setWordCount] = useState(0);
  
  const transcriptRef = useRef<TranscriptWord[]>([]);
  const calculationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wordHistoryRef = useRef<WordHistoryEntry[]>([]);
  const currentTimeRef = useRef<number>(0);

  /**
   * Parse segments into word-level transcript
   * Accepts segments from useChunkedTranscription
   */
  const parseSegments = useCallback((segments: any[]) => {
    const words: TranscriptWord[] = [];
    
    console.log('[GEORGE v137] 🔍 Parsing', segments.length, 'segments for speech rate calculation');

    segments.forEach((seg: any, segIdx: number) => {
      const text = String(seg?.text ?? '');
      if (!text.trim()) return;

      // Get segment timing (supports multiple formats)
      const segStart = readTimeValue(seg?.start, seg?.startTime, seg?.start_time);
      const segEnd = readTimeValue(seg?.end, seg?.endTime, seg?.end_time);
      const segDuration = readTimeValue(seg?.duration);
      
      // Calculate effective end time
      let effectiveEnd = segEnd;
      if (effectiveEnd <= segStart && segDuration > 0) {
        effectiveEnd = segStart + segDuration;
      }
      if (effectiveEnd <= segStart) {
        effectiveEnd = segStart + 1.0; // fallback
      }

      const segWords = text.split(/\s+/).filter((w: string) => w.length > 0);
      const totalDuration = effectiveEnd - segStart;
      const timePerWord = segWords.length > 0 ? totalDuration / segWords.length : 0;

      // Create word-level timings
      segWords.forEach((word: string, wordIdx: number) => {
        const cleanedWord = normalizeWord(word.replace(/[.,!?;:]+$/, ''));
        if (!cleanedWord) return;

        const wordStart = segStart + (wordIdx * timePerWord);
        words.push({
          word: cleanedWord,
          start: wordStart,
          end: wordStart + Math.max(timePerWord, 0.05),
        });
      });

      if (segIdx < 3) {
        console.log(`[GEORGE v137]   Segment ${segIdx}: "${text.substring(0, 40)}..." → ${segWords.length} words (${segStart.toFixed(2)}s - ${effectiveEnd.toFixed(2)}s)`);
      }
    });

    transcriptRef.current = words;
    setWordCount(words.length);

    console.log('[GEORGE v137] ✅ Parsed', words.length, 'total words for speech rate tracking');
    
    if (words.length > 0) {
      console.log('[GEORGE v137] First 5 words:');
      words.slice(0, 5).forEach((w, idx) => {
        console.log(`  [${idx}] "${w.word}" (${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s)`);
      });
    }

    return words.length;
  }, []);

  /**
   * Find word at specific time
   */
  const findWordAtTime = useCallback((time: number): TranscriptWord | null => {
    if (!transcriptRef.current.length) return null;

    for (const wordData of transcriptRef.current) {
      if (wordData.start <= time && time <= wordData.end) {
        return wordData;
      }
    }
    return null;
  }, []);

  /**
   * Calculate speech rate from tracked words
   */
  const calculateSpeechRate = useCallback((history: WordHistoryEntry[]): SpeechRateResult | null => {
    if (history.length < 2) {
      console.log('[GEORGE v137] ⚠️ Not enough words to calculate rate (need at least 2)');
      return null;
    }

    const firstWord = history[0];
    const lastWord = history[history.length - 1];
    const timeSpan = lastWord.time - firstWord.time;

    if (timeSpan <= 0) {
      console.log('[GEORGE v137] ⚠️ Time span too small:', timeSpan);
      return null;
    }

    const wordCount = history.length;
    const speechRate = wordCount / timeSpan;

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('📊 GEORGE v137 - SPEECH RATE CALCULATION COMPLETE');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  First word: "${firstWord.word}" at ${firstWord.time.toFixed(2)}s`);
    console.log(`  Last word:  "${lastWord.word}" at ${lastWord.time.toFixed(2)}s`);
    console.log(`  Time span:  ${timeSpan.toFixed(2)} seconds`);
    console.log(`  Words:      ${wordCount} words`);
    console.log(`  Speech rate: ${speechRate.toFixed(2)} words/second`);
    console.log('');

    // Interpretation
    if (speechRate > 2.5) {
      console.log('💨 Very fast talker! TTS needs 1.3-1.5x speed increase.');
    } else if (speechRate > 1.8) {
      console.log('⚡ Fast pace. TTS needs 1.1-1.3x speed increase.');
    } else if (speechRate > 1.2) {
      console.log('🚶 Normal pace. TTS speed 1.0x is appropriate.');
    } else {
      console.log('🐢 Slow pace. TTS may need 0.8-0.9x speed.');
    }

    console.log('');
    console.log('Word history:');
    history.forEach((w, i) => {
      console.log(`  [${i}] "${w.word}" at ${w.time.toFixed(2)}s`);
    });
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    setCurrentSpeechRate(speechRate);

    return {
      wordsPerSecond: speechRate,
      timeSpan,
      wordCount,
      firstWord: firstWord.word,
      lastWord: lastWord.word,
      startTime: firstWord.time,
      endTime: lastWord.time,
    };
  }, []);

  /**
   * Update current playback time for tracking
   */
  const updateTime = useCallback((time: number) => {
    currentTimeRef.current = time;
  }, []);

  /**
   * Start speech rate calculation
   */
  const startCalculation = useCallback(() => {
    if (isCalculating) {
      console.log('[GEORGE v137] Already calculating');
      return;
    }

    if (transcriptRef.current.length === 0) {
      console.log('[GEORGE v137] ⚠️ No transcript data loaded. Call parseSegments first.');
      return;
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('🤖 GEORGE v137 - SPEECH RATE TRACKING STARTED');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Tracking up to ${MAX_WORDS_TO_TRACK} words`);
    console.log(`  Total words available: ${transcriptRef.current.length}`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    setIsCalculating(true);
    wordHistoryRef.current = [];
    let wordsTracked = 0;
    let lastLoggedWordKey = '';

    calculationIntervalRef.current = setInterval(() => {
      const currentTime = currentTimeRef.current;
      const currentWord = findWordAtTime(currentTime);

      if (!currentWord || !currentWord.word) return;

      const wordKey = `${currentWord.word}_${currentWord.start.toFixed(3)}`;
      if (wordKey === lastLoggedWordKey) return;
      lastLoggedWordKey = wordKey;

      wordsTracked += 1;

      wordHistoryRef.current.push({
        word: currentWord.word,
        time: currentTime,
        index: wordsTracked - 1,
      });

      console.log(
        `[GEORGE v137] ${currentTime.toFixed(2)}s - Word #${wordsTracked}: "${currentWord.word}"`
      );

      if (wordsTracked >= MAX_WORDS_TO_TRACK) {
        calculateSpeechRate(wordHistoryRef.current);
        stopCalculation();
      }
    }, 200);
  }, [isCalculating, findWordAtTime, calculateSpeechRate]);

  /**
   * Stop speech rate calculation
   */
  const stopCalculation = useCallback(() => {
    if (calculationIntervalRef.current) {
      clearInterval(calculationIntervalRef.current);
      calculationIntervalRef.current = null;
    }
    setIsCalculating(false);
    console.log('[GEORGE v137] 🛑 Speech rate tracking stopped');
  }, []);

  /**
   * Reset all calculation state
   */
  const reset = useCallback(() => {
    stopCalculation();
    transcriptRef.current = [];
    wordHistoryRef.current = [];
    setWordCount(0);
    setCurrentSpeechRate(null);
    console.log('[GEORGE v137] 🔄 Calculator reset');
  }, [stopCalculation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (calculationIntervalRef.current) {
        clearInterval(calculationIntervalRef.current);
      }
    };
  }, []);

  return {
    // State
    isCalculating,
    currentSpeechRate,
    wordCount,
    
    // Methods
    parseSegments,
    startCalculation,
    stopCalculation,
    updateTime,
    reset,
  };
}

export default useSpeechRateCalculator;
