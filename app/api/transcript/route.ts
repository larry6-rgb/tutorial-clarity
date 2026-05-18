import { NextRequest, NextResponse } from 'next/server';

// Prevent Next.js from caching this route — each lang request must hit the server
export const dynamic = 'force-dynamic';

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
  if (!variants) {
    console.log(`[transcript-api] No variants defined for lang code: "${langCode}"`);
    return null;
  }

  // Check if already selected
  const currentLang = transcriptData?.selectedLanguage ?? '';
  console.log(`[transcript-api] Current language: "${currentLang}", requested: "${langCode}", variants: [${variants.join(', ')}]`);
  
  const isAlreadySelected = variants.some(
    (v) => currentLang.toLowerCase().includes(v.toLowerCase())
  );
  if (isAlreadySelected) {
    console.log(`[transcript-api] ✅ Already on requested language: "${currentLang}" (${langCode})`);
    return transcriptData;
  }

  // Find matching language in available list — try exact match first, then partial
  let matchingLang = availableLangs.find((lang: string) =>
    variants.some((v) => lang.toLowerCase() === v.toLowerCase())
  );
  if (!matchingLang) {
    matchingLang = availableLangs.find((lang: string) =>
      variants.some((v) => lang.toLowerCase().includes(v.toLowerCase()))
    );
  }

  if (!matchingLang) {
    console.log(`[transcript-api] ❌ Language "${langCode}" not found in available: [${availableLangs.join(', ')}]`);
    return null;
  }

  try {
    console.log(`[transcript-api] 🔄 Switching to "${matchingLang}" (${langCode})...`);
    const switched = await transcriptData.selectLanguage(matchingLang);
    
    // Verify the switch actually worked
    const newLang = switched?.selectedLanguage ?? '(unknown)';
    console.log(`[transcript-api] ✅ Switched to "${matchingLang}", new selectedLanguage: "${newLang}"`);
    
    // Double-check it has segments
    const segments = switched?.transcript?.content?.body?.initial_segments;
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      console.warn(`[transcript-api] ⚠️ Language switched but no segments found — may be empty transcript`);
    } else {
      console.log(`[transcript-api] ✅ Got ${segments.length} segments after language switch`);
    }
    
    return switched;
  } catch (err: any) {
    console.warn(`[transcript-api] ⚠️ Failed to select "${matchingLang}":`, err?.message);
    
    // Some versions of youtubei.js use different method names — try alternatives
    if (typeof transcriptData.setLanguage === 'function') {
      try {
        console.log(`[transcript-api] Trying .setLanguage("${matchingLang}") as fallback...`);
        const switched = await transcriptData.setLanguage(matchingLang);
        console.log(`[transcript-api] ✅ .setLanguage() succeeded`);
        return switched;
      } catch (err2: any) {
        console.warn(`[transcript-api] ⚠️ .setLanguage() also failed:`, err2?.message);
      }
    }
    
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

    // Debug: explore what properties the transcript data object has
    const tdKeys = transcriptData ? Object.keys(transcriptData) : [];
    console.log(`[transcript-api] TranscriptData keys: [${tdKeys.join(', ')}]`);
    console.log(`[transcript-api] TranscriptData.languages type: ${typeof transcriptData?.languages}`);
    console.log(`[transcript-api] TranscriptData.selectedLanguage: "${transcriptData?.selectedLanguage}"`);
    
    // Try multiple possible property names for available languages
    const availableLangs: string[] = transcriptData?.languages 
      ?? transcriptData?.availableLanguages 
      ?? [];
    const defaultLang = transcriptData?.selectedLanguage ?? '(unknown)';
    console.log(`[transcript-api] Available languages: [${availableLangs.join(', ')}]`);
    console.log(`[transcript-api] Default selected: "${defaultLang}"`);
    
    // Log available methods on transcriptData for debugging
    if (transcriptData) {
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(transcriptData) || {})
        .filter(name => typeof transcriptData[name] === 'function');
      console.log(`[transcript-api] Available methods: [${methods.join(', ')}]`);
    }

    // Try the requested language first (no fallback — give the frontend an honest answer)
    let selectedLangCode = requestedLang;
    let languageSwitched = false;

    const result = await trySelectLanguage(transcriptData, requestedLang, availableLangs);
    if (result) {
      transcriptData = result;
      languageSwitched = true;
    } else {
      // Only fall back if the requested language was truly unavailable
      console.log(`[transcript-api] Requested lang "${requestedLang}" not available, keeping default: "${defaultLang}"`);
      selectedLangCode = defaultLang.toLowerCase().includes('deutsch') || defaultLang.toLowerCase().includes('german') ? 'de' :
                         defaultLang.toLowerCase().includes('english') ? 'en' : requestedLang;
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

    console.log(`[transcript-api] Returning ${transcript.length} segments | lang: ${selectedLangCode} | switched: ${languageSwitched}`);

    return NextResponse.json({
      transcript,
      source: 'youtubei.js',
      videoId,
      language: selectedLangCode,
      languageSwitched,
      availableLanguages: availableLangs,
      count: transcript.length,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
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
