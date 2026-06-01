import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const DATA_FILE = path.join(process.cwd(), 'data', 'saved-videos.json');

// CORS headers — allow YouTube and any origin to reach this endpoint
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function readVideos(): SavedVideo[] {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeVideos(videos: SavedVideo[]): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(videos, null, 2), 'utf-8');
}

interface SavedVideo {
  id: string;
  url: string;
  title: string;
  dateSaved: string;
  isPersistent: boolean;
}

// Handle preflight CORS request from browser
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// GET — return all saved videos
export async function GET() {
  const videos = readVideos();
  return NextResponse.json(videos, { headers: CORS_HEADERS });
}

// POST — save a new video
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { videoId, title } = body;

    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json(
        { error: 'Missing videoId' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const videos = readVideos();

    // Already saved?
    if (videos.some(v => v.id === videoId)) {
      return NextResponse.json(
        { success: true, message: 'Already saved' },
        { headers: CORS_HEADERS }
      );
    }

    const newVideo: SavedVideo = {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: title || 'Untitled Video',
      dateSaved: new Date().toISOString(),
      isPersistent: false,
    };

    // Remove oldest non-persistent if over 50
    const nonPersistent = videos.filter(v => !v.isPersistent);
    if (nonPersistent.length >= 50) {
      const oldest = nonPersistent.sort(
        (a, b) => new Date(a.dateSaved).getTime() - new Date(b.dateSaved).getTime()
      )[0];
      const idx = videos.findIndex(v => v.id === oldest.id);
      if (idx !== -1) videos.splice(idx, 1);
    }

    videos.push(newVideo);
    writeVideos(videos);

    console.log(`[save-video] Saved: ${videoId} — "${newVideo.title}"`);
    return NextResponse.json(
      { success: true, message: 'Saved!' },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('[save-video] Error:', err);
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// PUT — replace entire list (called by watch page on any change: delete, pin, etc.)
export async function PUT(req: NextRequest) {
  try {
    const videos: SavedVideo[] = await req.json();
    writeVideos(videos);
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// DELETE — remove a video by ID
export async function DELETE(req: NextRequest) {
  try {
    const { videoId } = await req.json();
    const videos = readVideos();
    const updated = videos.filter(v => v.id !== videoId);
    writeVideos(updated);
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
