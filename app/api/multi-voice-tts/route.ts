import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/multi-voice-tts — Route v79 (enhanced error handling)
 * 
 * Generates TTS audio using OpenAI's TTS API.
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
 */

const OPENAI_VOICES = ['nova', 'shimmer', 'alloy', 'echo', 'fable', 'onyx'];

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  
  try {
    // ── STEP 1: Parse request body ──
    let body: any;
    try {
      body = await request.json();
    } catch (parseErr) {
      console.error(`[TTS-API] ${requestId} ❌ Failed to parse request body:`, parseErr);
      return NextResponse.json(
        { error: 'Invalid JSON in request body', requestId },
        { status: 400 }
      );
    }

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

    // ── STEP 2: Validate required fields ──
    if (!text || typeof text !== 'string') {
      console.error(`[TTS-API] ${requestId} ❌ Missing/invalid text. Got:`, typeof text, text?.length);
      return NextResponse.json(
        { error: 'Missing or invalid text', requestId, textType: typeof text, textLength: text?.length },
        { status: 400 }
      );
    }

    if (text.length > 4096) {
      console.error(`[TTS-API] ${requestId} ❌ Text too long: ${text.length} chars (max 4096)`);
      return NextResponse.json(
        { error: `Text too long: ${text.length} chars (max 4096)`, requestId },
        { status: 400 }
      );
    }

    // ── STEP 3: Resolve voice ID ──
    let voiceId = (customVoice || voice?.id || 'alloy').toLowerCase().trim();

    if (!OPENAI_VOICES.includes(voiceId)) {
      console.warn(`[TTS-API] ${requestId} ⚠️ Unknown voice "${voiceId}", falling back to alloy`);
      voiceId = 'alloy';
    }

    // ── STEP 4: Check API key ──
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error(`[TTS-API] ${requestId} ❌ OPENAI_API_KEY not configured!`);
      return NextResponse.json({ useClientSideTTS: true, reason: 'no-api-key' });
    }

    const model = ttsModel === 'tts-1-hd' ? 'tts-1-hd' : 'tts-1';

    console.log(`[TTS-API] ${requestId} | ${segmentId} | voice="${voiceId}" | speaker=${speakerId} | text="${text.substring(0, 50)}..." (${text.length}ch)`);

    // ── STEP 5: Call OpenAI TTS API (with retry for transient errors) ──
    let ttsResponse: Response | null = null;
    let lastError: string = '';
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
            speed: 1.0,
          }),
        });

        if (ttsResponse.ok) break; // Success — exit retry loop

        // Read error for logging
        const errorBody = await ttsResponse.text();
        lastError = `OpenAI ${ttsResponse.status}: ${errorBody.substring(0, 200)}`;
        console.error(`[TTS-API] ${requestId} ❌ Attempt ${attempt}/${MAX_RETRIES}: ${lastError}`);

        // Don't retry auth/quota errors
        if (ttsResponse.status === 401 || ttsResponse.status === 429) {
          console.log(`[TTS-API] ${requestId} Auth/quota error — falling back to client TTS`);
          return NextResponse.json({
            useClientSideTTS: true,
            reason: ttsResponse.status === 401 ? 'auth-error' : 'rate-limited',
            requestId,
          });
        }

        // For 5xx errors, wait before retry
        if (attempt < MAX_RETRIES && ttsResponse.status >= 500) {
          const delay = attempt * 500; // 500ms, 1000ms
          console.log(`[TTS-API] ${requestId} Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          ttsResponse = null; // Reset for next attempt
        }

      } catch (fetchErr) {
        lastError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(`[TTS-API] ${requestId} ❌ Fetch error (attempt ${attempt}/${MAX_RETRIES}):`, lastError);

        if (attempt < MAX_RETRIES) {
          const delay = attempt * 500;
          console.log(`[TTS-API] ${requestId} Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // ── STEP 6: Handle final response ──
    if (!ttsResponse || !ttsResponse.ok) {
      console.error(`[TTS-API] ${requestId} ❌ All ${MAX_RETRIES} attempts failed: ${lastError}`);
      return NextResponse.json(
        {
          error: 'OpenAI TTS failed after retries',
          details: lastError,
          requestId,
          segmentId,
          voiceId,
          textLength: text.length,
        },
        { status: 502 }
      );
    }

    // ── STEP 7: Return audio ──
    const audioBuffer = await ttsResponse.arrayBuffer();
    console.log(`[TTS-API] ${requestId} ✅ ${segmentId} voice="${voiceId}" ${audioBuffer.byteLength}B`);

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
        'X-Request-Id': requestId,
      },
    });

  } catch (error) {
    // ── CATASTROPHIC ERROR ──
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    console.error(`[TTS-API] ${requestId} ❌❌ UNCAUGHT EXCEPTION:`);
    console.error(`[TTS-API] ${requestId}   Message: ${errMsg}`);
    if (errStack) console.error(`[TTS-API] ${requestId}   Stack: ${errStack}`);

    return NextResponse.json(
      {
        error: 'Internal server error in TTS route',
        message: errMsg,
        requestId,
      },
      { status: 500 }
    );
  }
}
