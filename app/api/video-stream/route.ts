/**
 * /api/video-stream — Video/Audio Stream Extraction API
 * =====================================================
 * 
 * PURPOSE:
 *   Extract separate video-only and audio-only streaming URLs from YouTube.
 *   This enables our "separated playback" architecture where we control
 *   video and audio independently — no more YouTube iframe audio conflicts!
 * 
 * HOW IT WORKS:
 *   1. Calls yt-dlp (must be installed on the machine running Next.js)
 *   2. yt-dlp extracts available formats with direct CDN URLs
 *   3. We pick the best video-only and audio-only streams
 *   4. Returns URLs that the browser can load directly in <video>/<audio> elements
 * 
 * TWO MODES:
 *   GET /api/video-stream?videoId=xxx
 *     → Returns JSON with format info + URLs for video-only and audio-only
 * 
 *   GET /api/video-stream?videoId=xxx&proxy=video  (or proxy=audio)
 *     → Proxies the actual stream bytes (fallback if direct URLs have CORS issues)
 * 
 * REQUIREMENTS:
 *   - yt-dlp must be installed: https://github.com/yt-dlp/yt-dlp
 *   - Windows: winget install yt-dlp  OR  download yt-dlp.exe to PATH
 *   - Mac: brew install yt-dlp
 *   - Linux: pip install yt-dlp
 * 
 * NOTE: This runs on YOUR machine (localhost), not a cloud server.
 *   YouTube blocks datacenter IPs, but residential IPs (your home) work fine.
 * 
 * ARCHITECTURE FOR LARRY:
 *   ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
 *   │  Browser     │────▶│  Next.js API  │────▶│  yt-dlp      │
 *   │  <video>     │◀────│  /video-stream│◀────│  (local CLI)  │
 *   │  <audio>     │     └──────────────┘     └──────────────┘
 *   └─────────────┘            │
 *                              ▼
 *                     YouTube CDN (direct URLs)
 *                     OR proxied through our API
 */

import { NextRequest, NextResponse } from 'next/server';
import { execSync, spawn } from 'child_process';

export const dynamic = 'force-dynamic';

// ── Types ───────────────────────────────────────────────────────────

interface YtDlpFormat {
  format_id: string;
  ext: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec: string;
  acodec: string;
  url: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;       // total bitrate
  vbr?: number;       // video bitrate
  abr?: number;       // audio bitrate
  asr?: number;       // audio sample rate
  format_note?: string;
  resolution?: string;
  quality?: number;
}

interface StreamInfo {
  url: string;
  format_id: string;
  ext: string;
  quality_label?: string;
  width?: number;
  height?: number;
  fps?: number;
  codec: string;
  bitrate?: number;
  filesize?: number;
}

// ── Helper: Find yt-dlp ─────────────────────────────────────────────

function findYtDlp(): string | null {
  /**
   * Try to find yt-dlp on the system.
   * Checks common locations on Windows, Mac, and Linux.
   */
  const candidates = [
    'yt-dlp',                                    // in PATH
    'yt-dlp.exe',                                // Windows in PATH
    'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe',  // Chocolatey
    '/usr/local/bin/yt-dlp',                     // Mac/Linux
    '/usr/bin/yt-dlp',                           // Linux
  ];

  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" --version`, { 
        encoding: 'utf8', 
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      return cmd;
    } catch {
      // Not found at this path, try next
    }
  }
  return null;
}

// ── Helper: Get formats from yt-dlp ─────────────────────────────────

function getFormats(ytdlpPath: string, videoId: string): YtDlpFormat[] {
  /**
   * Call yt-dlp -j to get JSON info including all available formats.
   * The -j flag outputs a single JSON object with all metadata.
   */
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  
  try {
    const result = execSync(
      `"${ytdlpPath}" -j --no-warnings "${url}"`,
      {
        encoding: 'utf8',
        timeout: 30000,           // 30s timeout
        maxBuffer: 10 * 1024 * 1024,  // 10MB buffer for JSON output
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const info = JSON.parse(result);
    return info.formats || [];
  } catch (err: any) {
    console.error('[video-stream] yt-dlp error:', err.message);
    if (err.stderr) console.error('[video-stream] stderr:', err.stderr.toString().substring(0, 500));
    throw new Error(`yt-dlp failed: ${err.message}`);
  }
}

// ── Helper: Pick best formats ───────────────────────────────────────

function pickBestFormats(formats: YtDlpFormat[]) {
  /**
   * From all available formats, pick:
   *   1. Best video-only stream (highest resolution with reasonable codec)
   *   2. Best audio-only stream (highest bitrate)
   *   3. A selection of video qualities for user choice
   * 
   * Video-only: has video codec, NO audio codec (acodec === 'none')
   * Audio-only: has audio codec, NO video codec (vcodec === 'none')
   */

  const videoOnly = formats.filter(f => 
    f.vcodec && f.vcodec !== 'none' && 
    (!f.acodec || f.acodec === 'none') &&
    f.url
  );

  const audioOnly = formats.filter(f => 
    f.acodec && f.acodec !== 'none' && 
    (!f.vcodec || f.vcodec === 'none') &&
    f.url
  );

  // Sort video by height (resolution) descending, prefer mp4/webm
  videoOnly.sort((a, b) => {
    const resA = a.height || 0;
    const resB = b.height || 0;
    if (resB !== resA) return resB - resA;
    // Prefer mp4 over webm for broader browser compatibility
    if (a.ext === 'mp4' && b.ext !== 'mp4') return -1;
    if (b.ext === 'mp4' && a.ext !== 'mp4') return 1;
    return (b.tbr || 0) - (a.tbr || 0);
  });

  // Sort audio by bitrate descending, prefer m4a/mp4 for compatibility
  audioOnly.sort((a, b) => {
    const brA = a.abr || a.tbr || 0;
    const brB = b.abr || b.tbr || 0;
    if (brB !== brA) return brB - brA;
    if (a.ext === 'm4a' && b.ext !== 'm4a') return -1;
    if (b.ext === 'm4a' && a.ext !== 'm4a') return 1;
    return 0;
  });

  // Build video quality options (deduplicated by resolution)
  const seenResolutions = new Set<number>();
  const videoOptions: StreamInfo[] = [];
  for (const f of videoOnly) {
    const h = f.height || 0;
    if (h > 0 && !seenResolutions.has(h)) {
      seenResolutions.add(h);
      videoOptions.push({
        url: f.url,
        format_id: f.format_id,
        ext: f.ext,
        quality_label: f.format_note || `${h}p`,
        width: f.width,
        height: h,
        fps: f.fps,
        codec: f.vcodec,
        bitrate: f.vbr || f.tbr,
        filesize: f.filesize || f.filesize_approx,
      });
    }
  }

  // Build audio options
  const audioOptions: StreamInfo[] = audioOnly.map(f => ({
    url: f.url,
    format_id: f.format_id,
    ext: f.ext,
    codec: f.acodec,
    bitrate: f.abr || f.tbr,
    filesize: f.filesize || f.filesize_approx,
  }));

  return {
    // Best picks (first in sorted list)
    bestVideo: videoOptions[0] || null,
    bestAudio: audioOptions[0] || null,
    // All options for quality selection
    videoOptions,
    audioOptions,
  };
}

// ── Proxy mode: stream bytes through our server ─────────────────────

async function proxyStream(
  ytdlpPath: string, 
  videoId: string, 
  type: 'video' | 'audio',
  quality?: string,
  rangeHeader?: string | null,
): Promise<Response> {
  /**
   * Uses yt-dlp to pipe the stream directly through our API.
   * This is the CORS-safe fallback — the browser always loads from our origin.
   * 
   * We use yt-dlp's -o - flag to output to stdout, which we pipe to the response.
   * 
   * For video-only: -f "bestvideo[ext=mp4]" or specific format ID
   * For audio-only: -f "bestaudio[ext=m4a]" or specific format ID
   */
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  
  // Build format selector
  let formatSelector: string;
  if (quality) {
    // Use specific format ID
    formatSelector = quality;
  } else if (type === 'video') {
    // Best video-only, prefer mp4 for browser compatibility
    formatSelector = 'bestvideo[ext=mp4]/bestvideo';
  } else {
    // Best audio-only, prefer m4a for browser compatibility
    formatSelector = 'bestaudio[ext=m4a]/bestaudio';
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-f', formatSelector,
      '-o', '-',              // output to stdout
      '--no-warnings',
      '--no-part',
      '--no-continue',
      url,
    ];

    console.log(`[video-stream proxy] yt-dlp ${args.join(' ')}`);

    const proc = spawn(ytdlpPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stderrData = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    // Collect first chunk to determine content type
    let headerSent = false;
    const chunks: Buffer[] = [];
    let totalSize = 0;

    proc.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      totalSize += chunk.length;
    });

    proc.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        console.error(`[video-stream proxy] yt-dlp exited with code ${code}`);
        console.error(`[video-stream proxy] stderr: ${stderrData.substring(0, 500)}`);
        resolve(new Response(
          JSON.stringify({ error: `Stream failed: ${stderrData.substring(0, 200)}` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        ));
        return;
      }

      // Combine all chunks
      const buffer = Buffer.concat(chunks);
      
      // Determine content type
      const contentType = type === 'video' 
        ? 'video/mp4'    // Most common for video-only
        : 'audio/mp4';   // m4a is mp4 container

      resolve(new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600',  // Cache for 1 hour
        },
      }));
    });

    proc.on('error', (err) => {
      console.error('[video-stream proxy] spawn error:', err);
      resolve(new Response(
        JSON.stringify({ error: `Failed to start yt-dlp: ${err.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      ));
    });

    // Kill after 2 minutes (safety timeout)
    setTimeout(() => {
      proc.kill('SIGTERM');
    }, 120000);
  });
}

// ── GET Handler ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId');
  const proxyType = searchParams.get('proxy') as 'video' | 'audio' | null;
  const quality = searchParams.get('quality') || undefined;

  // ── Validate input ──
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json(
      { error: 'Invalid or missing videoId parameter (must be 11 chars)' },
      { status: 400 }
    );
  }

  // ── Find yt-dlp ──
  const ytdlpPath = findYtDlp();
  if (!ytdlpPath) {
    return NextResponse.json({
      error: 'yt-dlp is not installed on this machine',
      installInstructions: {
        windows: 'winget install yt-dlp   OR   download from https://github.com/yt-dlp/yt-dlp/releases',
        mac: 'brew install yt-dlp',
        linux: 'pip install yt-dlp   OR   sudo apt install yt-dlp',
        general: 'See https://github.com/yt-dlp/yt-dlp#installation',
      },
      hint: 'After installing, restart your terminal and run: yt-dlp --version',
    }, { status: 503 });
  }

  console.log(`[video-stream] Using yt-dlp at: ${ytdlpPath}`);

  // ── Proxy mode: stream bytes ──
  if (proxyType === 'video' || proxyType === 'audio') {
    const rangeHeader = request.headers.get('range');
    return proxyStream(ytdlpPath, videoId, proxyType, quality, rangeHeader);
  }

  // ── Info mode: return format data + URLs ──
  try {
    const formats = getFormats(ytdlpPath, videoId);
    
    if (formats.length === 0) {
      return NextResponse.json({
        error: 'No formats available for this video',
        hint: 'This could mean YouTube is blocking requests. Try again from a residential IP.',
        videoId,
      }, { status: 404 });
    }

    const { bestVideo, bestAudio, videoOptions, audioOptions } = pickBestFormats(formats);

    // Log what we found
    console.log(`[video-stream] Found ${videoOptions.length} video + ${audioOptions.length} audio formats`);
    if (bestVideo) console.log(`[video-stream] Best video: ${bestVideo.quality_label} ${bestVideo.codec}`);
    if (bestAudio) console.log(`[video-stream] Best audio: ${bestAudio.codec} ${bestAudio.bitrate}kbps`);

    return NextResponse.json({
      success: true,
      videoId,

      // ── Direct URLs (browser loads from YouTube CDN) ──
      // These work in <video src="..."> and <audio src="..."> elements.
      // URLs are temporary (expire in ~6 hours).
      bestVideo,
      bestAudio,

      // ── Proxy URLs (CORS-safe fallback) ──
      // Use these if direct URLs fail due to CORS or expiry.
      proxyUrls: {
        video: `/api/video-stream?videoId=${videoId}&proxy=video`,
        audio: `/api/video-stream?videoId=${videoId}&proxy=audio`,
      },

      // ── All available qualities ──
      videoOptions: videoOptions.map(v => ({
        ...v,
        url: undefined,  // Don't leak all URLs in the info response
        proxyUrl: `/api/video-stream?videoId=${videoId}&proxy=video&quality=${v.format_id}`,
      })),
      audioOptions: audioOptions.map(a => ({
        ...a,
        url: undefined,
        proxyUrl: `/api/video-stream?videoId=${videoId}&proxy=audio&quality=${a.format_id}`,
      })),

      // ── Stats ──
      totalFormats: formats.length,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'private, max-age=300',  // Cache for 5 minutes
      }
    });

  } catch (err: any) {
    console.error('[video-stream] Error:', err.message);
    
    return NextResponse.json({
      error: err.message,
      videoId,
      hint: err.message.includes('bot') || err.message.includes('Sign in')
        ? 'YouTube is blocking this request. This usually works from home (residential IP) but fails from cloud servers.'
        : 'Make sure yt-dlp is installed and working: yt-dlp --version',
    }, { status: 500 });
  }
}
