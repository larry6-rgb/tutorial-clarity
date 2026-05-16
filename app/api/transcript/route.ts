import { NextRequest, NextResponse } from 'next/server';

// Language display names mapped to common YouTube caption identifiers
const LANGUAGE_MAP: Record<string, string[]> = {
  de: ['German', 'Deutsch', 'de'],
  en: ['English', 'en'],
  es: ['Spanish', 'Español', 'es'],
  fr: ['French', 'Français', 'fr'],
  it: ['Italian', 'Italiano', 'it'],
  pt: ['Portuguese', 'Português', 'pt'],
};

type RawSegment = {
  start_ms?: number | string;
  end_ms?: number | string;
  startMs?: number | string;
  endMs?: number | string;
  duration_ms?: number | string;
  durationMs?: number | string;
  snippet?: {
    text?: string;
    runs?: Array<{ text?: string }>;
  };
  text?: string;
};

function readNumber(...values: Array<number | string | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function readSegmentText(segment: RawSegment): string {
  const runText = Array.isArray(segment?.snippet?.runs)
    ? segment.snippet.runs.map((run) => run?.text ?? '').join('')
    : '';
  return (runText || segment?.snippet?.text || segment?.text || '').trim();
}

/**
 * Try to select a specific language from the transcript data.
 * Returns the updated transcriptData if successful, or null if the language isn't available.
 */
async function trySelectLanguage(
  transcriptData: any,
  langCode: string,
  availableLangs: string[]
): Promise<any | null> {
  const variants = LANGUAGE_MAP[langCode];
  if (!variants) return null;

  // Check if already selected
  const currentLang = transcriptData?.selectedLanguage ?? '';
  const isAlreadySelected = variants.some(
    (v) => currentLang.toLowerCase().includes(v.toLowerCase())
  );
  if (isAlreadySelected) {
    console.log(`[transcript-api] ✅ Already on requested language: "${currentLang}" (${langCode})`);
    return transcriptData;
  }

  // Find matching language in available list
  const matchingLang = availableLangs.find((lang: string) =>
    variants.some((v) => lang.toLowerCase().includes(v.toLowerCase()))
  );

  if (!matchingLang) {
    console.log(`[transcript-api] Language "${langCode}" not found in available: [${availableLangs.join(', ')}]`);
    return null;
  }

  try {
    console.log(`[transcript-api] Switching to "${matchingLang}" (${langCode})...`);
    const switched = await transcriptData.selectLanguage(matchingLang);
    console.log(`[transcript-api] ✅ Switched to "${matchingLang}"`);
    return switched;
  } catch (err: any) {
    console.warn(`[transcript-api] ⚠️ Failed to select "${matchingLang}":`, err?.message);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoId = (searchParams.get('videoId') ?? '').trim();
  const requestedLang = (searchParams.get('lang') ?? 'de').trim().toLowerCase();

  if (!videoId) {
    return NextResponse.json({ error: 'Video ID is required', transcript: [] }, { status: 400 });
  }

  try {
    const { Innertube } = await import('youtubei.js');

    console.log(`[transcript-api] Fetching transcript for: ${videoId}, requested lang: ${requestedLang}`);

    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    let transcriptData: any = await info.getTranscript();

    const availableLangs: string[] = transcriptData?.languages ?? [];
    const defaultLang = transcriptData?.selectedLanguage ?? '(unknown)';
    console.log(`[transcript-api] Available languages: [${availableLangs.join(', ')}]`);
    console.log(`[transcript-api] Default selected: "${defaultLang}"`);

    // Fallback chain: requested → German → English → default
    const fallbackChain = [requestedLang];
    if (requestedLang !== 'de') fallbackChain.push('de');
    if (requestedLang !== 'en') fallbackChain.push('en');

    let selectedLangCode = requestedLang;
    let languageSwitched = false;

    for (const langCode of fallbackChain) {
      const result = await trySelectLanguage(transcriptData, langCode, availableLangs);
      if (result) {
        transcriptData = result;
        selectedLangCode = langCode;
        languageSwitched = true;
        break;
      }
    }

    if (!languageSwitched) {
      console.log(`[transcript-api] No fallback matched, using default: "${defaultLang}"`);
    }

    if (!transcriptData?.transcript?.content?.body?.initial_segments) {
      console.log('[transcript-api] No transcript payload available');
      return NextResponse.json({
        error: 'No captions available for this video',
        transcript: [],
        source: 'youtubei.js',
        language: selectedLangCode,
      }, { status: 200 });
    }

    const rawSegments: RawSegment[] = transcriptData.transcript.content.body.initial_segments;

    const transcript = rawSegments
      .map((segment) => {
        const startMs = readNumber(segment.start_ms, segment.startMs);
        const endMsCandidate = readNumber(segment.end_ms, segment.endMs);
        const durationMsCandidate = readNumber(segment.duration_ms, segment.durationMs);

        const start = startMs / 1000;
        const durationMs = durationMsCandidate > 0 ? durationMsCandidate : Math.max(endMsCandidate - startMs, 0);
        const duration = durationMs > 0 ? durationMs / 1000 : 1;

        return {
          text: readSegmentText(segment),
          start,
          duration,
        };
      })
      .filter((segment) => segment.text.length > 0);

    console.log(`[transcript-api] Returning ${transcript.length} segments | lang: ${selectedLangCode}`);

    return NextResponse.json({
      transcript,
      source: 'youtubei.js',
      videoId,
      language: selectedLangCode,
      count: transcript.length,
    });
  } catch (error: any) {
    console.error('[transcript-api] Transcript fetch error:', error);

    return NextResponse.json({
      error: 'Failed to fetch transcript',
      transcript: [],
      source: 'youtubei.js',
      details: error?.message || 'Unknown error',
    }, { status: 200 });
  }
}
