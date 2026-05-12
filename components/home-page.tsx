
"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Youtube, Bookmark, Zap, MousePointer } from 'lucide-react';
import { isValidYouTubeUrl } from '@/lib/youtube-utils';

const features = [
  {
    icon: Play,
    title: 'Perfect Spacebar Control',
    description: 'Reliable pause/play without YouTube interference. Works every time.',
    color: 'text-blue-400'
  },
  {
    icon: Zap,
    title: 'Speed Controls',
    description: 'Adjustable playback speed from 0.25x to 2x for your learning pace.',
    color: 'text-yellow-400'
  },
  {
    icon: Bookmark,
    title: 'Smart Bookmarks',
    description: 'Save important moments with notes and jump back instantly.',
    color: 'text-green-400'
  },
  {
    icon: MousePointer,
    title: 'Enhanced Controls',
    description: 'Draggable interface that stays out of your way while staying accessible.',
    color: 'text-purple-400'
  }
];

export default function HomePage() {
  const [videoUrl, setVideoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();



  const handleDirectNavigation = () => {
    setError('');
    
    console.log('🚀🚀🚀 DIRECT BUTTON CLICK!', { videoUrl, isLoading });
    
    if (!videoUrl.trim()) {
      console.log('🚨 NO URL PROVIDED!');
      setError('Please enter a YouTube URL');
      return;
    }

    const isValid = isValidYouTubeUrl(videoUrl);
    console.log('🚀 URL VALIDATION:', { videoUrl, isValid });
    
    if (!isValid) {
      console.log('🚨 INVALID URL!');
      setError('Please enter a valid YouTube video link');
      return;
    }

    setIsLoading(true);
    console.log('🚀🚀🚀 DIRECT NAVIGATION STARTING...');
    
    try {
      // Navigate to watch page
      const watchUrl = `/watch?url=${encodeURIComponent(videoUrl)}`;
      console.log('🚀🚀🚀 NAVIGATING TO:', watchUrl);
      
      // Force navigation with window.location
      window.location.href = watchUrl;
      
    } catch (error) {
      console.error('🚨 Navigation error:', error);
      setError('Error loading video. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* UNDER DEVELOPMENT BANNER */}
      <div className="bg-gradient-to-r from-yellow-600 to-orange-600 text-white py-4 px-4 text-center font-bold shadow-lg border-b-4 border-yellow-500">
        <div className="flex items-center justify-center gap-2 text-lg">
          ⚠️ <span className="uppercase tracking-wider">Under Development</span> ⚠️
        </div>
        <p className="text-sm mt-1 opacity-90">
          This app is currently being tested and developed. Features may not work as expected.
        </p>
      </div>
      
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10" />
        <div className="container mx-auto px-6 py-16 max-w-6xl">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center mb-6">
              <div className="p-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full mr-4">
                <Youtube size={32} className="text-white" />
              </div>
              <h1 className="text-5xl font-bold text-white">
                Tutorial <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Clarity</span>
              </h1>
            </div>
            
            <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed">
              Transform how you follow YouTube tutorials with enhanced controls designed for learners. 
              Perfect spacebar control, smart bookmarks, and speed adjustments that actually work.
            </p>

            {/* SIMPLE TEST BUTTONS FIRST */}
            <div className="max-w-2xl mx-auto mb-8">
              <div className="flex gap-4 justify-center mb-4">
                <button 
                  onClick={() => alert('TEST 1 WORKS!')}
                  className="px-4 py-2 bg-red-600 text-white rounded"
                >
                  TEST 1
                </button>
                <button 
                  onClick={() => console.log('TEST 2 CONSOLE LOG!')}
                  className="px-4 py-2 bg-green-600 text-white rounded"
                >
                  TEST 2
                </button>
                <button 
                  onClick={() => window.location.href = '/watch?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ'}
                  className="px-4 py-2 bg-blue-600 text-white rounded"
                >
                  DIRECT NAVIGATE
                </button>
              </div>
            </div>

            {/* URL Input - AUTO NAVIGATION */}
            <div className="max-w-2xl mx-auto">
              <div className="flex gap-4 mb-4">
                <div className="flex-1 relative">
                  <Youtube size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="url"
                    placeholder="Paste YouTube tutorial URL here - AUTO NAVIGATES when valid!"
                    value={videoUrl}
                    onChange={(e) => {
                      const newUrl = e.target.value;
                      console.log('🔥 INPUT CHANGED:', newUrl);
                      setVideoUrl(newUrl);
                      setError('');
                      
                      // AUTO NAVIGATE when valid URL detected
                      if (newUrl && isValidYouTubeUrl(newUrl)) {
                        console.log('🚀 VALID URL DETECTED - AUTO NAVIGATING!');
                        setTimeout(() => {
                          window.location.href = `/watch?url=${encodeURIComponent(newUrl)}`;
                        }, 1000); // 1 second delay so you can see it working
                      }
                    }}
                    className="w-full pl-11 h-14 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-gray-400 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isLoading}
                  />
                </div>
              </div>
              
              {error && (
                <p className="text-red-400 text-sm mb-3">{error}</p>
              )}
              
              <p className="text-sm text-gray-400">
                Works with any YouTube tutorial - just paste the link and start learning with enhanced controls
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="container mx-auto px-6 py-16 max-w-6xl">
        <div>
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Why Tutorial Clarity?
          </h2>
          <p className="text-gray-300 text-center mb-12 max-w-2xl mx-auto">
            Designed specifically for people learning from YouTube tutorials. No more frustrating controls or lost progress.
          </p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => {
              const IconComponent = feature.icon;
              return (
                <div
                  key={index}
                  className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-6 hover:bg-white/10 transition-all duration-300 group"
                >
                  <IconComponent size={32} className={`${feature.color} mb-4 group-hover:scale-110 transition-transform`} />
                  <h3 className="text-white font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/10 bg-white/5">
        <div className="container mx-auto px-6 py-8 max-w-6xl">
          <div className="text-center text-gray-400">
            <p className="mb-2">Tutorial Clarity - Making YouTube tutorials accessible for everyone</p>
            <p className="text-sm">Perfect for learners who need enhanced control over their tutorial experience</p>
          </div>
        </div>
      </div>
    </div>
  );
}
