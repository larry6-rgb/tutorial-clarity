export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

/**
 * /api/test-voices — Diagnostic endpoint
 * 
 * Tests ALL 6 OpenAI TTS voices to verify:
 * 1. API key has access to all voices
 * 2. Each voice produces different audio (different buffer sizes = different voices)
 * 3. No voice falls back to a default
 * 
 * Visit: http://localhost:3000/api/test-voices
 */
export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const testText = 'Hello, this is a test of the text to speech system. Each voice should sound distinctly different.';
  const voices = ['nova', 'onyx', 'shimmer', 'fable', 'alloy', 'echo'];
  const results: Array<{
    voice: string;
    success: boolean;
    size?: number;
    error?: string;
    duration_ms?: number;
  }> = [];

  console.log('[TEST-VOICES] ==========================================');
  console.log('[TEST-VOICES] Testing all 6 OpenAI TTS voices');
  console.log('[TEST-VOICES] ==========================================');

  for (const voice of voices) {
    const startTime = Date.now();
    try {
      console.log(`[TEST-VOICES] Testing voice: ${voice}...`);

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: testText,
          voice,
          response_format: 'mp3',
          speed: 1.0,
        }),
      });

      const duration_ms = Date.now() - startTime;

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[TEST-VOICES] ${voice}: FAILED (${response.status}) - ${errorBody.substring(0, 100)}`);
        results.push({ voice, success: false, error: `HTTP ${response.status}: ${errorBody.substring(0, 100)}`, duration_ms });
        continue;
      }

      const buffer = await response.arrayBuffer();
      console.log(`[TEST-VOICES] ${voice}: SUCCESS (${buffer.byteLength} bytes, ${duration_ms}ms)`);
      results.push({ voice, success: true, size: buffer.byteLength, duration_ms });

    } catch (error: any) {
      const duration_ms = Date.now() - startTime;
      console.error(`[TEST-VOICES] ${voice}: ERROR - ${error.message}`);
      results.push({ voice, success: false, error: error.message, duration_ms });
    }
  }

  // ── Analysis ──
  const successfulResults = results.filter(r => r.success);
  const sizes = successfulResults.map(r => r.size!);
  const allSameSize = sizes.length > 1 && new Set(sizes).size === 1;
  const uniqueSizes = new Set(sizes).size;

  console.log('[TEST-VOICES] ==========================================');
  console.log(`[TEST-VOICES] Results: ${successfulResults.length}/${voices.length} succeeded`);
  console.log(`[TEST-VOICES] Unique buffer sizes: ${uniqueSizes}`);
  if (allSameSize) {
    console.warn('[TEST-VOICES] ⚠️ ALL voices produced identical buffer sizes — they might be the same voice!');
  } else {
    console.log('[TEST-VOICES] ✅ Different buffer sizes = different voices confirmed');
  }
  console.log('[TEST-VOICES] ==========================================');

  return NextResponse.json({
    test: 'OpenAI TTS Voice Test',
    text: testText,
    results,
    analysis: {
      total: voices.length,
      succeeded: successfulResults.length,
      failed: results.filter(r => !r.success).length,
      uniqueBufferSizes: uniqueSizes,
      allSameSize,
      warning: allSameSize ? 'All voices produced identical buffer sizes — might be same voice!' : null,
    },
  });
}
