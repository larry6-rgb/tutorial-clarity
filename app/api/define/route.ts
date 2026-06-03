export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

// Lazy-initialize Groq client to avoid build-time errors when GROQ_API_KEY is not set
let groq: Groq | null = null;
function getGroqClient(): Groq {
    if (!groq) {
        groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
    }
    return groq;
}

// Dictionary API
async function getDictionaryDefinition(term: string): Promise<string | null> {
    try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`);
        if (!response.ok) return null;
        
        const data = await response.json();
        if (data && data[0] && data[0].meanings && data[0].meanings[0]) {
            const meaning = data[0].meanings[0];
            const definition = meaning.definitions[0].definition;
            return `📖 **Dictionary**: ${definition}`;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Wikipedia API
async function getWikipediaDefinition(term: string): Promise<string | null> {
    try {
        const response = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`
        );
        if (!response.ok) return null;
        
        const data = await response.json();
        if (data && data.extract) {
            return `📚 **Wikipedia**: ${data.extract.slice(0, 300)}...`;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// AI Definition using Groq
async function getAIDefinition(
    term: string,
    context: string,
    videoTitle: string
): Promise<string> {
    try {
        const prompt = `You are a helpful tutor explaining technical terms from a YouTube tutorial.

Video Title: "${videoTitle}"
Context: "${context}"
Term to define: "${term}"

Provide a clear, concise definition of "${term}" in the context of this tutorial. Focus on:
1. What it means in simple terms
2. Why it's relevant to the tutorial topic
3. A brief example if helpful

Keep the response under 150 words.`;

        const completion = await getGroqClient().chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
            max_tokens: 300
        });

        return `🤖 **AI Explanation**: ${completion.choices[0]?.message?.content || 'Definition not available.'}`;
    } catch (error) {
        console.error('Groq API error:', error);
        throw error;
    }
}

export async function POST(request: NextRequest) {
    try {
        const { term, context, videoTitle, userTier, developmentMode } = await request.json();

        if (!term) {
            return NextResponse.json(
                { error: 'Term is required' },
                { status: 400 }
            );
        }

        // Try dictionary first (free for all users)
        const dictDef = await getDictionaryDefinition(term);
        if (dictDef) {
            return NextResponse.json({ definition: dictDef });
        }

        // Try Wikipedia (free for all users)
        const wikiDef = await getWikipediaDefinition(term);
        if (wikiDef) {
            return NextResponse.json({ definition: wikiDef });
        }

        // AI definition - check development mode OR premium tier
        if (developmentMode === true || userTier === 'premium') {
            const aiDef = await getAIDefinition(term, context, videoTitle);
            return NextResponse.json({ definition: aiDef });
        }

        // User needs to upgrade for AI definitions
        return NextResponse.json({
            requiresUpgrade: true,
            message: 'To access AI-powered definitions for technical terms, please upgrade to a premium plan.'
        });

    } catch (error) {
        console.error('Definition API error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch definition' },
            { status: 500 }
        );
    }
}