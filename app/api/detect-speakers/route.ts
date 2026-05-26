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

// ═══════════════════════════════════════════════════════════════════════
// POST /api/detect-speakers
//
// Pipeline:
//   1. yt-dlp → get YouTube CDN audio URL
//   2. Download audio to temp file (so URL can expire safely)
//   3. Upload temp file to AssemblyAI's servers (stable, non-expiring)
//   4. Transcribe with speaker_labels=true
//   5. Clean up temp file
// ═══════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const { videoId } = await req.json();

    console.log('[AssemblyAI] ========================================');
    console.log('[AssemblyAI] SPEAKER DETECTION PIPELINE');
    console.log('[AssemblyAI] ========================================');
    console.log('[AssemblyAI] Video:', videoId);

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

    const ytdlpPath = findYtDlp();
    console.log('[AssemblyAI] Found yt-dlp at:', ytdlpPath);

    const youtubeAudioUrl = getDirectAudioUrl(ytdlpPath, videoId);
    console.log('[AssemblyAI] Step 1/5: ✅ YouTube URL obtained');
    console.log('[AssemblyAI] URL preview:', youtubeAudioUrl.substring(0, 100) + '...');

    // ── STEP 2/5: Download audio to temp file ───────────────────────
    // YouTube URLs expire quickly — download now so the URL doesn't
    // need to stay alive during the entire AssemblyAI processing.

    console.log('[AssemblyAI] Step 2/5: Downloading audio from YouTube... ⏳');

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
    const fileSizeMB = audioBuffer.byteLength / 1024 / 1024;

    console.log('[AssemblyAI] Step 2/5: ✅ Downloaded', fileSizeMB.toFixed(2), 'MB');

    if (fileSizeMB > 100) {
      console.warn('[AssemblyAI] ⚠️ Large file detected:', fileSizeMB.toFixed(2), 'MB — upload may take longer');
    }

    // Save to temporary file
    const tempFileName = `assemblyai_${videoId}_${randomUUID()}.webm`;
    tempFilePath = join(tmpdir(), tempFileName);
    await writeFile(tempFilePath, Buffer.from(audioBuffer));
    console.log('[AssemblyAI] Audio saved to temp file:', tempFilePath);

    // ── STEP 3/5: Upload to AssemblyAI ──────────────────────────────
    // AssemblyAI hosts the file — no expiry concerns.

    console.log('[AssemblyAI] Step 3/5: Uploading to AssemblyAI servers... ⏳');

    const client = new AssemblyAI({ apiKey });

    let uploadedUrl: string;
    try {
      uploadedUrl = await client.files.upload(tempFilePath);
    } catch (uploadErr: any) {
      throw new Error(`AssemblyAI upload failed: ${uploadErr.message}`);
    }

    console.log('[AssemblyAI] Step 3/5: ✅ Uploaded to AssemblyAI servers');
    console.log('[AssemblyAI] AssemblyAI URL:', uploadedUrl.substring(0, 80) + '...');

    // ── STEP 4/5: Transcribe with speaker diarization ───────────────

    console.log('[AssemblyAI] Step 4/5: Processing with AI (1-2 minutes)... ⏳');
    console.log('[AssemblyAI] Speaker labels: enabled');

    let transcript;
    try {
      transcript = await client.transcripts.transcribe({
        audio: uploadedUrl,
        speaker_labels: true,
      });
    } catch (transcribeErr: any) {
      throw new Error(`AssemblyAI transcription failed: ${transcribeErr.message}`);
    }

    console.log('[AssemblyAI] Transcription status:', transcript.status);

    if (transcript.status === 'error') {
      console.error('[AssemblyAI] Transcription error:', transcript.error);
      return NextResponse.json(
        { error: transcript.error || 'Transcription failed' },
        { status: 500 }
      );
    }

    console.log('[AssemblyAI] Step 4/5: ✅ Transcription complete');

    // Extract speaker-labeled utterances
    const utterances = transcript.utterances || [];
    console.log('[AssemblyAI] Found', utterances.length, 'utterances');

    // Find unique speakers
    const speakers = new Set<string>();
    utterances.forEach(u => { if (u.speaker) speakers.add(u.speaker); });
    console.log('[AssemblyAI] Detected speakers:', Array.from(speakers));

    // Convert to our segment format (ms → seconds)
    const segments = utterances.map(u => ({
      text: u.text,
      speaker: u.speaker,
      start: u.start / 1000,
      end: u.end / 1000,
      confidence: u.confidence,
    }));

    // Log sample
    segments.slice(0, 5).forEach((seg, i) => {
      console.log(`[AssemblyAI]   Seg ${i}: [${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s] Speaker ${seg.speaker}: "${seg.text.substring(0, 50)}"`);
    });

    console.log('[AssemblyAI] ========================================');
    console.log('[AssemblyAI] ✅ SPEAKER DETECTION COMPLETE');
    console.log('[AssemblyAI] Speakers:', Array.from(speakers).sort());
    console.log('[AssemblyAI] Utterances:', segments.length);
    console.log('[AssemblyAI] ========================================');

    return NextResponse.json({
      success: true,
      speakers: Array.from(speakers).sort(),
      segments,
      totalSegments: segments.length,
    });

  } catch (error: any) {
    console.error('[AssemblyAI] ❌ Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Speaker detection failed' },
      { status: 500 }
    );
  } finally {
    // ── STEP 5/5: Clean up temp file ────────────────────────────────
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
        console.log('[AssemblyAI] Step 5/5: ✅ Temp file deleted:', tempFilePath);
      } catch (cleanupErr) {
        console.warn('[AssemblyAI] Step 5/5: ⚠️ Failed to delete temp file:', cleanupErr);
        // Don't fail the request if cleanup fails
      }
    }
  }
}
