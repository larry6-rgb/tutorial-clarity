import { NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

// CORS — called cross-origin from the extension's content script running on
// youtube.com, same pattern as /api/save-video.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// Ported from SubTamer's backend (C:\Dev\SubTamer\backend\server.js /api/videos)
// wholesale, gated by a TC activation key instead of a SubTamer license key.
// Fetches every video in a channel's uploads playlist via the YouTube Data API.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channelId');
  const activationKey = searchParams.get('activationKey');
  const sort = searchParams.get('sort') || 'alpha';

  if (!channelId || !activationKey) {
    return NextResponse.json({ error: 'channelId and activationKey are required.' }, { status: 400, headers: CORS_HEADERS });
  }

  const activation = await db.tCExtensionActivation.findUnique({
    where: { activationKey },
    include: { user: { include: { subscription: true } } },
  });
  const valid = Boolean(
    activation?.active &&
    activation.user?.subscription?.status === 'active' &&
    ['monthly', 'annual', 'bundle'].includes(activation.user.subscription.plan)
  );
  if (!valid) {
    return NextResponse.json({ error: 'Invalid or inactive activation key.' }, { status: 403, headers: CORS_HEADERS });
  }

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;

    const channelUrl = channelId.startsWith('@')
      ? `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(channelId.slice(1))}&key=${apiKey}`
      : `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`;

    const channelRes = await fetch(channelUrl);
    const channelData = await channelRes.json();
    if (channelData.error) throw new Error(channelData.error.message);

    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return NextResponse.json({ error: 'Channel not found or has no public videos.' }, { status: 404, headers: CORS_HEADERS });
    }

    const videos: { id: string; title: string; date: string; thumbnail: string }[] = [];
    let pageToken = '';

    do {
      const pageUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${apiKey}${pageToken ? '&pageToken=' + pageToken : ''}`;
      const pageRes = await fetch(pageUrl);
      const pageData = await pageRes.json();
      if (pageData.error) throw new Error(pageData.error.message);

      (pageData.items || []).forEach((item: any) => {
        videos.push({
          id: item.snippet.resourceId.videoId,
          title: item.snippet.title,
          date: item.snippet.publishedAt,
          thumbnail: item.snippet.thumbnails?.default?.url ?? '',
        });
      });

      pageToken = pageData.nextPageToken || '';
    } while (pageToken);

    if (sort === 'alpha') {
      videos.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'newest') {
      videos.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else if (sort === 'oldest') {
      videos.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    return NextResponse.json({ videos, total: videos.length }, { headers: CORS_HEADERS });
  } catch (err: any) {
    console.error('[tc-extension/videos]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}
