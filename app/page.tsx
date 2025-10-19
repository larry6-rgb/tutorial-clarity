'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Youtube } from 'lucide-react';

export default function Page() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();

  if (!url.trim()) return;

  const watchUrl = `/watch?url=${encodeURIComponent(url.trim())}`;
  console.log("🚀 Navigating to:", watchUrl);
  router.push(`${watchUrl}&ts=${Date.now()}`);
};
 
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit(e as any);
  };
const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  e.preventDefault();
  const pastedText = e.clipboardData.getData('text');
  console.log('📋 Pasted text:', pastedText);
  setUrl(pastedText);
};
    return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* DEVELOPMENT BANNER */}
      <div className="bg-gradient-to-r from-yellow-600 to-orange-600 text-white py-4 px-4 text-center font-bold shadow-lg border-b-4 border-yellow-500">
        <div className="flex items-center justify-center gap-2 text-lg">
          ⚠️ <span className="uppercase tracking-wider">Under Development</span> ⚠️
        </div>
        <p className="text-sm mt-1 opacity-90">
          Phase 2: YouTube player working! Enhanced controls coming next!
        </p>
      </div>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10 pointer-events-none" />
        <div className="container mx-auto px-6 py-16 max-w-6xl">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center mb-6">
              <div className="p-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full mr-4">
                <Youtube size={32} className="text-white" />
              </div>
              <h1 className="text-5xl font-bold text-white">
                Tutorial{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                  Clarity
                </span>
              </h1>
            </div>

            <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed">
              Transform how you follow YouTube tutorials with enhanced controls designed for learners.
              Perfect spacebar control, smart bookmarks, and speed adjustments that actually work.
            </p>

            {/* YouTube URL Form */}
            <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <div className="flex-1">
                  <input
                    type="text"
                    value={url}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="Paste your YouTube tutorial URL here..."
                    className="w-full px-6 py-4 bg-gray-800/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-lg"
                    autoComplete="off"
                    spellCheck="false"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !url.trim()}
                  className="px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all disabled:opacity-50 text-lg"
                >
                  {isLoading ? '⏳ Loading...' : '🎯 Watch Enhanced'}
                </button>
              </div>
            </form>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700 rounded-xl p-6 hover:border-blue-500/30 transition-colors">
              <div className="text-blue-400 mb-4">⌨️</div>
              <h3 className="text-xl font-semibold text-white mb-3">Perfect Spacebar Control</h3>
              <p className="text-gray-300">
                Spacebar pause/play that actually works - no more fighting with YouTube's interface while following tutorials.
              </p>
            </div>

            <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700 rounded-xl p-6 hover:border-purple-500/30 transition-colors">
              <div className="text-purple-400 mb-4">🔖</div>
              <h3 className="text-xl font-semibold text-white mb-3">Smart Bookmarks</h3>
              <p className="text-gray-300">
                Save important moments with notes. Never lose your place or forget crucial steps in tutorials.
              </p>
            </div>

            <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700 rounded-xl p-6 hover:border-green-500/30 transition-colors">
              <div className="text-green-400 mb-4">⚡</div>
              <h3 className="text-xl font-semibold text-white mb-3">Speed Control</h3>
              <p className="text-gray-300">
                Precise speed adjustments for complex tutorials. Slow down for difficult parts, speed up for review.
              </p>
            </div>
          </div>

          {/* Development Progress */}
          <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700 rounded-xl p-6 text-center">
            <h3 className="text-xl font-semibold text-white mb-3">🚧 Development Progress</h3>
            <div className="flex justify-center items-center space-x-8">
              <div className="text-green-400">✅ Beautiful Homepage</div>
              <div className="text-green-400">✅ YouTube Player</div>
              <div className="text-yellow-400">🔄 Enhanced Controls (Next)</div>
              <div className="text-gray-500">⏳ Smart Features</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}