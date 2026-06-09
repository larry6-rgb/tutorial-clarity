import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tutorial Clarity — Supercharge Your YouTube Learning',
  description: 'Tutorial Clarity adds AI-powered tools to any YouTube tutorial: multi-speaker audio, zoom, spyglass, live transcripts, AI definitions, and summaries. 2-week free trial.',
  metadataBase: new URL('https://tutorialclarity.com'),
  openGraph: {
    title: 'Tutorial Clarity — Supercharge Your YouTube Learning',
    description: 'Add AI-powered learning tools to any YouTube video. Clarify audio, zoom in, get transcripts, definitions, and summaries.',
    url: 'https://tutorialclarity.com',
    siteName: 'Tutorial Clarity',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tutorial Clarity — Supercharge Your YouTube Learning',
    description: 'Add AI-powered learning tools to any YouTube video.',
  },
  alternates: {
    canonical: 'https://tutorialclarity.com',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Tutorial Clarity',
  applicationCategory: 'EducationApplication',
  operatingSystem: 'Web',
  url: 'https://tutorialclarity.com',
  description: 'Tutorial Clarity adds AI-powered tools to any YouTube tutorial video: multi-speaker audio re-narration, zoom, spyglass magnifier, live transcripts, AI definitions, and on-demand summaries.',
  offers: {
    '@type': 'Offer',
    price: '12.99',
    priceCurrency: 'USD',
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: '12.99',
      priceCurrency: 'USD',
      billingDuration: 'P1M',
    },
  },
  publisher: {
    '@type': 'Organization',
    name: 'Eppler Publishing LLC',
    url: 'https://tutorialclarity.com',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}