import { NextRequest, NextResponse } from 'next/server';
import { AssemblyAI } from 'assemblyai';
import { execSync } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

export const maxDuration = 300; // 5 minutes max for long videos

// ── Helper: Find yt-dlp binary ──────────────────────────────────────

function findYtDlp(): string {
  const candidates = [
    'yt-dlp', 'yt-dlp.exe',
    '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp',
    'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe',
  ];

  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" --version`, {
        encoding: 'utf8', timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
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

// ── Helper: Get direct YouTube audio URL via yt-dlp ─────────────────

function getDirectAudioUrl(ytdlpPath: string, videoId: string): string {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const result = execSync(
    `"${ytdlpPath}" -f "bestaudio" --get-url --no-warnings "${url}"`,
    {
      encoding: 'utf8', timeout: 30000,
      maxBuffer: 1024 * 1024, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  ).trim();

  if (!result || !result.startsWith('http')) {
    throw new Error('yt-dlp returned invalid URL: ' + result?.substring(0, 100));
  }

  return result;
}

// ── Helper: Format seconds to human-readable ────────────────────────

function fmtTime(seconds: number): string {
  if (seconds < 60) return seconds.toFixed(1) + 's';
  const min = Math.floor(seconds / 60);
  const sec = (seconds % 60).toFixed(0);
  return `${min}m ${sec}s`;
}

// ═══════════════════════════════════════════════════════════════════════
// POST /api/detect-speakers
//
// Pipeline with per-step timing:
//   1. yt-dlp → get YouTube CDN audio URL
//   2. Download audio to temp file
//   3. Upload temp file to AssemblyAI's servers
//   4. Transcribe with speaker_labels=true (the slow part)
//   5. Clean up temp file
// ═══════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const pipelineStart = Date.now();
  let tempFilePath: string | null = null;

  // Per-step durations for summary
  let step1Duration = '';
  let step2Duration = '';
  let step3Duration = '';
  let step4Duration = '';

  try {
    const { videoId } = await req.json();

    console.log('[AssemblyAI] ========================================');
    console.log('[AssemblyAI] SPEAKER DETECTION PIPELINE');
    console.log('[AssemblyAI] ========================================');
    console.log('[AssemblyAI] Video:', videoId);
    console.log('[AssemblyAI] Start time:', new Date().toISOString());

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AssemblyAI API key not configured. Add ASSEMBLYAI_API_KEY to your .env.local' },
        { status: 500 }
      );
    }

    // ── STEP 1/5: Get YouTube audio URL via yt-dlp ──────────────────

    console.log('[AssemblyAI] Step 1/5: Getting YouTube audio URL... ⏳');
    const step1Start = Date.now();

    const ytdlpPath = findYtDlp();
    console.log('[AssemblyAI] Found yt-dlp at:', ytdlpPath);

    const youtubeAudioUrl = getDirectAudioUrl(ytdlpPath, videoId);

    step1Duration = ((Date.now() - step1Start) / 1000).toFixed(1);
    console.log(`[AssemblyAI] Step 1/5: ✅ YouTube URL obtained (${step1Duration}s)`);
    console.log('[AssemblyAI] URL preview:', youtubeAudioUrl.substring(0, 100) + '...');

    // ── STEP 2/5: Download audio to temp file ───────────────────────

    console.log('[AssemblyAI] Step 2/5: Downloading audio from YouTube... ⏳');
    const step2Start = Date.now();

    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(() => downloadController.abort(), 60000);

    let audioResponse: Response;
    try {
      audioResponse = await fetch(youtubeAudioUrl, { signal: downloadController.signal });
      clearTimeout(downloadTimeout);
    } catch (err: any) {
      clearTimeout(downloadTimeout);
      if (err.name === 'AbortError') {
        throw new Error('Audio download timed out after 60 seconds');
      }
      throw new Error(`Audio download failed: ${err.message}`);
    }

    if (!audioResponse.ok) {
      throw new Error(`YouTube download failed (${audioResponse.status}): ${audioResponse.statusText}`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const fileSizeMB = (audioBuffer.byteLength / 1024 / 1024).toFixed(2);

    // Save to temporary file
    const tempFileName = `assemblyai_${videoId}_${randomUUID()}.webm`;
    tempFilePath = join(tmpdir(), tempFileName);
    await writeFile(tempFilePath, Buffer.from(audioBuffer));

    step2Duration = ((Date.now() - step2Start) / 1000).toFixed(1);
    console.log(`[AssemblyAI] Step 2/5: ✅ Downloaded ${fileSizeMB} MB (${step2Duration}s)`);
    console.log('[AssemblyAI] Temp file:', tempFilePath);

    // ── STEP 3/5: Upload to AssemblyAI ──────────────────────────────

    console.log('[AssemblyAI] Step 3/5: Uploading to AssemblyAI servers... ⏳');
    const step3Start = Date.now();

    const client = new AssemblyAI({ apiKey });

    let uploadedUrl: string;
    try {
      uploadedUrl = await client.files.upload(tempFilePath);
    } catch (uploadErr: any) {
      throw new Error(`AssemblyAI upload failed: ${uploadErr.message}`);
    }

    step3Duration = ((Date.now() - step3Start) / 1000).toFixed(1);
    console.log(`[AssemblyAI] Step 3/5: ✅ Uploaded to AssemblyAI (${step3Duration}s)`);
    console.log('[AssemblyAI] AssemblyAI URL:', uploadedUrl.substring(0, 80) + '...');

    // ── STEP 4/5: Transcribe with speaker diarization ───────────────

    console.log('[AssemblyAI] Step 4/5: AI processing (this is the slow part)... ⏳');
    console.log('[AssemblyAI] Warning: Processing time depends on video length');
    console.log('[AssemblyAI]   ~15 min video ≈ 2-3 min processing');
    console.log('[AssemblyAI]   ~30 min video ≈ 4-5 min processing');
    const step4Start = Date.now();

    // Race the transcription against a 4-minute timeout
    let transcript: any;
    try {
      transcript = await Promise.race([
        client.transcripts.transcribe({
          audio: uploadedUrl,
          speaker_labels: true,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(
            'Processing timed out after 4 minutes. The video may be too long. ' +
            'Try a shorter video, or check your AssemblyAI dashboard for the result.'
          )), 240000)
        ),
      ]);
    } catch (err: any) {
      step4Duration = ((Date.now() - step4Start) / 1000).toFixed(1);
      console.error(`[AssemblyAI] Step 4/5: ❌ Failed after ${step4Duration}s:`, err.message);
      throw err;
    }

    step4Duration = ((Date.now() - step4Start) / 1000).toFixed(1);
    console.log(`[AssemblyAI] Step 4/5: ✅ AI processing complete (${step4Duration}s)`);
    console.log('[AssemblyAI] Transcription status:', transcript.status);

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

    // Convert to our segment format (ms → seconds)
    const segments = utterances.map((u: any) => ({
      text: u.text,
      speaker: u.speaker,
      start: u.start / 1000,
      end: u.end / 1000,
      confidence: u.confidence,
    }));

    // Log sample
    segments.slice(0, 5).forEach((seg: any, i: number) => {
      console.log(`[AssemblyAI]   Seg ${i}: [${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s] Speaker ${seg.speaker}: "${seg.text.substring(0, 50)}"`);
    });

    // ── TIMING SUMMARY ──────────────────────────────────────────────

    const totalDuration = (Date.now() - pipelineStart) / 1000;
    console.log('[AssemblyAI] ========================================');
    console.log(`[AssemblyAI] ✅ SPEAKER DETECTION COMPLETE`);
    console.log(`[AssemblyAI] TOTAL TIME: ${fmtTime(totalDuration)}`);
    console.log(`[AssemblyAI]   Step 1 (yt-dlp):     ${step1Duration}s`);
    console.log(`[AssemblyAI]   Step 2 (download):   ${step2Duration}s`);
    console.log(`[AssemblyAI]   Step 3 (upload):     ${step3Duration}s`);
    console.log(`[AssemblyAI]   Step 4 (AI):         ${step4Duration}s  ← most of the time`);
    console.log(`[AssemblyAI] Speakers: ${Array.from(speakers).sort()}`);
    console.log(`[AssemblyAI] Utterances: ${segments.length}`);
    console.log('[AssemblyAI] ========================================');

    return NextResponse.json({
      success: true,
      speakers: Array.from(speakers).sort(),
      segments,
      totalSegments: segments.length,
      processingTime: fmtTime(totalDuration),
    });

  } catch (error: any) {
    const totalDuration = (Date.now() - pipelineStart) / 1000;
    console.error(`[AssemblyAI] ❌ Error after ${fmtTime(totalDuration)}:`, error.message);
    return NextResponse.json(
      { error: error.message || 'Speaker detection failed' },
      { status: 500 }
    );
  } finally {
    // ── STEP 5/5: Clean up temp file ────────────────────────────────
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
        console.log('[AssemblyAI] Step 5/5: ✅ Temp file deleted');
      } catch (cleanupErr) {
        console.warn('[AssemblyAI] Step 5/5: ⚠️ Failed to delete temp file:', cleanupErr);
      }
    }
  }
}
