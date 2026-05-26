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
  registerHandlers?: (handlers: { play: () => void; pause: () => void; isPlaying: () => boolean; regenerateVoices: (config?: SpeakerConfig) => void }) => void;
}

// ═══ MULTI-VOICE SYSTEM ═══
// Voice pools for same-gender variety — speakers cycle through these.
// OpenAI voices: 'onyx' (deep male), 'echo' (male), 'fable' (male),
//                'nova' (female), 'shimmer' (female), 'alloy' (neutral)
export const FEMALE_VOICES = ['nova', 'shimmer', 'alloy'];
export const MALE_VOICES   = ['onyx', 'fable', 'echo'];

// Default voice when no speaker detection is possible
const DEFAULT_VOICE = 'onyx';

/**
 * Compute a deterministic voice assignment for every speaker in the config.
 * 
 * ⚠️  THIS FUNCTION MUST ONLY BE CALLED ONCE — inside handleRegenerateVoices.
 *     If you see the call-counter exceed 1 in the logs, something is wrong.
 *
 * Speakers are sorted numerically so the mapping is stable regardless of
 * object-key iteration order.  Same-gender speakers cycle through their pool:
 *   Female: nova -> shimmer -> alloy -> nova ...
 *   Male:   onyx -> fable   -> echo  -> onyx ...
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

  const assignments: Record<string, string> = {};
  let femaleIdx = 0;
  let maleIdx = 0;

  const sorted = Object.keys(config).sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] || '0');
    const nb = parseInt(b.match(/\d+/)?.[0] || '0');
    return na - nb;
  });

  console.log(`[ASSIGN-VOICES] Processing speakers in order:`, sorted);

  for (const id of sorted) {
    const gender = config[id];
    if (gender === 'female') {
      assignments[id] = FEMALE_VOICES[femaleIdx % FEMALE_VOICES.length];
      console.log(`[ASSIGN-VOICES]   ${id} (female #${femaleIdx}) → ${assignments[id]}`);
      femaleIdx++;
    } else {
      assignments[id] = MALE_VOICES[maleIdx % MALE_VOICES.length];
      console.log(`[ASSIGN-VOICES]   ${id} (male #${maleIdx}) → ${assignments[id]}`);
      maleIdx++;
    }
  }

  console.log(`[ASSIGN-VOICES] FINAL:`, JSON.stringify(assignments));
  console.log(`[ASSIGN-VOICES] ════════════════════════════════════════`);
  return assignments;
}

/**
 * SILENT version of assignVoicesToSpeakers — for UI preview labels ONLY.
 * Does NOT log. Does NOT affect the frozen map. Safe to call on every render.
 */
export function previewVoiceAssignments(config: SpeakerConfig): Record<string, string> {
  const assignments: Record<string, string> = {};
  let femaleIdx = 0;
  let maleIdx = 0;
  const sorted = Object.keys(config).sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] || '0');
    const nb = parseInt(b.match(/\d+/)?.[0] || '0');
    return na - nb;
  });
  for (const id of sorted) {
    if (config[id] === 'female') {
      assignments[id] = FEMALE_VOICES[femaleIdx % FEMALE_VOICES.length];
      femaleIdx++;
    } else {
      assignments[id] = MALE_VOICES[maleIdx % MALE_VOICES.length];
      maleIdx++;
    }
  }
  return assignments;
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
function detectSpeakers(segments: ClarifyTranscriptSegment[]): ClarifyTranscriptSegment[] {
  if (segments.length === 0) return segments;

  console.log(`[speaker-detect] === ANALYZING ${segments.length} SEGMENTS ===`);

  // ── STEP 1: Gap analysis ──
  const gaps: number[] = [];
  const gapDetails: string[] = [];
  for (let i = 1; i < Math.min(segments.length, 100); i++) {
    const gap = segments[i].start - segments[i - 1].end;
    gaps.push(gap);
    if (i <= 30) {
      gapDetails.push(`seg${i}: gap=${gap.toFixed(2)}s`);
    }
  }
  console.log(`[speaker-detect] First 30 gaps:`, gapDetails.join(' | '));

  // Sort gaps to see distribution (only positive gaps matter for detection)
  const positiveGaps = gaps.filter(g => g > 0).sort((a, b) => a - b);
  const negativeCount = gaps.filter(g => g <= 0).length;

  if (positiveGaps.length > 0) {
    const p25 = positiveGaps[Math.floor(positiveGaps.length * 0.25)] || 0;
    const median = positiveGaps[Math.floor(positiveGaps.length * 0.5)] || 0;
    const p75 = positiveGaps[Math.floor(positiveGaps.length * 0.75)] || 0;
    const p90 = positiveGaps[Math.floor(positiveGaps.length * 0.9)] || 0;
    const max = positiveGaps[positiveGaps.length - 1] || 0;
    console.log(`[speaker-detect] Gap distribution (${positiveGaps.length} positive, ${negativeCount} negative/zero):`);
    console.log(`[speaker-detect]   25th=${p25.toFixed(2)}s, median=${median.toFixed(2)}s, 75th=${p75.toFixed(2)}s, 90th=${p90.toFixed(2)}s, max=${max.toFixed(2)}s`);
  } else {
    console.log(`[speaker-detect] ALL ${negativeCount} gaps are negative/zero (overlapping captions)`);
  }

  // ── STEP 2: Detect with adaptive thresholds ──
  // Try multiple thresholds, pick the first one that finds 2+ speakers
  const thresholds = [3.0, 2.0, 1.5, 1.0, 0.5, 0.3];
  let bestResult: ClarifyTranscriptSegment[] | null = null;
  let bestSpeakerCount = 0;
  let bestThreshold = 0;

  for (const threshold of thresholds) {
    const { result, speakerCount } = detectWithThreshold(segments, threshold);
    console.log(`[speaker-detect] Threshold ${threshold}s → ${speakerCount} speakers`);

    if (speakerCount >= 2 && speakerCount <= 10) {
      bestResult = result;
      bestSpeakerCount = speakerCount;
      bestThreshold = threshold;
      // Use the FIRST threshold that gives us 2+ speakers — it'll have
      // the most meaningful (largest gap) speaker changes
      break;
    }
    // Track best even if we don't break
    if (speakerCount > bestSpeakerCount) {
      bestResult = result;
      bestSpeakerCount = speakerCount;
      bestThreshold = threshold;
    }
  }

  // ── STEP 3: If gap-based found 2+ speakers, use it ──
  if (bestResult && bestSpeakerCount >= 2) {
    console.log(`[speaker-detect] ✅ Using gap threshold=${bestThreshold}s (${bestSpeakerCount} speakers)`);
    logSpeakerDistribution(bestResult);
    return bestResult;
  }

  // ── STEP 4: Gap-based found only 1 speaker — try text-based signals ──
  console.log(`[speaker-detect] Gap detection found only 1 speaker. Trying text signals...`);
  const textResult = detectWithTextSignals(segments);
  const textSpeakers = new Set(textResult.map(s => s.speaker)).size;

  if (textSpeakers >= 2) {
    console.log(`[speaker-detect] ✅ Text signals found ${textSpeakers} speakers`);
    logSpeakerDistribution(textResult);
    return textResult;
  }

  // ── STEP 5: Both failed — use segment-start-gap detection ──
  // YouTube captions overlap (end > next start), so use START-to-START gaps instead
  console.log(`[speaker-detect] Text signals also failed. Trying start-to-start gaps...`);
  const startGapResult = detectWithStartGaps(segments);
  const startGapSpeakers = new Set(startGapResult.map(s => s.speaker)).size;

  if (startGapSpeakers >= 2) {
    console.log(`[speaker-detect] ✅ Start-gap detection found ${startGapSpeakers} speakers`);
    logSpeakerDistribution(startGapResult);
    return startGapResult;
  }

  // ── STEP 6: Nothing worked — return best result from gap detection (even if 1 speaker) ──
  console.warn(`[speaker-detect] ⚠️ Could not find multiple speakers. Keeping all as speaker_0`);
  return bestResult || segments.map(s => ({ ...s, speaker: 'speaker_0' }));
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
  useEffect(() => { translatedTxRef.current = translatedTranscript; }, [translatedTranscript]);
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

      // DUMP: Show EXACTLY what the segment object looks like
      console.log(`[SEG-DUMP] Seg ${i}: translated exists=${!!rawSegTranslated}, tx exists=${!!rawSegTx}`);
      if (rawSegTranslated) {
        console.log(`[SEG-DUMP] Seg ${i} translated keys: [${Object.keys(rawSegTranslated).join(', ')}]`);
        console.log(`[SEG-DUMP] Seg ${i} translated.speaker = "${rawSegTranslated.speaker}" (type: ${typeof rawSegTranslated.speaker})`);
        console.log(`[SEG-DUMP] Seg ${i} translated.text = "${(rawSegTranslated.text || '').substring(0, 40)}"`);
      }

      // USE speakerOverride if provided (from regen loop which has guaranteed-correct speakers)
      // Fall back to segment data only if no override
      const speakerId = speakerOverride || seg?.speaker || 'speaker_0';
      if (speakerOverride) {
        console.log(`[SEG-DUMP] Seg ${i}: using speakerOverride="${speakerOverride}" (seg.speaker="${seg?.speaker}")`);
      }

      // ═══ VOICE LOOKUP ═══
      // ONLY source of truth: frozenVoiceMapRef (set by handleRegenerateVoices when user clicks Apply)
      // Before Apply: everyone gets DEFAULT_VOICE (onyx) — no guessing from saved config
      let voice: string;
      let source: string;
      const frozenMap = frozenVoiceMapRef.current;
      if (frozenMap && frozenMap[speakerId]) {
        voice = frozenMap[speakerId];
        source = 'FROZEN';
      } else if (frozenMap) {
        // ═══ FROZEN-missing: the speaker from transcript is NOT in the map ═══
        // This is THE BUG if you see this for every segment!
        voice = DEFAULT_VOICE;
        source = 'FROZEN-missing';
        console.error(`[BUG?] Seg ${i}: speaker "${speakerId}" NOT in frozen map!`);
        console.error(`[BUG?]   Map keys: [${Object.keys(frozenMap).join(', ')}]`);
        console.error(`[BUG?]   Map: ${JSON.stringify(frozenMap)}`);
        console.error(`[BUG?]   Seg speaker raw: "${seg?.speaker}" type=${typeof seg?.speaker}`);
        
        // ═══ WORKAROUND: Try to find a voice anyway ═══
        // Maybe speaker IDs don't match — try index-based assignment from map values
        const mapValues = Object.values(frozenMap);
        if (mapValues.length > 0) {
          voice = mapValues[i % mapValues.length];
          source = 'FROZEN-index-fallback';
          console.warn(`[BUG-FIX] Using index-based fallback: Seg ${i} % ${mapValues.length} = voice "${voice}"`);
        }
      } else {
        voice = DEFAULT_VOICE;
        source = 'PRE-APPLY';
      }
      // Determine gender: prefer explicit config, else infer from voice pool membership
      const FEMALE_VOICES = ['nova', 'shimmer', 'alloy'];
      const configGender = speakerConfigRef.current?.[speakerId];
      const gender = configGender
        || (FEMALE_VOICES.includes(voice) ? 'female' : 'male');

      console.log(`[VOICE] Seg ${i}: speaker="${speakerId}" voice="${voice}" source=${source} frozen=${!!frozenMap}`);

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
      console.log(`[DIAGNOSTIC] Request: voice="${voice}" gender="${gender}" speaker="${speakerId}"`);

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
      if (!cacheRef.current[i]) generateSeg(i, translatedTranscript[i].text);
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
        // Detect speakers for new batch (uses gap-based detection)
        const newSegs = detectSpeakers(rawNewSegs);
        setTranslatedTranscript(prev => {
          // Re-detect speakers across the full combined transcript for continuity
          const combined = [...prev, ...newSegs];
          const withSpeakers = detectSpeakers(combined);
          translatedTxRef.current = withSpeakers;
          return withSpeakers;
        });
        setTranslatedUpTo(prev => prev + newSegs.length);
        setNeedsMoreTranslation(!data.done);
        console.log(`[clarify] Got ${newSegs.length} more translated segments (done: ${data.done})`);
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
        console.log(`[TRACE-7-PLAY] Seg ${i}: voice="${cached.voice || '?'}" speaker=${seg?.speaker || '?'} | OpenAI (${age})`);

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
    _assignCallCounter = 0;
    const voiceMap = assignVoicesToSpeakers(frozenConfig);
    console.log('[REGEN] Voice map calculated:', JSON.stringify(voiceMap));

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

      // ═══ ALWAYS re-detect speakers to ensure labels are present ═══
      // This is the SAFETY NET — even if detection already ran, re-run to guarantee
      // speaker labels exist on every segment before we generate TTS
      console.log(`[REGEN] Running detectSpeakers() as safety net (${noSpeakerCount} missing speakers)...`);
      segs = detectSpeakers(segs);
      translatedTxRef.current = segs;
      // CRITICAL: Also sync the STATE so the useEffect (translatedTxRef.current = translatedTranscript)
      // doesn't overwrite our re-detected speakers with stale data during React re-renders
      setTranslatedTranscript(segs);

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
      console.log(`[REGEN] All ${segs.length} segments regenerated`);
    } else {
      console.warn('[REGEN] ⚠️ NO SEGMENTS to regenerate! Both translated and original are empty.');
    }

    console.log(`[REGEN] Final cache size: ${Object.keys(cacheRef.current).length}`);
    console.log('[REGEN] === REGENERATION COMPLETE ===');
  }, [generateSeg, onMuteYouTube]);

  // Register external handlers
  useEffect(() => {
    if (registerHandlers) {
      registerHandlers({
        play: () => handlePlay(),
        pause: () => handlePause(),
        isPlaying: () => isPlayingRef.current,
        regenerateVoices: (config?: SpeakerConfig) => handleRegenerateVoices(config),
      });
    }
  }, [registerHandlers, handlePlay, handlePause, handleRegenerateVoices]);

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
        }
      }

      setNeedsMoreTranslation(data.needsMoreTranslation || false);
      setSourceLanguage(data.sourceLanguage || '');

      const total = data.totalSegments || data.originalTranscript?.length || 0;
      const translated = data.translatedCount || data.transcript?.length || 0;
      setProcessingStage(`Ready! ${translated}/${total} segments translated`);

      if (mode !== 'subtitles_only') {
        // Generate first batch of TTS audio
        setProcessingStage('Generating AI audio...');
        const segsForTTS = data.transcript || [];
        const batch = segsForTTS.slice(0, 8);
        const parsedBatch = batch.map((s: any) => s.text || '');
        await Promise.allSettled(parsedBatch.map((text: string, i: number) => generateSeg(i, text)));

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
