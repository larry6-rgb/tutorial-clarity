export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { checkPremiumAccess } from '@/lib/subscription';
import { AssemblyAI } from 'assemblyai';
import { execSync } from 'child_process';
import { unlink, stat } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

export const maxDuration = 300; // 5 minutes max for long videos

// ── Helper: Find ffmpeg binary ──────────────────────────────────────

function findFfmpeg(): string | null {
  const candidates = [
    'ffmpeg', 'ffmpeg.exe',
    '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  ];
  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" -version`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      return cmd;
    } catch { /* try next */ }
  }
  return null;
}

// ── Pitch detection via autocorrelation ────────────────────────────
// Returns fundamental frequency in Hz, or 0 if undetectable.

function detectF0(pcmBuffer: Buffer, sampleRate: number): number {
  if (pcmBuffer.length < 512) return 0;
  const samples = new Float32Array(pcmBuffer.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = pcmBuffer.readInt16LE(i * 2) / 32768;
  }
  // Analyze first 1 second max
  const len = Math.min(samples.length, sampleRate);
  // Search period range: 70Hz–300Hz
  const minPeriod = Math.floor(sampleRate / 300);
  const maxPeriod = Math.floor(sampleRate / 70);
  let best = -1, bestPeriod = -1;
  for (let p = minPeriod; p <= maxPeriod; p++) {
    let corr = 0, norm = 0;
    for (let i = 0; i < len - p; i++) {
      corr += samples[i] * samples[i + p];
      norm += samples[i] * samples[i] + samples[i + p] * samples[i + p];
    }
    const nc = norm > 0 ? (2 * corr) / norm : 0;
    if (nc > best) { best = nc; bestPeriod = p; }
  }
  return bestPeriod > 0 ? sampleRate / bestPeriod : 0;
}

// ── Auto-detect gender per speaker via pitch analysis ───────────────

function detectSpeakerGenders(
  ffmpegPath: string,
  audioFile: string,
  utterances: any[],
  speakers: Set<string>
): Record<string, 'male' | 'female'> {
  const speakerList = Array.from(speakers);

  // Step 1: measure F0 for each speaker
  const f0Results: { speaker: string; f0: number }[] = [];

  for (const speaker of speakerList) {
    const speakerUtts = utterances
      .filter((u: any) => u.speaker === speaker)
      .sort((a: any, b: any) => (b.end - b.start) - (a.end - a.start));

    const utt = speakerUtts.find((u: any) => (u.end - u.start) > 1000) || speakerUtts[0];

    if (!utt) {
      f0Results.push({ speaker, f0: 0 });
      continue;
    }

    const startSec = (utt.start / 1000).toFixed(3);
    const duration = Math.min((utt.end - utt.start) / 1000, 4).toFixed(3);

    try {
      const pcm = execSync(
        `"${ffmpegPath}" -ss ${startSec} -i "${audioFile}" -t ${duration} -ar 16000 -ac 1 -f s16le -`,
        { timeout: 15000, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
      ) as Buffer;

      const f0 = detectF0(pcm, 16000);
      console.log(`[Gender] Speaker ${speaker}: F0=${f0.toFixed(1)}Hz (utterance ${startSec}s, ${duration}s)`);
      f0Results.push({ speaker, f0 });
    } catch (err: any) {
      console.warn(`[Gender] Could not analyze speaker ${speaker}:`, err.message?.substring(0, 100));
      f0Results.push({ speaker, f0: 0 });
    }
  }

  // Step 2: assign genders
  // If multiple speakers detected: use relative ranking — lower F0 = male, higher F0 = female.
  // This is more robust than an absolute threshold because male/female voices are reliably
  // distinguishable relative to each other even when absolute pitch varies by person/language.
  const genderMap: Record<string, 'male' | 'female'> = {};
  const validResults = f0Results.filter(r => r.f0 > 0);

  if (validResults.length >= 2) {
    // Sort ascending by F0 — lower half = male, upper half = female
    const sorted = [...validResults].sort((a, b) => a.f0 - b.f0);
    const midpoint = Math.floor(sorted.length / 2);
    sorted.forEach((r, i) => {
      genderMap[r.speaker] = i < midpoint ? 'male' : 'female';
    });
    // Speakers with failed F0 detection: default to male
    f0Results.filter(r => r.f0 === 0).forEach(r => { genderMap[r.speaker] = 'male'; });
  } else {
    // Single speaker or all failed: use absolute threshold
    f0Results.forEach(r => {
      genderMap[r.speaker] = (r.f0 > 0 && r.f0 < 170) ? 'male' : 'female';
    });
  }

  console.log('[Gender] Final assignments:', Object.entries(genderMap).map(([s, g]) => `${s}=${g}`).join(', '));
  return genderMap;
}

// ── Helper: Find yt-dlp binary ──────────────────────────────────────

function findYtDlp(): string {
  const candidates = [
    'yt-dlp', 'yt-dlp.exe',
    '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp',
    'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe',
  ];

  for (const cmd of candidates) {
    try {
      const version = execSync(`"${cmd}" --version`, {
        encoding: 'utf8', timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      console.log(`[AssemblyAI] Found yt-dlp ${version} at: ${cmd}`);
      return cmd;
    } catch { /* try next */ }
  }

  throw new Error(
    'yt-dlp not found. Install it:\n' +
    '  Windows: winget install yt-dlp\n' +
    '  Mac: brew install yt-dlp\n' +
    '  Linux: pip install yt-dlp'
  );
}

// ── Helper: Format seconds to human-readable ────────────────────────

function fmtTime(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return seconds.toFixed(1) + 's';
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}m ${sec}s`;
}

// ═══════════════════════════════════════════════════════════════════════
// POST /api/detect-speakers
//
// RELIABLE PIPELINE:
//   1. yt-dlp downloads audio to a temp file (handles all YouTube auth)
//   2. Upload temp file to AssemblyAI's servers
//   3. Transcribe with speaker_labels=true
//   4. Clean up temp file
//
// KEY INSIGHT: yt-dlp handles YouTube's cookies, headers, and
// authentication automatically. Using fetch() to download from
// YouTube CDN URLs doesn't work reliably because those URLs
// require specific cookies/headers that only yt-dlp knows about.
// ═══════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await checkPremiumAccess(userId);
  if (!access.allowed) {
    return NextResponse.json({ error: 'subscription_required', reason: access.reason }, { status: 403 });
  }

  const pipelineStart = Date.now();
  let tempFilePath: string | null = null;

  console.log('');
  console.log('='.repeat(60));
  console.log('[AssemblyAI] SPEAKER DETECTION — REQUEST RECEIVED');
  console.log('[AssemblyAI] Time:', new Date().toISOString());
  console.log('='.repeat(60));

  try {
    // ── Parse request body ──────────────────────────────────────────

    let body: any;
    try {
      body = await req.json();
      console.log('[AssemblyAI] Request body:', JSON.stringify(body));
    } catch (parseErr: any) {
      console.error('[AssemblyAI] ❌ Failed to parse request body:', parseErr.message);
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { videoId } = body;
    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    console.log('[AssemblyAI] Video ID:', videoId);

    // ── Check API key ───────────────────────────────────────────────

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      console.error('[AssemblyAI] ❌ ASSEMBLYAI_API_KEY not set in .env.local');
      return NextResponse.json(
        { error: 'AssemblyAI API key not configured. Add ASSEMBLYAI_API_KEY to your .env.local' },
        { status: 500 }
      );
    }
    console.log('[AssemblyAI] API key: ✅ present (starts with', apiKey.substring(0, 8) + '...)');

    // ── STEP 1: Download audio with yt-dlp ──────────────────────────
    // yt-dlp downloads directly — handles YouTube cookies, auth, etc.
    // This is MORE RELIABLE than getting a URL and fetching it ourselves.

    console.log('');
    console.log('[AssemblyAI] STEP 1: Downloading audio via yt-dlp... ⏳');
    const step1Start = Date.now();

    const ytdlpPath = findYtDlp();

    // Create temp file path — yt-dlp will write the audio here
    const tempFileName = `assemblyai_${videoId}_${randomUUID()}`;
    // Use %(ext)s so yt-dlp picks the right extension
    const tempFileTemplate = join(tmpdir(), tempFileName + '.%(ext)s');
    // The actual file will have the real extension (e.g., .webm, .m4a)
    const tempFileGlob = join(tmpdir(), tempFileName + '.*');

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // We try multiple format strategies because YouTube doesn't always
    // have separate audio-only streams (especially for some videos).
    // Strategy order:
    //   1. bestaudio (audio-only stream — smallest, fastest)
    //   2. bestaudio*/best with --extract-audio (download anything, extract audio)
    const formatStrategies = [
      { label: 'bestaudio', fmt: 'bestaudio', extract: false },
      { label: 'best+extract', fmt: 'bestaudio*/best', extract: true },
    ];

    let downloadSuccess = false;
    let lastError = '';

    for (const strategy of formatStrategies) {
      try {
        const extractFlags = strategy.extract
          ? ' --extract-audio --audio-format mp3'
          : '';
        const cmd = `"${ytdlpPath}" -f "${strategy.fmt}"${extractFlags} --no-playlist --no-warnings -o "${tempFileTemplate}" "${youtubeUrl}"`;
        console.log(`[AssemblyAI] Trying [${strategy.label}]:`, cmd);

        execSync(cmd, {
          encoding: 'utf8',
          timeout: 180000,  // 3 minute timeout for download + possible extraction
          maxBuffer: 5 * 1024 * 1024,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        downloadSuccess = true;
        console.log(`[AssemblyAI] Strategy [${strategy.label}] succeeded`);
        break;
      } catch (tryErr: any) {
        const stderr = tryErr.stderr?.toString() || tryErr.message || '';
        console.warn(`[AssemblyAI] Strategy [${strategy.label}] failed:`, stderr.substring(0, 200));
        lastError = stderr;
        // Clean up any partial files before trying next strategy
        try {
          const cleanCmd = process.platform === 'win32'
            ? `del /q "${join(tmpdir(), tempFileName)}.*" 2>nul`
            : `rm -f ${tempFileGlob} 2>/dev/null`;
          execSync(cleanCmd, { stdio: 'pipe', timeout: 5000 });
        } catch { /* ignore cleanup errors */ }
      }
    }

    if (!downloadSuccess) {
      throw new Error(
        `Audio download failed — all format strategies exhausted.\n` +
        `Last error: ${lastError.substring(0, 300)}\n\n` +
        `Possible fixes:\n` +
        `  1. Update yt-dlp: pip install -U yt-dlp\n` +
        `  2. Try a different video\n` +
        `  3. Check if the video is age-restricted or geo-blocked`
      );
    }

    // Find the actual file that was created (yt-dlp chose the extension)
    try {
      const findCmd = process.platform === 'win32'
        ? `dir /b "${join(tmpdir(), tempFileName)}.*"`
        : `ls -1 ${tempFileGlob} 2>/dev/null`;

      const foundFiles = execSync(findCmd, {
        encoding: 'utf8', timeout: 5000,
        cwd: process.platform === 'win32' ? tmpdir() : undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split('\n').filter(Boolean);

      if (foundFiles.length === 0) {
        throw new Error('yt-dlp completed but no audio file was created');
      }

      // On Windows, dir /b returns just the filename, not full path
      const foundFile = foundFiles[0].trim();
      tempFilePath = process.platform === 'win32'
        ? join(tmpdir(), foundFile)
        : foundFile;

      console.log('[AssemblyAI] Downloaded to:', tempFilePath);

      // Check file size
      const fileStats = await stat(tempFilePath);
      const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);
      console.log(`[AssemblyAI] STEP 1: ✅ Downloaded ${fileSizeMB} MB (${fmtTime(Date.now() - step1Start)})`);

    } catch (findErr: any) {
      throw new Error(`Audio file not found after download: ${findErr.message}`);
    }

    // ── STEP 2: Upload to AssemblyAI ────────────────────────────────

    console.log('');
    console.log('[AssemblyAI] STEP 2: Uploading to AssemblyAI... ⏳');
    const step2Start = Date.now();

    const client = new AssemblyAI({ apiKey });

    let uploadedUrl: string;
    try {
      uploadedUrl = await client.files.upload(tempFilePath);
    } catch (uploadErr: any) {
      console.error('[AssemblyAI] STEP 2: ❌ Upload failed:', uploadErr.message);
      throw new Error(`Upload to AssemblyAI failed: ${uploadErr.message}`);
    }

    console.log(`[AssemblyAI] STEP 2: ✅ Uploaded (${fmtTime(Date.now() - step2Start)})`);
    console.log('[AssemblyAI] AssemblyAI URL:', uploadedUrl.substring(0, 80) + '...');

    // ── STEP 3: Transcribe with speaker labels ──────────────────────

    console.log('');
    console.log('[AssemblyAI] STEP 3: AI processing (this is the slow part)... ⏳');
    console.log('[AssemblyAI]   ~15 min video ≈ 1-3 min processing');
    console.log('[AssemblyAI]   ~30 min video ≈ 3-5 min processing');
    const step3Start = Date.now();

    let transcript: any;
    try {
      transcript = await Promise.race([
        client.transcripts.transcribe({
          audio: uploadedUrl,
          speaker_labels: true,
          speech_models: ['universal-2'],
        } as any),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(
            'AI processing timed out after 4 minutes. Try a shorter video.'
          )), 240000)
        ),
      ]);
    } catch (txErr: any) {
      console.error(`[AssemblyAI] STEP 3: ❌ Failed after ${fmtTime(Date.now() - step3Start)}`);
      console.error('[AssemblyAI] Error:', txErr.message);
      throw txErr;
    }

    console.log(`[AssemblyAI] STEP 3: ✅ Complete (${fmtTime(Date.now() - step3Start)})`);
    console.log('[AssemblyAI] Status:', transcript.status);

    if (transcript.status === 'error') {
      console.error('[AssemblyAI] Transcription error:', transcript.error);
      return NextResponse.json(
        { error: transcript.error || 'Transcription failed' },
        { status: 500 }
      );
    }

    // ── Extract results ─────────────────────────────────────────────

    const utterances = transcript.utterances || [];
    const speakers = new Set<string>();
    utterances.forEach((u: any) => { if (u.speaker) speakers.add(u.speaker); });

    const segments = utterances.map((u: any) => ({
      text: u.text,
      speaker: u.speaker,
      start: u.start / 1000,
      end: u.end / 1000,
      confidence: u.confidence,
    }));

    // Log sample
    console.log('');
    console.log('[AssemblyAI] SAMPLE RESULTS:');
    segments.slice(0, 5).forEach((seg: any, i: number) => {
      console.log(`[AssemblyAI]   ${i}: [${seg.start.toFixed(1)}s] Speaker ${seg.speaker}: "${seg.text.substring(0, 60)}"`);
    });

    // ── Timing summary ──────────────────────────────────────────────

    const totalTime = fmtTime(Date.now() - pipelineStart);
    console.log('');
    console.log('='.repeat(60));
    console.log(`[AssemblyAI] ✅ COMPLETE — ${totalTime} total`);
    console.log(`[AssemblyAI]   Step 1 (download):  ${fmtTime(Date.now() - step1Start).split('.')[0]}s`);
    console.log(`[AssemblyAI]   Step 2 (upload):    ${fmtTime(step2Start ? Date.now() - step2Start : 0)}`);
    console.log(`[AssemblyAI]   Step 3 (AI):        ${fmtTime(step3Start ? Date.now() - step3Start : 0)}`);
    console.log(`[AssemblyAI] Speakers: [${Array.from(speakers).sort().join(', ')}]`);
    console.log(`[AssemblyAI] Utterances: ${segments.length}`);
    console.log('='.repeat(60));

    // ── STEP 4: Auto-detect speaker genders via pitch analysis ─────────

    let genderMap: Record<string, 'male' | 'female'> = {};
    if (tempFilePath) {
      const ffmpegPath = findFfmpeg();
      if (ffmpegPath) {
        console.log('');
        console.log('[Gender] STEP 4: Detecting speaker genders via pitch analysis...');
        genderMap = detectSpeakerGenders(ffmpegPath, tempFilePath, utterances, speakers);
        console.log('[Gender] STEP 4: ✅ Gender map:', genderMap);
      } else {
        console.warn('[Gender] ffmpeg not found — skipping auto gender detection');
      }
    }

    return NextResponse.json({
      success: true,
      speakers: Array.from(speakers).sort(),
      segments,
      genderMap,
      totalSegments: segments.length,
      processingTime: totalTime,
    });

  } catch (error: any) {
    const totalTime = fmtTime(Date.now() - pipelineStart);
    console.error('');
    console.error('='.repeat(60));
    console.error(`[AssemblyAI] ❌ FAILED after ${totalTime}`);
    console.error(`[AssemblyAI] Error: ${error.message}`);
    console.error('='.repeat(60));

    return NextResponse.json(
      { error: error.message || 'Speaker detection failed' },
      { status: 500 }
    );
  } finally {
    // ── Clean up temp file ──────────────────────────────────────────
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
        console.log('[AssemblyAI] 🧹 Temp file cleaned up');
      } catch {
        // Don't fail if cleanup fails
      }
    }
  }
}
