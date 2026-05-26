import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/multi-voice-tts — Route v80 (nuclear diagnostic logging)
 * 
 * Generates TTS audio using OpenAI's TTS API.
 * Every step is traced with [API-xxxxx] prefix for end-to-end debugging.
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
    // ═══ NUCLEAR LOG: Request headers ═══
    const expectedVoice = request.headers.get('x-expected-voice');
    const headerSpeaker = request.headers.get('x-speaker-id');
    const headerSegment = request.headers.get('x-segment-id');
    console.log(`[API-${requestId}] ==========================================`);
    console.log(`[API-${requestId}] NEW REQUEST`);
    console.log(`[API-${requestId}] X-Expected-Voice: ${expectedVoice}`);
    console.log(`[API-${requestId}] X-Speaker-Id: ${headerSpeaker}`);
    console.log(`[API-${requestId}] X-Segment-Id: ${headerSegment}`);

    // ── STEP 1: Parse request body ──
    let body: any;
    let rawBodyText: string;
    try {
      rawBodyText = await request.text();
      body = JSON.parse(rawBodyText);
    } catch (parseErr) {
      console.error(`[API-${requestId}] ❌ Failed to parse request body:`, parseErr);
      return NextResponse.json(
        { error: 'Invalid JSON in request body', requestId },
        { status: 400 }
      );
    }

    // ═══ NUCLEAR LOG: Parsed body inspection ═══
    console.log(`[API-${requestId}] Body keys: [${Object.keys(body).join(', ')}]`);
    console.log(`[API-${requestId}] body.voice:`, JSON.stringify(body.voice));
    console.log(`[API-${requestId}] body.voice type: ${typeof body.voice}`);
    console.log(`[API-${requestId}] body.customVoice: ${body.customVoice}`);
    console.log(`[API-${requestId}] body.speakerId: ${body.speakerId}`);
    console.log(`[API-${requestId}] body.text length: ${body.text?.length}`);

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

    // ═══ NUCLEAR LOG: Destructured values ═══
    console.log(`[API-${requestId}] Destructured voice: ${JSON.stringify(voice)}`);
    console.log(`[API-${requestId}] voice?.id: "${voice?.id}"`);
    console.log(`[API-${requestId}] voice?.name: "${voice?.name}"`);
    console.log(`[API-${requestId}] voice?.gender: "${voice?.gender}"`);
    console.log(`[API-${requestId}] customVoice: "${customVoice}"`);

    // ── STEP 2: Validate required fields ──
    if (!text || typeof text !== 'string') {
      console.error(`[API-${requestId}] ❌ Missing/invalid text. Got:`, typeof text, text?.length);
      return NextResponse.json(
        { error: 'Missing or invalid text', requestId, textType: typeof text, textLength: text?.length },
        { status: 400 }
      );
    }

    if (text.length > 4096) {
      console.error(`[API-${requestId}] ❌ Text too long: ${text.length} chars (max 4096)`);
      return NextResponse.json(
        { error: `Text too long: ${text.length} chars (max 4096)`, requestId },
        { status: 400 }
      );
    }

    // ── STEP 3: Resolve voice ID ──
    const rawVoice = customVoice || voice?.id || 'alloy';
    let voiceId = rawVoice.toLowerCase().trim();

    console.log(`[API-${requestId}] Voice resolution: customVoice="${customVoice}" || voice?.id="${voice?.id}" || 'alloy' => rawVoice="${rawVoice}" => voiceId="${voiceId}"`);

    if (!OPENAI_VOICES.includes(voiceId)) {
      console.warn(`[API-${requestId}] ⚠️ Unknown voice "${voiceId}", falling back to alloy. Valid: [${OPENAI_VOICES.join(',')}]`);
      voiceId = 'alloy';
    }

    // ═══ NUCLEAR LOG: Voice vs header comparison ═══
    if (expectedVoice && expectedVoice !== voiceId) {
      console.error(`[API-${requestId}] ⚠️ HEADER MISMATCH: X-Expected-Voice="${expectedVoice}" but resolved voiceId="${voiceId}"`);
    }

    // ── STEP 4: Check API key ──
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error(`[API-${requestId}] ❌ OPENAI_API_KEY not configured!`);
      return NextResponse.json({ useClientSideTTS: true, reason: 'no-api-key' });
    }

    const model = ttsModel === 'tts-1-hd' ? 'tts-1-hd' : 'tts-1';

    // ═══ NUCLEAR LOG: OpenAI call parameters ═══
    console.log(`[API-${requestId}] ==========================================`);
    console.log(`[API-${requestId}] CALLING OPENAI TTS`);
    console.log(`[API-${requestId}] Model: ${model}`);
    console.log(`[API-${requestId}] Voice: "${voiceId}"`);
    console.log(`[API-${requestId}] Text (first 80): "${text.substring(0, 80)}"`);
    console.log(`[API-${requestId}] Text length: ${text.length}`);
    console.log(`[API-${requestId}] ==========================================`);

    // ── STEP 5: Build the EXACT OpenAI request payload and log it ──
    const openaiPayload = {
      model,
      input: text,
      voice: voiceId,
      response_format: 'mp3',
      speed: 1.0,
    };
    console.log(`[API-${requestId}] OpenAI payload: ${JSON.stringify(openaiPayload)}`);

    // ── STEP 6: Call OpenAI TTS API (with retry for transient errors) ──
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
          body: JSON.stringify(openaiPayload),
        });

        console.log(`[API-${requestId}] OpenAI response: status=${ttsResponse.status}, attempt=${attempt}`);

        if (ttsResponse.ok) break; // Success — exit retry loop

        // Read error for logging
        const errorBody = await ttsResponse.text();
        lastError = `OpenAI ${ttsResponse.status}: ${errorBody.substring(0, 200)}`;
        console.error(`[API-${requestId}] ❌ Attempt ${attempt}/${MAX_RETRIES}: ${lastError}`);

        // Don't retry auth/quota errors
        if (ttsResponse.status === 401 || ttsResponse.status === 429) {
          console.log(`[API-${requestId}] Auth/quota error — falling back to client TTS`);
          return NextResponse.json({
            useClientSideTTS: true,
            reason: ttsResponse.status === 401 ? 'auth-error' : 'rate-limited',
            requestId,
          });
        }

        // For 5xx errors, wait before retry
        if (attempt < MAX_RETRIES && ttsResponse.status >= 500) {
          const delay = attempt * 500;
          console.log(`[API-${requestId}] Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          ttsResponse = null;
        }

      } catch (fetchErr) {
        lastError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(`[API-${requestId}] ❌ Fetch error (attempt ${attempt}/${MAX_RETRIES}):`, lastError);

        if (attempt < MAX_RETRIES) {
          const delay = attempt * 500;
          console.log(`[API-${requestId}] Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // ── STEP 7: Handle final response ──
    if (!ttsResponse || !ttsResponse.ok) {
      console.error(`[API-${requestId}] ❌ All ${MAX_RETRIES} attempts failed: ${lastError}`);
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

    // ── STEP 8: Return audio with full diagnostic headers ──
    const audioBuffer = await ttsResponse.arrayBuffer();
    console.log(`[API-${requestId}] ✅ SUCCESS: ${segmentId} | voice="${voiceId}" | speaker=${speakerId} | ${audioBuffer.byteLength}B`);
    console.log(`[API-${requestId}] ==========================================`);

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
        'X-Buffer-Size': audioBuffer.byteLength.toString(),
      },
    });

  } catch (error) {
    // ── CATASTROPHIC ERROR ──
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    console.error(`[API-${requestId}] ==========================================`);
    console.error(`[API-${requestId}] ❌❌ UNCAUGHT EXCEPTION:`);
    console.error(`[API-${requestId}]   Message: ${errMsg}`);
    if (errStack) console.error(`[API-${requestId}]   Stack: ${errStack}`);
    console.error(`[API-${requestId}] ==========================================`);

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
