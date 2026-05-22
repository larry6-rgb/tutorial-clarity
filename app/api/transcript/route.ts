import { NextRequest, NextResponse } from 'next/server';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

/**
 * =============================================================================
 * TRANSCRIPT API — V17 COMPATIBLE (youtubei.js 17.0.1)
 * =============================================================================
 *
 * This version is specifically written and tested for youtubei.js v17.0.1.
 *
 * KEY V17 DIFFERENCES FROM V12-V16:
 * ─────────────────────────────────
 * 1. Segments are PARSED objects (TranscriptSegment class instances),
 *    NOT raw JSON — they have:
 *      • .start_ms (string from raw data, needs Number() conversion)
 *      • .end_ms   (string, needs conversion)
 *      • .snippet  (Text object — use .text or .toString() for plain text)
 *      • NO .duration_ms — must compute: end_ms - start_ms
 *
 * 2. The path to segments is:
 *      transcriptInfo.transcript.content.body.initial_segments
 *    Where .body is a TranscriptSegmentList, and .initial_segments is
 *    an ObservedArray of TranscriptSegment | TranscriptSectionHeader
 *
 * 3. Language selection uses transcriptInfo.selectLanguage(langName)
 *    which returns a NEW TranscriptInfo instance
 *
 * 4. Available languages: transcriptInfo.languages (string[])
 *    Selected language: transcriptInfo.selectedLanguage (string)
 *
 * THREE-METHOD FALLBACK:
 * ─────────────────────
 * Method 1: youtube-transcript (npm) — fastest, simplest
 * Method 2: youtubei.js v17 — more detailed, language switching
 * Method 3: Direct InnerTube API fetch — last resort
 *
 * If ALL fail, it's YouTube blocking the IP (datacenter vs residential).
 * =============================================================================
 */

// Language code variants for youtube-transcript library
const LANG_CODES: Record<string, string[]> = {
  de: ['de', 'de-DE'],
  en: ['en', 'en-US', 'en-GB'],
  es: ['es', 'es-419', 'es-ES'],
  fr: ['fr', 'fr-FR'],
  it: ['it', 'it-IT'],
  pt: ['pt', 'pt-BR', 'pt-PT'],
};

// Language name variants for youtubei.js selectLanguage matching
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

// ─── Helper: safe number parsing ──────────────────────────────────────────────

function toSeconds(msValue: any): number {
  if (msValue === null || msValue === undefined) return 0;
  const n = Number(msValue);
  return Number.isFinite(n) ? n / 1000 : 0;
}

// ─── Helper: extract text from v17 segment ────────────────────────────────────

function getSegmentText(seg: any): string {
  // v17: snippet is a Text object with .text property and .runs array
  if (seg?.snippet) {
    // Try .text first (most reliable)
    if (typeof seg.snippet.text === 'string' && seg.snippet.text.trim()) {
      return seg.snippet.text.trim();
    }
    // Try .toString()
    if (typeof seg.snippet.toString === 'function') {
      const str = seg.snippet.toString();
      if (str && str.trim()) return str.trim();
    }
    // Try .runs array
    if (Array.isArray(seg.snippet.runs)) {
      const text = seg.snippet.runs.map((r: any) => r?.text ?? '').join('');
      if (text.trim()) return text.trim();
    }
  }
  // Fallback for raw/untyped data
  if (typeof seg?.text === 'string') return seg.text.trim();
  return '';
}

// ─── Helper: decode HTML entities ─────────────────────────────────────────────

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

// ─── Method 1: youtube-transcript library ─────────────────────────────────────

async function fetchWithYoutubeTranscript(
  videoId: string,
  lang: string
): Promise<{ segments: TranscriptSegment[]; language: string } | null> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');

    const variants = LANG_CODES[lang] || [lang];

    // Try each language variant
    for (const variant of variants) {
      try {
        console.log(`[v17] Method 1: youtube-transcript lang="${variant}"`);
        const result = await YoutubeTranscript.fetchTranscript(videoId, { lang: variant });

        if (result && result.length > 0) {
          const segments = result
            .map((item: any) => ({
              text: (item.text || '').trim(),
              start: (item.offset || 0) / 1000,
              duration: (item.duration || 0) / 1000,
            }))
            .filter((s: TranscriptSegment) => s.text.length > 0);

          if (segments.length > 0) {
            console.log(`[v17] Method 1 ✅ ${segments.length} segments, lang="${variant}"`);
            return { segments, language: variant };
          }
        }
      } catch (err: any) {
        const msg = err.message?.substring(0, 150) || 'unknown';
        console.log(`[v17] Method 1: lang="${variant}" failed: ${msg}`);
        if (msg.includes('disabled') || msg.includes('too many') || msg.includes('captcha')) {
          break;
        }
      }
    }

    // Try without language (default transcript)
    try {
      console.log(`[v17] Method 1: trying default (no lang)`);
      const result = await YoutubeTranscript.fetchTranscript(videoId);

      if (result && result.length > 0) {
        const segments = result
          .map((item: any) => ({
            text: (item.text || '').trim(),
            start: (item.offset || 0) / 1000,
            duration: (item.duration || 0) / 1000,
          }))
          .filter((s: TranscriptSegment) => s.text.length > 0);

        if (segments.length > 0) {
          const detectedLang = result[0]?.lang || 'unknown';
          console.log(`[v17] Method 1 ✅ (default) ${segments.length} segments, detected="${detectedLang}"`);
          return { segments, language: detectedLang };
        }
      }
    } catch (err: any) {
      console.log(`[v17] Method 1: default failed: ${err.message?.substring(0, 150)}`);
    }

    return null;
  } catch (importErr: any) {
    console.error(`[v17] Method 1: import error: ${importErr.message}`);
    return null;
  }
}

// ─── Method 2: youtubei.js v17 ────────────────────────────────────────────────

async function fetchWithYoutubei(
  videoId: string,
  lang: string
): Promise<{ segments: TranscriptSegment[]; language: string; availableLanguages: string[] } | null> {
  try {
    const { Innertube } = await import('youtubei.js');

    console.log(`[v17] Method 2: youtubei.js v17 for videoId="${videoId}"`);

    const youtube = await Innertube.create();
    console.log(`[v17] Method 2: Innertube created`);

    const info = await youtube.getInfo(videoId);
    console.log(`[v17] Method 2: getInfo() done`);

    let transcriptInfo: any;
    try {
      transcriptInfo = await info.getTranscript();
    } catch (transcriptErr: any) {
      console.log(`[v17] Method 2: getTranscript() failed: ${transcriptErr.message?.substring(0, 200)}`);
      return null;
    }

    if (!transcriptInfo) {
      console.log(`[v17] Method 2: getTranscript() returned null`);
      return null;
    }

    // ── v17 API: get languages and selected language ──
    const availableLangs: string[] = transcriptInfo.languages ?? [];
    const currentLang = transcriptInfo.selectedLanguage ?? '(unknown)';
    console.log(`[v17] Method 2: current="${currentLang}", available=[${availableLangs.join(', ')}]`);

    // ── Try to switch language if needed ──
    let actualLang = currentLang;
    const nameVariants = LANGUAGE_NAMES[lang];

    if (nameVariants && availableLangs.length > 0) {
      const isAlreadyCorrect = nameVariants.some(
        (v) => currentLang.toLowerCase().includes(v.toLowerCase())
      );

      if (!isAlreadyCorrect) {
        // Find a matching language name in the available list
        const matchingLang = availableLangs.find((l: string) =>
          nameVariants.some((v) => l.toLowerCase() === v.toLowerCase())
        ) || availableLangs.find((l: string) =>
          nameVariants.some((v) => l.toLowerCase().includes(v.toLowerCase()))
        );

        if (matchingLang) {
          try {
            console.log(`[v17] Method 2: switching language to "${matchingLang}"...`);
            transcriptInfo = await transcriptInfo.selectLanguage(matchingLang);
            actualLang = matchingLang;
            console.log(`[v17] Method 2: language switched successfully`);
          } catch (switchErr: any) {
            console.log(`[v17] Method 2: selectLanguage("${matchingLang}") failed: ${switchErr.message?.substring(0, 100)}`);
          }
        } else {
          console.log(`[v17] Method 2: no matching language found for "${lang}" in available languages`);
        }
      } else {
        console.log(`[v17] Method 2: already in correct language "${currentLang}"`);
      }
    }

    // ── v17 segment path: transcriptInfo.transcript.content.body.initial_segments ──
    const body = transcriptInfo?.transcript?.content?.body;
    const rawSegments = body?.initial_segments;

    if (!rawSegments || !Array.isArray(rawSegments)) {
      console.log(`[v17] Method 2: no initial_segments found`);
      console.log(`[v17] Method 2: transcript exists: ${!!transcriptInfo.transcript}`);
      console.log(`[v17] Method 2: content exists: ${!!transcriptInfo.transcript?.content}`);
      console.log(`[v17] Method 2: body exists: ${!!body}`);
      if (body) {
        console.log(`[v17] Method 2: body type: ${body.constructor?.name}`);
        console.log(`[v17] Method 2: body keys: ${Object.keys(body).join(', ')}`);
      }
      return null;
    }

    console.log(`[v17] Method 2: found ${rawSegments.length} raw segments`);

    // ── v17: segments are TranscriptSegment class instances ──
    // They have: start_ms, end_ms, snippet (Text object)
    // NO duration_ms — compute from end_ms - start_ms
    const segments: TranscriptSegment[] = rawSegments
      .map((seg: any) => {
        const text = getSegmentText(seg);
        const startMs = Number(seg.start_ms) || 0;
        const endMs = Number(seg.end_ms) || 0;
        const start = startMs / 1000;
        const duration = endMs > startMs ? (endMs - startMs) / 1000 : 1;
        return { text, start, duration };
      })
      .filter((s: TranscriptSegment) => s.text.length > 0);

    if (segments.length === 0) {
      console.log(`[v17] Method 2: all segments filtered out (empty text)`);
      // Debug: show first 3 raw segments
      rawSegments.slice(0, 3).forEach((seg: any, i: number) => {
        console.log(`[v17] Method 2: raw[${i}]: start_ms=${seg.start_ms}, end_ms=${seg.end_ms}, type=${seg.constructor?.name}, text="${getSegmentText(seg)}"`);
      });
      return null;
    }

    console.log(`[v17] Method 2 ✅ ${segments.length} segments, lang="${actualLang}"`);
    console.log(`[v17] Method 2: first segment: "${segments[0].text}" @ ${segments[0].start}s`);

    return { segments, language: actualLang, availableLanguages: availableLangs };
  } catch (err: any) {
    console.error(`[v17] Method 2 FAILED: ${err.message?.substring(0, 200)}`);
    return null;
  }
}

// ─── Method 3: Direct InnerTube API (raw fetch) ──────────────────────────────

async function fetchWithDirectAPI(
  videoId: string,
  lang: string
): Promise<{ segments: TranscriptSegment[]; language: string } | null> {
  try {
    console.log(`[v17] Method 3: direct InnerTube API for videoId="${videoId}"`);

    // Step 1: Get player data (for caption track URLs)
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
      console.log(`[v17] Method 3: player API returned ${playerResp.status}`);
      return null;
    }

    const playerData = await playerResp.json();
    const playStatus = playerData?.playabilityStatus?.status;
    console.log(`[v17] Method 3: playability status="${playStatus}"`);

    if (playStatus === 'LOGIN_REQUIRED') {
      console.log(`[v17] Method 3: LOGIN_REQUIRED — YouTube blocking this IP`);
      return null;
    }

    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      console.log(`[v17] Method 3: no caption tracks`);
      return null;
    }

    console.log(`[v17] Method 3: ${tracks.length} caption tracks: [${tracks.map((t: any) => t.languageCode).join(', ')}]`);

    // Step 2: Pick the best track
    const langVariants = LANG_CODES[lang] || [lang];
    const selectedTrack = tracks.find((t: any) =>
      langVariants.some((v: string) => t.languageCode === v)
    ) || tracks[0];

    const captionUrl = selectedTrack?.baseUrl;
    if (!captionUrl) {
      console.log(`[v17] Method 3: no baseUrl on selected track`);
      return null;
    }

    // Step 3: Fetch caption XML
    console.log(`[v17] Method 3: fetching captions for lang="${selectedTrack.languageCode}"...`);
    const captionResp = await fetch(captionUrl);
    const captionText = await captionResp.text();

    if (!captionText) {
      console.log(`[v17] Method 3: empty caption response`);
      return null;
    }

    // Step 4: Parse XML
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
      console.log(`[v17] Method 3 ✅ ${segments.length} segments, lang="${selectedTrack.languageCode}"`);
      return { segments, language: selectedTrack.languageCode };
    }

    console.log(`[v17] Method 3: parsed 0 segments from XML`);
    return null;
  } catch (err: any) {
    console.error(`[v17] Method 3 FAILED: ${err.message?.substring(0, 200)}`);
    return null;
  }
}

// ─── Main GET handler ─────────────────────────────────────────────────────────

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

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[v17] TRANSCRIPT REQUEST: videoId="${videoId}", lang="${requestedLang}"`);
  console.log(`[v17] Time: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);

  let result: { segments: TranscriptSegment[]; language: string; availableLanguages?: string[] } | null = null;
  let source = '';

  // ── Method 1: youtube-transcript ──
  result = await fetchWithYoutubeTranscript(videoId, requestedLang);
  if (result) {
    source = 'youtube-transcript';
  }

  // ── Method 2: youtubei.js v17 ──
  if (!result) {
    console.log(`[v17] Method 1 failed, trying Method 2...`);
    const ytResult = await fetchWithYoutubei(videoId, requestedLang);
    if (ytResult) {
      result = ytResult;
      source = 'youtubei.js-v17';
    }
  }

  // ── Method 3: Direct InnerTube API ──
  if (!result) {
    console.log(`[v17] Method 2 failed, trying Method 3...`);
    result = await fetchWithDirectAPI(videoId, requestedLang);
    if (result) {
      source = 'direct-innertube';
    }
  }

  // ── All methods failed ──
  if (!result || result.segments.length === 0) {
    console.log(`[v17] ❌ ALL METHODS FAILED for videoId="${videoId}"`);
    console.log(`[v17] If on home network: check that the video actually has captions on YouTube`);
    console.log(`[v17] If on datacenter: YouTube is likely blocking the IP`);

    return NextResponse.json(
      {
        error: 'Could not fetch transcript. YouTube may be blocking server requests, or this video has no captions.',
        transcript: [],
        source: 'none',
        videoId,
        language: requestedLang,
        blocked: true,
        details: 'All 3 methods failed. On a home network this usually means the video has no captions. On a cloud server it means YouTube is blocking the IP.',
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

  // ── Success ──
  const languageSwitched = requestedLang !== result.language &&
    !result.language.toLowerCase().startsWith(requestedLang);

  console.log(`[v17] ✅ SUCCESS: ${result.segments.length} segments via ${source}, lang="${result.language}"`);

  return NextResponse.json(
    {
      transcript: result.segments,
      source,
      videoId,
      language: result.language,
      languageSwitched: !languageSwitched,
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
