/**
 * Client-Side Speaker Detection Module v42
 * 
 * IMPROVED speaker detection with multiple signal analysis:
 * - Pause-based detection (refined thresholds)
 * - Content pattern analysis (questions, introductions, addressing)
 * - Turn-taking conversation patterns
 * - Confidence scoring system
 * 
 * v42 improvements:
 * - Better speaker change detection using content patterns
 * - Questions after statements suggest speaker change
 * - Introduction patterns identify first speaker
 * - Addressing by name indicates speaker change
 * - Higher confidence thresholds reduce false positives
 * - Combined multi-signal scoring for accuracy
 * 
 * Features:
 * - Multi-signal speaker change detection
 * - Content-aware pattern matching
 * - Confidence-weighted speaker assignment
 * - Support for 2+ speakers
 */

export interface DetectedSpeaker {
  id: string;
  estimatedGender: 'male' | 'female' | 'neutral' | 'unknown';
  segmentCount: number;
  totalSpeakingTime: number;
  avgSegmentDuration: number;
}

export interface SpeakerSegment {
  segmentIndex: number;
  speakerId: string;
  speakerGender: 'male' | 'female' | 'neutral' | 'unknown';
  start: number;
  end: number;
  pauseBefore: number;
  text: string;
  changeConfidence?: number;  // v42: confidence score for speaker change
}

export interface SpeakerDetectionResult {
  speakers: DetectedSpeaker[];
  segments: SpeakerSegment[];
  detectionMethod: 'multi-signal' | 'pause-based' | 'pattern-based' | 'single-speaker';
  confidence: number;
}

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
  speakerId?: string;
  speakerGender?: string;
}

interface SpeakerChangeSignal {
  segmentIndex: number;
  confidence: number;
  reasons: string[];
}

// Detection thresholds - v42 refined
const PAUSE_THRESHOLD_WEAK = 0.5;      // Weak signal
const PAUSE_THRESHOLD_MODERATE = 1.0;  // Moderate signal
const PAUSE_THRESHOLD_STRONG = 2.0;    // Strong signal - likely speaker change
const MIN_SEGMENTS_FOR_DETECTION = 3;  // Reduced from 4
const CHANGE_CONFIDENCE_THRESHOLD = 0.6; // Need this much confidence to switch speakers

// Content patterns for speaker detection
const QUESTION_PATTERNS = [
  /\?$/,                           // Ends with question mark
  /^(is|are|do|does|did|was|were|have|has|had|can|could|would|should|will|what|where|when|why|who|how)\s/i,
];

const INTRODUCTION_PATTERNS = [
  /^(hey|hi|hello|what'?s up)\b/i,  // Greetings
  /\b(this is|my name is|i'?m)\s+[A-Z]/i,  // Self-introduction
  /^(so|okay|alright)\s+(this is|i'?m)/i,  // "So this is..."
];

const ADDRESSING_PATTERNS = [
  /\b(say hi|meet|introduce|this is)\s+[A-Z]/i,  // Introducing someone
  /\b(hey|hi)\s+[A-Z][a-z]+[!,]?$/i,  // "Hey Marta!"
];

const RESPONSE_PATTERNS = [
  /^(yes|yeah|no|nope|sure|okay|right|exactly|definitely)\b/i,  // Agreement/disagreement
  /^(i think|i believe|i feel|in my|for me)\b/i,  // Personal perspective
  /^(that'?s|it'?s)\s+(right|true|correct|interesting|amazing|cool)/i,  // Affirmations
];

/**
 * v42: Analyze text content for speaker change signals
 */
function analyzeContentForSpeakerChange(
  currentText: string,
  prevText: string | null
): { confidence: number; reasons: string[] } {
  let confidence = 0;
  const reasons: string[] = [];

  const currentLower = currentText.toLowerCase().trim();
  const prevLower = prevText?.toLowerCase().trim() || '';

  // Check if current segment is a question (often new speaker responding)
  const isQuestion = QUESTION_PATTERNS.some(p => p.test(currentText));
  
  // Check if previous was an introduction (next might be different speaker)
  const prevWasIntro = prevText && INTRODUCTION_PATTERNS.some(p => p.test(prevText));
  
  // Check if current is a response pattern
  const isResponse = RESPONSE_PATTERNS.some(p => p.test(currentText));
  
  // Check if current addresses someone by name
  const isAddressing = ADDRESSING_PATTERNS.some(p => p.test(currentText));

  // Previous was introduction, current is question = likely speaker change
  if (prevWasIntro && isQuestion) {
    confidence += 0.5;
    reasons.push('question-after-intro');
    console.log('[v42] Content signal: question after introduction');
  }
  
  // Current is a response to previous statement
  if (isResponse && prevText && !QUESTION_PATTERNS.some(p => p.test(prevText))) {
    confidence += 0.3;
    reasons.push('response-pattern');
  }
  
  // Current addresses someone by name (often introduces different speaker)
  if (isAddressing) {
    confidence += 0.3;
    reasons.push('addressing-pattern');
  }

  // Question following a long statement
  if (isQuestion && prevText && prevText.length > 100) {
    confidence += 0.3;
    reasons.push('question-after-long-statement');
  }

  // Dramatic topic change (very different content)
  if (prevText && currentText.length > 20 && prevText.length > 20) {
    // Simple check: first 3 words different
    const prevWords = prevLower.split(/\s+/).slice(0, 3).join(' ');
    const currWords = currentLower.split(/\s+/).slice(0, 3).join(' ');
    if (prevWords !== currWords && !currWords.startsWith('and') && !currWords.startsWith('but')) {
      // Check for pronoun switch (I -> you, you -> I)
      const prevHasI = /\bi\s/i.test(prevText);
      const currHasYou = /\byou\b/i.test(currentText);
      const prevHasYou = /\byou\b/i.test(prevText);
      const currHasI = /\bi\s/i.test(currentText);
      
      if ((prevHasI && currHasYou) || (prevHasYou && currHasI)) {
        confidence += 0.25;
        reasons.push('pronoun-switch');
      }
    }
  }

  return { confidence: Math.min(confidence, 0.8), reasons };
}

/**
 * v42: Analyze pause duration for speaker change signal
 */
function analyzePauseForSpeakerChange(
  pauseDuration: number
): { confidence: number; reasons: string[] } {
  let confidence = 0;
  const reasons: string[] = [];

  if (pauseDuration >= PAUSE_THRESHOLD_STRONG) {
    confidence = 0.6;
    reasons.push(`long-pause-${pauseDuration.toFixed(1)}s`);
  } else if (pauseDuration >= PAUSE_THRESHOLD_MODERATE) {
    confidence = 0.4;
    reasons.push(`moderate-pause-${pauseDuration.toFixed(1)}s`);
  } else if (pauseDuration >= PAUSE_THRESHOLD_WEAK) {
    confidence = 0.2;
    reasons.push(`short-pause-${pauseDuration.toFixed(1)}s`);
  }

  return { confidence, reasons };
}

/**
 * v42: Analyze segment duration patterns
 */
function analyzeDurationPattern(
  currentDuration: number,
  prevDuration: number | null,
  avgDuration: number
): { confidence: number; reasons: string[] } {
  let confidence = 0;
  const reasons: string[] = [];

  if (prevDuration === null) return { confidence, reasons };

  // Large duration difference suggests different speaker style
  const durationRatio = currentDuration / prevDuration;
  
  if (durationRatio < 0.3 || durationRatio > 3.0) {
    confidence = 0.25;
    reasons.push('duration-shift');
  }

  // Current is very different from average
  const avgRatio = currentDuration / avgDuration;
  if (avgRatio < 0.4 || avgRatio > 2.5) {
    confidence += 0.1;
    reasons.push('unusual-duration');
  }

  return { confidence: Math.min(confidence, 0.35), reasons };
}

/**
 * v42: Combined multi-signal speaker change detection
 */
function detectSpeakerChanges(segments: TranscriptSegment[]): SpeakerChangeSignal[] {
  const changes: SpeakerChangeSignal[] = [];
  const avgDuration = segments.reduce((sum, s) => sum + s.duration, 0) / segments.length;

  console.log('[v42] Analyzing segments for speaker changes...');

  for (let i = 1; i < segments.length; i++) {
    const current = segments[i];
    const prev = segments[i - 1];
    const prevEnd = prev.start + prev.duration;
    const pause = current.start - prevEnd;

    // Collect all signals
    const pauseSignal = analyzePauseForSpeakerChange(pause);
    const contentSignal = analyzeContentForSpeakerChange(current.text, prev.text);
    const durationSignal = analyzeDurationPattern(
      current.duration,
      prev.duration,
      avgDuration
    );

    // Combine signals with weights
    const totalConfidence = 
      pauseSignal.confidence * 0.4 +      // Pause is important but not dominant
      contentSignal.confidence * 0.45 +   // Content patterns are very reliable
      durationSignal.confidence * 0.15;   // Duration is a weak signal

    const allReasons = [
      ...pauseSignal.reasons,
      ...contentSignal.reasons,
      ...durationSignal.reasons
    ];

    if (allReasons.length > 0) {
      console.log(`[v42] Segment ${i}: confidence=${totalConfidence.toFixed(2)}, signals=[${allReasons.join(', ')}]`);
    }

    if (totalConfidence >= CHANGE_CONFIDENCE_THRESHOLD) {
      changes.push({
        segmentIndex: i,
        confidence: totalConfidence,
        reasons: allReasons
      });
      console.log(`[v42] ✓ Speaker change detected at segment ${i} with confidence ${totalConfidence.toFixed(2)}`);
    }
  }

  return changes;
}

/**
 * v42: Assign speakers based on multi-signal detection
 */
function assignSpeakersMultiSignal(
  segments: TranscriptSegment[],
  changes: SpeakerChangeSignal[],
  speakerCount: number
): SpeakerSegment[] {
  const result: SpeakerSegment[] = [];
  const changeSet = new Map(changes.map(c => [c.segmentIndex, c]));
  let currentSpeaker = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prevEnd = i > 0 ? segments[i - 1].start + segments[i - 1].duration : seg.start;
    const pause = seg.start - prevEnd;
    
    const change = changeSet.get(i);
    let changeConfidence = 0;

    // Change speaker if we detected a change at this segment
    if (change) {
      currentSpeaker = (currentSpeaker + 1) % speakerCount;
      changeConfidence = change.confidence;
      console.log(`[v42] Segment ${i} ("${seg.text.substring(0, 30)}...") -> SPEAKER_${currentSpeaker} (confidence: ${changeConfidence.toFixed(2)})`);
    }

    result.push({
      segmentIndex: i,
      speakerId: `SPEAKER_${currentSpeaker}`,
      speakerGender: 'unknown',
      start: seg.start,
      end: seg.start + seg.duration,
      pauseBefore: pause,
      text: seg.text,
      changeConfidence
    });
  }

  return result;
}

/**
 * Estimate speaker count from change signals
 */
function estimateSpeakerCountFromChanges(
  segments: TranscriptSegment[],
  changes: SpeakerChangeSignal[]
): number {
  if (changes.length === 0) return 1;
  
  // Few changes = likely 2 speakers in conversation
  if (changes.length >= 1 && changes.length <= segments.length / 2) {
    return 2;
  }
  
  // Many changes might indicate multiple speakers
  // But cap at 3 since accurate detection is hard
  return Math.min(3, 2);
}

/**
 * v42: Voice assignment - same as v40 (gender-neutral)
 */
function estimateGenders(
  speakerSegments: SpeakerSegment[],
  speakerCount: number
): Map<string, 'male' | 'female' | 'neutral' | 'unknown'> {
  const genderMap = new Map<string, 'male' | 'female' | 'neutral' | 'unknown'>();
  
  // Use female/neutral voices for ALL speakers
  // This gives voice variety without wrong gender assumptions
  for (let i = 0; i < speakerCount; i++) {
    genderMap.set(`SPEAKER_${i}`, 'female');
  }
  
  console.log('[v42] Assigned', speakerCount, 'speakers with female voices (Nova, Shimmer, Alloy...)');
  return genderMap;
}

/**
 * Build speaker profiles from assigned segments
 */
function buildSpeakerProfiles(
  segments: SpeakerSegment[],
  genderMap: Map<string, 'male' | 'female' | 'neutral' | 'unknown'>
): DetectedSpeaker[] {
  const profiles = new Map<string, DetectedSpeaker>();
  
  for (const seg of segments) {
    const existing = profiles.get(seg.speakerId);
    const duration = seg.end - seg.start;
    
    if (existing) {
      existing.segmentCount++;
      existing.totalSpeakingTime += duration;
      existing.avgSegmentDuration = existing.totalSpeakingTime / existing.segmentCount;
    } else {
      profiles.set(seg.speakerId, {
        id: seg.speakerId,
        estimatedGender: genderMap.get(seg.speakerId) || 'unknown',
        segmentCount: 1,
        totalSpeakingTime: duration,
        avgSegmentDuration: duration
      });
    }
  }
  
  return Array.from(profiles.values()).sort(
    (a, b) => b.totalSpeakingTime - a.totalSpeakingTime
  );
}

/**
 * Main function: Detect speakers from transcription segments
 * v42: Uses multi-signal analysis for improved accuracy
 */
export function detectSpeakers(segments: TranscriptSegment[]): SpeakerDetectionResult {
  console.log('[v42 SpeakerDetection] Analyzing', segments.length, 'segments');
  
  // Not enough segments for meaningful detection
  if (segments.length < MIN_SEGMENTS_FOR_DETECTION) {
    console.log('[v42 SpeakerDetection] Too few segments, defaulting to single speaker');
    const singleSpeakerSegments: SpeakerSegment[] = segments.map((seg, i) => ({
      segmentIndex: i,
      speakerId: 'SPEAKER_0',
      speakerGender: 'female',
      start: seg.start,
      end: seg.start + seg.duration,
      pauseBefore: i > 0 ? seg.start - (segments[i-1].start + segments[i-1].duration) : 0,
      text: seg.text
    }));
    
    return {
      speakers: [{
        id: 'SPEAKER_0',
        estimatedGender: 'female',
        segmentCount: segments.length,
        totalSpeakingTime: segments.reduce((sum, s) => sum + s.duration, 0),
        avgSegmentDuration: segments.reduce((sum, s) => sum + s.duration, 0) / segments.length
      }],
      segments: singleSpeakerSegments,
      detectionMethod: 'single-speaker',
      confidence: 1.0
    };
  }
  
  // v42: Multi-signal speaker change detection
  const changes = detectSpeakerChanges(segments);
  console.log('[v42 SpeakerDetection] Detected', changes.length, 'speaker changes');
  
  // Estimate speaker count
  const speakerCount = estimateSpeakerCountFromChanges(segments, changes);
  console.log('[v42 SpeakerDetection] Estimated', speakerCount, 'speakers');
  
  // Single speaker case
  if (speakerCount === 1 || changes.length === 0) {
    const singleSpeakerSegments: SpeakerSegment[] = segments.map((seg, i) => ({
      segmentIndex: i,
      speakerId: 'SPEAKER_0',
      speakerGender: 'female',
      start: seg.start,
      end: seg.start + seg.duration,
      pauseBefore: i > 0 ? seg.start - (segments[i-1].start + segments[i-1].duration) : 0,
      text: seg.text
    }));
    
    return {
      speakers: [{
        id: 'SPEAKER_0',
        estimatedGender: 'female',
        segmentCount: segments.length,
        totalSpeakingTime: segments.reduce((sum, s) => sum + s.duration, 0),
        avgSegmentDuration: segments.reduce((sum, s) => sum + s.duration, 0) / segments.length
      }],
      segments: singleSpeakerSegments,
      detectionMethod: 'single-speaker',
      confidence: 0.9
    };
  }
  
  // Assign speakers based on multi-signal detection
  const speakerSegments = assignSpeakersMultiSignal(segments, changes, speakerCount);
  
  // Estimate genders (actually assigns voice types)
  const genderMap = estimateGenders(speakerSegments, speakerCount);
  
  // Apply genders to segments
  for (const seg of speakerSegments) {
    seg.speakerGender = genderMap.get(seg.speakerId) || 'unknown';
  }
  
  // Build speaker profiles
  const speakers = buildSpeakerProfiles(speakerSegments, genderMap);
  
  // Calculate overall confidence from change signals
  const avgChangeConfidence = changes.length > 0
    ? changes.reduce((sum, c) => sum + c.confidence, 0) / changes.length
    : 0.5;
  
  const confidence = Math.min(0.95, avgChangeConfidence);
  
  // Log final assignments for debugging
  console.log('[v42 SpeakerDetection] Final assignments:');
  speakerSegments.slice(0, 10).forEach(seg => {
    console.log(`  [${seg.speakerId}] "${seg.text.substring(0, 50)}..."`);
  });
  
  console.log('[v42 SpeakerDetection] Result:', {
    speakers: speakers.length,
    method: 'multi-signal',
    confidence: confidence.toFixed(2),
    changes: changes.length
  });
  
  return {
    speakers,
    segments: speakerSegments,
    detectionMethod: 'multi-signal',
    confidence
  };
}

/**
 * Apply speaker detection to existing segments
 * Returns segments with updated speakerId and speakerGender
 */
export function applySpeakerDetection(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  const result = detectSpeakers(segments);
  
  return segments.map((seg, idx) => {
    const speakerSeg = result.segments.find(s => s.segmentIndex === idx);
    return {
      ...seg,
      speakerId: speakerSeg?.speakerId || 'SPEAKER_0',
      speakerGender: speakerSeg?.speakerGender || 'unknown'
    };
  });
}

/**
 * Get speakers from detection result for voice initialization
 */
export function getSpeakersForVoiceAssignment(result: SpeakerDetectionResult) {
  return result.speakers.map(speaker => ({
    id: speaker.id,
    gender: speaker.estimatedGender,
    total_speaking_time: speaker.totalSpeakingTime,
    pitch: undefined
  }));
}
