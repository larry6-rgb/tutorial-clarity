import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// CORS headers — allow YouTube and any origin to reach this endpoint
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface SavedVideoOut {
  id: string;
  url: string;
  title: string;
  dateSaved: string;
  isPersistent: boolean;
}

function toOut(v: { id: string; url: string; title: string; dateSaved: Date; isPersistent: boolean }): SavedVideoOut {
  return { id: v.id, url: v.url, title: v.title, dateSaved: v.dateSaved.toISOString(), isPersistent: v.isPersistent };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// GET — return all saved videos
export async function GET() {
  try {
    const videos = await db.savedVideo.findMany({ orderBy: { dateSaved: 'asc' } });
    return NextResponse.json(videos.map(toOut), { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[save-video] GET error:', err);
    return NextResponse.json([], { headers: CORS_HEADERS });
  }
}

// POST — save a new video
export async function POST(req: NextRequest) {
  try {
    const { videoId, title } = await req.json();

    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400, headers: CORS_HEADERS });
    }

    const existing = await db.savedVideo.findUnique({ where: { id: videoId } });
    if (existing) {
      return NextResponse.json({ success: true, message: 'Already saved' }, { headers: CORS_HEADERS });
    }

    // Keep list to 50 non-persistent videos — remove oldest if at limit
    const nonPersistent = await db.savedVideo.findMany({
      where: { isPersistent: false },
      orderBy: { dateSaved: 'asc' },
    });
    if (nonPersistent.length >= 50) {
      await db.savedVideo.delete({ where: { id: nonPersistent[0].id } });
    }

    const video = await db.savedVideo.create({
      data: {
        id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: title || 'Untitled Video',
        isPersistent: false,
      },
    });

    console.log(`[save-video] Saved: ${videoId} — "${video.title}"`);
    return NextResponse.json({ success: true, message: 'Saved!' }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[save-video] POST error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

// PUT — replace entire list (called by watch page on pin/delete/etc.)
export async function PUT(req: NextRequest) {
  try {
    const videos: SavedVideoOut[] = await req.json();

    await db.$transaction(async (tx) => {
      await tx.savedVideo.deleteMany();
      if (videos.length > 0) {
        await tx.savedVideo.createMany({
          data: videos.map(v => ({
            id: v.id,
            url: v.url,
            title: v.title,
            dateSaved: new Date(v.dateSaved),
            isPersistent: v.isPersistent ?? false,
          })),
          skipDuplicates: true,
        });
      }
    });

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[save-video] PUT error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

// DELETE — remove a video by ID
export async function DELETE(req: NextRequest) {
  try {
    const { videoId } = await req.json();
    await db.savedVideo.deleteMany({ where: { id: videoId } });
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[save-video] DELETE error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}
