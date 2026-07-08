import { NextResponse } from 'next/server';

// Chapters aren't a distinct field in the YouTube Data API -- creators embed
// them as timestamp lines in the video description (the same convention
// YouTube's own player parses to show chapter markers). We fetch the public
// description and parse it the same way. No premium gate: basic navigation,
// same free tier as Zoom/Resume.
function parseChapters(description: string): { time: number; title: string }[] {
  const lines = description.split('\n');
  const chapters: { time: number; title: string }[] = [];
  const timestampPattern = /^\s*(?:[-•*]\s*)?(\d{1,2}:)?(\d{1,2}):(\d{2})\s+[-–—]?\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(timestampPattern);
    if (!match) continue;
    const hours = match[1] ? parseInt(match[1]) : 0;
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    const title = match[4].trim();
    if (!title) continue;
    const time = hours * 3600 + minutes * 60 + seconds;
    chapters.push({ time, title });
  }

  // Only treat this as a real chapter list if there are at least 2 entries
  // and the first one starts at (or very near) 0:00 -- otherwise it's likely
  // just a stray timestamp mentioned in the description, not real chapters.
  if (chapters.length < 2 || chapters[0].time > 5) return [];
  return chapters.sort((a, b) => a.time - b.time);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get('videoId');
  if (!videoId) {
    return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
  }

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${apiKey}`
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const description: string = data.items?.[0]?.snippet?.description ?? '';
    const chapters = parseChapters(description);

    return NextResponse.json({ chapters });
  } catch (err: any) {
    console.error('[video-chapters]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
