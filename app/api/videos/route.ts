import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const MAX_PAGES = 60; // ~3000 videos cap to bound request time

interface YoutubeVideo {
  id: string;
  title: string;
  date: string;
  thumbnail: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channelId');
  const key = searchParams.get('key');
  const sort = searchParams.get('sort') || 'alpha';

  if (!channelId) {
    return NextResponse.json({ error: 'Missing channelId' }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ error: 'Missing license key' }, { status: 401 });
  }

  const license = await db.subTamerLicense.findUnique({ where: { licenseKey: key } });
  if (license?.status !== 'active') {
    return NextResponse.json({ error: 'License not active' }, { status: 403 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Server misconfigured: missing YouTube API key' }, { status: 500 });
  }

  try {
    const uploadsPlaylistId = await getUploadsPlaylistId(channelId, apiKey);
    if (!uploadsPlaylistId) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    const videos = await getAllVideos(uploadsPlaylistId, apiKey);

    if (sort === 'date') {
      videos.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else {
      videos.sort((a, b) => a.title.localeCompare(b.title));
    }

    return NextResponse.json({ total: videos.length, videos });
  } catch (error) {
    console.error('[api/videos]', error);
    return NextResponse.json({ error: 'Failed to fetch videos' }, { status: 502 });
  }
}

async function getUploadsPlaylistId(channelId: string, apiKey: string): Promise<string | null> {
  const param = channelId.startsWith('@')
    ? `forHandle=${encodeURIComponent(channelId)}`
    : `id=${encodeURIComponent(channelId)}`;

  const res = await fetch(`${YOUTUBE_API}/channels?part=contentDetails&${param}&key=${apiKey}`);
  if (!res.ok) throw new Error(`channels.list failed: ${res.status}`);
  const data = await res.json();
  return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
}

async function getAllVideos(playlistId: string, apiKey: string): Promise<YoutubeVideo[]> {
  const videos: YoutubeVideo[] = [];
  let pageToken = '';

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${YOUTUBE_API}/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${apiKey}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`playlistItems.list failed: ${res.status}`);
    const data = await res.json();

    for (const item of data.items ?? []) {
      const snippet = item.snippet;
      if (!snippet || snippet.title === 'Deleted video' || snippet.title === 'Private video') continue;
      videos.push({
        id: snippet.resourceId?.videoId,
        title: snippet.title,
        date: snippet.publishedAt,
        thumbnail: snippet.thumbnails?.default?.url ?? '',
      });
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return videos;
}
