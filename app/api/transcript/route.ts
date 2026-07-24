import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { readFile, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { auth } from '@clerk/nextjs/server';
import { checkPremiumAccess } from '@/lib/subscription';

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
 * FOUR-METHOD FALLBACK:
 * ─────────────────────
 * Method 1: youtube-transcript (npm) — fastest, simplest
 * Method 2: youtubei.js v17 — more detailed, language switching
 * Method 3: Direct InnerTube API fetch — last resort for a real caption track
 * Method 4: Download audio (yt-dlp) + transcribe with OpenAI Whisper — for
 *           videos that genuinely have no YouTube caption track at all
 *           (e.g. only burned-in/on-screen subtitles). Added 2026-07-24.
 *
 * If Methods 1-3 all fail, it usually means the video has no real caption
 * track — Method 4 is the actual fix for that case, not IP blocking.
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

    // Empty lang means "auto" — skip straight to the no-lang default fetch below
    // instead of asking youtube-transcript for an empty-string variant.
    const variants = lang ? (LANG_CODES[lang] || [lang]) : [];

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

// ─── Helper: detect the video's true original-language caption track ──────────
// "No language specified" isn't reliable on its own — youtube-transcript's own
// default can land on ANY available track (e.g. a manually-added translation),
// not necessarily the video's actual spoken language (see the Chinese-default
// bug found 2026-07-14: a Russian video's "default" track came back as "zh").
// YouTube marks its auto-generated speech-recognition track with kind="asr" —
// that's always in the video's real spoken language, so it's the authoritative
// answer for what "auto" should mean.
async function detectOriginalLanguage(videoId: string): Promise<string | null> {
  try {
    const playerResp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId,
      }),
    });
    if (!playerResp.ok) return null;

    const playerData = await playerResp.json();
    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    const asrTrack = tracks.find((t: any) => t.kind === 'asr');
    const detected = asrTrack?.languageCode || tracks[0]?.languageCode || null;
    console.log(`[v17] Auto-detect: ${tracks.length} tracks, asr="${asrTrack?.languageCode || 'none'}" → using "${detected}"`);
    return detected;
  } catch (err: any) {
    console.log(`[v17] Auto-detect failed: ${err.message?.substring(0, 100)}`);
    return null;
  }
}

// ─── Helper: find yt-dlp binary ────────────────────────────────────────────────
// Same binary the old speaker-detection route used (see railpack.json — a custom
// build step downloads yt-dlp's official GitHub release binary; ffmpeg comes from
// apt). Proven working on Railway as of 2026-07-23.

function findYtDlp(): string | null {
  const candidates = [
    'yt-dlp', 'yt-dlp.exe',
    '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp',
    'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe',
  ];
  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" --version`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      return cmd;
    } catch { /* try next */ }
  }
  return null;
}

// Whisper's verbose_json returns full language names ("english"), not the
// 2-letter codes the rest of this file uses — normalize the common ones so
// callers (sourceLanguage display, "auto" detection) see a consistent shape.
const WHISPER_LANG_CODES: Record<string, string> = {
  english: 'en', german: 'de', spanish: 'es', french: 'fr', italian: 'it',
  portuguese: 'pt', japanese: 'ja', korean: 'ko', chinese: 'zh',
};

// OpenAI's real limit is 25MB — stay a little under it.
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;

// ─── Helper: is the current request allowed to trigger the paid Whisper fallback? ───
// Soft check — never throws, just returns false for anonymous/free callers so
// this stays a "skip the expensive step" decision, not a hard block on the
// whole route. Trial counts as allowed (matches checkPremiumAccess elsewhere).
export async function canUseAudioFallback(): Promise<boolean> {
  try {
    const { userId } = await auth();
    if (!userId) return false;
    const access = await checkPremiumAccess(userId);
    return access.allowed;
  } catch {
    return false;
  }
}

// ─── Method 4: download audio directly and transcribe with Whisper ────────────
// Only reached when Methods 1-3 all failed to find a real YouTube caption
// track — the actual gap, not a transient IP block. Most common on videos
// where the creator burned subtitles into the picture instead of using
// YouTube's separate caption feature (confirmed pattern, see project memory
// 2026-07-23). This works regardless of whether YouTube ever had captions,
// since it transcribes the real audio instead of asking YouTube for text.
async function fetchWithWhisper(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; language: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('[v17] Method 4: no OPENAI_API_KEY — skipping Whisper fallback');
    return null;
  }

  const ytdlpPath = findYtDlp();
  if (!ytdlpPath) {
    console.log('[v17] Method 4: yt-dlp not found — skipping Whisper fallback');
    return null;
  }

  const tempFileName = `whisper_${videoId}_${randomUUID()}`;
  const tempFileTemplate = join(tmpdir(), tempFileName + '.%(ext)s');
  const tempFileGlob = join(tmpdir(), tempFileName + '.*');
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let audioPath: string | null = null;

  try {
    console.log('[v17] Method 4: downloading audio via yt-dlp...');
    // Not every video has a separate audio-only stream — try that first (fast,
    // small), then fall back to downloading the best available stream and
    // extracting audio from it. audio-quality 7 (~96kbps mp3) keeps file size
    // down for Whisper's 25MB cap while staying plenty clear for speech.
    const formatStrategies = [
      { label: 'bestaudio', fmt: 'bestaudio' },
      { label: 'best+extract', fmt: 'bestaudio*/best' },
    ];
    let downloadSuccess = false;
    let lastDlError = '';
    for (const strategy of formatStrategies) {
      try {
        execSync(
          `"${ytdlpPath}" -f "${strategy.fmt}" --extract-audio --audio-format mp3 --audio-quality 7 --no-playlist --no-warnings -o "${tempFileTemplate}" "${youtubeUrl}"`,
          { encoding: 'utf8', timeout: 180000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        downloadSuccess = true;
        break;
      } catch (dlErr: any) {
        lastDlError = dlErr.stderr?.toString() || dlErr.message || '';
        console.log(`[v17] Method 4: strategy [${strategy.label}] failed: ${lastDlError.substring(0, 200)}`);
        try {
          const cleanCmd = process.platform === 'win32'
            ? `del /q "${join(tmpdir(), tempFileName)}.*" 2>nul`
            : `rm -f ${tempFileGlob} 2>/dev/null`;
          execSync(cleanCmd, { stdio: 'pipe', timeout: 5000 });
        } catch { /* ignore cleanup errors */ }
      }
    }
    if (!downloadSuccess) {
      console.log(`[v17] Method 4: yt-dlp download failed on all strategies: ${lastDlError.substring(0, 200)}`);
      return null;
    }

    const findCmd = process.platform === 'win32'
      ? `dir /b "${join(tmpdir(), tempFileName)}.*"`
      : `ls -1 ${tempFileGlob} 2>/dev/null`;
    const found = execSync(findCmd, {
      encoding: 'utf8', timeout: 5000,
      cwd: process.platform === 'win32' ? tmpdir() : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);

    if (found.length === 0) {
      console.log('[v17] Method 4: yt-dlp completed but no audio file found');
      return null;
    }
    audioPath = process.platform === 'win32' ? join(tmpdir(), found[0].trim()) : found[0].trim();

    const stats = await stat(audioPath);
    const sizeMB = stats.size / 1024 / 1024;
    console.log(`[v17] Method 4: downloaded ${sizeMB.toFixed(2)}MB`);
    if (stats.size > WHISPER_MAX_BYTES) {
      console.log(`[v17] Method 4: audio too large for Whisper (${sizeMB.toFixed(1)}MB > 24MB) — video too long for this fallback`);
      return null;
    }

    console.log('[v17] Method 4: transcribing with Whisper...');
    const fileBuffer = await readFile(audioPath);
    const form = new FormData();
    form.append('file', new Blob([fileBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });

    if (!whisperRes.ok) {
      const errBody = await whisperRes.text();
      console.log(`[v17] Method 4: Whisper API failed ${whisperRes.status}: ${errBody.substring(0, 200)}`);
      return null;
    }

    const data = await whisperRes.json();
    const rawSegments: any[] = data.segments || [];
    const segments: TranscriptSegment[] = rawSegments
      .map((s: any) => ({
        text: (s.text || '').trim(),
        start: s.start || 0,
        duration: Math.max(0, (s.end || 0) - (s.start || 0)),
      }))
      .filter((s: TranscriptSegment) => s.text.length > 0);

    if (segments.length === 0) {
      console.log('[v17] Method 4: Whisper returned no usable segments');
      return null;
    }

    const detectedLang = (data.language || '').toLowerCase();
    const language = WHISPER_LANG_CODES[detectedLang] || detectedLang || 'unknown';
    console.log(`[v17] Method 4 ✅ ${segments.length} segments via Whisper, detected language="${language}"`);
    return { segments, language };
  } catch (err: any) {
    console.error(`[v17] Method 4 FAILED: ${err.message?.substring(0, 200)}`);
    return null;
  } finally {
    if (audioPath) {
      try { await unlink(audioPath); } catch { /* best-effort cleanup */ }
    }
  }
}

// ─── Shared core logic ─────────────────────────────────────────────────────────
// Exported so other server-side routes (summarize-video, ask-video,
// transcript-document, process-video) can call this directly in-process
// instead of doing a fetch() back to this route's own public HTTPS URL —
// that self-fetch pattern is prone to failing with ERR_SSL_WRONG_VERSION_NUMBER
// on Railway (found 2026-07-23 debugging a Summary failure). Calling the
// function directly has identical behavior and can't hit that network bug.

export interface TranscriptApiResult {
  transcript: TranscriptSegment[];
  source: string;
  videoId: string;
  language: string;
  languageSwitched: boolean;
  availableLanguages: string[];
  count: number;
  error?: string;
  blocked?: boolean;
  details?: string;
}

export async function getTranscriptData(
  videoId: string,
  requestedLang: string = '',
  allowAudioFallback: boolean = false
): Promise<TranscriptApiResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[v17] TRANSCRIPT REQUEST: videoId="${videoId}", lang="${requestedLang}"`);
  console.log(`[v17] Time: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);

  let result: { segments: TranscriptSegment[]; language: string; availableLanguages?: string[] } | null = null;
  let source = '';

  // No language requested — resolve the video's true original (ASR) language
  // first, rather than letting Method 1 fall through to its own unreliable
  // "default" track.
  let effectiveLang = requestedLang;
  if (!effectiveLang) {
    const detected = await detectOriginalLanguage(videoId);
    if (detected) {
      console.log(`[v17] No language requested — using detected original language "${detected}"`);
      effectiveLang = detected;
    }
  }

  // ── Method 1: youtube-transcript ──
  result = await fetchWithYoutubeTranscript(videoId, effectiveLang);
  if (result) {
    source = 'youtube-transcript';
  }

  // ── Method 2: youtubei.js v17 ──
  if (!result) {
    console.log(`[v17] Method 1 failed, trying Method 2...`);
    const ytResult = await fetchWithYoutubei(videoId, effectiveLang);
    if (ytResult) {
      result = ytResult;
      source = 'youtubei.js-v17';
    }
  }

  // ── Method 3: Direct InnerTube API ──
  if (!result) {
    console.log(`[v17] Method 2 failed, trying Method 3...`);
    result = await fetchWithDirectAPI(videoId, effectiveLang);
    if (result) {
      source = 'direct-innertube';
    }
  }

  // ── Method 4: download audio + Whisper transcription (last resort) ──
  // Costs real money (yt-dlp download + Whisper API) — only run it for callers
  // that have already confirmed the requester is logged in and on a trial/paid
  // plan. Free/anonymous callers still get Methods 1-3 for free, they just
  // don't get this fallback when a video genuinely has no caption track.
  if (!result && allowAudioFallback) {
    console.log(`[v17] Method 3 failed, trying Method 4 (Whisper audio transcription)...`);
    const whisperResult = await fetchWithWhisper(videoId);
    if (whisperResult) {
      result = whisperResult;
      source = 'whisper-audio';
    }
  } else if (!result) {
    console.log(`[v17] Method 3 failed — skipping Method 4 (Whisper): caller not authorized for paid fallback`);
  }

  // ── All methods failed ──
  if (!result || result.segments.length === 0) {
    console.log(`[v17] ❌ ALL METHODS FAILED for videoId="${videoId}"`);
    console.log(`[v17] If on home network: check that the video actually has captions on YouTube`);
    console.log(`[v17] If on datacenter: YouTube is likely blocking the IP`);

    const audioFallbackNote = allowAudioFallback
      ? "automatic audio transcription also didn't succeed — possibly because the video is too long, or YouTube is temporarily blocking server requests."
      : 'automatic audio transcription is available on trial/paid plans and may work for this video — sign in or upgrade to try it.';

    return {
      error: `Could not fetch or generate a transcript for this video. It has no real YouTube caption track (on-screen/burned-in subtitles don't count), and ${audioFallbackNote}`,
      transcript: [],
      source: 'none',
      videoId,
      language: requestedLang,
      languageSwitched: false,
      availableLanguages: [],
      count: 0,
      blocked: true,
      details: allowAudioFallback
        ? 'All 4 methods failed (3 caption-track methods + Whisper audio transcription fallback). On a home network this usually means the video has no real caption track and is also too long/unavailable for the audio fallback. On a cloud server it can also mean YouTube is blocking the IP.'
        : '3 caption-track methods failed; the Whisper audio-transcription fallback was skipped (not attempted) because the caller is not on a trial/paid plan. On a home network this usually means the video has no real caption track. On a cloud server it can also mean YouTube is blocking the IP.',
    };
  }

  // ── Success ──
  const languageSwitched = requestedLang !== result.language &&
    !result.language.toLowerCase().startsWith(requestedLang);

  console.log(`[v17] ✅ SUCCESS: ${result.segments.length} segments via ${source}, lang="${result.language}"`);

  return {
    transcript: result.segments,
    source,
    videoId,
    language: result.language,
    languageSwitched: !languageSwitched,
    availableLanguages: result.availableLanguages || [],
    count: result.segments.length,
  };
}

// ─── Main GET handler ─────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoId = (searchParams.get('videoId') ?? '').trim();
  const requestedLang = (searchParams.get('lang') ?? '').trim().toLowerCase();

  if (!videoId) {
    return NextResponse.json(
      { error: 'Video ID is required', transcript: [] },
      { status: 400 }
    );
  }

  // Soft check — this route stays public (it backs the free Scroll Transcript
  // feature too), so an anonymous/free caller still gets a normal response,
  // just without the paid Whisper fallback if the video has no captions.
  const allowAudioFallback = await canUseAudioFallback();

  const data = await getTranscriptData(videoId, requestedLang, allowAudioFallback);

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  });
}
