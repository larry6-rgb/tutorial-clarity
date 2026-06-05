import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/multi-voice-tts — Route v81 (fixed voice parameter)
 * 
 * Generates TTS audio using OpenAI's TTS API.
 * 
 * Request body:
 *   text: string          — Text to synthesize
 *   voice: string         — Voice ID like "nova", "onyx", "shimmer" (plain string!)
 *   gender?: string       — "male" or "female"
 *   speakerId?: string    — Speaker identifier
 *   segmentId?: string    — Segment identifier
 *   videoId?: string      — Source video ID
 *   ttsModel?: string     — 'tts-1' or 'tts-1-hd'
 * 
 * Also accepts legacy format: voice: { id: string, ... }
 */

const OPENAI_VOICES = ['nova', 'shimmer', 'alloy', 'echo', 'fable', 'onyx'];

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  
  try {
    // ── Parse request body ──
    let body: any;
    try {
      body = await request.json();
    } catch (parseErr) {
      console.error(`[API] ${requestId} ❌ Bad JSON:`, parseErr);
      return NextResponse.json({ error: 'Invalid JSON', requestId }, { status: 400 });
    }

    const { text, voice, gender, videoId, segmentId, speakerId, ttsModel = 'tts-1', customVoice, targetDuration } = body;

    // ── Resolve voice ID (handle both string and object formats) ──
    let voiceId: string;
    if (customVoice && typeof customVoice === 'string') {
      voiceId = customVoice.toLowerCase().trim();
    } else if (typeof voice === 'string') {
      // NEW format: voice is a plain string like "nova"
      voiceId = voice.toLowerCase().trim();
    } else if (voice && typeof voice === 'object' && voice.id) {
      // LEGACY format: voice is { id: "nova", name: "nova", ... }
      voiceId = String(voice.id).toLowerCase().trim();
    } else {
      voiceId = 'alloy';
    }

    console.log(`[API] ${requestId} | voice input: ${JSON.stringify(voice)} (type=${typeof voice}) => resolved: "${voiceId}" | speaker=${speakerId} | seg=${segmentId}`);

    // ── Validate ──
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text', requestId }, { status: 400 });
    }
    if (text.length > 4096) {
      return NextResponse.json({ error: `Text too long: ${text.length}`, requestId }, { status: 400 });
    }
    if (!OPENAI_VOICES.includes(voiceId)) {
      console.warn(`[API] ${requestId} ⚠️ Unknown voice "${voiceId}", using alloy`);
      voiceId = 'alloy';
    }

    // ── Check API key ──
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ useClientSideTTS: true, reason: 'no-api-key' });
    }

    const model = ttsModel === 'tts-1-hd' ? 'tts-1-hd' : 'tts-1';

    // Always generate at natural speed — forcing TTS to fit exact slot durations causes
    // audible rate swings (0.5x–1.65x) because translated text isn't always the same
    // relative length as the original. Natural pauses absorb small mismatches instead.
    const ttsSpeed = 1.0;

    console.log(`[API] ${requestId} | CALLING OpenAI: model=${model} voice="${voiceId}" speed=1.0 text="${text.substring(0, 50)}..." (${text.length}ch)`);

    // ── Call OpenAI TTS with retry ──
    let ttsResponse: Response | null = null;
    let lastError = '';
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
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
            speed: ttsSpeed,
          }),
        });

        if (ttsResponse.ok) break;

        const errorBody = await ttsResponse.text();
        lastError = `OpenAI ${ttsResponse.status}: ${errorBody.substring(0, 200)}`;
        console.error(`[API] ${requestId} ❌ attempt ${attempt}: ${lastError}`);

        if (ttsResponse.status === 401 || ttsResponse.status === 429) {
          return NextResponse.json({
            useClientSideTTS: true,
            reason: ttsResponse.status === 401 ? 'auth-error' : 'rate-limited',
            requestId,
          });
        }

        if (attempt < MAX_RETRIES && ttsResponse.status >= 500) {
          await new Promise(r => setTimeout(r, attempt * 500));
          ttsResponse = null;
        }
      } catch (fetchErr) {
        lastError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(`[API] ${requestId} ❌ fetch error attempt ${attempt}: ${lastError}`);
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, attempt * 500));
      }
    }

    if (!ttsResponse || !ttsResponse.ok) {
      console.error(`[API] ${requestId} ❌ All retries failed: ${lastError}`);
      return NextResponse.json(
        { error: 'OpenAI TTS failed', details: lastError, requestId, voiceId },
        { status: 502 }
      );
    }

    // ── Return audio ──
    const audioBuffer = await ttsResponse.arrayBuffer();
    console.log(`[API] ${requestId} ✅ ${segmentId} voice="${voiceId}" ${audioBuffer.byteLength}B`);

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600',
        'X-Voice-Id': voiceId,
        'X-Voice-Used': voiceId,
        'X-Model': model,
        'X-Segment-Id': segmentId || '',
        'X-Speaker-Id': speakerId || '',
        'X-Request-Id': requestId,
      },
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[API] ${requestId} ❌❌ UNCAUGHT:`, errMsg);
    return NextResponse.json({ error: 'Internal error', message: errMsg, requestId }, { status: 500 });
  }
}
