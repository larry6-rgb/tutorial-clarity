import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * /api/process-video — Video Processing, Translation & Transcription
 * 
 * POST — Start video processing
 *   Body: { videoId: string, option: number, targetLanguage: string, startIndex?: number, batchSize?: number }
 * 
 *   - Initial call (no startIndex): Fetches transcript, translates first BUFFER_SIZE segments, returns immediately.
 *     Response includes `originalTranscript` (all segments in source language) and `transcript` (translated buffer).
 *   - Follow-up calls (startIndex > 0): Translates the next batch of segments.
 *     Response includes only the newly translated `transcript` segments.
 * 
 * PROGRESSIVE TRANSLATION: Translate 30 segments at a time so the user can start
 * watching immediately. Client requests more batches as playback progresses.
 */

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

// In-memory cache for original transcripts (per video) so follow-up batch requests
// don't re-fetch from YouTube. Expires after 10 minutes.
const transcriptCache = new Map<string, { segments: TranscriptSegment[]; detectedLang: string; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch transcript from our /api/transcript endpoint.
 */
async function fetchTranscript(
  videoId: string,
  request: NextRequest
): Promise<TranscriptSegment[]> {
  const origin = request.nextUrl.origin;
  const transcriptUrl = `${origin}/api/transcript?videoId=${videoId}`;
  console.log(`[process-video] Fetching transcript from: ${transcriptUrl}`);

  const response = await fetch(transcriptUrl, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Transcript fetch failed (${response.status})`);
  }

  const data = await response.json();
  if (!data.transcript || !Array.isArray(data.transcript)) {
    throw new Error('Invalid transcript response');
  }

  console.log(`[process-video] Got ${data.transcript.length} segments (language: ${data.language || 'unknown'})`);

  return data.transcript.map((seg: any) => {
    const start = typeof seg.start === 'number' ? seg.start : parseFloat(seg.start) || 0;
    const duration = typeof seg.duration === 'number' ? seg.duration : parseFloat(seg.duration) || 3;
    return { text: seg.text || '', start, end: start + duration };
  });
}

/**
 * Translate a batch of transcript segments to target language using OpenAI.
 */
async function translateBatch(
  segments: TranscriptSegment[],
  targetLanguage: string
): Promise<TranscriptSegment[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[process-video] No OPENAI_API_KEY — skipping translation');
    return segments;
  }

  const langNames: Record<string, string> = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German',
    it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean',
    zh: 'Chinese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  };
  const langName = langNames[targetLanguage] || targetLanguage;

  // Translate in sub-batches of 25 (OpenAI context limit)
  const SUB_BATCH = 25;
  const translated: TranscriptSegment[] = [];

  for (let i = 0; i < segments.length; i += SUB_BATCH) {
    const batch = segments.slice(i, i + SUB_BATCH);
    const textsToTranslate = batch.map((s, idx) => `[${idx}] ${s.text}`).join('\n');

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: `You are a professional translator. Translate each numbered line to ${langName}. Keep the [N] numbering prefix. Output ONLY the translated lines, one per line. Preserve the meaning and tone. Do not add explanations.`,
            },
            { role: 'user', content: textsToTranslate },
          ],
        }),
      });

      if (!response.ok) {
        console.error(`[process-video] Translation API error (${response.status})`);
        translated.push(...batch);
        continue;
      }

      const data = await response.json();
      const translatedText = data.choices?.[0]?.message?.content || '';
      const translatedLines = translatedText.split('\n').filter((l: string) => l.trim());

      for (let j = 0; j < batch.length; j++) {
        const seg = batch[j];
        const matchingLine = translatedLines.find((l: string) => l.startsWith(`[${j}]`));
        if (matchingLine) {
          const translatedSegText = matchingLine.replace(/^\[\d+\]\s*/, '').trim();
          translated.push({ ...seg, text: translatedSegText || seg.text });
        } else if (translatedLines[j]) {
          const translatedSegText = translatedLines[j].replace(/^\[\d+\]\s*/, '').trim();
          translated.push({ ...seg, text: translatedSegText || seg.text });
        } else {
          translated.push(seg);
        }
      }

      console.log(`[process-video] Translated sub-batch ${Math.floor(i / SUB_BATCH) + 1}/${Math.ceil(segments.length / SUB_BATCH)}`);
    } catch (err) {
      console.error(`[process-video] Translation batch error:`, err);
      translated.push(...batch);
    }
  }

  return translated;
}

/**
 * Detect source language from transcript segments.
 */
function detectLanguage(segments: TranscriptSegment[]): string {
  const sample = segments.slice(0, 10).map(s => s.text).join(' ').toLowerCase();
  if (/\b(und|ich|die|der|das|ist|wir|sie|nicht|haben|ein|eine|für|mit|auf|den|dem|von)\b/.test(sample)) {
    return 'de';
  }
  if (/\b(the|and|is|are|was|were|have|has|with|for|that|this|from|but|not|you|we|they)\b/.test(sample)) {
    return 'en';
  }
  return 'unknown';
}

const INITIAL_BUFFER = 30; // Translate first 30 segments for quick start

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoId, option, targetLanguage = 'en', startIndex = 0, batchSize = 50 } = body;

    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid videoId' }, { status: 400 });
    }

    console.log(`[process-video] POST — videoId=${videoId}, option=${option}, targetLang=${targetLanguage}, startIndex=${startIndex}, batchSize=${batchSize}`);

    // Clean expired cache entries
    const now = Date.now();
    for (const [key, val] of transcriptCache) {
      if (now - val.timestamp > CACHE_TTL) transcriptCache.delete(key);
    }

    let allOriginalSegments: TranscriptSegment[];
    let detectedLang: string;

    // Check cache first (for follow-up batch requests)
    const cacheKey = `${videoId}_${targetLanguage}`;
    const cached = transcriptCache.get(cacheKey);

    if (cached && startIndex > 0) {
      // Follow-up batch request — use cached original segments
      allOriginalSegments = cached.segments;
      detectedLang = cached.detectedLang;
      console.log(`[process-video] Using cached transcript (${allOriginalSegments.length} segments)`);
    } else {
      // Initial request — fetch from YouTube
      allOriginalSegments = await fetchTranscript(videoId, request);
      if (allOriginalSegments.length === 0) {
        return NextResponse.json({ error: 'No transcript segments found' }, { status: 404 });
      }
      detectedLang = detectLanguage(allOriginalSegments);
      // Cache it for follow-up requests
      transcriptCache.set(cacheKey, { segments: allOriginalSegments, detectedLang, timestamp: now });
    }

    // Translate if detected language differs from target, OR if language is unknown
    // (unknown = detection failed, but user explicitly chose a target language so try anyway)
    const needsTranslation = detectedLang !== targetLanguage;
    console.log(`[process-video] Detected: ${detectedLang}, target: ${targetLanguage}, needsTranslation: ${needsTranslation}`);

    if (startIndex === 0) {
      // ═══ INITIAL REQUEST ═══
      // Return original transcript immediately + translated first buffer

      let translatedBuffer: TranscriptSegment[] = [];
      if (needsTranslation) {
        const bufferSlice = allOriginalSegments.slice(0, INITIAL_BUFFER);
        console.log(`[process-video] Translating initial buffer of ${bufferSlice.length} segments...`);
        translatedBuffer = await translateBatch(bufferSlice, targetLanguage);
        console.log(`[process-video] ✓ Initial buffer translated (${translatedBuffer.length} segments)`);
      }

      return NextResponse.json({
        // Original transcript in source language (ALL segments)
        originalTranscript: allOriginalSegments,
        // Translated segments (just the first buffer)
        transcript: needsTranslation ? translatedBuffer : allOriginalSegments.slice(0, INITIAL_BUFFER),
        translatedCount: INITIAL_BUFFER,
        totalSegments: allOriginalSegments.length,
        needsMoreTranslation: allOriginalSegments.length > INITIAL_BUFFER,
        isStreaming: false,
        videoId,
        translatedTo: targetLanguage,
        sourceLanguage: detectedLang,
      });
    } else {
      // ═══ FOLLOW-UP BATCH REQUEST ═══
      // Translate the next batch starting from startIndex
      const endIndex = Math.min(startIndex + batchSize, allOriginalSegments.length);
      const batchSlice = allOriginalSegments.slice(startIndex, endIndex);

      if (batchSlice.length === 0) {
        return NextResponse.json({
          transcript: [],
          startIndex,
          translatedCount: 0,
          totalSegments: allOriginalSegments.length,
          done: true,
          videoId,
        });
      }

      console.log(`[process-video] Translating batch [${startIndex}..${endIndex}] (${batchSlice.length} segments)...`);
      const translatedBatch = needsTranslation
        ? await translateBatch(batchSlice, targetLanguage)
        : batchSlice;

      console.log(`[process-video] ✓ Batch translated (${translatedBatch.length} segments)`);

      return NextResponse.json({
        transcript: translatedBatch,
        startIndex,
        translatedCount: translatedBatch.length,
        totalSegments: allOriginalSegments.length,
        done: endIndex >= allOriginalSegments.length,
        videoId,
      });
    }

  } catch (error) {
    console.error('[process-video] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ error: 'Use POST to start processing' }, { status: 405 });
}
