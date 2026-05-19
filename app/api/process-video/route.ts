import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * /api/process-video — Video Processing & Transcription Route
 * 
 * Handles two request types:
 * 
 * POST — Start video processing
 *   Body: { videoId: string, option: number, targetLanguage: string }
 *   Response: { transcript: TranscriptSegment[], isStreaming: boolean }
 * 
 * GET — Poll for new segments (streaming mode)
 *   Params: ?videoId=xxx&afterCount=N
 *   Response: { newSegments: TranscriptSegment[], isStreaming: boolean }
 * 
 * The route fetches the YouTube transcript via the /api/transcript endpoint
 * and returns it in the format expected by useClarifyAudio.ts.
 */

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  words?: Array<{ word: string; start: number; end: number }>;
}

// In-memory store for active processing jobs
// In production, this would use Redis or a database
const activeJobs = new Map<string, {
  transcript: TranscriptSegment[];
  isStreaming: boolean;
  startedAt: number;
  targetLanguage: string;
}>();

// Clean up old jobs periodically (jobs older than 30 minutes)
function cleanupOldJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  activeJobs.forEach((job, key) => {
    if (job.startedAt < cutoff) {
      activeJobs.delete(key);
    }
  });
}

/**
 * Fetch transcript from our own /api/transcript endpoint.
 */
async function fetchTranscript(
  videoId: string,
  targetLanguage: string,
  request: NextRequest
): Promise<TranscriptSegment[]> {
  // Build the URL for our transcript API
  const origin = request.nextUrl.origin;
  const transcriptUrl = `${origin}/api/transcript?v=${videoId}&lang=${targetLanguage}`;

  console.log(`[process-video] Fetching transcript from: ${transcriptUrl}`);

  const response = await fetch(transcriptUrl, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error || `Transcript fetch failed with status ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.transcript || !Array.isArray(data.transcript)) {
    throw new Error('Invalid transcript response format');
  }

  // Convert transcript segments to the format expected by useClarifyAudio
  const segments: TranscriptSegment[] = data.transcript.map((seg: any, index: number) => {
    const start = typeof seg.start === 'number' ? seg.start : parseFloat(seg.start) || 0;
    const duration = typeof seg.duration === 'number' ? seg.duration : parseFloat(seg.duration) || 3;
    const end = start + duration;

    return {
      text: seg.text || '',
      start,
      end,
    };
  });

  return segments;
}

/**
 * POST — Start video processing
 * 
 * Fetches the transcript and returns it. For simple transcription (option 2),
 * the transcript is returned immediately. For streaming-capable options,
 * segments are stored for polling.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoId, option, targetLanguage = 'en' } = body;

    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid videoId' }, { status: 400 });
    }

    console.log(`[process-video] POST — videoId=${videoId}, option=${option}, lang=${targetLanguage}`);

    // Clean up old jobs
    cleanupOldJobs();

    // Fetch the transcript
    const transcript = await fetchTranscript(videoId, targetLanguage, request);

    if (transcript.length === 0) {
      return NextResponse.json(
        { error: 'No transcript segments found for this video' },
        { status: 404 }
      );
    }

    console.log(`[process-video] ✓ Got ${transcript.length} segments for ${videoId}`);

    // Store the job for potential polling
    const jobKey = `${videoId}_${targetLanguage}`;
    activeJobs.set(jobKey, {
      transcript,
      isStreaming: false, // Transcript is complete
      startedAt: Date.now(),
      targetLanguage,
    });

    return NextResponse.json({
      transcript,
      isStreaming: false,
      totalSegments: transcript.length,
      videoId,
    });

  } catch (error) {
    console.error('[process-video] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
}

/**
 * GET — Poll for new segments
 * 
 * Used in streaming mode to check if more segments are available.
 * Returns segments after the given count.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const videoId = searchParams.get('videoId');
    const afterCount = parseInt(searchParams.get('afterCount') || '0', 10);

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId parameter' }, { status: 400 });
    }

    // Try to find the job (check all language variants)
    let matchedJob: { transcript: TranscriptSegment[]; isStreaming: boolean; startedAt: number; targetLanguage: string } | null = null;
    activeJobs.forEach((value, key) => {
      if (!matchedJob && key.startsWith(`${videoId}_`)) {
        matchedJob = value;
      }
    });

    if (!matchedJob) {
      // No active job — processing is complete
      return NextResponse.json({
        newSegments: [],
        isStreaming: false,
      });
    }

    // TypeScript workaround: assign to a const after null check
    const job = matchedJob as { transcript: TranscriptSegment[]; isStreaming: boolean; startedAt: number; targetLanguage: string };

    // Return segments after the given count
    const newSegments = job.transcript.slice(afterCount);

    return NextResponse.json({
      newSegments,
      isStreaming: job.isStreaming,
      totalSegments: job.transcript.length,
    });

  } catch (error) {
    console.error('[process-video] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Poll failed' },
      { status: 500 }
    );
  }
}
