import { NextRequest, NextResponse } from 'next/server';
import { AssemblyAI } from 'assemblyai';
import { execSync } from 'child_process';

export const maxDuration = 300; // 5 minutes max for long videos

/**
 * Get a direct YouTube audio URL using yt-dlp.
 * AssemblyAI needs a publicly accessible URL — our localhost proxy won't work.
 * yt-dlp extracts a fresh CDN URL that AssemblyAI can fetch directly.
 */
function getDirectAudioUrl(videoId: string): string {
  console.log('[AssemblyAI] Extracting direct audio URL via yt-dlp...');

  // Find yt-dlp binary
  const candidates = ['yt-dlp', 'yt-dlp.exe', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp',
    'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe'];
  let ytdlpPath = '';

  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" --version`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      ytdlpPath = cmd;
      console.log('[AssemblyAI] Found yt-dlp at:', cmd);
      break;
    } catch { /* try next */ }
  }

  if (!ytdlpPath) {
    throw new Error('yt-dlp not found. Install it: pip install yt-dlp (or winget install yt-dlp on Windows)');
  }

  // Get best audio-only URL
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const result = execSync(
      `"${ytdlpPath}" -f "bestaudio" --get-url --no-warnings "${url}"`,
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!result || !result.startsWith('http')) {
      throw new Error('yt-dlp returned invalid URL: ' + result?.substring(0, 100));
    }

    console.log('[AssemblyAI] Direct audio URL obtained:', result.substring(0, 100) + '...');
    return result;
  } catch (err: any) {
    console.error('[AssemblyAI] yt-dlp error:', err.message);
    throw new Error(`Failed to extract audio URL: ${err.message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();

    console.log('[AssemblyAI] ════════════════════════════════════════');
    console.log('[AssemblyAI] Starting speaker detection');
    console.log('[AssemblyAI] Video ID:', videoId);

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Step 1: Get a direct audio URL via yt-dlp (AssemblyAI needs a public URL)
    const audioUrl = getDirectAudioUrl(videoId);

    // Initialize AssemblyAI client
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      console.error('[AssemblyAI] API key not found in ASSEMBLYAI_API_KEY env var');
      return NextResponse.json(
        { error: 'AssemblyAI API key not configured. Add ASSEMBLYAI_API_KEY to your .env.local' },
        { status: 500 }
      );
    }

    const client = new AssemblyAI({ apiKey });

    console.log('[AssemblyAI] Submitting audio for transcription...');
    console.log('[AssemblyAI] Speech model: best');
    console.log('[AssemblyAI] Speaker labels: enabled');

    // Submit audio with speaker diarization
    const transcript = await client.transcripts.transcribe({
      audio: audioUrl,
      speaker_labels: true,
    });

    console.log('[AssemblyAI] Transcription status:', transcript.status);

    if (transcript.status === 'error') {
      console.error('[AssemblyAI] Transcription error:', transcript.error);
      return NextResponse.json(
        { error: transcript.error || 'Transcription failed' },
        { status: 500 }
      );
    }

    // Extract speaker-labeled utterances
    const utterances = transcript.utterances || [];

    console.log('[AssemblyAI] Success! Found', utterances.length, 'utterances');

    // Find unique speakers
    const speakers = new Set<string>();
    utterances.forEach(u => {
      if (u.speaker) speakers.add(u.speaker);
    });

    console.log('[AssemblyAI] Detected speakers:', Array.from(speakers));

    // Return speaker-labeled segments (convert ms → seconds)
    const segments = utterances.map(u => ({
      text: u.text,
      speaker: u.speaker,
      start: u.start / 1000,
      end: u.end / 1000,
      confidence: u.confidence,
    }));

    // Log sample for debugging
    segments.slice(0, 5).forEach((seg, i) => {
      console.log(`[AssemblyAI]   Seg ${i}: [${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s] Speaker ${seg.speaker}: "${seg.text.substring(0, 50)}"`);
    });

    return NextResponse.json({
      success: true,
      speakers: Array.from(speakers).sort(),
      segments,
      totalSegments: segments.length,
    });

  } catch (error: any) {
    console.error('[AssemblyAI] Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Speaker detection failed' },
      { status: 500 }
    );
  }
}
