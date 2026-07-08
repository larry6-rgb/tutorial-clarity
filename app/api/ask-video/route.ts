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

        const { videoId, title, question, history } = await request.json();
        if (!videoId || !question) {
            return NextResponse.json({ error: 'videoId and question are required' }, { status: 400 });
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

        const historyPairs: { question: string; answer: string }[] = Array.isArray(history) ? history.slice(-4) : [];
        const historyMessages = historyPairs.flatMap(pair => ([
            { role: 'user' as const, content: pair.question },
            { role: 'assistant' as const, content: pair.answer },
        ]));

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
                            `You are a helpful assistant answering questions about ${videoLabel}, a YouTube video, based only on its transcript below. ` +
                            'Answer using only what is actually said in the transcript. If the transcript does not cover what the viewer is asking about, ' +
                            'say clearly that the video does not appear to cover that, rather than guessing or using outside knowledge. ' +
                            'Keep answers concise and conversational.\n\n' +
                            `TRANSCRIPT:\n${capped}`,
                    },
                    ...historyMessages,
                    { role: 'user', content: question },
                ],
                max_tokens: 500,
                temperature: 0.3,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error('[ask-video] OpenAI error:', err);
            return NextResponse.json({ error: 'Could not generate an answer. Please try again.' }, { status: 500 });
        }

        const data = await response.json();
        const answer = data.choices?.[0]?.message?.content?.trim() ?? '';
        return NextResponse.json({ answer });
    } catch (err: any) {
        console.error('[ask-video]', err);
        return NextResponse.json({ error: 'Could not generate an answer. Please try again.' }, { status: 500 });
    }
}
