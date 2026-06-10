import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma as db } from '@/lib/db';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

// GET /api/libraries — list all libraries for the current user
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors });

  const libraries = await db.library.findMany({
    where: { clerkId: userId },
    include: { videos: { orderBy: { addedAt: 'desc' } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ libraries }, { headers: cors });
}

// POST /api/libraries — create a library or add a video to one
// Body: { action: 'create', name } | { action: 'add_video', libraryId, videoId, title, url, thumbnail }
// | { action: 'remove_video', libraryId, videoId } | { action: 'delete', libraryId }
// | { action: 'rename', libraryId, name }
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors });

  const body = await req.json();
  const { action } = body;

  if (action === 'create') {
    const { name } = body;
    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400, headers: cors });
    const library = await db.library.create({ data: { clerkId: userId, name: name.trim() }, include: { videos: true } });
    return NextResponse.json({ library }, { headers: cors });
  }

  if (action === 'rename') {
    const { libraryId, name } = body;
    const library = await db.library.findFirst({ where: { id: libraryId, clerkId: userId } });
    if (!library) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });
    const updated = await db.library.update({ where: { id: libraryId }, data: { name: name.trim() }, include: { videos: true } });
    return NextResponse.json({ library: updated }, { headers: cors });
  }

  if (action === 'delete') {
    const { libraryId } = body;
    const library = await db.library.findFirst({ where: { id: libraryId, clerkId: userId } });
    if (!library) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });
    await db.library.delete({ where: { id: libraryId } });
    return NextResponse.json({ ok: true }, { headers: cors });
  }

  if (action === 'add_video') {
    const { libraryId, videoId, title, url, thumbnail } = body;
    const library = await db.library.findFirst({ where: { id: libraryId, clerkId: userId } });
    if (!library) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });
    const video = await db.libraryVideo.upsert({
      where: { libraryId_videoId: { libraryId, videoId } },
      create: { libraryId, videoId, title, url, thumbnail },
      update: { title, url, thumbnail },
    });
    return NextResponse.json({ video }, { headers: cors });
  }

  if (action === 'remove_video') {
    const { libraryId, videoId } = body;
    const library = await db.library.findFirst({ where: { id: libraryId, clerkId: userId } });
    if (!library) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });
    await db.libraryVideo.deleteMany({ where: { libraryId, videoId } });
    return NextResponse.json({ ok: true }, { headers: cors });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: cors });
}
