

// Simple YouTube utilities for extracting video IDs and validating URLs

export function extractVideoId(url: string): string | null {
  if (!url) return null;

  // Clean the URL
  url = url.trim();

  // Various YouTube URL patterns (including Shorts!)
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
    /youtu\.be\/([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/  // YouTube Shorts support!
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      console.log('✅ Extracted video ID from URL:', match[1]);
      return match[1];
    }
  }

  console.log('❌ Could not extract video ID from URL:', url);
  return null;
}

export function isValidYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null;
}

export function createYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

export function createYouTubeThumbnailUrl(videoId: string, quality: 'default' | 'hqdefault' | 'maxresdefault' = 'hqdefault'): string {
  return `https://i.ytimg.com/vi/z5NObURCxO4/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLDKZ2WlRXnSCFTyb-m_u7dPJwY-Gg`;
}
