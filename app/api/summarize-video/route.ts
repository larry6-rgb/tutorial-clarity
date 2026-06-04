import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { checkPremiumAccess } from '@/lib/subscription';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const access = await checkPremiumAccess(userId);
        if (!access.allowed) {
          return NextResponse.json({ error: 'subscription_required', reason: access.reason }, { status: 403 });
        }

        const { videoId, title } = await request.json();
        if (!videoId) {
            return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'OpenAI API key not configured.' }, { status: 500 });
        }

        // Fetch the transcript from our own endpoint
        const origin = request.nextUrl.origin;
        const transcriptRes = await fetch(`${origin}/api/transcript?videoId=${videoId}`, {
            headers: { Accept: 'application/json' },
        });

        if (!transcriptRes.ok) {
            return NextResponse.json({ error: 'Could not retrieve transcript for this video.' }, { status: 422 });
        }

        const transcriptData = await transcriptRes.json();
        const segments: { text: string }[] = transcriptData.transcript ?? [];

        if (segments.length === 0) {
            return NextResponse.json({ error: 'No transcript available for this video.' }, { status: 422 });
        }

        // Build plain-text transcript, capped at ~12,000 words
        const words = segments.map(s => s.text.trim()).join(' ');
        const capped = words.split(/\s+/).slice(0, 12000).join(' ');

        const videoLabel = title ? `"${title}"` : 'this video';

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are a helpful assistant that reads YouTube video transcripts and writes honest, plain-English summaries. ' +
                            'Your job is to tell the viewer exactly what the video actually covers — not what the title claims — so they can decide whether it is worth their time. ' +
                            'Be specific and concrete. Mention the main topics, key points, and any conclusions or recommendations made. ' +
                            'If the video is vague, repetitive, or fails to deliver on its title, say so clearly and kindly.',
                    },
                    {
                        role: 'user',
                        content:
                            `Please write a thorough summary of ${videoLabel}. ` +
                            `Aim for roughly 8–12 sentences — enough that the reader gets a solid sense of what the video covers, ` +
                            `what they will learn, and whether it matches what the title promises.\n\n` +
                            `TRANSCRIPT:\n${capped}`,
                    },
                ],
                max_tokens: 600,
                temperature: 0.4,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error('[summarize-video] OpenAI error:', err);
            return NextResponse.json({ error: 'Summary generation failed. Please try again.' }, { status: 500 });
        }

        const data = await response.json();
        const summary = data.choices?.[0]?.message?.content?.trim() ?? '';
        return NextResponse.json({ summary });
    } catch (err: any) {
        console.error('[summarize-video]', err);
        return NextResponse.json({ error: 'Summary generation failed. Please try again.' }, { status: 500 });
    }
}
