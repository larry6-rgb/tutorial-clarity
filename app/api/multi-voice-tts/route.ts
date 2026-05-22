import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/multi-voice-tts — Route v78
 * 
 * Generates TTS audio using OpenAI's TTS API.
 * Called by useAudioTranslation.ts for each transcript segment.
 * 
 * Request body:
 *   text: string          — Text to synthesize
 *   voice: { id, name, gender, provider } — Voice config
 *   videoId: string       — Source video ID
 *   segmentId: string     — Segment identifier
 *   speakerId: string     — Speaker identifier  
 *   targetDuration?: number — Desired audio duration in seconds
 *   targetLanguage: string — Target language code
 *   ttsModel: 'tts-1' | 'tts-1-hd' — OpenAI model
 *   customVoice?: string  — Override voice ID
 * 
 * Response:
 *   - Audio blob (audio/mpeg) on success
 *   - JSON { useClientSideTTS: true } if server TTS unavailable (fallback to browser)
 *   - JSON { error: string } on failure
 */

const OPENAI_VOICES = ['nova', 'shimmer', 'alloy', 'echo', 'fable', 'onyx'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      text,
      voice,
      videoId,
      segmentId,
      speakerId,
      targetDuration,
      targetLanguage,
      ttsModel = 'tts-1',
      customVoice,
    } = body;

    // Validate required fields
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid text' }, { status: 400 });
    }

    // Determine voice ID
    let voiceId = customVoice || voice?.id || 'alloy';
    voiceId = voiceId.toLowerCase();

    // Validate voice is a known OpenAI voice
    if (!OPENAI_VOICES.includes(voiceId)) {
      console.warn(`[multi-voice-tts] Unknown voice "${voiceId}", falling back to alloy`);
      voiceId = 'alloy';
    }

    // Check for OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log('[multi-voice-tts] No OPENAI_API_KEY set — falling back to client-side TTS');
      return NextResponse.json({ useClientSideTTS: true });
    }

    // Validate model
    const model = ttsModel === 'tts-1-hd' ? 'tts-1-hd' : 'tts-1';

    console.log(`[multi-voice-tts] Generating: voice=${voiceId}, model=${model}, lang=${targetLanguage}, ` +
      `segment=${segmentId}, speaker=${speakerId}, text="${text.substring(0, 50)}..."`);

    // Optionally adjust speed based on target duration
    let speed = 1.0;
    if (targetDuration && targetDuration > 0) {
      // Rough estimate: ~150 words per minute at speed 1.0
      const wordCount = text.split(/\s+/).length;
      const estimatedDuration = (wordCount / 150) * 60;
      if (estimatedDuration > 0) {
        speed = Math.max(0.25, Math.min(4.0, estimatedDuration / targetDuration));
      }
    }

    // Call OpenAI TTS API
    const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: voiceId,
        response_format: 'mp3',
        speed: Math.round(speed * 100) / 100,
      }),
    });

    if (!ttsResponse.ok) {
      const errorBody = await ttsResponse.text();
      console.error(`[multi-voice-tts] OpenAI API error (${ttsResponse.status}):`, errorBody);

      // If it's a quota/auth error, fall back to client-side TTS
      if (ttsResponse.status === 401 || ttsResponse.status === 429) {
        console.log('[multi-voice-tts] Auth/quota issue — falling back to client-side TTS');
        return NextResponse.json({ useClientSideTTS: true });
      }

      return NextResponse.json(
        { error: `OpenAI TTS failed: ${ttsResponse.status}` },
        { status: 502 }
      );
    }

    // Stream audio back to client
    const audioBuffer = await ttsResponse.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600',
        'X-Voice-Id': voiceId,
        'X-Model': model,
        'X-Segment-Id': segmentId || '',
        'X-Speaker-Id': speakerId || '',
      },
    });

  } catch (error) {
    console.error('[multi-voice-tts] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
