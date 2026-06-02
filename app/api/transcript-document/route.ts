import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
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
        const segments: { text: string; start: number }[] = transcriptData.transcript ?? [];

        if (segments.length === 0) {
            return NextResponse.json({ error: 'No transcript available for this video.' }, { status: 422 });
        }

        // Format segments with timestamps for GPT so it can preserve them at natural breaks
        const rawLines = segments.map(seg => {
            const m = Math.floor(seg.start / 60);
            const s = Math.floor(seg.start % 60);
            const ts = `[${m}:${String(s).padStart(2, '0')}]`;
            return `${ts} ${seg.text.trim()}`;
        }).join('\n');

        // Cap at ~12,000 words
        const words = rawLines.split(/\s+/);
        const capped = words.slice(0, 14000).join(' ');

        const videoLabel = title || 'Unknown Title';

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
                            'You are a professional transcriptionist. You receive a raw auto-generated YouTube transcript ' +
                            '(with timestamps) and reformat it into a clean, readable document. ' +
                            'Rules:\n' +
                            '- Fix punctuation, capitalization, and obvious auto-caption errors.\n' +
                            '- Group sentences into natural paragraphs (every 4–8 sentences or at clear topic shifts).\n' +
                            '- Place a timestamp at the start of each new paragraph, e.g. [2:14].\n' +
                            '- Do NOT add commentary, summaries, or headings — just the cleaned transcript.\n' +
                            '- Preserve every word spoken; do not omit or paraphrase content.',
                    },
                    {
                        role: 'user',
                        content:
                            `Please clean and format the transcript for the video titled "${videoLabel}".\n\n` +
                            `RAW TRANSCRIPT:\n${capped}`,
                    },
                ],
                max_tokens: 4000,
                temperature: 0.2,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error('[transcript-document] OpenAI error:', err);
            return NextResponse.json({ error: 'Transcript generation failed. Please try again.' }, { status: 500 });
        }

        const data = await response.json();
        const transcript = data.choices?.[0]?.message?.content?.trim() ?? '';
        return NextResponse.json({ transcript, title: videoLabel });
    } catch (err: any) {
        console.error('[transcript-document]', err);
        return NextResponse.json({ error: 'Transcript generation failed. Please try again.' }, { status: 500 });
    }
}
