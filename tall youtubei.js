import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoId = searchParams.get('videoId');

  if (!videoId) {
    return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
  }

  try {
    const { Innertube } = await import('youtubei.js');
    
    console.log('Fetching transcript for:', videoId);
    
    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    
    const transcriptData = await info.getTranscript();
    
    if (!transcriptData || !transcriptData.transcript) {
      console.log('No transcript available');
      return NextResponse.json({ 
        error: 'No captions available for this video',
        transcript: []
      }, { status: 200 });
    }

    console.log('Transcript content:', transcriptData.transcript.content);
    
    const segments = transcriptData.transcript.content.body.initial_segments.map((segment: any) => ({
      start: segment.start_ms / 1000,
      duration: segment.end_ms / 1000 - segment.start_ms / 1000,
      text: segment.snippet.runs.map((run: any) => run.text).join('')
    }));

    console.log('Parsed segments:', segments.length);

    return NextResponse.json({ transcript: segments });

  } catch (error: any) {
    console.error('Transcript fetch error:', error);
    
    return NextResponse.json({ 
      error: 'Failed to fetch transcript',
      transcript: [],
      details: error.message || 'Unknown error'
    }, { status: 200 });
  }
}