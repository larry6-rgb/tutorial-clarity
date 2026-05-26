import { NextRequest, NextResponse } from 'next/server';
import { AssemblyAI } from 'assemblyai';

export const maxDuration = 300; // 5 minutes max for long videos

export async function POST(req: NextRequest) {
  try {
    const { audioUrl, videoId } = await req.json();

    console.log('[AssemblyAI] Starting speaker detection');
    console.log('[AssemblyAI] Video ID:', videoId);
    console.log('[AssemblyAI] Audio URL:', audioUrl?.substring(0, 80) + '...');

    if (!audioUrl) {
      return NextResponse.json(
        { error: 'Audio URL is required' },
        { status: 400 }
      );
    }

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
    console.log('[AssemblyAI] Speech model: universal-2');
    console.log('[AssemblyAI] Speaker labels: enabled');

    // Submit audio with speaker diarization
    // Note: SDK types may not include 'universal-2' yet, but the API requires it
    const transcript = await client.transcripts.transcribe({
      audio: audioUrl,
      speaker_labels: true,
      speech_model: 'universal-2' as any, // Required by current AssemblyAI API
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
