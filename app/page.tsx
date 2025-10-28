'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [url, setUrl] = useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Extract video ID from YouTube URL
    let videoId = '';
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.includes('youtube.com')) {
        videoId = urlObj.searchParams.get('v') || '';
      } else if (urlObj.hostname.includes('youtu.be')) {
        videoId = urlObj.pathname.slice(1);
      }
    } catch {
      // If URL parsing fails, assume it's just a video ID
      videoId = url;
    }

    if (videoId) {
      router.push(`/watch?url=${videoId}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 relative overflow-hidden">
      {/* White checkered pattern overlay */}
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(45deg, white 25%, transparent 25%),
            linear-gradient(-45deg, white 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, white 75%),
            linear-gradient(-45deg, transparent 75%, white 75%)
          `,
          backgroundSize: '40px 40px',
          backgroundPosition: '0 0, 0 20px, 20px -20px, -20px 0px'
        }}
      />
      
      {/* Content */}
      <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
        <div className="bg-black rounded-lg shadow-2xl p-8 w-full max-w-md">
          <h1 
            className="text-4xl font-bold text-center mb-8 bg-gradient-to-r from-purple-300 to-blue-400 bg-clip-text text-transparent"
          >
            Tutorial Clarity
          </h1>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube URL"
              className="w-full px-4 py-3 bg-gray-900 text-white border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            
            <button
              type="submit"
              className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white font-semibold rounded-lg hover:from-purple-600 hover:to-blue-600 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              Watch Enhanced
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}