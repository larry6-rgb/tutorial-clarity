/**
 * matchSpeakerSegments — Hybrid AssemblyAI + YouTube timestamp matching
 * =====================================================================
 *
 * The core of our hybrid approach:
 * - YouTube captions provide text + timestamps (perfectly synced to video)
 * - AssemblyAI provides speaker labels (accurate voice detection)
 * - We match them by text similarity to assign speaker labels to YouTube segments
 *
 * This completely avoids the sync problem that defeated the legacy integration.
 * See ASSEMBLYAI_SYNC_ANALYSIS.md for the full investigation.
 */

export interface YouTubeSegment {
  idx: number;
  text: string;
  start: number;
  end: number;
}

export interface AssemblySegment {
  text: string;
  speaker: string;
  start: number;
  end: number;
  confidence?: number;
}

/**
 * Match YouTube caption segments to AssemblyAI speaker labels.
 *
 * Strategy: For each YouTube segment, find the AssemblyAI utterance
 * with the highest text similarity. If similarity is high enough,
 * assign that speaker label. Otherwise use time-overlap as fallback.
 *
 * Returns a Map of YouTube segment index → speaker ID string.
 */
export function matchSpeakerSegments(
  youtubeSegments: YouTubeSegment[],
  assemblySegments: AssemblySegment[]
): Map<number, string>;
export function matchSpeakerSegments(
  youtubeSegments: YouTubeSegment[],
  assemblySegments: AssemblySegment[],
  returnNormMap: true
): { speakerMap: Map<number, string>; normMap: Map<string, string> };
export function matchSpeakerSegments(
  youtubeSegments: YouTubeSegment[],
  assemblySegments: AssemblySegment[],
  returnNormMap?: boolean
): Map<number, string> | { speakerMap: Map<number, string>; normMap: Map<string, string> } {
  console.log('[MATCH] ════════════════════════════════════════════');
  console.log('[MATCH] Matching YouTube segments to AssemblyAI speakers...');
  console.log('[MATCH] YouTube segments:', youtubeSegments.length);
  console.log('[MATCH] AssemblyAI segments:', assemblySegments.length);

  const speakerMap = new Map<number, string>();

  if (assemblySegments.length === 0) {
    console.warn('[MATCH] No AssemblyAI segments — assigning all to speaker_0');
    youtubeSegments.forEach(s => speakerMap.set(s.idx, 'speaker_0'));
    return speakerMap;
  }

  // Normalize all speaker labels to speaker_0, speaker_1, etc.
  const speakerNormMap = new Map<string, string>();
  let nextSpeakerId = 0;
  assemblySegments.forEach(seg => {
    if (!speakerNormMap.has(seg.speaker)) {
      speakerNormMap.set(seg.speaker, `speaker_${nextSpeakerId++}`);
    }
  });

  console.log('[MATCH] Speaker label mapping:', Object.fromEntries(speakerNormMap));

  // AssemblyAI timestamps are relative to the extracted audio file, YouTube caption
  // timestamps are relative to the video's own timeline — these can be offset by an
  // unknown, per-video amount (see ASSEMBLYAI_SYNC_ANALYSIS.md, "never solved").
  // Estimate that offset from confident (near-exact) text matches so Strategy 1 can be
  // scoped to a plausible time window instead of searching the whole video — otherwise
  // a short, generic phrase ("Wow!", "Buffalo steak") repeated by a DIFFERENT speaker
  // elsewhere in the video can win the text-similarity contest purely by coincidence,
  // silently mislabeling that speaker (and therefore their gender/voice).
  const offsetSamples: number[] = [];
  for (const ytSeg of youtubeSegments) {
    let best: { asmSeg: AssemblySegment; similarity: number } | null = null;
    for (const asmSeg of assemblySegments) {
      const sim = textSimilarity(ytSeg.text, asmSeg.text);
      if (!best || sim > best.similarity) best = { asmSeg, similarity: sim };
    }
    if (best && best.similarity >= 0.6) {
      offsetSamples.push(best.asmSeg.start - ytSeg.start);
    }
  }
  offsetSamples.sort((a, b) => a - b);
  const timelineOffset = offsetSamples.length >= 3
    ? offsetSamples[Math.floor(offsetSamples.length / 2)]
    : 0;
  console.log(`[MATCH] Estimated AssemblyAI↔YouTube offset: ${timelineOffset.toFixed(1)}s (from ${offsetSamples.length} confident matches)`);

  let textMatches = 0;
  let timeMatches = 0;
  let fallbacks = 0;

  const CANDIDATE_WINDOW_SEC = 25;

  youtubeSegments.forEach(ytSeg => {
    // Strategy 1: Text similarity match. Short/generic text (<=4 words) is too easy to
    // match by coincidence, so restrict its search to utterances near this segment's
    // estimated time — but only when we trust the offset estimate (>=3 samples);
    // otherwise search the whole video as before rather than risk false negatives.
    const wordCount = ytSeg.text.trim().split(/\s+/).filter(Boolean).length;
    const restrictToWindow = wordCount <= 4 && offsetSamples.length >= 3;
    const searchPool = restrictToWindow
      ? assemblySegments.filter(a =>
          a.end >= (ytSeg.start + timelineOffset) - CANDIDATE_WINDOW_SEC &&
          a.start <= (ytSeg.end + timelineOffset) + CANDIDATE_WINDOW_SEC)
      : assemblySegments;
    const effectivePool = searchPool.length > 0 ? searchPool : assemblySegments;

    let bestTextMatch: { speaker: string; similarity: number } | null = null;

    for (const asmSeg of effectivePool) {
      const sim = textSimilarity(ytSeg.text, asmSeg.text);
      if (!bestTextMatch || sim > bestTextMatch.similarity) {
        bestTextMatch = { speaker: asmSeg.speaker, similarity: sim };
      }
    }

    if (bestTextMatch && bestTextMatch.similarity >= 0.3) {
      const normalized = speakerNormMap.get(bestTextMatch.speaker) || 'speaker_0';
      speakerMap.set(ytSeg.idx, normalized);
      textMatches++;
      if (ytSeg.idx < 10) {
        console.log(`[MATCH] Seg ${ytSeg.idx}: "${ytSeg.text.substring(0, 35)}" → ${normalized} (text: ${(bestTextMatch.similarity * 100).toFixed(0)}%)`);
      }
      return;
    }

    // Strategy 2: Who is speaking at the midpoint of this YouTube segment?
    // Find the AssemblyAI utterance that CONTAINS the YouTube segment's midpoint time.
    // This is more accurate than max-overlap because a dominant speaker's long utterances
    // would otherwise win every overlap contest even when a different speaker is active.
    const ytMid = (ytSeg.start + ytSeg.end) / 2;
    let midpointMatch: { speaker: string } | null = null;

    for (const asmSeg of assemblySegments) {
      if (ytMid >= asmSeg.start && ytMid <= asmSeg.end) {
        midpointMatch = { speaker: asmSeg.speaker };
        break;
      }
    }

    if (midpointMatch) {
      const normalized = speakerNormMap.get(midpointMatch.speaker) || 'speaker_0';
      speakerMap.set(ytSeg.idx, normalized);
      timeMatches++;
      if (ytSeg.idx < 10) {
        console.log(`[MATCH] Seg ${ytSeg.idx}: "${ytSeg.text.substring(0, 35)}" → ${normalized} (midpoint at ${ytMid.toFixed(1)}s)`);
      }
      return;
    }

    // Strategy 3: Nearest utterance midpoint (midpoint falls in a gap between utterances)
    let nearest: { speaker: string; distance: number } | null = null;
    for (const asmSeg of assemblySegments) {
      const dist = Math.abs(ytMid - (asmSeg.start + asmSeg.end) / 2);
      if (!nearest || dist < nearest.distance) {
        nearest = { speaker: asmSeg.speaker, distance: dist };
      }
    }

    if (nearest) {
      const normalized = speakerNormMap.get(nearest.speaker) || 'speaker_0';
      speakerMap.set(ytSeg.idx, normalized);
      fallbacks++;
      if (ytSeg.idx < 10) {
        console.log(`[MATCH] Seg ${ytSeg.idx}: "${ytSeg.text.substring(0, 35)}" → ${normalized} (nearest, ${nearest.distance.toFixed(1)}s away)`);
      }
    } else {
      speakerMap.set(ytSeg.idx, 'speaker_0');
      fallbacks++;
    }
  });

  // Log statistics
  console.log('[MATCH] ────────────────────────────────────────');
  console.log(`[MATCH] Results: ${textMatches} text matches, ${timeMatches} time matches, ${fallbacks} fallbacks`);

  const dist: Record<string, number> = {};
  speakerMap.forEach(speaker => { dist[speaker] = (dist[speaker] || 0) + 1; });
  console.log('[MATCH] Speaker distribution:', dist);
  console.log('[MATCH] ════════════════════════════════════════════');

  if (returnNormMap) return { speakerMap, normMap: speakerNormMap };
  return speakerMap;
}

/**
 * Text similarity using Jaccard index on word sets.
 * Returns 0..1 where 1 = identical word sets.
 */
function textSimilarity(text1: string, text2: string): number {
  const normalize = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const words1 = new Set(normalize(text1).split(/\s+/).filter(w => w.length > 0));
  const words2 = new Set(normalize(text2).split(/\s+/).filter(w => w.length > 0));

  if (words1.size === 0 && words2.size === 0) return 1;
  if (words1.size === 0 || words2.size === 0) return 0;

  let intersection = 0;
  words1.forEach(w => { if (words2.has(w)) intersection++; });

  const union = words1.size + words2.size - intersection;
  return union > 0 ? intersection / union : 0;
}
