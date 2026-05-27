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
): Map<number, string> {
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

  let textMatches = 0;
  let timeMatches = 0;
  let fallbacks = 0;

  youtubeSegments.forEach(ytSeg => {
    // Strategy 1: Text similarity match
    let bestTextMatch: { speaker: string; similarity: number } | null = null;

    for (const asmSeg of assemblySegments) {
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

    // Strategy 2: Time overlap match (fallback)
    // Find the AssemblyAI segment with the most time overlap.
    // ★ FIX: Check ALL AssemblyAI segments for overlap, not just midpoint-inside.
    //   A YouTube caption can span a speaker change, so we pick the speaker
    //   who covers MORE of the caption's time range.
    let bestTimeMatch: { speaker: string; overlap: number } | null = null;

    for (const asmSeg of assemblySegments) {
      const overlapStart = Math.max(ytSeg.start, asmSeg.start);
      const overlapEnd = Math.min(ytSeg.end, asmSeg.end);
      const overlap = overlapEnd - overlapStart;
      if (overlap > 0 && (!bestTimeMatch || overlap > bestTimeMatch.overlap)) {
        bestTimeMatch = { speaker: asmSeg.speaker, overlap };
      }
    }

    if (bestTimeMatch && bestTimeMatch.overlap > 0) {
      const normalized = speakerNormMap.get(bestTimeMatch.speaker) || 'speaker_0';
      speakerMap.set(ytSeg.idx, normalized);
      timeMatches++;
      if (ytSeg.idx < 10) {
        console.log(`[MATCH] Seg ${ytSeg.idx}: "${ytSeg.text.substring(0, 35)}" → ${normalized} (time overlap: ${bestTimeMatch.overlap.toFixed(1)}s)`);
      }
      return;
    }

    // Strategy 3: Nearest-in-time AssemblyAI segment
    const ytMid = (ytSeg.start + ytSeg.end) / 2;
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
