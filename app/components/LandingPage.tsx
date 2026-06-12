'use client';

import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* Under construction banner */}
      <div className="w-full bg-amber-500 text-gray-950 text-center text-sm font-semibold py-2 px-4">
        🚧 Tutorial Clarity is currently under construction and will be opening soon. Stay tuned!
      </div>

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
        <span
          className="text-2xl font-bold"
          style={{
            background: 'linear-gradient(135deg, #E6E6FA 0%, #4169E1 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}
        >
          Tutorial Clarity
        </span>
        <div className="flex items-center gap-4">
          <Link href="/books" className="text-gray-300 hover:text-white transition-colors">
            Books
          </Link>
          <Link href="/sign-in" className="text-gray-300 hover:text-white transition-colors">
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold transition-colors"
          >
            Start Free Trial
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center px-6 pt-24 pb-20">
        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          Watch YouTube Videos
          <br />
          <span
            style={{
              background: 'linear-gradient(135deg, #818CF8 0%, #4169E1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}
          >
            Like Never Before
          </span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-4">
          Tutorial Clarity gives you AI-powered tools to understand, pause, zoom, translate,
          and fully absorb any YouTube video — at your own pace.
        </p>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-10">
          Designed specifically for people who just want YouTube to work better — no technical knowledge required.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/sign-up"
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-bold text-lg transition-colors"
          >
            Start Your Free 2-Week Trial
          </Link>
          <Link
            href="/sign-in"
            className="border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white px-8 py-4 rounded-xl font-semibold text-lg transition-colors"
          >
            Sign In
          </Link>
        </div>
        <p className="text-gray-500 mt-4 text-sm">No credit card required. Full access for 14 days.</p>
      </section>

      {/* Features */}
      <section className="px-6 py-20 bg-gray-900">
        <h2 className="text-3xl font-bold text-center mb-14">Everything you need to learn better</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {features.map((f) => (
            <div key={f.title} className="bg-gray-800 rounded-2xl p-6">
              <div className="text-4xl mb-4">{f.icon}</div>
              <h3 className="text-xl font-bold mb-2">{f.title}</h3>
              <p className="text-gray-400">{f.description}</p>
              {f.premium && (
                <span className="inline-block mt-3 text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded-full">
                  Premium
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-gray-400 mt-10 text-lg">
          ...and <span className="text-white font-semibold">8 more tools</span> included with every plan.
        </p>
      </section>

      {/* Pricing */}
      <section className="px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-4">Simple, honest pricing</h2>
        <p className="text-gray-400 text-center mb-4">Try everything free for 14 days. No credit card needed.</p>
        <p className="text-gray-400 text-center max-w-2xl mx-auto mb-4">
          We strongly encourage you to test every premium feature during your trial — so you can see firsthand just how valuable they can be for you.
        </p>
        <p className="text-gray-500 text-center max-w-2xl mx-auto mb-14">
          We only charge for features that cost us real money to provide — so every dollar you pay goes directly toward making your experience better. And with a full 14-day free trial, you'll know exactly what you're getting before you ever pay a cent.
        </p>
        <div className="flex flex-col md:flex-row gap-8 max-w-4xl mx-auto justify-center">

          {/* Monthly */}
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 flex-1">
            <h3 className="text-xl font-bold mb-2">Monthly</h3>
            <div className="text-4xl font-bold mb-1">$12.99</div>
            <div className="text-gray-400 mb-6">per month</div>
            <ul className="space-y-3 text-gray-300 mb-8">
              {planFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/sign-up"
              className="block text-center bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-xl font-semibold transition-colors"
            >
              Start Free Trial
            </Link>
          </div>

          {/* Annual — highlighted */}
          <div className="bg-blue-900 border border-blue-500 rounded-2xl p-8 flex-1 relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-sm font-bold px-4 py-1 rounded-full">
              Best Value
            </div>
            <h3 className="text-xl font-bold mb-2">Annual</h3>
            <div className="text-4xl font-bold mb-1">$99</div>
            <div className="text-blue-300 mb-1">per year</div>
            <div className="text-blue-300 text-sm mb-6">That's just $8.25/month — save 36%</div>
            <ul className="space-y-3 text-blue-100 mb-8">
              {planFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/sign-up"
              className="block text-center bg-blue-500 hover:bg-blue-400 text-white px-6 py-3 rounded-xl font-semibold transition-colors"
            >
              Start Free Trial
            </Link>
          </div>
        </div>

        <p className="text-center text-gray-400 text-sm mt-6">
          🎁 All future features included — current subscribers never pay more.
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-8 py-10 text-center text-gray-500 text-sm">
        <p className="mb-2">
          <span className="font-semibold text-gray-400">Tutorial Clarity</span> — by Eppler Publishing LLC
        </p>
        <div className="flex justify-center gap-6">
          <Link href="/books" className="hover:text-gray-300 transition-colors">Books</Link>
          <Link href="/privacy" className="hover:text-gray-300 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-gray-300 transition-colors">Terms of Service</Link>
          <Link href="/about" className="hover:text-gray-300 transition-colors">About</Link>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    icon: '🌐',
    title: 'Clarify Audio',
    description: 'Translate any YouTube video into your language with natural-sounding AI voices that match the original speakers.',
    premium: true,
  },
  {
    icon: '📋',
    title: 'AI Summary',
    description: "Get an honest plain-English summary of any video in seconds. Know what you're getting before you commit.",
    premium: true,
  },
  {
    icon: '📄',
    title: 'Clean Transcript',
    description: 'Download a properly formatted transcript with punctuation and paragraph breaks — ready to read or print.',
    premium: true,
  },
  {
    icon: '🔍',
    title: 'Zoom',
    description: 'Draw a box on any part of the video and zoom in to fill the screen. Perfect for seeing small details clearly.',
    premium: false,
  },
  {
    icon: '⏮',
    title: 'Resume Watching',
    description: 'Pick up exactly where you left off — even days later. Your place is saved automatically.',
    premium: false,
  },
  {
    icon: '⌨️',
    title: 'Keyboard Shortcuts',
    description: 'Control playback speed, mute, and play/pause from within Tutorial Clarity using simple keyboard shortcuts.',
    premium: false,
  },
];

const planFeatures = [
  '20 Clarify Audio sessions/month',
  'AI Video Summaries',
  'Clean Transcript Downloads',
  'Zoom & Resume features',
  'Keyboard Shortcuts',
  '14-day free trial',
];
