'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import type { SubscriptionStatus } from '@/lib/subscription';

export default function AppHome() {
  const [videoUrl, setVideoUrl] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/subscription-status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => null);
  }, []);

  const extractVideoId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const videoId = extractVideoId(videoUrl);
    if (videoId) {
      router.push(`/watch?url=${videoId}`);
    } else {
      alert('Please enter a valid YouTube URL or video ID');
    }
  };

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{
        backgroundImage: `
          linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
          linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
          linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)
        `,
        backgroundSize: '40px 40px',
        backgroundPosition: '0 0, 0 20px, 20px -20px, -20px 0px',
        backgroundColor: '#404040',
      }}
    >
      {/* User menu top-right */}
      <div className="absolute top-4 right-4">
        <UserButton />
      </div>

      <div className="w-full max-w-md px-4 space-y-4">

        {/* Trial expired notice */}
        {status?.trialExpired && (
          <div className="bg-amber-900/80 border border-amber-600 rounded-2xl p-5 text-amber-100">
            <h2 className="font-bold text-lg mb-1">Your free trial has ended</h2>
            <p className="text-sm text-amber-200 mb-3">
              Premium features (Clarify Audio, AI Summaries, Transcripts, AI Definitions) are now
              paused. All base features — Zoom, Resume, Saved Videos, and Keyboard Shortcuts —
              remain free and fully available.
            </p>
            <button
              onClick={() => router.push('/subscribe')}
              className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              Upgrade to continue premium access →
            </button>
          </div>
        )}

        {/* Session warning (3 or fewer remaining) */}
        {status?.sessionWarning && (
          <div className="bg-blue-900/80 border border-blue-600 rounded-2xl p-5 text-blue-100">
            <h2 className="font-bold text-lg mb-1">
              {status.sessionsRemaining === 1
                ? '1 Clarify Audio session remaining'
                : `${status.sessionsRemaining} Clarify Audio sessions remaining`}
            </h2>
            <p className="text-sm text-blue-200 mb-3">
              You've used {status.sessionsUsed} of your {status.sessionsLimit} sessions this month.
              Would you like to add more?
            </p>
            <button
              onClick={() => router.push('/subscribe')}
              className="bg-blue-500 hover:bg-blue-400 text-white font-bold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              Add 20 more sessions — $8.99 →
            </button>
          </div>
        )}

        {/* Main card */}
        <div className="bg-black p-12 rounded-2xl shadow-2xl">
          <h1
            className="text-4xl font-bold mb-8 text-center"
            style={{
              background: 'linear-gradient(135deg, #E6E6FA 0%, #4169E1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Tutorial Clarity
          </h1>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Enter YouTube URL or Video ID
              </label>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full px-4 py-3 bg-gray-900 text-white border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-lg"
            >
              Watch Video
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
