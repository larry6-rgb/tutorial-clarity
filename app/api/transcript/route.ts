import { NextRequest, NextResponse } from 'next/server';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

type RawSegment = {
  start_ms?: number | string;
  end_ms?: number | string;
  startMs?: number | string;
  endMs?: number | string;
  duration_ms?: number | string;
  durationMs?: number | string;
  snippet?: {
    text?: string;
    runs?: Array<{ text?: string }>;
  };
  text?: string;
};

function readNumber(...values: Array<number | string | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function readSegmentText(segment: RawSegment): string {
  const runText = Array.isArray(segment?.snippet?.runs)
    ? segment.snippet.runs.map((run) => run?.text ?? '').join('')
    : '';
  return (runText || segment?.snippet?.text || segment?.text || '').trim();
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoId = (searchParams.get('videoId') ?? '').trim();

  if (!videoId) {
    return NextResponse.json(
      { error: 'Video ID is required', transcript: [] },
      { status: 400 }
    );
  }

  try {
    const { Innertube } = await import('youtubei.js');

    console.log(`[transcript-api] Fetching default transcript for: ${videoId}`);

    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    const transcriptData: any = await info.getTranscript();

    if (!transcriptData?.transcript?.content?.body?.initial_segments) {
      console.log('[transcript-api] No transcript available');
      return NextResponse.json(
        {
          error: 'No transcript available for this video',
          transcript: [],
          source: 'youtubei.js',
          videoId,
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        }
      );
    }

    const rawSegments: RawSegment[] =
      transcriptData.transcript.content.body.initial_segments;

    const transcript = rawSegments
      .map((segment) => {
        const startMs = readNumber(segment.start_ms, segment.startMs);
        const endMsCandidate = readNumber(segment.end_ms, segment.endMs);
        const durationMsCandidate = readNumber(
          segment.duration_ms,
          segment.durationMs
        );

        const start = startMs / 1000;
        const durationMs =
          durationMsCandidate > 0
            ? durationMsCandidate
            : Math.max(endMsCandidate - startMs, 0);
        const duration = durationMs > 0 ? durationMs / 1000 : 1;

        return { text: readSegmentText(segment), start, duration };
      })
      .filter((segment) => segment.text.length > 0);

    const language = transcriptData?.selectedLanguage ?? 'default';

    console.log(
      `[transcript-api] Returning ${transcript.length} segments (lang: ${language})`
    );

    return NextResponse.json(
      {
        transcript,
        source: 'youtubei.js',
        videoId,
        language,
        count: transcript.length,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (error: any) {
    console.error('[transcript-api] Transcript fetch error:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch transcript',
        transcript: [],
        source: 'youtubei.js',
        videoId,
        details: error?.message || 'Unknown error',
      },
      { status: 200 }
    );
  }
}
