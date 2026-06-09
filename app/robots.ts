import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api/', '/sync', '/watch-v2'],
      },
    ],
    sitemap: 'https://tutorialclarity.com/sitemap.xml',
    host: 'https://tutorialclarity.com',
  };
}
