import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    console.log('Fetching transcript for:', videoId);

    const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
    
    if (!transcriptData || transcriptData.length === 0) {
      return NextResponse.json({ error: 'No transcript available' }, { status: 404 });
    }

    const segments = transcriptData.map((item: any) => ({
      start: item.offset / 1000,
      duration: item.duration / 1000,
      text: item.text
    }));

    return NextResponse.json({ transcript: segments });

  } catch (error) {
    console.error('Transcript error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcript' },
      { status: 500 }
    );
  }
}