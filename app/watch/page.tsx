'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';

interface SurfedVideo {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
  savedAt: number;
}

const MAX_SURFED_VIDEOS = 25;
const SURF_EXPIRY_DAYS = 7;

export default function HomePage() {
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [surfedVideos, setSurfedVideos] = useState<SurfedVideo[]>([]);

  const getSurfedVideos = useCallback((): SurfedVideo[] => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem('tc_surf_shelf');
    if (!stored) return [];
    let videos: SurfedVideo[] = [];
    try { videos = JSON.parse(stored); } catch { return []; }
    const now = Date.now();
    const cutoff = now - SURF_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    videos = videos.filter(v => v.savedAt > cutoff).sort((a,b)=>b.savedAt-a.savedAt).slice(0, MAX_SURFED_VIDEOS);
    localStorage.setItem('tc_surf_shelf', JSON.stringify(videos));
    return videos;
  }, []);

  useEffect(() => { setSurfedVideos(getSurfedVideos()); }, [getSurfedVideos]);

  return (
    <main className="relative flex h-screen w-full flex-col items-center justify-center bg-gray-900 text-white">
      <h1 className="mb-6 text-4xl font-bold text-blue-400">Tutorial Clarity</h1>
      <p className="mb-8 text-lg text-gray-300">Your enhanced YouTube experience.</p>

      <div className="space-x-4">
        <button
          onClick={() => router.push('/watch')}
          className="rounded bg-blue-600 px-6 py-3 text-lg text-white shadow-lg hover:bg-blue-700 transition-colors"
        >
          Open Watch Page
        </button>
      </div>

      {/* Menu panel (Surf Shelf) */}
      <div
        className={`fixed top-16 right-4 z-50 w-80 max-h-[80vh] overflow-y-auto rounded-lg border border-blue-600 bg-gray-800 p-4 shadow-lg transition-opacity duration-200 ${
          isMenuOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
      >
        <h2 className="mb-3 text-lg font-semibold text-blue-400">🌊 Surf Shelf ({surfedVideos.length}/{MAX_SURFED_VIDEOS})</h2>
        {surfedVideos.length === 0 ? (
          <p className="text-sm text-gray-400">No videos surfed yet. Go to Watch to save.</p>
        ) : (
          <ul className="space-y-3">
            {surfedVideos.map((v) => (
              <li key={v.id} className="flex items-center space-x-3 rounded-md bg-gray-700 p-2">
                <img src={v.thumbnail} alt={v.title} className="h-10 w-16 rounded-sm object-cover" />
                <div className="flex-grow">
                  <button
                    onClick={() => router.push(`/watch?url=${encodeURIComponent(v.url)}`)}
                    className="text-left text-sm text-blue-300 hover:text-blue-100 line-clamp-2"
                    title={v.title}
                  >
                    {v.title}
                  </button>
                  <p className="text-xs text-gray-400">Saved: {new Date(v.savedAt).toLocaleDateString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={() => setIsMenuOpen(v => !v)}
        className="fixed right-4 top-4 z-50 rounded bg-blue-600 px-4 py-2 text-white shadow-lg hover:bg-blue-700"
      >
        Menu
      </button>
    </main>
  );
}