export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { auth } from '@clerk/nextjs/server';
import { checkPremiumAccess } from '@/lib/subscription';

// Lazy-initialize Groq client to avoid build-time errors when GROQ_API_KEY is not set
let groq: Groq | null = null;
function getGroqClient(): Groq {
    if (!groq) {
        groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
    }
    return groq;
}

// Ask the AI to define the term. It's told to use the video's own explanation
// when the transcript context covers the term, and to fall back to its own
// general knowledge when the video doesn't explain it — one call handles both
// cases instead of chaining separate dictionary/Wikipedia lookups first.
async function getDefinition(
    term: string,
    context: string,
    videoTitle: string
): Promise<string> {
    const prompt = `You are a helpful tutor explaining a word or phrase a viewer highlighted in a YouTube tutorial.

Video Title: "${videoTitle}"
Transcript excerpt around where the viewer paused: "${context}"
Term to define: "${term}"

Look for a definition within the video's transcript above. If the transcript explains this term, base your answer on that explanation.
If the transcript does NOT explain it, ignore the transcript and give a clear, accurate general definition from your own knowledge instead.

Keep the response under 150 words. Do not mention whether the video did or didn't cover it — just give the definition directly.`;

    const completion = await getGroqClient().chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        max_tokens: 300
    });

    return completion.choices[0]?.message?.content?.trim() || 'Definition not available.';
}

export async function POST(request: NextRequest) {
    try {
        const { term, context, videoTitle } = await request.json();

        if (!term) {
            return NextResponse.json(
                { error: 'Term is required' },
                { status: 400 }
            );
        }

        // Entitlement is established on the server. Never trust a browser-supplied
        // tier or development flag for a metered AI feature.
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({
                requiresUpgrade: true,
                message: 'Sign in and start a free trial to use AI-powered definitions.'
            }, { status: 401 });
        }

        const access = await checkPremiumAccess(userId);
        if (!access.allowed) {
            return NextResponse.json({
                requiresUpgrade: true,
                message: 'To access AI-powered definitions for technical terms, please upgrade to a premium plan.'
            }, { status: 403 });
        }

        const definition = await getDefinition(term, context, videoTitle);
        return NextResponse.json({ definition });

    } catch (error) {
        console.error('Definition API error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch definition. Please try again.' },
            { status: 500 }
        );
    }
}
