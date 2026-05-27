'use client';

/**
 * ClarifyAudioPanel — PROGRESSIVE WORKFLOW
 * 
 * 1. choosing:    ProcessingOptionsModal (mode + language)
 * 2. processing:  Fetches transcript + translates first 30 segments → ready fast
 * 3. ready:       Big green "Play Clarified Audio" button
 * 4. playing:     Pause button + volume + segment info (YouTube is muted)
 *                 Background: continues translating ahead of playback
 * 5. paused:      Resume button (YouTube is UNmuted)
 * 6. stopped:     Back to start
 * 
 * KEY FEATURES:
 * - SCHEDULER APPROACH: AI audio plays at natural speed (user's chosen speed)
 *   Each segment triggers when video reaches its timestamp. No rate-matching.
 * - MULTI-VOICE: Detects speaker changes via timing gaps, assigns male (onyx)
 *   and female (nova) voices automatically. Voices change when speakers change.
 * - LIVE OPTIONS: Speed changes apply immediately to playing audio.
 * - Progressive translation: 30-segment buffer, then translate ahead of playback
 * - Dual transcript: original (source lang) + translated, switchable by audio mode
 * - Speed control with bright orange styling
 * - Options button opens settings without restarting translation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import ProcessingOptionsModal, { OutputMode } from '@/app/hooks/ProcessingOptionsModal';
import { matchSpeakerSegments, type YouTubeSegment, type AssemblySegment } from '@/app/utils/matchSpeakerSegments';

export interface ClarifyTranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;  // Speaker ID (e.g., 'speaker_0', 'speaker_1')
}

interface AudioCache {
  [index: number]: {
    url?: string;
    useClientTTS?: boolean;
    generating?: boolean;
    voice?: string;  // Which TTS voice was used for this segment
    generatedAt?: number;  // Timestamp when this entry was created
  };
}

// Speaker voice configuration: maps speaker IDs to 'male' | 'female'
export type SpeakerConfig = Record<string, 'male' | 'female'>;

interface ClarifyAudioPanelProps {
  videoId: string;
  currentTime: number;
  aiPlaybackSpeed?: number;
  speakerConfig?: SpeakerConfig;           // Optional manual voice config per speaker
  onSpeakersDetected?: (speakers: string[]) => void;  // Callback when speakers are detected
  onSubtitleChange?: (subtitle: string | null) => void;
  onMuteYouTube?: (mute: boolean) => void;
  onPlayYouTube?: () => void;
  onTranscriptReady?: (segments: ClarifyTranscriptSegment[]) => void;
  onSegmentChange?: (index: number) => void;
  registerHandlers?: (handlers: { play: () => void; pause: () => void; isPlaying: () => boolean; regenerateVoices: (config?: SpeakerConfig) => void; detectWithAssemblyAI: () => Promise<string[]>; manualDetectSpeakers: () => string[]; testAudioBlobs: () => void; hasAudioBlobs: () => boolean }) => void;
}

// ═══ MULTI-VOICE SYSTEM — SMART ROTATION ═══
// All 6 OpenAI voices:
//   Female: nova, shimmer, fable
//   Male:   onyx, echo
//   Neutral: alloy
//
// Strategy:
//   Speakers 0-2: User picks male/female → deterministic voice from pool
//   Speakers 3+:  Auto-cycle through whichever voices weren't used by 0-2
//
// This keeps the main speakers distinct while providing variety for extras.
export const FEMALE_VOICES = ['nova', 'shimmer', 'fable'];
export const MALE_VOICES   = ['onyx', 'echo'];
const ALL_VOICES = ['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer'];

// Default voice when no speaker detection is possible
const DEFAULT_VOICE = 'onyx';

/**
 * Compute a deterministic voice assignment for every speaker in the config.
 *
 * ⚠️  THIS FUNCTION MUST ONLY BE CALLED ONCE — inside handleRegenerateVoices.
 *     If you see the call-counter exceed 1 in the logs, something is wrong.
 *
 * SMART ROTATION:
 *   1. Speakers 0-2 get voices from male/female pools based on user config
 *   2. Track which voices were used for speakers 0-2
 *   3. Speakers 3+ auto-cycle through the UNUSED voices (no overlap with main)
 *
 * Example: If user picks Nova(♀), Onyx(♂), Shimmer(♀) for speakers 0-2,
 *   speakers 3+ cycle through: alloy, fable, echo (the 3 unused voices)
 */
let _assignCallCounter = 0;  // GUARD: tracks how many times this is called per session

export function assignVoicesToSpeakers(config: SpeakerConfig): Record<string, string> {
  _assignCallCounter++;
  console.log(`[ASSIGN-VOICES] ════════════════════════════════════════`);
  console.log(`[ASSIGN-VOICES] CALL #${_assignCallCounter} — THIS SHOULD ONLY BE CALLED ONCE PER APPLY!`);
  if (_assignCallCounter > 1) {
    console.warn(`[ASSIGN-VOICES] ⚠️ WARNING: Called ${_assignCallCounter} times! Should be 1.`);
  }
  console.log(`[ASSIGN-VOICES] Config:`, JSON.stringify(config));

  const voiceMap: Record<string, string> = {};

  // Track which voices are used by speakers 0-2
  const usedVoices = new Set<string>();

  const sorted = Object.keys(config).sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] || '0');
    const nb = parseInt(b.match(/\d+/)?.[0] || '0');
    return na - nb;
  });

  const totalSpeakers = sorted.length;
  console.log(`[ASSIGN-VOICES] Processing ${totalSpeakers} speakers in order:`, sorted);

  // ── STEP 1: Assign voices for speakers 0-2 based on user config ──
  const mainSpeakers = sorted.filter(id => {
    const n = parseInt(id.match(/\d+/)?.[0] || '0');
    return n <= 2;
  });

  mainSpeakers.forEach(speakerId => {
    const gender = config[speakerId];
    let voice: string;

    if (gender === 'female') {
      // Female voices: nova, shimmer, fable — pick based on how many females assigned so far
      const femaleCount = Array.from(usedVoices).filter(v =>
        FEMALE_VOICES.includes(v)
      ).length;
      voice = FEMALE_VOICES[femaleCount % FEMALE_VOICES.length];
    } else {
      // Male voices: onyx, echo — pick based on how many males assigned so far
      const maleCount = Array.from(usedVoices).filter(v =>
        MALE_VOICES.includes(v)
      ).length;
      voice = MALE_VOICES[maleCount % MALE_VOICES.length];
    }

    voiceMap[speakerId] = voice;
    usedVoices.add(voice);
    console.log(`[ASSIGN-VOICES]   ${speakerId} (${gender}) → ${voice}`);
  });

  console.log(`[ASSIGN-VOICES] Speakers 0-2 assigned. Used voices:`, Array.from(usedVoices));

  // ── STEP 2: Get unused voices for speakers 3+ ──
  const unusedVoices = ALL_VOICES.filter(v => !usedVoices.has(v));
  console.log(`[ASSIGN-VOICES] Unused voices for speakers 3+:`, unusedVoices);

  // ── STEP 3: Auto-cycle unused voices for speakers 3+ ──
  const extraSpeakers = sorted.filter(id => {
    const n = parseInt(id.match(/\d+/)?.[0] || '0');
    return n > 2;
  });

  if (extraSpeakers.length > 0) {
    console.log(`[ASSIGN-VOICES] ========================================`);
    console.log(`[ASSIGN-VOICES] AUTO-ROTATION FOR SPEAKERS 3+`);
    console.log(`[ASSIGN-VOICES] Main speakers (0-2):`,
      Object.entries(voiceMap)
        .filter(([id]) => mainSpeakers.includes(id))
        .map(([id, voice]) => `${id}=${voice}`)
    );
    console.log(`[ASSIGN-VOICES] Unused voices pool:`, unusedVoices);
    console.log(`[ASSIGN-VOICES] Rotation pattern:`);

    // If somehow all 6 voices are used (shouldn't happen with 3 speakers), fall back to ALL_VOICES
    const rotationPool = unusedVoices.length > 0 ? unusedVoices : ALL_VOICES;

    extraSpeakers.forEach((speakerId, idx) => {
      const voiceIndex = idx % rotationPool.length;
      const voice = rotationPool[voiceIndex];
      voiceMap[speakerId] = voice;
      console.log(`[ASSIGN-VOICES]   ${speakerId} (auto) → ${voice} (index ${voiceIndex})`);
    });

    console.log(`[ASSIGN-VOICES] ========================================`);
  }

  console.log(`[ASSIGN-VOICES] FINAL:`, JSON.stringify(voiceMap));
  console.log(`[ASSIGN-VOICES] ════════════════════════════════════════`);
  return voiceMap;
}

/**
 * SILENT version of assignVoicesToSpeakers — for UI preview labels ONLY.
 * Does NOT log. Does NOT affect the frozen map. Safe to call on every render.
 * Uses the same smart rotation logic as the main function.
 */
export function previewVoiceAssignments(config: SpeakerConfig): Record<string, string> {
  const voiceMap: Record<string, string> = {};
  const usedVoices = new Set<string>();

  const sorted = Object.keys(config).sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] || '0');
    const nb = parseInt(b.match(/\d+/)?.[0] || '0');
    return na - nb;
  });

  // Speakers 0-2: user-configured
  sorted.forEach(id => {
    const n = parseInt(id.match(/\d+/)?.[0] || '0');
    if (n > 2) return;

    const gender = config[id];
    if (gender === 'female') {
      const femaleCount = Array.from(usedVoices).filter(v => FEMALE_VOICES.includes(v)).length;
      const voice = FEMALE_VOICES[femaleCount % FEMALE_VOICES.length];
      voiceMap[id] = voice;
      usedVoices.add(voice);
    } else {
      const maleCount = Array.from(usedVoices).filter(v => MALE_VOICES.includes(v)).length;
      const voice = MALE_VOICES[maleCount % MALE_VOICES.length];
      voiceMap[id] = voice;
      usedVoices.add(voice);
    }
  });

  // Speakers 3+: auto-cycle unused voices
  const unusedVoices = ALL_VOICES.filter(v => !usedVoices.has(v));
  const rotationPool = unusedVoices.length > 0 ? unusedVoices : ALL_VOICES;
  let extraIdx = 0;

  sorted.forEach(id => {
    const n = parseInt(id.match(/\d+/)?.[0] || '0');
    if (n <= 2) return;
    voiceMap[id] = rotationPool[extraIdx % rotationPool.length];
    extraIdx++;
  });

  return voiceMap;
}

/**
 * Detect speaker changes using MULTIPLE signals:
 * 1. Timing gaps (primary — large gaps = scene changes / speaker changes)
 * 2. Text signals (question→answer, greetings, sentence boundaries)
 * 3. Adaptive threshold based on gap distribution
 * 4. Fallback: try progressively lower thresholds
 *
 * YouTube captions often OVERLAP (negative gaps), so pure gap detection
 * misses within-scene speaker changes. Text signals fill that gap.
 */
function detectSpeakers(segments: ClarifyTranscriptSegment[], forceSkipIfAssemblyAI?: boolean): ClarifyTranscriptSegment[] {
  if (segments.length === 0) return segments;

  // ═══ FORCE-SKIP: If caller says AssemblyAI labels are active, return segments as-is ═══
  if (forceSkipIfAssemblyAI) {
    console.log(`[speaker-detect] ⛔ SKIPPED — forceSkipIfAssemblyAI=true, returning ${segments.length} segments unchanged`);
    return segments;
  }

  // ═══ CRITICAL: If segments already have AssemblyAI speaker labels, PRESERVE them! ═══
  // AssemblyAI labels look like "speaker_0", "speaker_1", etc.
  // Gap-based detection should ONLY run when there are NO existing labels.
  const hasExistingSpeakers = segments.filter(s => s.speaker && s.speaker !== 'speaker_0').length;
  const uniqueExistingSpeakers = new Set(segments.filter(s => s.speaker).map(s => s.speaker)).size;
  
  if (hasExistingSpeakers > 0 && uniqueExistingSpeakers >= 2) {
    console.log(`[speaker-detect] ✅ PRESERVING existing speaker labels (${uniqueExistingSpeakers} unique speakers, ${hasExistingSpeakers} labeled segments)`);
    // Fill in any segments that DON'T have a speaker label
    const result = segments.map((seg, i) => {
      if (seg.speaker) return seg;
      // For unlabeled segments, inherit from nearest labeled neighbor
      let nearest = 'speaker_0';
      let minDist = Infinity;
      for (let j = 0; j < segments.length; j++) {
        if (segments[j].speaker && Math.abs(j - i) < minDist) {
          minDist = Math.abs(j - i);
          nearest = segments[j].speaker!;
        }
      }
      return { ...seg, speaker: nearest };
    });
    console.log(`[speaker-detect] Filled ${segments.length - hasExistingSpeakers} unlabeled segments`);
    return result;
  }

  console.log(`[speaker-detect] No AssemblyAI labels found — running gap-based detection`);

  const N = segments.length;
  const TARGET_SPEAKERS = 3; // We want 3 speakers (user sees 3 radio button rows)
  const numBoundaries = TARGET_SPEAKERS - 1; // 2 boundaries → 3 groups
  
  console.log(`[speaker-detect] === ANALYZING ${N} SEGMENTS (target: ${TARGET_SPEAKERS} speakers) ===`);

  // ── STEP 1: Compute ALL gap types ──
  const endToStartGaps: { idx: number; gap: number }[] = [];
  const startToStartGaps: { idx: number; gap: number }[] = [];
  
  for (let i = 1; i < N; i++) {
    endToStartGaps.push({ idx: i, gap: segments[i].start - segments[i - 1].end });
    startToStartGaps.push({ idx: i, gap: segments[i].start - segments[i - 1].start });
  }

  // Log gap stats
  const etsVals = endToStartGaps.map(g => g.gap);
  const stsVals = startToStartGaps.map(g => g.gap);
  const negCount = etsVals.filter(g => g <= 0).length;
  console.log(`[speaker-detect] End-to-start gaps: ${negCount}/${etsVals.length} negative/zero`);
  if (etsVals.length > 0) {
    const sorted = [...etsVals].sort((a, b) => a - b);
    console.log(`[speaker-detect]   min=${sorted[0].toFixed(2)}s median=${sorted[Math.floor(sorted.length/2)].toFixed(2)}s max=${sorted[sorted.length-1].toFixed(2)}s`);
  }
  if (stsVals.length > 0) {
    const sorted = [...stsVals].sort((a, b) => a - b);
    console.log(`[speaker-detect] Start-to-start gaps: min=${sorted[0].toFixed(2)}s median=${sorted[Math.floor(sorted.length/2)].toFixed(2)}s max=${sorted[sorted.length-1].toFixed(2)}s`);
  }

  // ── STEP 2: PRIMARY METHOD — Top-N largest gaps ──
  // This is the BEST method for YouTube captions because:
  // - YouTube captions often overlap (negative end-to-start gaps)
  // - Start-to-start gaps are ALWAYS positive
  // - Top-N always finds exactly the boundaries we want
  // - It picks the MOST SIGNIFICANT gaps as speaker change points
  if (startToStartGaps.length >= numBoundaries) {
    console.log(`[speaker-detect] Using TOP-${numBoundaries} largest start-to-start gaps (PRIMARY method)...`);
    
    // Sort gaps by size descending, pick the N largest
    const sortedGaps = [...startToStartGaps].sort((a, b) => b.gap - a.gap);
    
    // Log top 5 gaps for diagnostic
    console.log(`[speaker-detect] Top 5 gaps:`);
    sortedGaps.slice(0, 5).forEach((g, i) => {
      console.log(`[speaker-detect]   #${i+1}: seg ${g.idx} (t=${segments[g.idx].start.toFixed(1)}s), gap=${g.gap.toFixed(2)}s, text="${segments[g.idx].text.substring(0, 40)}"`);
    });
    
    const boundaryIndices = sortedGaps
      .slice(0, numBoundaries)
      .map(g => g.idx)
      .sort((a, b) => a - b); // sort by position in transcript

    console.log(`[speaker-detect] Chosen boundaries:`);
    boundaryIndices.forEach((idx, i) => {
      const gap = startToStartGaps.find(g => g.idx === idx)!;
      console.log(`[speaker-detect]   Boundary ${i+1}: seg ${idx} (t=${segments[idx].start.toFixed(1)}s), gap=${gap.gap.toFixed(2)}s`);
    });

    // Assign speakers based on boundaries
    const topNResult: ClarifyTranscriptSegment[] = [];
    for (let i = 0; i < N; i++) {
      const seg = { ...segments[i] };
      let speakerIdx = 0;
      for (const boundary of boundaryIndices) {
        if (i >= boundary) speakerIdx++;
      }
      seg.speaker = `speaker_${speakerIdx}`;
      topNResult.push(seg);
    }

    const topNSpeakers = new Set(topNResult.map(s => s.speaker)).size;
    if (topNSpeakers >= 2) {
      console.log(`[speaker-detect] ✅ Top-N gaps found ${topNSpeakers} speakers`);
      logSpeakerDistribution(topNResult);
      return topNResult;
    }
  }

  // ── STEP 3: Fallback — threshold-based detection ──
  console.log(`[speaker-detect] Top-N failed, trying threshold-based...`);
  const thresholds = [3.0, 2.0, 1.5, 1.0, 0.5, 0.3];
  for (const threshold of thresholds) {
    const { result, speakerCount } = detectWithThreshold(segments, threshold);
    if (speakerCount >= 2 && speakerCount <= 10) {
      console.log(`[speaker-detect] ✅ Threshold ${threshold}s → ${speakerCount} speakers`);
      logSpeakerDistribution(result);
      return result;
    }
  }

  // ── STEP 4: Text-based signals ──
  console.log(`[speaker-detect] Threshold failed, trying text signals...`);
  const textResult = detectWithTextSignals(segments);
  const textSpeakers = new Set(textResult.map(s => s.speaker)).size;
  if (textSpeakers >= 2) {
    console.log(`[speaker-detect] ✅ Text signals found ${textSpeakers} speakers`);
    logSpeakerDistribution(textResult);
    return textResult;
  }

  // ── STEP 5: FORCED SPLIT — absolute last resort ──
  console.warn(`[speaker-detect] ⚠️ All methods failed! Forcing ${TARGET_SPEAKERS}-way split`);
  const chunkSize = Math.ceil(N / TARGET_SPEAKERS);
  const forcedResult = segments.map((seg, i) => ({
    ...seg,
    speaker: `speaker_${Math.min(Math.floor(i / chunkSize), TARGET_SPEAKERS - 1)}`,
  }));
  logSpeakerDistribution(forcedResult);
  return forcedResult;
}

/** Gap-based detection with a specific threshold */
function detectWithThreshold(
  segments: ClarifyTranscriptSegment[],
  threshold: number
): { result: ClarifyTranscriptSegment[]; speakerCount: number } {
  let currentSpeaker = 0;
  const result: ClarifyTranscriptSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = { ...segments[i] };
    if (i === 0) {
      seg.speaker = `speaker_${currentSpeaker}`;
    } else {
      const prevEnd = result[result.length - 1].end;
      const gap = seg.start - prevEnd;
      if (gap > threshold) {
        currentSpeaker++;
      }
      seg.speaker = `speaker_${currentSpeaker}`;
    }
    result.push(seg);
  }

  return { result, speakerCount: currentSpeaker + 1 };
}

/** Text-based speaker detection using multiple signals */
function detectWithTextSignals(segments: ClarifyTranscriptSegment[]): ClarifyTranscriptSegment[] {
  let currentSpeaker = 0;
  const result: ClarifyTranscriptSegment[] = [];
  const changeLog: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = { ...segments[i] };

    if (i === 0) {
      seg.speaker = `speaker_${currentSpeaker}`;
    } else {
      const prevSeg = result[result.length - 1];
      const prevText = prevSeg.text.trim();
      const currText = seg.text.trim();
      const gap = seg.start - prevSeg.end;

      // Multiple signals for speaker change
      const prevEndsQuestion = /\?["\s]*$/.test(prevText);
      const prevEndsSentence = /[.!]["\s]*$/.test(prevText);
      const currStartsCapital = /^[A-ZÄÖÜ]/.test(currText);  // Include German capitals

      // Greeting patterns (common in interview videos)
      const isGreeting = /^(hi|hello|hey|good morning|good afternoon|guten|hallo|moin|tschüss|danke|super)/i.test(currText);

      // Name/introduction patterns
      const hasNameIntro = /^(I'm |my name|ich bin |ich heiße |mein name)/i.test(currText);

      // Question→answer: previous ends with ? and gap > 0.2s
      const questionAnswer = prevEndsQuestion && gap > 0.2;

      // Sentence boundary with positive gap: prev ends with period, curr starts with capital
      const sentenceBoundaryGap = prevEndsSentence && currStartsCapital && gap > 0.3;

      // Greeting at start of segment
      const greetingChange = isGreeting && gap > 0.1;

      // Name introduction
      const nameChange = hasNameIntro && gap > 0.1;

      // Any positive gap > 0.2s combined with sentence boundary
      const gapWithBoundary = gap > 0.2 && (prevEndsSentence || prevEndsQuestion) && currStartsCapital;

      const speakerChange = questionAnswer || sentenceBoundaryGap || greetingChange || nameChange || gapWithBoundary;

      if (speakerChange) {
        currentSpeaker++;
        const signals = [
          questionAnswer && 'Q→A',
          sentenceBoundaryGap && 'sent-boundary',
          greetingChange && 'greeting',
          nameChange && 'name-intro',
          gapWithBoundary && 'gap+boundary',
        ].filter(Boolean).join('+');
        changeLog.push(`seg ${i}: ${signals} (gap=${gap.toFixed(2)}s) → speaker_${currentSpeaker} "${currText.substring(0, 30)}"`);
      }

      seg.speaker = `speaker_${currentSpeaker}`;
    }
    result.push(seg);
  }

  if (changeLog.length > 0) {
    console.log(`[speaker-detect] Text signals found ${changeLog.length} speaker changes:`);
    changeLog.slice(0, 20).forEach(c => console.log(`  ${c}`));
    if (changeLog.length > 20) console.log(`  ... and ${changeLog.length - 20} more`);
  }

  return result;
}

/** Start-to-start gap detection — useful when YouTube captions overlap (end > next start) */
function detectWithStartGaps(segments: ClarifyTranscriptSegment[]): ClarifyTranscriptSegment[] {
  // Calculate start-to-start gaps (immune to overlapping end times)
  const startGaps: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    startGaps.push(segments[i].start - segments[i - 1].start);
  }

  // Find adaptive threshold: use 90th percentile of start-gaps
  const sorted = [...startGaps].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 5;
  const threshold = Math.max(p90, 3.0); // At least 3 seconds for start-to-start

  console.log(`[speaker-detect] Start-gap 90th percentile: ${p90.toFixed(2)}s, using threshold: ${threshold.toFixed(2)}s`);

  let currentSpeaker = 0;
  const result: ClarifyTranscriptSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = { ...segments[i] };
    if (i === 0) {
      seg.speaker = `speaker_${currentSpeaker}`;
    } else {
      const startGap = seg.start - segments[i - 1].start;
      if (startGap > threshold) {
        currentSpeaker++;
      }
      seg.speaker = `speaker_${currentSpeaker}`;
    }
    result.push(seg);
  }

  return result;
}

/** Log speaker distribution */
function logSpeakerDistribution(result: ClarifyTranscriptSegment[]) {
  const dist: Record<string, number> = {};
  result.forEach(s => { dist[s.speaker || '?'] = (dist[s.speaker || '?'] || 0) + 1; });

  // Find speaker change points
  const changes: string[] = [];
  for (let i = 1; i < result.length; i++) {
    if (result[i].speaker !== result[i - 1].speaker) {
      changes.push(`seg ${i}: ${result[i - 1].speaker} → ${result[i].speaker} (t=${result[i].start.toFixed(1)}s)`);
    }
  }

  console.log(`[speaker-detect] Distribution:`, dist);
  console.log(`[speaker-detect] ${changes.length} change points:`);
  changes.slice(0, 20).forEach(c => console.log(`  ${c}`));
  if (changes.length > 20) console.log(`  ... and ${changes.length - 20} more`);
}

// ═══ DELETED: getVoiceForSegment and module-level cache ═══
// Voice lookups now ONLY go through frozenVoiceMapRef (set once in handleRegenerateVoices).
// There is NO other code path for voice assignment. Period.

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ClarifyAudioPanel({
  videoId, currentTime, aiPlaybackSpeed = 1, speakerConfig, onSpeakersDetected, onSubtitleChange, onMuteYouTube, onPlayYouTube, onTranscriptReady, onSegmentChange, registerHandlers,
}: ClarifyAudioPanelProps) {

  // ═══ STATE ═══
  type Phase = 'choosing' | 'processing' | 'ready' | 'playing' | 'paused' | 'stopped' | 'error';
  const [phase, setPhase] = useState<Phase>('choosing');
  const [selectedMode, setSelectedMode] = useState<OutputMode | null>(null);
  const [selectedLang, setSelectedLang] = useState('en');
  const [error, setError] = useState('');

  // Dual transcript: original (source language) + translated
  const [originalTranscript, setOriginalTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [translatedTranscript, setTranslatedTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [translatedUpTo, setTranslatedUpTo] = useState(0); // How many segments are translated
  const [totalSegments, setTotalSegments] = useState(0);
  const [needsMoreTranslation, setNeedsMoreTranslation] = useState(false);
  const [isTranslatingMore, setIsTranslatingMore] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('');

  // The "active" transcript = translated when AI playing, original when YouTube
  const [transcript, setTranscript] = useState<ClarifyTranscriptSegment[]>([]);
  const [currentSegIdx, setCurrentSegIdx] = useState(-1);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [useClientTTS, setUseClientTTS] = useState(false);

  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [showOptionsOverlay, setShowOptionsOverlay] = useState(false);

  // ═══ REFS ═══
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<AudioCache>({});
  const genSetRef = useRef<Set<number>>(new Set());
  const playingIdxRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const volRef = useRef(1.0);
  const mutedRef = useRef(false);
  const txRef = useRef<ClarifyTranscriptSegment[]>([]);
  const originalTxRef = useRef<ClarifyTranscriptSegment[]>([]);
  const translatedTxRef = useRef<ClarifyTranscriptSegment[]>([]);
  const speedRef = useRef(1);
  const speakerConfigRef = useRef<SpeakerConfig | undefined>(speakerConfig);
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);  // SCHEDULER: timing-based sync loop
  const lastScheduledSegRef = useRef(-1);  // SCHEDULER: last segment we triggered playback for
  const translatingMoreRef = useRef(false);
  const regenEpochRef = useRef(0);  // Incremented on each regeneration to invalidate stale generations
  const frozenVoiceMapRef = useRef<Record<string, string> | null>(null);  // FROZEN voice assignments — set once at regen, used for ALL segments
  const assemblyAISpeakerMapRef = useRef<Map<number, string> | null>(null);  // Stores AssemblyAI speaker labels by segment index — survives React re-renders
  const assemblyAILabelsActiveRef = useRef(false);  // Protection flag — when true, gap-based detection is disabled

  // Keep refs synced
  useEffect(() => { volRef.current = volume / 100; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { txRef.current = transcript; }, [transcript]);
  useEffect(() => {
    const oldSpeed = speedRef.current;
    speedRef.current = aiPlaybackSpeed;
    // Apply immediately to currently playing audio (live update)
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.playbackRate = aiPlaybackSpeed;
      console.log(`[options-update] Speed changed ${oldSpeed}x -> ${aiPlaybackSpeed}x, applied to current audio`);
    } else if (oldSpeed !== aiPlaybackSpeed) {
      console.log(`[options-update] Speed changed ${oldSpeed}x -> ${aiPlaybackSpeed}x, will apply to next segment`);
    }
  }, [aiPlaybackSpeed]);
  useEffect(() => { originalTxRef.current = originalTranscript; }, [originalTranscript]);
  useEffect(() => {
    // Sync ref from state, BUT re-apply AssemblyAI labels if they exist
    // (React state updates can lose speaker labels via intermediate renders)
    if (assemblyAILabelsActiveRef.current && assemblyAISpeakerMapRef.current) {
      const map = assemblyAISpeakerMapRef.current;
      translatedTxRef.current = translatedTranscript.map((seg, i) => ({
        ...seg,
        speaker: map.get(i) || seg.speaker || 'speaker_0',
      }));
    } else {
      translatedTxRef.current = translatedTranscript;
    }
  }, [translatedTranscript]);
  useEffect(() => {
    // Only update the ref if we're NOT in the middle of a regeneration
    // (frozenVoiceMapRef being set means regen calculated assignments — don't overwrite)
    speakerConfigRef.current = speakerConfig;
    if (speakerConfig && Object.keys(speakerConfig).length > 0) {
      console.log('[speaker-config] Config prop updated:', speakerConfig);
    }
  }, [speakerConfig]);

  // Update audio element volume in real-time
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume / 100;
  }, [volume, isMuted]);

  // ═══ SWITCH ACTIVE TRANSCRIPT BASED ON AUDIO MODE ═══
  // When AI audio is playing → show translated transcript
  // When paused/stopped (YouTube audio) → show original transcript
  useEffect(() => {
    if (phase === 'playing') {
      // AI audio active → show translated
      setTranscript(translatedTranscript.length > 0 ? translatedTranscript : originalTranscript);
    } else if (originalTranscript.length > 0 && (phase === 'paused' || phase === 'ready')) {
      // YouTube audio active → show original (source language)
      setTranscript(originalTranscript);
    }
  }, [phase, originalTranscript, translatedTranscript]);

  // ═══ TRACK CURRENT SEGMENT FROM VIDEO TIME ═══
  useEffect(() => {
    if (transcript.length === 0) return;
    let idx = -1;
    for (let i = 0; i < transcript.length; i++) {
      if (currentTime >= transcript[i].start && (!transcript[i + 1] || currentTime < transcript[i + 1].start)) {
        idx = i; break;
      }
    }
    if (idx !== currentSegIdx) {
      setCurrentSegIdx(idx);
      if (idx >= 0) {
        if (onSubtitleChange) onSubtitleChange(transcript[idx].text);
        if (onSegmentChange) onSegmentChange(idx);
      }
    }
  }, [currentTime, transcript, currentSegIdx, onSubtitleChange, onSegmentChange]);

  // ═══ TTS GENERATION (multi-voice) ═══
  const generateSeg = useCallback(async (i: number, text: string, speakerOverride?: string) => {
    // ── CACHE CHECK with diagnostic logging ──
    const cacheEntry = cacheRef.current[i];
    if (cacheEntry?.url || cacheEntry?.useClientTTS || cacheEntry?.generating) {
      console.log(`[CACHE-CHECK] Seg ${i}: SKIPPED (url=${!!cacheEntry?.url}, clientTTS=${!!cacheEntry?.useClientTTS}, generating=${!!cacheEntry?.generating}, voice="${cacheEntry?.voice || '?'}")`);
      return;
    }
    if (genSetRef.current.has(i)) {
      console.log(`[CACHE-CHECK] Seg ${i}: SKIPPED (already in genSet)`);
      return;
    }

    // Capture epoch at start — if it changes during generation, discard results
    const startEpoch = regenEpochRef.current;

    genSetRef.current.add(i);
    cacheRef.current[i] = { generating: true };

    try {
      // ═══ RAW SEGMENT DUMP — find the actual speaker label ═══
      const rawSegTranslated = translatedTxRef.current[i];
      const rawSegTx = txRef.current[i];
      const seg = rawSegTranslated || rawSegTx;

      // DUMP: Show segment details (first 3 only to reduce clutter)
      if (i < 3) {
        console.log(`[SEG-DUMP] Seg ${i}: translated=${!!rawSegTranslated} tx=${!!rawSegTx} speaker="${(rawSegTranslated || rawSegTx)?.speaker}" text="${((rawSegTranslated || rawSegTx)?.text || '').substring(0, 40)}"`);
      }

      // USE speakerOverride if provided (from regen loop which has guaranteed-correct speakers)
      // Fall back to segment data only if no override
      const speakerId = speakerOverride || seg?.speaker || 'speaker_0';

      // ═══ VOICE LOOKUP ═══
      // CRITICAL: Check frozen map FIRST — it's the ONLY source of truth after Apply
      let voice: string;
      let source: string;
      const frozenMap = frozenVoiceMapRef.current;
      const hasFrozenMap = frozenMap && Object.keys(frozenMap).length > 0;

      if (hasFrozenMap) {
        // FROZEN MAP EXISTS — use it
        const mappedVoice = frozenMap![speakerId];
        if (mappedVoice) {
          voice = mappedVoice;
          source = 'FROZEN';
        } else {
          // Speaker ID not in map — try fallbacks
          console.warn(`[VOICE] Seg ${i}: speaker "${speakerId}" NOT in frozen map! Keys: [${Object.keys(frozenMap!).join(', ')}]`);
          // Fallback 1: try speaker_0
          const fallback0 = frozenMap!['speaker_0'];
          if (fallback0) {
            voice = fallback0;
            source = 'FROZEN-fallback-s0';
          } else {
            // Fallback 2: index-based rotation through map values
            const mapValues = Object.values(frozenMap!);
            voice = mapValues[i % mapValues.length] || DEFAULT_VOICE;
            source = 'FROZEN-index-fallback';
          }
        }
      } else {
        // NO FROZEN MAP — try to auto-create one from available speaker info
        const cfg = speakerConfigRef.current;
        if (cfg && Object.keys(cfg).length > 0) {
          // Config exists (user has seen speaker UI) → auto-freeze a voice map
          _assignCallCounter = 0;
          const autoMap = assignVoicesToSpeakers(cfg);
          frozenVoiceMapRef.current = Object.freeze({ ...autoMap });
          voice = autoMap[speakerId] || DEFAULT_VOICE;
          source = 'AUTO-FROZEN-FROM-CONFIG';
          console.log(`[VOICE] Auto-created frozen map from config:`, autoMap);
        } else if (assemblyAISpeakerMapRef.current && assemblyAISpeakerMapRef.current.size > 0) {
          // AssemblyAI detected speakers but no config yet → use default genders
          const uniqueSpeakers = Array.from(new Set(assemblyAISpeakerMapRef.current.values())).sort();
          const defaultGenders = ['female', 'male', 'female', 'male', 'female', 'male'];
          const autoConfig: Record<string, 'male' | 'female'> = {};
          uniqueSpeakers.forEach((sp, idx) => { autoConfig[sp] = defaultGenders[idx % defaultGenders.length] as 'male' | 'female'; });
          _assignCallCounter = 0;
          const autoMap = assignVoicesToSpeakers(autoConfig);
          frozenVoiceMapRef.current = Object.freeze({ ...autoMap });
          voice = autoMap[speakerId] || DEFAULT_VOICE;
          source = 'AUTO-FROZEN-FROM-ASSEMBLY';
          console.log(`[VOICE] Auto-created frozen map from AssemblyAI:`, autoMap);
        } else {
          // No speaker info at all — true pre-detection mode
          voice = DEFAULT_VOICE;
          source = 'PRE-DETECT';
        }
      }
      
      // Determine gender: prefer explicit config, else infer from voice pool membership
      const configGender = speakerConfigRef.current?.[speakerId];
      const gender = configGender
        || (FEMALE_VOICES.includes(voice) ? 'female' : 'male');

      // ═══ VOICE DEBUG — shows exactly what happened (first 5 + every 20th) ═══
      if (i < 5 || i % 20 === 0) {
        console.log(`[VOICE] Seg ${i}: speaker="${speakerId}" voice="${voice}" source=${source} gender=${gender} frozen=${hasFrozenMap}${speakerOverride ? ` override="${speakerOverride}"` : ''}`);
      }

      // ═══ REQUEST BODY — voice is a PLAIN STRING (not an object!) ═══
      const requestBody = {
        text,
        voice,              // ← plain string like "nova", "onyx", "shimmer"
        gender,             // ← "male" or "female"
        videoId,
        segmentId: `seg_${i}`,
        speakerId,
        targetDuration: seg ? seg.end - seg.start : undefined,
        targetLanguage: selectedLang,
        ttsModel: 'tts-1',
      };

      const bodyJson = JSON.stringify(requestBody);
      if (i < 3) console.log(`[DIAGNOSTIC] Request: voice="${voice}" gender="${gender}" speaker="${speakerId}"`);

      // ── Fetch with client-side retry for transient errors ──
      let res: Response | null = null;
      let fetchError: string = '';
      const CLIENT_RETRIES = 2;

      for (let attempt = 1; attempt <= CLIENT_RETRIES; attempt++) {
        try {
          res = await fetch('/api/multi-voice-tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyJson,
          });

          // Check epoch — if regeneration happened while we were awaiting, discard
          if (regenEpochRef.current !== startEpoch) {
            console.log(`[voice-variety] Seg ${i}: DISCARDED (epoch ${startEpoch} -> ${regenEpochRef.current})`);
            genSetRef.current.delete(i);
            return;
          }

          if (res.ok) break; // Success

          // Read error response body for debugging
          let errorBody = '';
          try {
            errorBody = await res.text();
            const errorJson = JSON.parse(errorBody);
            console.error(`[TTS-ERROR] Seg ${i} attempt ${attempt}/${CLIENT_RETRIES}: HTTP ${res.status}`, errorJson);
            fetchError = `HTTP ${res.status}: ${errorJson.error || errorJson.message || errorBody.substring(0, 100)}`;
          } catch {
            console.error(`[TTS-ERROR] Seg ${i} attempt ${attempt}/${CLIENT_RETRIES}: HTTP ${res.status} body=${errorBody.substring(0, 100)}`);
            fetchError = `HTTP ${res.status}: ${errorBody.substring(0, 100)}`;
          }

          // Retry on 5xx (server transient errors)
          if (attempt < CLIENT_RETRIES && res.status >= 500) {
            console.log(`[TTS-ERROR] Seg ${i}: Retrying in ${attempt * 300}ms...`);
            await new Promise(r => setTimeout(r, attempt * 300));
            res = null;
          }

        } catch (netErr) {
          fetchError = netErr instanceof Error ? netErr.message : String(netErr);
          console.error(`[TTS-ERROR] Seg ${i} attempt ${attempt}/${CLIENT_RETRIES}: Network error:`, fetchError);
          if (attempt < CLIENT_RETRIES) {
            await new Promise(r => setTimeout(r, attempt * 300));
          }
        }
      }

      if (!res || !res.ok) {
        console.error(`[TTS-ERROR] Seg ${i}: All ${CLIENT_RETRIES} attempts failed: ${fetchError}`);
        throw new Error(`TTS failed: ${fetchError}`);
      }

      const ct = res.headers.get('content-type');
      const returnedVoice = res.headers.get('x-voice-used') || res.headers.get('x-voice-id');
      const requestId = res.headers.get('x-request-id');
      const now = Date.now();

      // Verify voice match
      if (returnedVoice && returnedVoice !== voice) {
        console.error(`[MISMATCH] Seg ${i}: sent="${voice}" server="${returnedVoice}" (${requestId})`);
      } else {
        console.log(`[DIAGNOSTIC] Seg ${i}: ✅ voice="${voice}" confirmed by server (${requestId})`);
      }

      if (ct?.includes('application/json')) {
        const data = await res.json();
        if (data.useClientSideTTS) {
          console.log(`[voice-variety] Seg ${i}: Server says use client TTS (reason: ${data.reason || '?'})`);
          cacheRef.current[i] = { useClientTTS: true, voice, generatedAt: now };
          setUseClientTTS(true);
        }
      } else {
        const blob = await res.blob();
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          cacheRef.current[i] = { url, voice, generatedAt: now };
          console.log(`[voice-variety] Seg ${i}: ✅ ${blob.size}B voice="${voice}" server="${returnedVoice}"`);
        } else {
          cacheRef.current[i] = { useClientTTS: true, voice, generatedAt: now };
          setUseClientTTS(true);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TTS-ERROR] Seg ${i}: FINAL FAILURE — falling back to client TTS. Error: ${errMsg}`);
      cacheRef.current[i] = { useClientTTS: true, generatedAt: Date.now() };
      setUseClientTTS(true);
    }

    genSetRef.current.delete(i);
    setGeneratedCount(prev => prev + 1);
  }, [videoId, selectedLang]);

  // ═══ PRE-GENERATE AHEAD + PROGRESSIVE TRANSLATION ═══
  useEffect(() => {
    if (phase !== 'playing' || translatedTranscript.length === 0) return;
    const start = Math.max(0, currentSegIdx);
    // Generate TTS for segments ahead of current position
    for (let i = start; i < Math.min(start + 8, translatedTranscript.length); i++) {
      if (!cacheRef.current[i]) {
        // Pass speaker explicitly — use stored AssemblyAI map if available, else segment data
        const speaker = assemblyAISpeakerMapRef.current?.get(i) || translatedTranscript[i].speaker;
        generateSeg(i, translatedTranscript[i].text, speaker);
      }
    }

    // Request more translation if approaching the edge of translated segments
    if (needsMoreTranslation && !translatingMoreRef.current && currentSegIdx >= translatedUpTo - 15) {
      requestMoreTranslation();
    }
  }, [phase, currentSegIdx, translatedTranscript, generateSeg, needsMoreTranslation, translatedUpTo]);

  // ═══ REQUEST MORE TRANSLATION BATCHES ═══
  const requestMoreTranslation = useCallback(async () => {
    if (translatingMoreRef.current) return;
    translatingMoreRef.current = true;
    setIsTranslatingMore(true);

    try {
      const res = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId, option: 2, targetLanguage: selectedLang,
          startIndex: translatedUpTo, batchSize: 50,
        }),
      });
      if (!res.ok) throw new Error(`Batch failed (${res.status})`);
      const data = await res.json();

      if (data.transcript?.length > 0) {
        const rawNewSegs: ClarifyTranscriptSegment[] = data.transcript.map((s: any, i: number) => ({
          text: s.text || '', start: s.start || 0,
          end: s.end || (data.transcript[i + 1]?.start || (s.start || 0) + 3),
          speaker: s.speaker || undefined,
        }));
        // detectSpeakers will preserve AssemblyAI labels if they exist in combined
        // ★ PROTECTION: If AssemblyAI labels are active, skip gap-based detection entirely
        //   and re-apply frozen labels from assemblyAISpeakerMapRef
        setTranslatedTranscript(prev => {
          const combined = [...prev, ...rawNewSegs];
          const isAssemblyAIActive = assemblyAILabelsActiveRef.current;
          const withSpeakers = detectSpeakers(combined, isAssemblyAIActive);
          // If AssemblyAI labels are active, re-apply from the frozen map
          if (isAssemblyAIActive && assemblyAISpeakerMapRef.current) {
            const map = assemblyAISpeakerMapRef.current;
            const reLabeled = withSpeakers.map((seg, i) => ({
              ...seg,
              speaker: map.get(i) || seg.speaker || 'speaker_0',
            }));
            console.log('[requestMoreTranslation] ★ Re-applied AssemblyAI labels to', reLabeled.length, 'segments');
            translatedTxRef.current = reLabeled;
            return reLabeled;
          }
          translatedTxRef.current = withSpeakers;
          return withSpeakers;
        });
        setTranslatedUpTo(prev => prev + rawNewSegs.length);
        setNeedsMoreTranslation(!data.done);
        console.log(`[clarify] Got ${rawNewSegs.length} more translated segments (done: ${data.done})`);
      } else {
        setNeedsMoreTranslation(false);
      }
    } catch (err) {
      console.error('[clarify] Failed to fetch more translations:', err);
    }

    translatingMoreRef.current = false;
    setIsTranslatingMore(false);
  }, [videoId, selectedLang, translatedUpTo]);

  // ═══ AUDIO PLAYBACK — SCHEDULER APPROACH ═══
  // Play each segment at the user's chosen speed (NEVER distorted).
  // The scheduler watches video time and triggers segments when video reaches their timestamp.
  // Gaps between segments are natural pauses — no rate-matching needed.

  const currentTimeRef = useRef(currentTime);
  const prevVideoTimeRef = useRef(currentTime);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  // Helper: find the segment index that covers a given video time
  const findSegForTime = useCallback((videoTime: number, segs: ClarifyTranscriptSegment[]): number => {
    for (let i = 0; i < segs.length; i++) {
      if (videoTime >= segs[i].start && (i === segs.length - 1 || videoTime < segs[i + 1].start)) {
        return i;
      }
    }
    if (segs.length > 0 && videoTime < segs[0].start) return 0;
    return segs.length - 1;
  }, []);

  // Play a single segment at user's chosen speed — no rate math, no onended chaining
  const playSeg = useCallback((i: number) => {
    if (i < 0 || i >= translatedTxRef.current.length) return;

    playingIdxRef.current = i;
    lastScheduledSegRef.current = i;
    const cached = cacheRef.current[i];

    if (cached?.url) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      try {
        const a = new Audio(cached.url);
        a.volume = mutedRef.current ? 0 : volRef.current;
        a.playbackRate = speedRef.current;
        audioRef.current = a;

        const seg = translatedTxRef.current[i];
        const age = cached.generatedAt ? `${((Date.now() - cached.generatedAt) / 1000).toFixed(0)}s ago` : '?';
        const videoNow = currentTimeRef.current;
        const expectedVoice = frozenVoiceMapRef.current?.[seg?.speaker || 'speaker_0'] || '(no map)';
        console.log(`[▶ PLAY] Seg ${i}: speaker=${seg?.speaker || '?'} | voice="${cached.voice || '?'}" expected="${expectedVoice}" ${cached.voice !== expectedVoice ? '❌ MISMATCH' : '✅'} | time=${seg?.start?.toFixed(1)}-${seg?.end?.toFixed(1)}s videoAt=${videoNow.toFixed(1)}s | text="${(seg?.text || '').substring(0, 50)}" (${age})`);

        a.onended = () => {
          // Segment finished naturally — scheduler will pick up next one
          playingIdxRef.current = -1;
        };
        a.onerror = () => {
          console.warn(`[scheduler] Audio error on seg ${i}, marking for client TTS`);
          if (cached.url) { try { URL.revokeObjectURL(cached.url); } catch {} }
          cached.url = undefined;
          cached.useClientTTS = true;
          playingIdxRef.current = -1;
        };
        a.play().catch(() => { playingIdxRef.current = -1; });
      } catch {
        playingIdxRef.current = -1;
      }
    } else if (cached?.useClientTTS) {
      const seg = translatedTxRef.current[i];
      console.log(`[scheduler] Playing seg ${i} via BROWSER TTS | voice="${cached.voice || 'browser-default'}" speaker=${seg?.speaker || '?'} | source=client-TTS`);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(translatedTxRef.current[i].text);
        u.lang = selectedLang === 'en' ? 'en-US' : selectedLang;
        u.volume = mutedRef.current ? 0 : volRef.current;
        u.rate = speedRef.current;

        // Try to match the assigned voice with a browser voice
        if (cached.voice) {
          const voices = window.speechSynthesis.getVoices();
          const voiceGender = FEMALE_VOICES.includes(cached.voice) ? 'female' : 'male';
          // Pick a browser voice that matches the language and approximate gender
          const langVoices = voices.filter(v => v.lang.startsWith(selectedLang === 'en' ? 'en' : selectedLang));
          if (langVoices.length > 0) {
            // Try to alternate voices for different speakers
            const speakerNum = parseInt(seg?.speaker?.match(/\d+/)?.[0] || '0');
            u.voice = langVoices[speakerNum % langVoices.length];
            console.log(`[scheduler] Browser voice picked: "${u.voice.name}" for ${seg?.speaker} (${voiceGender})`);
          }
        }

        u.onend = () => { playingIdxRef.current = -1; };
        u.onerror = () => { playingIdxRef.current = -1; };
        window.speechSynthesis.speak(u);
      }
    }
    // If no cached audio yet, do nothing — scheduler will retry when cache is ready
  }, [selectedLang]);

  // ═══ SCHEDULER LOOP — watches video time, triggers segments ═══
  useEffect(() => {
    if (phase !== 'playing') {
      if (schedulerRef.current) {
        clearInterval(schedulerRef.current);
        schedulerRef.current = null;
        console.log(`[scheduler] Stopped (phase=${phase})`);
      }
      return;
    }

    console.log(`[scheduler] === SCHEDULER STARTED ===`);

    // ═══ ONE-TIME DIAGNOSTIC: Segment/Speaker/Voice/Timestamp alignment check ═══
    {
      const segs = translatedTxRef.current;
      const frozenMap = frozenVoiceMapRef.current;
      console.log('[🔍 SCHEDULER-DIAG] ════════════════════════════════════════════');
      console.log(`[🔍 SCHEDULER-DIAG] ${segs.length} segments, frozenMap=${frozenMap ? Object.keys(frozenMap).length + ' entries' : 'NULL'}`);
      if (frozenMap) console.log('[🔍 SCHEDULER-DIAG] Map:', JSON.stringify(frozenMap));

      // Check timestamp ordering and overlaps
      let overlaps = 0, outOfOrder = 0, bigGaps = 0;
      for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i + 1].start < segs[i].start) outOfOrder++;
        if (segs[i].end > segs[i + 1].start + 0.1) overlaps++;
        if (segs[i + 1].start - segs[i].end > 5) bigGaps++;
      }
      if (overlaps) console.warn(`[🔍 SCHEDULER-DIAG] ⚠️ ${overlaps} overlapping segments!`);
      if (outOfOrder) console.error(`[🔍 SCHEDULER-DIAG] ❌ ${outOfOrder} out-of-order segments!`);
      if (bigGaps) console.warn(`[🔍 SCHEDULER-DIAG] ⚠️ ${bigGaps} gaps >5s between segments`);

      // Show first 15 segments: index, time range, speaker, cached voice, expected voice, text
      const showN = Math.min(15, segs.length);
      console.log(`[🔍 SCHEDULER-DIAG] First ${showN} segments:`);
      for (let i = 0; i < showN; i++) {
        const s = segs[i];
        const cached = cacheRef.current[i];
        const speaker = s.speaker || 'speaker_0';
        const cachedVoice = cached?.voice || '(none)';
        const expectedVoice = frozenMap?.[speaker] || '(no map)';
        const match = cachedVoice === expectedVoice;
        const icon = !cached?.url ? '⚠️' : match ? '✅' : '❌';
        console.log(`[🔍 SCHEDULER-DIAG]  ${icon} [${i}] ${s.start.toFixed(1)}-${s.end.toFixed(1)}s ${speaker} voice=${cachedVoice} exp=${expectedVoice} "${(s.text || '').substring(0, 40)}"`);
      }

      // Speaker distribution summary
      const dist: Record<string, { count: number; voices: Set<string> }> = {};
      segs.forEach((s, i) => {
        const sp = s.speaker || 'speaker_0';
        if (!dist[sp]) dist[sp] = { count: 0, voices: new Set() };
        dist[sp].count++;
        const v = cacheRef.current[i]?.voice;
        if (v) dist[sp].voices.add(v);
      });
      console.log('[🔍 SCHEDULER-DIAG] Speaker summary:');
      Object.entries(dist).forEach(([sp, d]) => {
        const expected = frozenMap?.[sp] || '?';
        const actual = Array.from(d.voices).join(',') || '(none cached)';
        const ok = d.voices.size === 1 && d.voices.has(expected);
        console.log(`[🔍 SCHEDULER-DIAG]   ${ok ? '✅' : '❌'} ${sp}: ${d.count} segs | expected=${expected} actual=[${actual}]`);
      });
      console.log('[🔍 SCHEDULER-DIAG] ════════════════════════════════════════════');
    }

    const SEEK_THRESHOLD = 2.0;  // seconds — detect user seeking

    schedulerRef.current = setInterval(() => {
      if (!isPlayingRef.current) return;

      const segs = translatedTxRef.current;
      if (segs.length === 0) return;

      const videoTime = currentTimeRef.current;
      const prevVideoTime = prevVideoTimeRef.current;
      prevVideoTimeRef.current = videoTime;

      // ─── USER SEEK DETECTION ───
      if (Math.abs(videoTime - prevVideoTime) > SEEK_THRESHOLD) {
        console.log(`[scheduler] USER SEEK detected: ${prevVideoTime.toFixed(1)} -> ${videoTime.toFixed(1)}`);
        // Stop current audio, reset scheduler to find new matching segment
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        playingIdxRef.current = -1;
        lastScheduledSegRef.current = -1;  // Reset so scheduler finds new segment
      }

      // ─── If audio is currently playing, don't interrupt it ───
      if (playingIdxRef.current >= 0) return;

      // ─── Find which segment the video is currently in ───
      const targetIdx = findSegForTime(videoTime, segs);
      if (targetIdx < 0) return;

      // ─── Don't replay the same segment we just played ───
      if (targetIdx === lastScheduledSegRef.current) return;

      // ─── Check if video has reached this segment's start (with small tolerance) ───
      const seg = segs[targetIdx];
      if (videoTime >= seg.start - 0.2) {
        // Check if TTS is ready
        const cached = cacheRef.current[targetIdx];
        if (cached?.url || cached?.useClientTTS) {
          playSeg(targetIdx);
        } else {
          // TTS not ready yet — skip this segment, scheduler will try next one
          console.log(`[scheduler] Seg ${targetIdx} not cached yet, skipping`);
          lastScheduledSegRef.current = targetIdx;
        }
      }
    }, 100);

    return () => {
      if (schedulerRef.current) {
        clearInterval(schedulerRef.current);
        schedulerRef.current = null;
        console.log(`[scheduler] Cleanup`);
      }
    };
  }, [phase, playSeg, findSegForTime]);

  // ═══ USER ACTIONS ═══

  // Speed changes are applied in the aiPlaybackSpeed ref sync useEffect above

  /** User clicks "Play Clarified Audio" or "Resume" — scheduler handles timing */
  const handlePlay = useCallback(() => {
    if (onMuteYouTube) onMuteYouTube(true);
    if (onPlayYouTube) onPlayYouTube();
    isPlayingRef.current = true;
    playingIdxRef.current = -1;
    lastScheduledSegRef.current = -1;  // Let scheduler find the right segment

    console.log(`[scheduler] === PLAY === speed=${speedRef.current}x, videoTime=${currentTimeRef.current.toFixed(1)}`);
    setPhase('playing');
    // Scheduler loop (started by phase useEffect) will pick up the first segment
  }, [onMuteYouTube, onPlayYouTube]);

  /** User clicks "Pause" */
  const handlePause = useCallback(() => {
    isPlayingRef.current = false;
    if (audioRef.current) audioRef.current.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.pause();
    setPhase('paused');
    if (onMuteYouTube) onMuteYouTube(false);
  }, [onMuteYouTube]);

  /** User clicks "Stop" */
  const handleStop = useCallback(() => {
    isPlayingRef.current = false;
    if (schedulerRef.current) { clearInterval(schedulerRef.current); schedulerRef.current = null; }
    lastScheduledSegRef.current = -1;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; audioRef.current = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    Object.values(cacheRef.current).forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
    cacheRef.current = {};
    genSetRef.current.clear();
    setTranscript([]);
    setOriginalTranscript([]);
    setTranslatedTranscript([]);
    setTranslatedUpTo(0);
    setTotalSegments(0);
    setNeedsMoreTranslation(false);
    setGeneratedCount(0);
    setCurrentSegIdx(-1);
    setPhase('stopped');
    if (onMuteYouTube) onMuteYouTube(false);
    if (onTranscriptReady) onTranscriptReady([]);
  }, [onMuteYouTube, onTranscriptReady]);

  /** Clear audio cache and regenerate TTS with current speaker voice config.
   *  Called when the user applies new voice assignments from the speaker config UI.
   *  Keeps transcripts intact — only regenerates the audio.
   *  @param configOverride — If provided, updates the ref immediately (avoids useEffect timing gap) */
  const handleRegenerateVoices = useCallback(async (configOverride?: SpeakerConfig) => {
    console.log('[REGEN] ════════════════════════════════════════════════');
    console.log('[REGEN] === REGENERATE VOICES CALLED ===');
    console.log('[REGEN] ════════════════════════════════════════════════');
    console.log('[REGEN] Config received:', JSON.stringify(configOverride));
    console.log('[REGEN] Config type:', typeof configOverride);
    console.log('[REGEN] Config keys:', configOverride ? Object.keys(configOverride) : 'none');

    // ── STEP 1: IMMEDIATELY stop everything ──
    setPhase('paused');
    isPlayingRef.current = false;
    if (schedulerRef.current) { clearInterval(schedulerRef.current); schedulerRef.current = null; }
    lastScheduledSegRef.current = -1;
    playingIdxRef.current = -1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (onMuteYouTube) onMuteYouTube(false);
    console.log('[REGEN] Playback stopped');

    // ── STEP 2: SNAPSHOT the config ──
    const frozenConfig: SpeakerConfig = configOverride
      ? { ...configOverride }
      : { ...(speakerConfigRef.current || {}) };
    speakerConfigRef.current = frozenConfig;
    console.log('[REGEN] Config snapshot:', JSON.stringify(frozenConfig));

    if (Object.keys(frozenConfig).length === 0) {
      console.error('[REGEN] ⚠️ CONFIG IS EMPTY! Voice assignment will produce empty map.');
    }

    // ── STEP 3: CALCULATE voice assignments ONCE ──
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔧 VOICE ASSIGNMENT DEBUG');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('Speaker Config received:');
    console.log(JSON.stringify(frozenConfig, null, 2));
    console.log('');
    console.log('Detailed breakdown:');
    console.log(`  speaker_0: ${frozenConfig.speaker_0 || 'MISSING'}`);
    console.log(`  speaker_1: ${frozenConfig.speaker_1 || 'MISSING'}`);
    console.log(`  speaker_2: ${frozenConfig.speaker_2 || 'MISSING'}`);
    console.log('');

    _assignCallCounter = 0;
    const voiceMap = assignVoicesToSpeakers(frozenConfig);

    console.log('');
    console.log('Voice Map created:');
    console.log(JSON.stringify(voiceMap, null, 2));
    console.log('');
    console.log('Expected result (with F/M/F config):');
    console.log('  speaker_0 (female) → nova');
    console.log('  speaker_1 (male)   → onyx');
    console.log('  speaker_2 (female) → shimmer');
    console.log('');
    console.log('Actual result:');
    console.log(`  speaker_0 (${frozenConfig.speaker_0 || '?'}) → ${voiceMap.speaker_0 || '?'}`);
    console.log(`  speaker_1 (${frozenConfig.speaker_1 || '?'}) → ${voiceMap.speaker_1 || '?'}`);
    console.log(`  speaker_2 (${frozenConfig.speaker_2 || '?'}) → ${voiceMap.speaker_2 || '?'}`);
    console.log('');

    // Check for bugs
    const allVoices = Object.values(voiceMap);
    const allSame = allVoices.length > 1 && allVoices.every(v => v === allVoices[0]);
    if (allSame) {
      console.error('❌ BUG: All speakers assigned same voice!');
      console.error(`   All assigned to: ${allVoices[0]}`);
      console.error('   This is wrong - should be different voices!');
    } else if (allVoices.length > 1) {
      console.log('✅ Multiple distinct voices assigned');
    }

    // Check gender-voice consistency
    Object.entries(frozenConfig).forEach(([speaker, gender]) => {
      const voice = voiceMap[speaker];
      if (gender === 'female' && !FEMALE_VOICES.includes(voice)) {
        console.error(`❌ ${speaker}: gender=female but voice=${voice} (not female!)`);
      }
      if (gender === 'male' && !MALE_VOICES.includes(voice)) {
        console.error(`❌ ${speaker}: gender=male but voice=${voice} (not male!)`);
      }
    });

    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    if (Object.keys(voiceMap).length === 0) {
      console.error('[REGEN] ⚠️ VOICE MAP IS EMPTY! Segments will fall back to default.');
    }

    // ── STEP 4: FREEZE the map ──
    const frozenMap = Object.freeze({ ...voiceMap });
    frozenVoiceMapRef.current = frozenMap;
    console.log('[REGEN] ════════════════════════════════════════════════');
    console.log('[REGEN] FROZEN MAP CREATED:');
    console.log('[REGEN]', JSON.stringify(frozenMap));
    console.log('[REGEN] frozenVoiceMapRef.current exists:', !!frozenVoiceMapRef.current);
    console.log('[REGEN] frozenVoiceMapRef.current keys:', Object.keys(frozenVoiceMapRef.current || {}));
    console.log('[REGEN] ════════════════════════════════════════════════');

    // ── STEP 5: NUCLEAR CACHE CLEAR ──
    const oldCacheSize = Object.keys(cacheRef.current).length;
    Object.values(cacheRef.current).forEach(e => {
      if (e.url) { try { URL.revokeObjectURL(e.url); } catch {} }
    });
    cacheRef.current = {};
    genSetRef.current = new Set();
    setGeneratedCount(0);

    regenEpochRef.current++;
    const thisEpoch = regenEpochRef.current;
    console.log(`[REGEN] Cache cleared (${oldCacheSize} entries), epoch=${thisEpoch}`);

    // ── STEP 6: REGENERATE all segments ──
    // Try translated segments first, fall back to original
    let segs = translatedTxRef.current;
    if (!segs || segs.length === 0) {
      segs = txRef.current;
      console.log('[REGEN] No translated segments, using original transcript');
    }

    if (segs.length > 0) {
      // ═══ ★ CRITICAL FIX: Re-apply AssemblyAI speaker labels from stored map ═══
      // React re-renders can overwrite translatedTxRef via the useEffect sync,
      // losing the AssemblyAI speaker labels. The stored map is the source of truth.
      if (assemblyAISpeakerMapRef.current && assemblyAISpeakerMapRef.current.size > 0) {
        const storedMap = assemblyAISpeakerMapRef.current;
        console.log(`[REGEN] ★ Re-applying stored AssemblyAI speaker map (${storedMap.size} entries)`);
        segs = segs.map((seg, i) => ({
          ...seg,
          speaker: storedMap.get(i) || seg.speaker || 'speaker_0',
        }));
        translatedTxRef.current = segs;
        setTranslatedTranscript(segs);
        console.log('[REGEN] ★ Speaker labels restored from assemblyAISpeakerMapRef');
      } else {
        console.log('[REGEN] No stored AssemblyAI speaker map — will use gap-based detection');
      }

      // ═══ CRITICAL: Check speaker labels on segments ═══
      const dist: Record<string, number> = {};
      let noSpeakerCount = 0;
      segs.forEach((s, idx) => {
        const sp = s.speaker || '(undefined)';
        dist[sp] = (dist[sp] || 0) + 1;
        if (!s.speaker) noSpeakerCount++;
      });
      console.log(`[REGEN] Segment speaker distribution:`, dist);
      console.log(`[REGEN] Segments WITHOUT speaker: ${noSpeakerCount}/${segs.length}`);

      // Log first 10 segment speakers for debugging
      console.log(`[REGEN] First 10 segment speakers:`);
      segs.slice(0, 10).forEach((s, i) => {
        console.log(`[REGEN]   Seg ${i}: speaker="${s.speaker}" text="${(s.text || '').substring(0, 40)}"`);
      });

      // ═══ SAFETY NET: Only run gap-based detection if we DON'T have AssemblyAI labels ═══
      // (If AssemblyAI map was applied above, skip — gap-based detection is less accurate)
      if (!assemblyAISpeakerMapRef.current || assemblyAISpeakerMapRef.current.size === 0) {
        console.log(`[REGEN] Running detectSpeakers() as safety net (${noSpeakerCount} missing speakers)...`);
        segs = detectSpeakers(segs);
        translatedTxRef.current = segs;
        setTranslatedTranscript(segs);
      } else {
        console.log('[REGEN] Skipping gap-based detectSpeakers() — AssemblyAI labels already applied');
      }

      // Verify result
      const dist2: Record<string, number> = {};
      segs.forEach(s => { dist2[s.speaker || '(undefined)'] = (dist2[s.speaker || '(undefined)'] || 0) + 1; });
      console.log(`[REGEN] After detectSpeakers:`, dist2);
      segs.slice(0, 10).forEach((s, i) => {
        console.log(`[REGEN]   Seg ${i}: speaker="${s.speaker}" text="${(s.text || '').substring(0, 40)}"`);
      });

      // Verify frozen map covers all speakers in the transcript
      const transcriptSpeakers = new Set(segs.map(s => s.speaker || 'speaker_0'));
      const mapSpeakers = new Set(Object.keys(frozenMap));
      transcriptSpeakers.forEach(sp => {
        if (!mapSpeakers.has(sp)) {
          console.warn(`[REGEN] ⚠️ Speaker "${sp}" in transcript but NOT in frozen map!`);
        }
      });

      // ═══ VOICE ASSIGNMENT SUMMARY — what you should hear ═══
      console.log('[REGEN] ╔══════════════════════════════════════════════╗');
      console.log('[REGEN] ║   VOICE ASSIGNMENT SUMMARY                  ║');
      console.log('[REGEN] ╠══════════════════════════════════════════════╣');
      Object.entries(frozenMap).forEach(([speaker, voice]) => {
        const count = segs.filter(s => s.speaker === speaker).length;
        console.log(`[REGEN] ║   ${speaker} → ${voice} (${count} segments)`.padEnd(49) + '║');
      });
      console.log('[REGEN] ╚══════════════════════════════════════════════╝');

      for (let batchStart = 0; batchStart < segs.length; batchStart += 8) {
        if (regenEpochRef.current !== thisEpoch) {
          console.log(`[REGEN] Epoch ${thisEpoch} superseded, aborting`);
          return;
        }
        const batch = segs.slice(batchStart, Math.min(batchStart + 8, segs.length));
        // CRITICAL: Pass s.speaker directly so generateSeg doesn't rely on translatedTxRef
        // (which can be overwritten by React useEffect during async awaits)
        await Promise.allSettled(batch.map((s, j) => generateSeg(batchStart + j, s.text, s.speaker)));
        console.log(`[REGEN] Batch ${batchStart}-${batchStart + batch.length - 1} done`);
      }
      // ═══ POST-GENERATION AUDIT — verify voices are actually different ═══
      const voiceAudit: Record<string, number> = {};
      Object.keys(cacheRef.current).forEach(key => {
        const v = cacheRef.current[parseInt(key)]?.voice || '(none)';
        voiceAudit[v] = (voiceAudit[v] || 0) + 1;
      });
      console.log('[REGEN] ╔══════════════════════════════════════════════╗');
      console.log('[REGEN] ║   POST-GENERATION VOICE AUDIT               ║');
      console.log('[REGEN] ╠══════════════════════════════════════════════╣');
      Object.entries(voiceAudit).forEach(([voice, count]) => {
        console.log(`[REGEN] ║   ${voice}: ${count} segments`.padEnd(49) + '║');
      });
      const uniqueVoices = Object.keys(voiceAudit).filter(v => v !== '(none)');
      if (uniqueVoices.length >= 2) {
        console.log('[REGEN] ║   ✅ MULTI-VOICE CONFIRMED!                 ║');
      } else {
        console.log('[REGEN] ║   ❌ SINGLE VOICE! Something went wrong     ║');
      }
      console.log('[REGEN] ╚══════════════════════════════════════════════╝');

      // ═══ STORAGE VERIFICATION — check blob/segment alignment ═══
      console.log('[REGEN] ╔══════════════════════════════════════════════╗');
      console.log('[REGEN] ║   📦 STORAGE VERIFICATION                   ║');
      console.log('[REGEN] ╠══════════════════════════════════════════════╣');
      let missingCount = 0;
      let mismatchCount = 0;
      segs.slice(0, 10).forEach((seg, idx) => {
        const entry = cacheRef.current[idx];
        const speaker = seg.speaker || 'speaker_0';
        const expectedVoice = frozenMap[speaker] || '(no map)';
        const cachedVoice = entry?.voice || '(none)';
        const hasUrl = !!entry?.url;
        const match = cachedVoice === expectedVoice;
        if (!hasUrl) missingCount++;
        if (!match && cachedVoice !== '(none)') mismatchCount++;
        const icon = !hasUrl ? '⚠️' : match ? '✅' : '❌';
        console.log(`[REGEN] ║ ${icon} [${idx}] ${speaker}→${expectedVoice} cached=${cachedVoice}`.padEnd(49) + '║');
      });
      if (segs.length > 10) {
        // Check remaining silently
        for (let i = 10; i < segs.length; i++) {
          const entry = cacheRef.current[i];
          const speaker = segs[i].speaker || 'speaker_0';
          const expectedVoice = frozenMap[speaker] || '(no map)';
          const cachedVoice = entry?.voice || '(none)';
          if (!entry?.url) missingCount++;
          if (cachedVoice !== '(none)' && cachedVoice !== expectedVoice) mismatchCount++;
        }
      }
      console.log(`[REGEN] ║ Missing blobs: ${missingCount}/${segs.length}`.padEnd(49) + '║');
      console.log(`[REGEN] ║ Voice mismatches: ${mismatchCount}/${segs.length}`.padEnd(49) + '║');
      if (mismatchCount === 0 && missingCount === 0) {
        console.log('[REGEN] ║ ✅ All blobs correctly stored!              ║');
      }
      console.log('[REGEN] ╚══════════════════════════════════════════════╝');
      console.log(`[REGEN] ✅ All ${segs.length} segments regenerated with multi-voice!`);
    } else {
      console.warn('[REGEN] ⚠️ NO SEGMENTS to regenerate! Both translated and original are empty.');
    }

    console.log(`[REGEN] Final cache size: ${Object.keys(cacheRef.current).length}`);
    console.log('[REGEN] === REGENERATION COMPLETE ===');
  }, [generateSeg, onMuteYouTube]);

  // ═══ ASSEMBLYAI HYBRID SPEAKER DETECTION ═══
  // Uses AssemblyAI for accurate speaker labels, matched to YouTube caption timestamps.
  // See ASSEMBLYAI_SYNC_ANALYSIS.md for why this hybrid approach is necessary.
  const detectSpeakersWithAssemblyAI = useCallback(async (): Promise<string[]> => {
    console.log('[ASSEMBLY-DETECT] ════════════════════════════════════════');
    console.log('[ASSEMBLY-DETECT] Starting AssemblyAI speaker detection...');

    try {
      // Call AssemblyAI speaker detection API
      // The backend handles getting the audio URL via yt-dlp (AssemblyAI needs a public URL)
      console.log('[ASSEMBLY-DETECT] Calling /api/detect-speakers for video', videoId);
      console.log('[ASSEMBLY-DETECT] This takes 1-2 minutes (yt-dlp extract + AssemblyAI transcription)...');
      const detectRes = await fetch('/api/detect-speakers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });

      if (!detectRes.ok) {
        const errData = await detectRes.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errData.error || `Speaker detection failed (${detectRes.status})`);
      }

      const detectData = await detectRes.json();
      console.log('[ASSEMBLY-DETECT] AssemblyAI returned:');
      console.log('[ASSEMBLY-DETECT]   Speakers:', detectData.speakers);
      console.log('[ASSEMBLY-DETECT]   Segments:', detectData.totalSegments);

      // Step 3: Match AssemblyAI segments to our YouTube-based segments
      console.log('[ASSEMBLY-DETECT] Step 3: Matching to YouTube caption segments...');

      // ★ CRITICAL FIX: Use ORIGINAL (German) segments for text matching!
      //   AssemblyAI returns German text. If we match against translated (English) text,
      //   text similarity = ~0% and all matching falls to imprecise time-based.
      //   Using original German text allows real text matching for accurate speaker labels.
      const originalSegs = originalTxRef.current;
      const translatedSegs = translatedTxRef.current;
      // Use original for matching, translated for playback. Both should have same count + timestamps.
      const matchingSegs = originalSegs.length > 0 ? originalSegs : translatedSegs;
      const targetSegs = translatedSegs.length > 0 ? translatedSegs : originalSegs;

      if (matchingSegs.length === 0) {
        console.warn('[ASSEMBLY-DETECT] No transcript segments available yet!');
        return ['speaker_0'];
      }

      console.log(`[ASSEMBLY-DETECT] Using ${originalSegs.length > 0 ? 'ORIGINAL (German)' : 'translated'} text for matching (${matchingSegs.length} segs)`);
      console.log(`[ASSEMBLY-DETECT] Target segments for labels: ${targetSegs.length} (${translatedSegs.length > 0 ? 'translated' : 'original'})`);

      const ytSegments: YouTubeSegment[] = matchingSegs.map((seg, i) => ({
        idx: i,
        text: seg.text,
        start: seg.start,
        end: seg.end,
      }));

      const asmSegments: AssemblySegment[] = detectData.segments;
      const speakerMap = matchSpeakerSegments(ytSegments, asmSegments);

      // ★ PERSIST the speaker map in a ref so it survives React re-renders
      assemblyAISpeakerMapRef.current = speakerMap;
      assemblyAILabelsActiveRef.current = true;  // ★ PROTECTION: disable gap-based detection
      console.log('[ASSEMBLY-DETECT] ★ Speaker map saved to assemblyAISpeakerMapRef (' + speakerMap.size + ' entries)');
      console.log('[ASSEMBLY-DETECT] ★ assemblyAILabelsActiveRef = true — gap-based detection DISABLED');

      // Step 4: Apply speaker labels to translated transcript segments (for playback)
      console.log('[ASSEMBLY-DETECT] Step 4: Applying speaker labels to', targetSegs.length, 'segments...');
      const updatedSegments = targetSegs.map((seg: ClarifyTranscriptSegment, i: number) => ({
        ...seg,
        speaker: speakerMap.get(i) || seg.speaker || 'speaker_0',
      }));

      // Update state
      setTranslatedTranscript(updatedSegments);
      translatedTxRef.current = updatedSegments;

      // Extract unique speakers
      const uniqueSpeakers = Array.from(new Set(speakerMap.values())).sort();

      // Notify parent
      if (onSpeakersDetected) onSpeakersDetected(uniqueSpeakers);

      // Log results with speaker distribution
      const speakerDist: Record<string, number> = {};
      updatedSegments.forEach((seg: ClarifyTranscriptSegment) => {
        const sp = seg.speaker || '(none)';
        speakerDist[sp] = (speakerDist[sp] || 0) + 1;
      });
      
      console.log('[ASSEMBLY-DETECT] ════════════════════════════════════════');
      console.log('[ASSEMBLY-DETECT] ✅ AssemblyAI Detection Complete!');
      console.log('[ASSEMBLY-DETECT] Detected speakers:', uniqueSpeakers);
      console.log('[ASSEMBLY-DETECT] Speaker distribution:', JSON.stringify(speakerDist));
      console.log('[ASSEMBLY-DETECT] Sample assignments:');
      updatedSegments.slice(0, 15).forEach((seg: ClarifyTranscriptSegment, i: number) => {
        console.log(`[ASSEMBLY-DETECT]   Seg ${i}: "${seg.text.substring(0, 40)}" → ${seg.speaker}`);
      });
      console.log('[ASSEMBLY-DETECT] ════════════════════════════════════════');

      // ★ VERIFICATION: Check labels survived after 1 second
      setTimeout(() => {
        console.log('');
        console.log('🔍 CHECKING IF LABELS WERE PRESERVED (after 1 second)...');
        const checkCounts = new Map<string, number>();
        translatedTxRef.current.forEach(seg => {
          const speaker = seg.speaker || 'speaker_0';
          checkCounts.set(speaker, (checkCounts.get(speaker) || 0) + 1);
        });
        console.log('Current speaker distribution:');
        checkCounts.forEach((count, speaker) => {
          console.log(`  ${speaker}: ${count} segments`);
        });
        if (checkCounts.size === 1 && checkCounts.has('speaker_0')) {
          console.error('❌ LABELS WERE OVERWRITTEN! All segments are speaker_0!');
          console.error('Re-applying from frozen map...');
          // Emergency re-apply
          if (assemblyAISpeakerMapRef.current) {
            const map = assemblyAISpeakerMapRef.current;
            translatedTxRef.current = translatedTxRef.current.map((seg, i) => ({
              ...seg,
              speaker: map.get(i) || seg.speaker || 'speaker_0',
            }));
            console.log('✅ Emergency re-apply complete');
          }
        } else {
          console.log('✅ Labels still preserved after 1 second');
        }
      }, 1000);

      // ★ AUTO-CREATE frozen voice map immediately so TTS uses correct voices
      // (Don't wait for user to click Apply & Regenerate)
      if (uniqueSpeakers.length > 1) {
        const defaultGenders = ['female', 'male', 'female', 'male', 'female', 'male'] as const;
        const autoConfig: Record<string, 'male' | 'female'> = {};
        uniqueSpeakers.forEach((sp, idx) => { autoConfig[sp] = defaultGenders[idx % defaultGenders.length]; });
        _assignCallCounter = 0;
        const autoMap = assignVoicesToSpeakers(autoConfig);
        frozenVoiceMapRef.current = Object.freeze({ ...autoMap });
        console.log('[ASSEMBLY-DETECT] ★ Auto-created frozen voice map:', autoMap);
        console.log('[ASSEMBLY-DETECT] ★ New TTS segments will now use distinct voices!');
        console.log('[ASSEMBLY-DETECT] ★ Click "Apply & Regenerate" to re-generate existing audio with these voices.');
      }

      return uniqueSpeakers;

    } catch (error: any) {
      console.error('[ASSEMBLY-DETECT] ❌ Error:', error);
      console.error('[ASSEMBLY-DETECT] Stack:', error.stack);
      throw error; // Let caller handle UI feedback
    }
  }, [videoId, onSpeakersDetected]);

  // ═══ DIAGNOSTIC: Audio blob test — plays cached blobs one-by-one so you can hear if voices are correct ═══
  // NOTE: Must be defined BEFORE registerHandlers useEffect for dependency tracking
  const testAudioBlobs = useCallback(() => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🧪 AUDIO BLOB TEST');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    const cache = cacheRef.current;
    const keys = Object.keys(cache).map(Number).sort((a, b) => a - b);

    if (keys.length === 0) {
      console.error('❌ NO AUDIO BLOBS FOUND!');
      console.error('Generate audio first before testing.');
      return;
    }

    const totalBlobs = keys.length;
    const totalSegments = translatedTxRef.current.length;
    const frozenMap = frozenVoiceMapRef.current || {};

    // ── VOICE ASSIGNMENT VERIFICATION ──
    console.log('🔍 VOICE ASSIGNMENT VERIFICATION');
    console.log('  Speaker Config (speakerConfigRef):', JSON.stringify(speakerConfigRef.current));
    console.log('  Frozen Voice Map:', JSON.stringify(frozenMap));
    console.log('  AssemblyAI Speaker Map:', assemblyAISpeakerMapRef.current ? `${assemblyAISpeakerMapRef.current.size} entries` : 'null');
    console.log('');

    // Check for common bugs
    const issues: string[] = [];
    const cfg = speakerConfigRef.current || {};
    const mapVoices = Object.values(frozenMap);
    if (Object.keys(frozenMap).length === 0) {
      issues.push('Frozen voice map is EMPTY — no voices assigned!');
    }
    if (Object.keys(cfg).length === 0) {
      issues.push('Speaker config is EMPTY — defaults were never set!');
    }
    if (mapVoices.length > 1 && mapVoices.every(v => v === mapVoices[0])) {
      issues.push(`All speakers assigned SAME voice: ${mapVoices[0]}`);
    }
    Object.entries(cfg).forEach(([speaker, gender]) => {
      const voice = frozenMap[speaker];
      if (voice && gender === 'female' && !FEMALE_VOICES.includes(voice)) {
        issues.push(`${speaker}: gender=female but voice=${voice} (not female!)`);
      }
      if (voice && gender === 'male' && !MALE_VOICES.includes(voice)) {
        issues.push(`${speaker}: gender=male but voice=${voice} (not male!)`);
      }
    });
    if (issues.length > 0) {
      console.error('❌ ISSUES FOUND:');
      issues.forEach(issue => console.error(`   - ${issue}`));
    } else {
      console.log('✅ Voice assignment verification passed');
    }
    console.log('');

    console.log(`📊 Total audio blobs in cache: ${totalBlobs}`);
    console.log(`📊 Total transcript segments: ${totalSegments}`);

    if (totalBlobs !== totalSegments) {
      console.warn(`⚠️  Mismatch: ${totalBlobs} blobs but ${totalSegments} segments!`);
    }

    // ── INDEX ALIGNMENT CHECK ──
    console.log('');
    console.log('🔍 INDEX ALIGNMENT CHECK');
    const missingIndices: number[] = [];
    const emptyBlobs: number[] = [];
    for (let i = 0; i < totalSegments; i++) {
      if (!cache[i]) {
        missingIndices.push(i);
      } else if (!cache[i].url) {
        emptyBlobs.push(i);
      }
    }
    if (missingIndices.length > 0) {
      console.error(`❌ ${missingIndices.length} segments have NO cached blob!`);
      console.error('   Missing indices:', missingIndices.slice(0, 20).join(', '), missingIndices.length > 20 ? '...' : '');
    } else {
      console.log('✅ All segment indices have a cached blob');
    }
    if (emptyBlobs.length > 0) {
      console.warn(`⚠️  ${emptyBlobs.length} blobs have no URL (still generating?)`);
    }

    // ── VOICE MAP ──
    console.log('');
    console.log('Voice map being used:');
    if (Object.keys(frozenMap).length === 0) {
      console.warn('⚠️  Frozen voice map is EMPTY — voices will use defaults');
    } else {
      Object.entries(frozenMap).forEach(([speaker, voice]) => {
        console.log(`  ${speaker} → ${voice}`);
      });
    }

    // ── STORAGE VERIFICATION (first 10) ──
    console.log('');
    console.log('📦 STORAGE VERIFICATION (first 10):');
    const storageCheck = keys.slice(0, 10).map(idx => {
      const entry = cache[idx];
      const seg = translatedTxRef.current[idx];
      const speaker = seg?.speaker || 'speaker_0';
      const expectedVoice = frozenMap[speaker] || '(no map)';
      const cachedVoice = entry?.voice || '(none)';
      const voiceMatch = cachedVoice === expectedVoice;
      return { idx, speaker, expectedVoice, cachedVoice, voiceMatch, hasUrl: !!entry?.url, text: (seg?.text || '').substring(0, 40) };
    });

    storageCheck.forEach(item => {
      const matchIcon = item.voiceMatch ? '✅' : '❌';
      console.log(`${matchIcon} [${item.idx}] ${item.speaker} → expected=${item.expectedVoice}, cached=${item.cachedVoice}, url=${item.hasUrl}`);
      console.log(`   "${item.text}..."`);
    });

    // ── VOICE DISTRIBUTION ──
    const voiceDistribution: Record<string, number> = {};
    keys.forEach(idx => {
      const v = cache[idx]?.voice || '(none)';
      voiceDistribution[v] = (voiceDistribution[v] || 0) + 1;
    });
    console.log('');
    console.log('Voice distribution across all blobs:');
    Object.entries(voiceDistribution).forEach(([voice, count]) => {
      console.log(`  ${voice}: ${count} blobs`);
    });

    // ── PLAY FIRST 5 BLOBS ──
    const testCount = Math.min(5, keys.length);
    console.log('');
    console.log(`Playing first ${testCount} blobs with 4-second gaps...`);
    console.log('Listen carefully and note if voice matches expectation!');
    console.log('');

    const testKeys = keys.slice(0, testCount);
    testKeys.forEach((segIdx, order) => {
      const entry = cache[segIdx];
      const seg = translatedTxRef.current[segIdx];
      const speaker = seg?.speaker || 'speaker_0';
      const expectedVoice = frozenMap[speaker] || '(no map)';

      if (entry?.url) {
        setTimeout(() => {
          console.log('');
          console.log(`▶️  PLAYING BLOB ${segIdx}:`);
          console.log(`   Text: "${(seg?.text || '').substring(0, 60)}"`);
          console.log(`   Speaker: ${speaker}`);
          console.log(`   Expected Voice: ${expectedVoice}`);
          console.log(`   Cached Voice: ${entry.voice || '(none)'}`);
          console.log(`   Duration: ${((seg?.end || 0) - (seg?.start || 0)).toFixed(1)}s`);
          console.log('');
          console.log(`   👂 LISTEN NOW - Should sound like ${expectedVoice.toUpperCase()}`);

          const audio = new Audio(entry.url);
          audio.play().catch(e => console.error(`   ❌ Play failed for ${segIdx}:`, e));
          audio.onended = () => console.log(`   ✅ Blob ${segIdx} finished playing`);
          audio.onerror = (e) => console.error(`   ❌ Blob ${segIdx} playback error:`, e);
        }, order * 4000);
      } else {
        console.warn(`⚠️  Blob ${segIdx}: No URL — skipping playback`);
      }
    });

    // Summary after all blobs finish
    setTimeout(() => {
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('🧪 TEST COMPLETE');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
      console.log('Questions to answer:');
      console.log('1. Did each blob play with the expected voice?');
      console.log('2. Were there any blobs that played the WRONG voice?');
      console.log('3. Did any blob sound like it switched voices mid-playback?');
      console.log('');
      console.log('If blobs play CORRECT voices → Scheduler/playback bug');
      console.log('If blobs play WRONG voices   → Generation/storage bug');
      console.log('');
    }, testCount * 4000 + 2000);
  }, []);

  // Also expose on window for console access
  useEffect(() => {
    (window as any).testAudioBlobs = testAudioBlobs;
    return () => { delete (window as any).testAudioBlobs; };
  }, [testAudioBlobs]);

  // Register external handlers
  useEffect(() => {
    if (registerHandlers) {
      registerHandlers({
        play: () => handlePlay(),
        pause: () => handlePause(),
        isPlaying: () => isPlayingRef.current,
        regenerateVoices: (config?: SpeakerConfig) => handleRegenerateVoices(config),
        detectWithAssemblyAI: detectSpeakersWithAssemblyAI,
        manualDetectSpeakers: () => {
          console.log('[MANUAL-DETECT] Running gap-based speaker detection...');
          let segs = translatedTxRef.current;
          if (!segs || segs.length === 0) segs = txRef.current;
          if (segs.length === 0) {
            console.warn('[MANUAL-DETECT] No segments available!');
            return ['speaker_0'];
          }
          const detected = detectSpeakers(segs);
          translatedTxRef.current = detected;
          setTranslatedTranscript(detected);
          const speakers = Array.from(new Set(detected.map(s => s.speaker || 'speaker_0'))).sort();
          console.log(`[MANUAL-DETECT] Found ${speakers.length} speakers:`, speakers);
          return speakers;
        },
        testAudioBlobs,
        hasAudioBlobs: () => Object.keys(cacheRef.current).some(k => !!cacheRef.current[parseInt(k)]?.url),
      });
    }
  }, [registerHandlers, handlePlay, handlePause, handleRegenerateVoices, detectSpeakersWithAssemblyAI, testAudioBlobs]);


  /** User selects options from modal -> start processing */
  const handleSelectOption = useCallback(async (mode: OutputMode, lang: string) => {
    setSelectedMode(mode);
    setSelectedLang(lang);
    setPhase('processing');
    setError('');
    setProcessingStage('Fetching transcript...');
    cacheRef.current = {};
    genSetRef.current.clear();
    setGeneratedCount(0);
    setUseClientTTS(false);

    try {
      setProcessingStage('Fetching & translating transcript...');
      const res = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, option: 2, targetLanguage: lang }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || `Failed (${res.status})`); }
      const data = await res.json();

      // Store original transcript (source language — ALL segments)
      if (data.originalTranscript?.length) {
        const origSegs: ClarifyTranscriptSegment[] = data.originalTranscript.map((s: any, i: number) => ({
          text: s.text || '', start: s.start || 0,
          end: s.end || (data.originalTranscript[i + 1]?.start || (s.start || 0) + 3),
        }));
        setOriginalTranscript(origSegs);
        originalTxRef.current = origSegs;
        setTotalSegments(origSegs.length);
        if (onTranscriptReady) onTranscriptReady(origSegs);
      }

      // Store translated buffer (with speaker detection for multi-voice)
      let transSegs: ClarifyTranscriptSegment[] = [];
      if (data.transcript?.length) {
        const rawTransSegs: ClarifyTranscriptSegment[] = data.transcript.map((s: any, i: number) => ({
          text: s.text || '', start: s.start || 0,
          end: s.end || (data.transcript[i + 1]?.start || (s.start || 0) + 3),
          speaker: s.speaker || undefined,
        }));
        transSegs = detectSpeakers(rawTransSegs);
        setTranslatedTranscript(transSegs);
        translatedTxRef.current = transSegs;
        setTranslatedUpTo(transSegs.length);

        // Notify parent about detected speakers for voice config UI
        if (onSpeakersDetected) {
          const uniqueSpeakers = [...new Set(transSegs.map(s => s.speaker).filter(Boolean))] as string[];
          uniqueSpeakers.sort();
          console.log(`[speaker-config] Detected ${uniqueSpeakers.length} speakers:`, uniqueSpeakers);
          onSpeakersDetected(uniqueSpeakers);

          // ★ AUTO-CREATE initial frozen voice map so TTS generation uses distinct voices immediately
          if (uniqueSpeakers.length > 1 && (!frozenVoiceMapRef.current || Object.keys(frozenVoiceMapRef.current).length === 0)) {
            const defaultGenders = ['female', 'male', 'female', 'male', 'female', 'male'] as const;
            const autoConfig: Record<string, 'male' | 'female'> = {};
            uniqueSpeakers.forEach((sp, idx) => { autoConfig[sp] = defaultGenders[idx % defaultGenders.length]; });
            _assignCallCounter = 0;
            const autoMap = assignVoicesToSpeakers(autoConfig);
            frozenVoiceMapRef.current = Object.freeze({ ...autoMap });
            console.log(`[speaker-config] ★ Auto-created initial voice map:`, autoMap);
          }
        }
      }

      setNeedsMoreTranslation(data.needsMoreTranslation || false);
      setSourceLanguage(data.sourceLanguage || '');

      const total = data.totalSegments || data.originalTranscript?.length || 0;
      const translated = data.translatedCount || data.transcript?.length || 0;
      setProcessingStage(`Ready! ${translated}/${total} segments translated`);

      if (mode !== 'subtitles_only') {
        // Generate first batch of TTS audio — pass speaker overrides from detected speakers
        setProcessingStage('Generating AI audio...');
        const segsForTTS = data.transcript || [];
        const batch = segsForTTS.slice(0, 8);
        await Promise.allSettled(batch.map((s: any, i: number) => {
          const text = s.text || '';
          // Use speaker from transSegs (which has gap-based detection labels)
          const speaker = transSegs[i]?.speaker;
          return generateSeg(i, text, speaker);
        }));

        setProcessingStage('Ready! Scheduler mode - natural speed playback');
        setPhase('ready');
      } else {
        setPhase('ready');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      setPhase('error');
    }
  }, [videoId, onTranscriptReady, onSpeakersDetected, generateSeg]);

  /** handleRestart — full restart (re-choose options) */
  const handleRestart = useCallback(() => {
    handleStop();
    setError('');
    setPhase('choosing');
  }, [handleStop]);

  /** handleOptions — open options overlay WITHOUT restarting */
  const handleOptions = useCallback(() => {
    setShowOptionsOverlay(true);
  }, []);

  /** handleOptionsApply — apply new options from overlay */
  const handleOptionsApply = useCallback((mode: OutputMode, lang: string) => {
    setShowOptionsOverlay(false);
    // Only reprocess if language changed
    if (lang !== selectedLang) {
      handleSelectOption(mode, lang);
    } else {
      setSelectedMode(mode);
    }
  }, [selectedLang, handleSelectOption]);

  // Keep a ref to onMuteYouTube so cleanup doesn't re-fire on every prop change
  const onMuteYouTubeRef = useRef(onMuteYouTube);
  useEffect(() => { onMuteYouTubeRef.current = onMuteYouTube; }, [onMuteYouTube]);

  // Cleanup on unmount ONLY
  useEffect(() => {
    return () => {
      if (schedulerRef.current) { clearInterval(schedulerRef.current); schedulerRef.current = null; }
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      Object.values(cacheRef.current).forEach(e => { if (e.url) URL.revokeObjectURL(e.url); });
      if (onMuteYouTubeRef.current) onMuteYouTubeRef.current(false);
    };
  }, []);

  // ═══ COMPUTED ═══
  const audioMode = selectedMode === 'audio_only' || selectedMode === 'audio_and_subtitles';
  const langLabel = (code: string) => ({ en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' }[code] || code.toUpperCase());
  const isAiActive = phase === 'playing';
  const activeTranscriptLang = isAiActive ? selectedLang : (sourceLanguage || 'source');

  // ═══ RENDER ═══
  return (
    <div style={{ padding: '12px', fontSize: '12px', color: 'white' }}>

      {/* ─── OPTIONS OVERLAY (doesn't restart) ─── */}
      {showOptionsOverlay && (
        <div style={{ position: 'relative', zIndex: 10 }}>
          <div style={{
            padding: '12px', backgroundColor: '#1e293b', borderRadius: '8px',
            border: '1px solid #475569', marginBottom: '10px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Settings</span>
              <button onClick={() => setShowOptionsOverlay(false)} style={{
                background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '16px',
              }}>x</button>
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '6px' }}>
              Changing language will reprocess the video.
            </div>
            <ProcessingOptionsModal
              isOpen={true} onClose={() => setShowOptionsOverlay(false)}
              onSelectOption={handleOptionsApply}
              initialMode={selectedMode || undefined} initialLanguage={selectedLang}
            />
          </div>
        </div>
      )}

      {/* ─── CHOOSING ─── */}
      {phase === 'choosing' && !showOptionsOverlay && (
        <ProcessingOptionsModal
          isOpen={true} onClose={() => setPhase('stopped')}
          onSelectOption={handleSelectOption}
          initialMode={selectedMode || undefined} initialLanguage={selectedLang}
        />
      )}

      {/* ─── STOPPED ─── */}
      {phase === 'stopped' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
            Clarify Audio is not active.
          </p>
          <button onClick={handleRestart} style={{
            width: '100%', padding: '10px', backgroundColor: '#2563eb', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
          }}>🎯 Choose Processing Options</button>
        </div>
      )}

      {/* ─── ERROR ─── */}
      {phase === 'error' && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(220,38,38,0.15)', border: '1px solid #dc2626',
            borderRadius: '6px', fontSize: '11px', color: '#fca5a5', marginBottom: '10px',
          }}>{'❌'} {error}</div>
          <button onClick={handleRestart} style={{
            width: '100%', padding: '10px', backgroundColor: '#2563eb', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
          }}>{'🔄'} Try Again</button>
        </div>
      )}

      {/* ─── PROCESSING ─── */}
      {phase === 'processing' && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#60a5fa', marginBottom: '8px', textAlign: 'center' }}>
            {processingStage.startsWith('Generating') ? '🎵 Generating Audio...' :
             processingStage.includes('translating') ? '🌐 Translating...' :
             '📝 Fetching Transcript...'}
          </div>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ width: '100%', height: '8px', backgroundColor: '#374151', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                width: translatedUpTo > 0 ? `${Math.min(100, (translatedUpTo / Math.max(totalSegments, 1)) * 100)}%` : '30%',
                height: '100%', backgroundColor: '#3b82f6', borderRadius: '4px',
                transition: 'width 0.3s ease',
                animation: translatedUpTo === 0 ? 'pulse 1.5s ease-in-out infinite' : undefined,
              }} />
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
            {processingStage || 'Fetching transcript...'}
          </div>
        </div>
      )}

      {/* ─── READY ─── */}
      {phase === 'ready' && !showOptionsOverlay && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#22c55e', marginBottom: '4px' }}>
              {'✅'} Audio Ready
            </div>
            <div style={{ fontSize: '10px', color: '#9ca3af' }}>
              {translatedUpTo}/{totalSegments} segments translated · {useClientTTS ? 'Browser voices' : 'OpenAI voices'} · {langLabel(selectedLang)}
            </div>
            {needsMoreTranslation && (
              <div style={{ fontSize: '9px', color: '#60a5fa', marginTop: '2px' }}>
                More segments will translate during playback
              </div>
            )}
          </div>

          {/* Transcript language indicator */}
          {sourceLanguage && sourceLanguage !== selectedLang && (
            <div style={{
              padding: '4px 8px', marginBottom: '8px', borderRadius: '4px',
              backgroundColor: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)',
              fontSize: '10px', color: '#93c5fd', textAlign: 'center',
            }}>
              {'📖'} Showing {langLabel(sourceLanguage)} transcript (YouTube audio)
            </div>
          )}

          {audioMode && (
            <button onClick={handlePlay} style={{
              width: '100%', padding: '14px', backgroundColor: '#22c55e', color: 'white',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontSize: '16px', fontWeight: 'bold', marginBottom: '10px',
              boxShadow: '0 2px 8px rgba(34,197,94,0.3)',
            }}>
              {'▶'} Play Clarified Audio
            </button>
          )}

          {!audioMode && (
            <div style={{
              padding: '10px', backgroundColor: '#1e3a5f', borderRadius: '8px',
              textAlign: 'center', fontSize: '12px', marginBottom: '10px',
            }}>
              {'📝'} Subtitles are active
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleStop} style={{
              flex: 1, padding: '7px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
            }}>{'⏹'} Stop</button>
            <button onClick={handleOptions} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>{'⚙️'} Options</button>
          </div>
        </div>
      )}

      {/* ─── PLAYING ─── */}
      {phase === 'playing' && !showOptionsOverlay && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(34,197,94,0.15)', border: '1px solid #22c55e',
            borderRadius: '8px', marginBottom: '10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#22c55e', marginBottom: '2px' }}>
              {'🔊'} Playing Clarified Audio
            </div>
            <div style={{ fontSize: '10px', color: '#86efac' }}>
              YouTube muted · {translatedUpTo}/{totalSegments} translated · {generatedCount} TTS ready
              {isTranslatingMore && ' · translating more...'}
            </div>
          </div>

          {/* Transcript language indicator */}
          <div style={{
            padding: '4px 8px', marginBottom: '8px', borderRadius: '4px',
            backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
            fontSize: '10px', color: '#86efac', textAlign: 'center',
          }}>
            {'🌐'} Showing {langLabel(selectedLang)} transcript (AI audio) · {aiPlaybackSpeed}x speed
          </div>

          <button onClick={handlePause} style={{
            width: '100%', padding: '12px', backgroundColor: '#f59e0b', color: 'white',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontWeight: 'bold', marginBottom: '8px',
          }}>
            {'⏸'} Pause
          </button>

          {/* Volume */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <button onClick={() => { setIsMuted(!isMuted); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'white', padding: '2px' }}>
              {isMuted ? '🔇' : '🔊'}
            </button>
            <input type="range" min={0} max={100} value={isMuted ? 0 : volume}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                setVolume(v);
                if (v > 0 && isMuted) setIsMuted(false);
              }}
              style={{ flex: 1, accentColor: '#22c55e', height: '4px' }}
            />
            <span style={{ fontSize: '10px', color: '#9ca3af', minWidth: '28px' }}>{isMuted ? 0 : volume}%</span>
          </div>

          {/* Current segment info */}
          {currentSegIdx >= 0 && transcript[currentSegIdx] && (
            <div style={{
              padding: '6px 8px', backgroundColor: '#1f2937', borderRadius: '6px',
              fontSize: '11px', color: '#d1d5db', marginBottom: '8px', textAlign: 'center',
            }}>
              <span style={{ color: '#60a5fa', marginRight: '4px' }}>[{fmtTime(transcript[currentSegIdx].start)}]</span>
              {transcript[currentSegIdx].text}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleStop} style={{
              flex: 1, padding: '7px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
            }}>{'⏹'} Stop</button>
            <button onClick={handleOptions} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>{'⚙️'} Options</button>
          </div>
        </div>
      )}

      {/* ─── PAUSED ─── */}
      {phase === 'paused' && !showOptionsOverlay && (
        <div>
          <div style={{
            padding: '8px', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b',
            borderRadius: '8px', marginBottom: '10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#f59e0b', marginBottom: '2px' }}>
              {'⏸'} Audio Paused
            </div>
            <div style={{ fontSize: '10px', color: '#fcd34d' }}>
              YouTube audio is back to normal
            </div>
          </div>

          {/* Transcript language indicator */}
          {sourceLanguage && sourceLanguage !== selectedLang && (
            <div style={{
              padding: '4px 8px', marginBottom: '8px', borderRadius: '4px',
              backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              fontSize: '10px', color: '#fcd34d', textAlign: 'center',
            }}>
              {'📖'} Showing {langLabel(sourceLanguage)} transcript (YouTube audio)
            </div>
          )}

          <button onClick={handlePlay} style={{
            width: '100%', padding: '12px', backgroundColor: '#22c55e', color: 'white',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontWeight: 'bold', marginBottom: '8px',
          }}>
            {'▶'} Resume Clarified Audio
          </button>

          {/* Current segment info */}
          {currentSegIdx >= 0 && transcript[currentSegIdx] && (
            <div style={{
              padding: '6px 8px', backgroundColor: '#1f2937', borderRadius: '6px',
              fontSize: '11px', color: '#d1d5db', marginBottom: '8px', textAlign: 'center',
            }}>
              <span style={{ color: '#60a5fa', marginRight: '4px' }}>[{fmtTime(transcript[currentSegIdx].start)}]</span>
              {transcript[currentSegIdx].text}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleStop} style={{
              flex: 1, padding: '7px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
            }}>{'⏹'} Stop</button>
            <button onClick={handleOptions} style={{
              flex: 1, padding: '7px', backgroundColor: '#374151', color: 'white',
              border: '1px solid #4b5563', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            }}>{'⚙️'} Options</button>
          </div>
        </div>
      )}
    </div>
  );
}
