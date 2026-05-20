import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * /api/process-video — Video Processing, Translation & Transcription
 * 
 * POST — Start video processing
 *   Body: { videoId: string, option: number, targetLanguage: string }
 *   Response: { transcript: TranscriptSegment[], isStreaming: boolean }
 * 
 * CRITICAL: This route now TRANSLATES the transcript to the target language
 * using OpenAI before returning it. The German transcript from YouTube gets
 * translated to English (or whatever target language the user selected).
 */

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

/**
 * Fetch transcript from our /api/transcript endpoint.
 */
async function fetchTranscript(
  videoId: string,
  request: NextRequest
): Promise<TranscriptSegment[]> {
  const origin = request.nextUrl.origin;
  // Fetch default transcript (don't specify lang — let YouTube return whatever it has)
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
 * Translate transcript segments to target language using OpenAI.
 * Batches segments to minimize API calls (translate ~20 at a time).
 */
async function translateSegments(
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

  console.log(`[process-video] Translating ${segments.length} segments to ${langName}...`);

  const BATCH_SIZE = 25;
  const translated: TranscriptSegment[] = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
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
            {
              role: 'user',
              content: textsToTranslate,
            },
          ],
        }),
      });

      if (!response.ok) {
        console.error(`[process-video] Translation API error (${response.status})`);
        // On error, return original text for this batch
        translated.push(...batch);
        continue;
      }

      const data = await response.json();
      const translatedText = data.choices?.[0]?.message?.content || '';
      const translatedLines = translatedText.split('\n').filter((l: string) => l.trim());

      // Parse translated lines back to segments
      for (let j = 0; j < batch.length; j++) {
        const seg = batch[j];
        // Try to find the matching translated line by index
        const matchingLine = translatedLines.find((l: string) => l.startsWith(`[${j}]`));
        if (matchingLine) {
          // Remove the [N] prefix
          const translatedSegText = matchingLine.replace(/^\[\d+\]\s*/, '').trim();
          translated.push({ ...seg, text: translatedSegText || seg.text });
        } else if (translatedLines[j]) {
          // Fallback: use position-based matching
          const translatedSegText = translatedLines[j].replace(/^\[\d+\]\s*/, '').trim();
          translated.push({ ...seg, text: translatedSegText || seg.text });
        } else {
          translated.push(seg); // Keep original if no translation found
        }
      }

      console.log(`[process-video] Translated batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(segments.length / BATCH_SIZE)}`);

    } catch (err) {
      console.error(`[process-video] Translation batch error:`, err);
      translated.push(...batch); // Keep originals on error
    }
  }

  console.log(`[process-video] ✓ Translation complete: ${translated.length} segments`);
  return translated;
}

/**
 * Detect if the transcript is already in the target language.
 * Simple heuristic: check first few segments for common words in the target language.
 */
function detectLanguage(segments: TranscriptSegment[]): string {
  const sample = segments.slice(0, 10).map(s => s.text).join(' ').toLowerCase();
  // Simple German detection
  if (/\b(und|ich|die|der|das|ist|wir|sie|nicht|haben|ein|eine|für|mit|auf|den|dem|von)\b/.test(sample)) {
    return 'de';
  }
  // Simple English detection
  if (/\b(the|and|is|are|was|were|have|has|with|for|that|this|from|but|not|you|we|they)\b/.test(sample)) {
    return 'en';
  }
  return 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoId, option, targetLanguage = 'en' } = body;

    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid videoId' }, { status: 400 });
    }

    console.log(`[process-video] POST — videoId=${videoId}, option=${option}, targetLang=${targetLanguage}`);

    // Step 1: Fetch the transcript (in whatever language YouTube has)
    let segments = await fetchTranscript(videoId, request);
    if (segments.length === 0) {
      return NextResponse.json({ error: 'No transcript segments found' }, { status: 404 });
    }

    // Step 2: Detect source language and translate if needed
    const detectedLang = detectLanguage(segments);
    console.log(`[process-video] Detected source language: ${detectedLang}, target: ${targetLanguage}`);

    if (detectedLang !== targetLanguage && targetLanguage !== detectedLang) {
      // Source and target differ — TRANSLATE!
      segments = await translateSegments(segments, targetLanguage);
    } else {
      console.log(`[process-video] Source matches target (${targetLanguage}) — skipping translation`);
    }

    console.log(`[process-video] ✓ Returning ${segments.length} segments (${targetLanguage})`);

    return NextResponse.json({
      transcript: segments,
      isStreaming: false,
      totalSegments: segments.length,
      videoId,
      translatedTo: targetLanguage,
      sourceLanguage: detectedLang,
    });

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
