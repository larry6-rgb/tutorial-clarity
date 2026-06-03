'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

function SyncContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const data = searchParams.get('data');

    if (data) {
      try {
        const youtubeVideos = JSON.parse(decodeURIComponent(data));
        const localVideos = JSON.parse(localStorage.getItem('tutorialClaritySavedVideos') || '[]');

        const validYoutubeVideos = youtubeVideos.filter((v: any) => {
          return v && v.id && v.url && v.title && v.dateSaved;
        });

        const allVideos = [...localVideos];
        validYoutubeVideos.forEach((ytVideo: any) => {
          if (!allVideos.find(v => v.id === ytVideo.id)) {
            allVideos.push({
              id: ytVideo.id,
              url: ytVideo.url,
              title: ytVideo.title || 'Untitled Video',
              dateSaved: ytVideo.dateSaved,
              isPersistent: ytVideo.isPersistent || false
            });
          }
        });

        localStorage.setItem('tutorialClaritySavedVideos', JSON.stringify(allVideos));

        console.log(`✅ Synced ${validYoutubeVideos.length} valid videos`);
      } catch (error) {
        console.error('Sync error:', error);
      }
    }
  }, [searchParams]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>📥</div>
        <div>Syncing videos...</div>
      </div>
    </div>
  );
}

export default function SyncPage() {
  return (
    <Suspense fallback={
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>📥</div>
          <div>Syncing videos...</div>
        </div>
      </div>
    }>
      <SyncContent />
    </Suspense>
  );
}
