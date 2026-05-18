import { NextRequest, NextResponse } from 'next/server';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

// Language display names mapped to YouTube caption language codes
const LANGUAGE_MAP: Record<string, string[]> = {
  de: ['German', 'Deutsch', 'de'],
  en: ['English', 'en'],
  es: ['Spanish', 'Español', 'es'],
  fr: ['French', 'Français', 'fr'],
  it: ['Italian', 'Italiano', 'it'],
  pt: ['Portuguese', 'Português', 'pt'],
};

type TranscriptSegment = {
  text: string;
  start: number;
  duration: number;
};

/**
 * METHOD 1: youtube-transcript library (simple, reliable)
 * Returns { text, duration, offset } per segment
 */
async function fetchWithYoutubeTranscript(
  videoId: string,
  lang: string
): Promise<{ segments: TranscriptSegment[]; language: string } | null> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');

    // Try with requested language first
    console.log(`[transcript] Method 1: youtube-transcript, lang="${lang}", videoId="${videoId}"`);
    try {
      const result = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      if (result && result.length > 0) {
        const segments = result.map((item: any) => ({
          text: (item.text ?? '').trim(),
          start: (item.offset ?? 0) / 1000, // offset is in ms, convert to seconds
          duration: typeof item.duration === 'number' && item.duration > 100
            ? item.duration / 1000 // if duration seems to be in ms
            : item.duration ?? 1,
        })).filter((s: TranscriptSegment) => s.text.length > 0);

        if (segments.length > 0) {
          console.log(`[transcript] ✅ Got ${segments.length} segments in "${lang}"`);
          return { segments, language: lang };
        }
      }
    } catch (langErr: any) {
      console.log(`[transcript] Language "${lang}" failed: ${langErr?.message}`);
    }

    // Fallback: fetch without specifying language (gets default/first available)
    if (lang !== 'de') {
      // If we already tried a non-default lang and it failed, try default
      console.log(`[transcript] Trying default language (no lang specified)...`);
    } else {
      console.log(`[transcript] Trying without language constraint...`);
    }

    const fallbackResult = await YoutubeTranscript.fetchTranscript(videoId);
    if (fallbackResult && fallbackResult.length > 0) {
      const segments = fallbackResult.map((item: any) => ({
        text: (item.text ?? '').trim(),
        start: (item.offset ?? 0) / 1000,
        duration: typeof item.duration === 'number' && item.duration > 100
          ? item.duration / 1000
          : item.duration ?? 1,
      })).filter((s: TranscriptSegment) => s.text.length > 0);

      if (segments.length > 0) {
        const fallbackLang = fallbackResult[0]?.lang ?? 'unknown';
        console.log(`[transcript] ✅ Fallback got ${segments.length} segments (lang: ${fallbackLang})`);
        return { segments, language: fallbackLang };
      }
    }

    return null;
  } catch (err: any) {
    console.error(`[transcript] Method 1 failed entirely: ${err?.message}`);
    return null;
  }
}

/**
 * METHOD 2: youtubei.js library (more complex, used as fallback)
 */
async function fetchWithYoutubei(
  videoId: string,
  lang: string
): Promise<{ segments: TranscriptSegment[]; language: string; availableLanguages: string[] } | null> {
  try {
    const { Innertube } = await import('youtubei.js');

    console.log(`[transcript] Method 2: youtubei.js, lang="${lang}", videoId="${videoId}"`);

    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    let transcriptData: any = await info.getTranscript();

    if (!transcriptData) {
      console.log(`[transcript] youtubei.js returned null transcriptData`);
      return null;
    }

    const availableLangs: string[] = transcriptData?.languages
      ?? transcriptData?.availableLanguages
      ?? [];
    const defaultLang = transcriptData?.selectedLanguage ?? '(unknown)';
    console.log(`[transcript] Available: [${availableLangs.join(', ')}], default: "${defaultLang}"`);

    // Try to switch language if needed
    const variants = LANGUAGE_MAP[lang] ?? [lang];
    const isAlreadyCorrect = variants.some(
      (v) => defaultLang.toLowerCase().includes(v.toLowerCase())
    );

    if (!isAlreadyCorrect && availableLangs.length > 0) {
      // Find matching language
      let matchingLang = availableLangs.find((l: string) =>
        variants.some((v) => l.toLowerCase() === v.toLowerCase())
      ) ?? availableLangs.find((l: string) =>
        variants.some((v) => l.toLowerCase().includes(v.toLowerCase()))
      );

      if (matchingLang) {
        try {
          console.log(`[transcript] Switching to "${matchingLang}"...`);
          if (typeof transcriptData.selectLanguage === 'function') {
            transcriptData = await transcriptData.selectLanguage(matchingLang);
          } else if (typeof transcriptData.setLanguage === 'function') {
            transcriptData = await transcriptData.setLanguage(matchingLang);
          }
        } catch (switchErr: any) {
          console.warn(`[transcript] Language switch failed: ${switchErr?.message}`);
        }
      }
    }

    // Extract segments
    const rawSegments = transcriptData?.transcript?.content?.body?.initial_segments;
    if (!rawSegments || !Array.isArray(rawSegments) || rawSegments.length === 0) {
      console.log(`[transcript] No segments in youtubei.js response`);
      return null;
    }

    const segments: TranscriptSegment[] = rawSegments
      .map((seg: any) => {
        const startMs = Number(seg.start_ms ?? seg.startMs ?? 0);
        const endMs = Number(seg.end_ms ?? seg.endMs ?? 0);
        const durMs = Number(seg.duration_ms ?? seg.durationMs ?? 0);

        const runText = Array.isArray(seg?.snippet?.runs)
          ? seg.snippet.runs.map((r: any) => r?.text ?? '').join('')
          : '';
        const text = (runText || seg?.snippet?.text || seg?.text || '').trim();

        const duration = durMs > 0 ? durMs / 1000 : (endMs > startMs ? (endMs - startMs) / 1000 : 1);

        return { text, start: startMs / 1000, duration };
      })
      .filter((s: TranscriptSegment) => s.text.length > 0);

    console.log(`[transcript] ✅ youtubei.js got ${segments.length} segments`);
    return { segments, language: lang, availableLanguages: availableLangs };
  } catch (err: any) {
    console.error(`[transcript] Method 2 failed: ${err?.message}`);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoId = (searchParams.get('videoId') ?? '').trim();
  const requestedLang = (searchParams.get('lang') ?? 'de').trim().toLowerCase();

  if (!videoId) {
    return NextResponse.json(
      { error: 'Video ID is required', transcript: [] },
      { status: 400 }
    );
  }

  console.log(`\n[transcript] ========== Request: videoId="${videoId}", lang="${requestedLang}" ==========`);

  // Method 1: youtube-transcript (simpler, more reliable)
  const method1 = await fetchWithYoutubeTranscript(videoId, requestedLang);
  if (method1 && method1.segments.length > 0) {
    return NextResponse.json(
      {
        transcript: method1.segments,
        source: 'youtube-transcript',
        videoId,
        language: method1.language,
        languageSwitched: method1.language === requestedLang,
        count: method1.segments.length,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        },
      }
    );
  }

  // Method 2: youtubei.js (fallback)
  const method2 = await fetchWithYoutubei(videoId, requestedLang);
  if (method2 && method2.segments.length > 0) {
    return NextResponse.json(
      {
        transcript: method2.segments,
        source: 'youtubei.js',
        videoId,
        language: method2.language,
        languageSwitched: true,
        availableLanguages: method2.availableLanguages,
        count: method2.segments.length,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        },
      }
    );
  }

  // Both methods failed
  console.error(`[transcript] ❌ All methods failed for videoId="${videoId}"`);
  return NextResponse.json(
    {
      error: 'No transcript available for this video',
      transcript: [],
      source: 'none',
      videoId,
      language: requestedLang,
      details: 'Both youtube-transcript and youtubei.js methods failed to retrieve a transcript.',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    }
  );
}
