import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkPremiumAccess } from '@/lib/subscription';

// Plain, same-origin channel video search — no extension required. Given a
// channel handle/ID, fetches every video in its uploads playlist via the
// YouTube Data API (public, API-key only) so users can search a channel with
// thousands of videos instantly. Gated to paid TC plans via the same
// checkPremiumAccess() helper other premium features use.
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await checkPremiumAccess(userId);
  if (!access.allowed) {
    return NextResponse.json({ error: 'subscription_required', reason: access.reason }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channelId');
  const sort = searchParams.get('sort') || 'alpha';

  if (!channelId) {
    return NextResponse.json({ error: 'channelId is required.' }, { status: 400 });
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
      return NextResponse.json({ error: 'Channel not found or has no public videos.' }, { status: 404 });
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

    return NextResponse.json({ videos, total: videos.length });
  } catch (err: any) {
    console.error('[channel-videos]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
