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
    if (!apiKey) {
      console.error('[channel-videos] YOUTUBE_API_KEY is not configured');
      return NextResponse.json({ error: 'Channel search is temporarily unavailable.' }, { status: 503 });
    }

    const channelUrl = channelId.startsWith('@')
      ? `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(channelId.slice(1))}&key=${apiKey}`
      : `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`;

    const channelRes = await fetch(channelUrl, { cache: 'no-store' });
    const channelData = await channelRes.json();
    if (!channelRes.ok || channelData.error) throw new Error(channelData.error?.message || 'YouTube channel lookup failed.');

    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return NextResponse.json({ error: 'Channel not found or has no public videos.' }, { status: 404 });
    }

    const videos: { id: string; title: string; date: string; thumbnail: string }[] = [];
    let pageToken = '';
    let fetchedPages = 0;
    let warning: string | null = null;
    const seenPageTokens = new Set<string>();

    do {
      if (pageToken && seenPageTokens.has(pageToken)) {
        warning = 'YouTube returned a repeated page. The results shown may be incomplete.';
        break;
      }
      if (pageToken) seenPageTokens.add(pageToken);

      const pageUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${apiKey}${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
      const pageRes = await fetch(pageUrl, { cache: 'no-store' });
      const pageData = await pageRes.json();
      if (!pageRes.ok || pageData.error) {
        const message = pageData.error?.message || 'YouTube video lookup failed.';
        if (videos.length === 0) throw new Error(message);
        console.warn(`[channel-videos] Partial result after ${fetchedPages} pages: ${message}`);
        warning = `YouTube stopped the channel scan after ${videos.length} videos. You can search these results, but some videos may be missing.`;
        break;
      }

      fetchedPages += 1;

      (pageData.items || []).forEach((item: any) => {
        if (!item.snippet?.resourceId?.videoId || !item.snippet?.title) return;
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

    return NextResponse.json({
      videos,
      total: videos.length,
      complete: warning === null,
      warning,
      fetchedPages,
    });
  } catch (err: any) {
    console.error('[channel-videos]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
