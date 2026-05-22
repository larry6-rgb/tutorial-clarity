
// Simple test for YouTube utilities
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function isValidYouTubeUrl(url) {
  return extractVideoId(url) !== null;
}

// Test YouTube URL validation
const testUrls = [
  'https://www.youtube.com/watch?v=j-hV-Zy6wmU&t=42s',
  'https://youtu.be/j-hV-Zy6wmU',
  'https://www.youtube.com/embed/j-hV-Zy6wmU',
  'https://invalid-url.com',
  ''
];

console.log('🔍 Testing YouTube URL validation:');
testUrls.forEach(url => {
  const isValid = isValidYouTubeUrl(url);
  const videoId = extractVideoId(url);
  console.log(`✅ URL: ${url || '(empty)'}`);
  console.log(`   Valid: ${isValid}, Video ID: ${videoId}`);
  console.log('');
});
