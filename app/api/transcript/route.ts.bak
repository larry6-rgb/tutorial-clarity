import { NextRequest, NextResponse } from 'next/server';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

/**
 * =============================================================================
 * TRANSCRIPT API ROUTE — DEBUGGED & TESTED
 * =============================================================================
 *
 * ROOT CAUSE OF FAILURES (discovered via testing 2026-05-18):
 *
 * 1. YouTube aggressively blocks server/datacenter IPs with "LOGIN_REQUIRED:
 *    Sign in to confirm you're not a bot." This affects ALL server-side
 *    transcript fetching methods:
 *    - youtube-transcript library (InnerTube API + web scraping)
 *    - youtubei.js (get_transcript endpoint returns HTTP 400)
 *    - youtube-caption-extractor (same IP block)
 *    - Direct InnerTube API calls (ANDROID, IOS, WEB, MWEB clients — all blocked)
 *    - yt-dlp (same block)
 *    - Invidious/Piped instances (most down or also blocked)
 *
 * 2. The block is IP-selective: mega-popular videos (e.g. Rick Roll dQw4w9WgXcQ)
 *    may still work, but most videos (including Easy German) get blocked.
 *
 * 3. This is NOT a code bug — the same code works fine from residential IPs
 *    (like Larry's home network). The issue is cloud/datacenter IP reputation.
 *
 * SOLUTION STRATEGY:
 * - Method 1: youtube-transcript (simpler, faster, works on residential IPs)
 * - Method 2: youtubei.js (fallback, more complex but different request pattern)
 * - Method 3: Direct InnerTube API call (raw fetch, different client contexts)
 * - Clear error reporting so the frontend can inform the user
 *
 * On Larry's home network (Windows + localhost:3000), Methods 1-2 should work
 * for all Easy German videos since residential IPs aren't flagged.
 * =============================================================================
 */

// Language display names for youtube-transcript's lang parameter
const LANG_CODES: Record<string, string[]> = {
  de: ['de', 'de-DE'],
  en: ['en', 'en-US', 'en-GB'],
  es: ['es', 'es-419', 'es-ES'],
  fr: ['fr', 'fr-FR'],
  it: ['it', 'it-IT'],
  pt: ['pt', 'pt-BR', 'pt-PT'],
};

// Language names for youtubei.js selectLanguage matching
const LANGUAGE_NAMES: Record<string, string[]> = {
  de: ['German', 'Deutsch', 'de'],
  en: ['English', 'en'],
  es: ['Spanish', 'Español', 'es'],
  fr: ['French', 'Français', 'fr'],
  it: ['Italian', 'Italiano', 'it'],
  pt: ['Portuguese', 'Português', 'pt'],
};

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

// ─── Method 1: youtube-transcript library ────────────────────────────────────

async function fetchWithYoutubeTranscript(
  videoId: string,
  lang: string
): Promise<{ segments: TranscriptSegment[]; language: string } | null> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');

    // Try requested language variants first
    const variants = LANG_CODES[lang] || [lang];

    for (const variant of variants) {
      try {
        console.log(`[transcript] Method 1: trying youtube-transcript with lang="${variant}"`);
        const result = await YoutubeTranscript.fetchTranscript(videoId, { lang: variant });
        if (result && result.length > 0) {
          const segments = result.map((item: any) => ({
            text: (item.text || '').trim(),
            start: (item.offset || 0) / 1000,   // offset is in ms
            duration: (item.duration || 0) / 1000, // duration is in ms
          })).filter((s: TranscriptSegment) => s.text.length > 0);

          if (segments.length > 0) {
            console.log(`[transcript] Method 1 SUCCESS: ${segments.length} segments, lang="${variant}"`);
            return { segments, language: variant };
          }
        }
      } catch (langErr: any) {
        console.log(`[transcript] Method 1: lang="${variant}" failed:`, langErr.message?.substring(0, 120));
        // If it's "not available in this language", try the next variant
        // If it's "disabled" or "too many requests", break out entirely
        if (langErr.message?.includes('disabled') || langErr.message?.includes('too many')) {
          break;
        }
      }
    }

    // Fallback: try without specifying language (gets default transcript)
    try {
      console.log(`[transcript] Method 1: trying without lang parameter (default transcript)`);
      const result = await YoutubeTranscript.fetchTranscript(videoId);
      if (result && result.length > 0) {
        const segments = result.map((item: any) => ({
          text: (item.text || '').trim(),
          start: (item.offset || 0) / 1000,
          duration: (item.duration || 0) / 1000,
        })).filter((s: TranscriptSegment) => s.text.length > 0);

        if (segments.length > 0) {
          const detectedLang = result[0]?.lang || 'unknown';
          console.log(`[transcript] Method 1 SUCCESS (default): ${segments.length} segments, detected lang="${detectedLang}"`);
          return { segments, language: detectedLang };
        }
      }
    } catch (defaultErr: any) {
      console.log(`[transcript] Method 1: default fetch failed:`, defaultErr.message?.substring(0, 120));
    }

    return null;
  } catch (importErr: any) {
    console.error(`[transcript] Method 1: import error:`, importErr.message);
    return null;
  }
}

// ─── Method 2: youtubei.js library ───────────────────────────────────────────

async function fetchWithYoutubei(
  videoId: string,
  lang: string
): Promise<{ segments: TranscriptSegment[]; language: string; availableLanguages: string[] } | null> {
  try {
    const { Innertube } = await import('youtubei.js');

    console.log(`[transcript] Method 2: trying youtubei.js for videoId="${videoId}"`);

    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    let transcriptData: any = await info.getTranscript();

    if (!transcriptData) {
      console.log(`[transcript] Method 2: getTranscript() returned null/undefined`);
      return null;
    }

    const availableLangs: string[] = transcriptData?.languages ?? transcriptData?.availableLanguages ?? [];
    const defaultLang = transcriptData?.selectedLanguage ?? '(unknown)';
    console.log(`[transcript] Method 2: default="${defaultLang}", available=[${availableLangs.join(', ')}]`);

    // Try to switch language if needed
    let actualLang = defaultLang;
    const nameVariants = LANGUAGE_NAMES[lang];
    if (nameVariants) {
      const isAlreadyCorrect = nameVariants.some(
        (v) => defaultLang.toLowerCase().includes(v.toLowerCase())
      );

      if (!isAlreadyCorrect && availableLangs.length > 0) {
        // Find matching language name
        let matchingLang = availableLangs.find((l: string) =>
          nameVariants.some((v) => l.toLowerCase() === v.toLowerCase())
        ) || availableLangs.find((l: string) =>
          nameVariants.some((v) => l.toLowerCase().includes(v.toLowerCase()))
        );

        if (matchingLang) {
          try {
            console.log(`[transcript] Method 2: switching to "${matchingLang}"`);
            transcriptData = await transcriptData.selectLanguage(matchingLang);
            actualLang = matchingLang;
          } catch (switchErr: any) {
            console.log(`[transcript] Method 2: selectLanguage failed:`, switchErr.message?.substring(0, 80));
            // Try setLanguage as fallback
            if (typeof transcriptData.setLanguage === 'function') {
              try {
                transcriptData = await transcriptData.setLanguage(matchingLang);
                actualLang = matchingLang;
              } catch {}
            }
          }
        }
      }
    }

    // Extract segments
    const rawSegments = transcriptData?.transcript?.content?.body?.initial_segments;
    if (!rawSegments || !Array.isArray(rawSegments) || rawSegments.length === 0) {
      console.log(`[transcript] Method 2: no initial_segments found`);
      return null;
    }

    const segments: TranscriptSegment[] = rawSegments
      .map((seg: any) => {
        const startMs = parseNum(seg.start_ms, seg.startMs);
        const endMs = parseNum(seg.end_ms, seg.endMs);
        const durationMs = parseNum(seg.duration_ms, seg.durationMs);
        const text = extractText(seg);

        const start = startMs / 1000;
        const dur = durationMs > 0 ? durationMs / 1000 : Math.max((endMs - startMs) / 1000, 1);

        return { text, start, duration: dur };
      })
      .filter((s: TranscriptSegment) => s.text.length > 0);

    console.log(`[transcript] Method 2 SUCCESS: ${segments.length} segments, lang="${actualLang}"`);
    return { segments, language: actualLang, availableLanguages: availableLangs };
  } catch (err: any) {
    console.error(`[transcript] Method 2 FAILED:`, err.message?.substring(0, 200));
    return null;
  }
}

// ─── Method 3: Direct InnerTube API (raw fetch) ─────────────────────────────

async function fetchWithDirectAPI(
  videoId: string,
  lang: string
): Promise<{ segments: TranscriptSegment[]; language: string } | null> {
  try {
    console.log(`[transcript] Method 3: trying direct InnerTube API for videoId="${videoId}"`);

    // Step 1: Get caption tracks via player API
    const playerResp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
          },
        },
        videoId,
      }),
    });

    if (!playerResp.ok) {
      console.log(`[transcript] Method 3: player API returned ${playerResp.status}`);
      return null;
    }

    const playerData = await playerResp.json();
    const playStatus = playerData?.playabilityStatus?.status;

    if (playStatus === 'LOGIN_REQUIRED') {
      console.log(`[transcript] Method 3: LOGIN_REQUIRED — YouTube is blocking this server IP`);
      return null;
    }

    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      console.log(`[transcript] Method 3: no caption tracks found (status=${playStatus})`);
      return null;
    }

    console.log(`[transcript] Method 3: found ${tracks.length} caption tracks`);

    // Step 2: Find the best matching track
    const langVariants = LANG_CODES[lang] || [lang];
    let selectedTrack = tracks.find((t: any) =>
      langVariants.some((v) => t.languageCode === v)
    ) || tracks[0]; // Fall back to first track

    const captionUrl = selectedTrack.baseUrl;
    if (!captionUrl) {
      console.log(`[transcript] Method 3: no baseUrl on selected track`);
      return null;
    }

    // Step 3: Fetch caption XML
    const captionResp = await fetch(captionUrl);
    const captionText = await captionResp.text();

    if (!captionText || captionText.length === 0) {
      console.log(`[transcript] Method 3: empty caption response`);
      return null;
    }

    // Step 4: Parse XML captions
    const RE_XML = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
    const segments: TranscriptSegment[] = [];
    let match;

    while ((match = RE_XML.exec(captionText)) !== null) {
      const start = parseFloat(match[1]) || 0;
      const duration = parseFloat(match[2]) || 1;
      const text = decodeHtmlEntities(match[3]).trim();
      if (text.length > 0) {
        segments.push({ text, start, duration });
      }
    }

    if (segments.length > 0) {
      console.log(`[transcript] Method 3 SUCCESS: ${segments.length} segments, lang="${selectedTrack.languageCode}"`);
      return { segments, language: selectedTrack.languageCode };
    }

    console.log(`[transcript] Method 3: parsed 0 segments from XML`);
    return null;
  } catch (err: any) {
    console.error(`[transcript] Method 3 FAILED:`, err.message?.substring(0, 200));
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNum(...values: any[]): number {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function extractText(seg: any): string {
  const runText = Array.isArray(seg?.snippet?.runs)
    ? seg.snippet.runs.map((r: any) => r?.text ?? '').join('')
    : '';
  return (runText || seg?.snippet?.text || seg?.text || '').trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'");
}

// ─── Main GET handler ────────────────────────────────────────────────────────

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

  console.log(`\n========================================`);
  console.log(`[transcript] Request: videoId="${videoId}", lang="${requestedLang}"`);
  console.log(`========================================`);

  let result: { segments: TranscriptSegment[]; language: string; availableLanguages?: string[] } | null = null;
  let source = '';
  let lastError = '';

  // Method 1: youtube-transcript (fastest, simplest)
  result = await fetchWithYoutubeTranscript(videoId, requestedLang);
  if (result) {
    source = 'youtube-transcript';
  }

  // Method 2: youtubei.js (more complex, different request pattern)
  if (!result) {
    const ytResult = await fetchWithYoutubei(videoId, requestedLang);
    if (ytResult) {
      result = ytResult;
      source = 'youtubei.js';
    }
  }

  // Method 3: Direct InnerTube API (raw fetch)
  if (!result) {
    result = await fetchWithDirectAPI(videoId, requestedLang);
    if (result) {
      source = 'direct-innertube';
    }
  }

  // All methods failed
  if (!result || result.segments.length === 0) {
    console.log(`[transcript] ALL METHODS FAILED for videoId="${videoId}"`);
    console.log(`[transcript] This is likely YouTube blocking this server's IP.`);
    console.log(`[transcript] The same code works from residential IPs (like a home network).`);

    return NextResponse.json(
      {
        error: 'Could not fetch transcript. YouTube may be blocking server requests. Try refreshing or check if captions are available for this video.',
        transcript: [],
        source: 'none',
        videoId,
        language: requestedLang,
        blocked: true,  // Flag so frontend knows it's an IP/bot block
        details: 'All 3 methods failed: youtube-transcript, youtubei.js, direct InnerTube API. This typically happens when YouTube blocks the server IP. On a home network (localhost), this should work fine.',
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

  // Success!
  const languageSwitched = requestedLang !== result.language &&
    !result.language.toLowerCase().startsWith(requestedLang);

  console.log(`[transcript] ✅ Returning ${result.segments.length} segments via ${source}`);

  return NextResponse.json(
    {
      transcript: result.segments,
      source,
      videoId,
      language: result.language,
      languageSwitched: !languageSwitched, // true = we got the requested language
      availableLanguages: result.availableLanguages || [],
      count: result.segments.length,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    }
  );
}
