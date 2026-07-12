import Link from 'next/link';
import type { Metadata } from 'next';

const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/subtamer/bhkddcpolmfjkmnnbbjhbjekldkbookp';

export const metadata: Metadata = {
  title: 'SubTamer — Taming Your YouTube Subscriptions',
  description:
    'Ever lose a channel in your own subscription list? SubTamer fixes that — drag channels into frames and find anything instantly. Free Chrome extension.',
  openGraph: {
    title: 'SubTamer — Taming Your YouTube Subscriptions',
    description:
      'Ever lose a channel in your own subscription list? SubTamer fixes that — drag channels into frames and find anything instantly.',
    type: 'website',
    images: ['https://img.youtube.com/vi/RhsJJCKYEWM/maxresdefault.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SubTamer — Taming Your YouTube Subscriptions',
    description: 'Ever lose a channel in your own subscription list? SubTamer fixes that.',
  },
};

export default function SubTamerPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
        <Link
          href="/"
          className="text-2xl font-bold"
          style={{
            background: 'linear-gradient(135deg, #E6E6FA 0%, #4169E1 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Tutorial Clarity
        </Link>
        <a
          href={CHROME_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-amber-400 hover:bg-amber-300 text-black px-5 py-2 rounded-lg font-semibold transition-colors"
        >
          Add to Chrome — Free
        </a>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="flex flex-col items-center text-center mb-10">
          <img src="/images/subtamer-icon.png" alt="SubTamer icon" className="w-16 h-16 rounded-xl mb-5" />
          <h1
            className="text-4xl sm:text-5xl font-bold mb-4"
            style={{ color: '#ffd700' }}
          >
            SubTamer
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl">
            Ever lose a channel in your own YouTube subscription list? SubTamer fixes that —
            drag channels into frames and find anything instantly.
          </p>
        </div>

        <div className="relative w-full mb-10" style={{ paddingBottom: '56.25%' }}>
          <iframe
            className="absolute inset-0 w-full h-full rounded-2xl border border-gray-800"
            src="https://www.youtube.com/embed/RhsJJCKYEWM"
            title="SubTamer — Taming Your YouTube Subscriptions"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>

        <div className="flex flex-col items-center text-center mb-16">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-amber-400 hover:bg-amber-300 text-black px-8 py-4 rounded-xl font-bold text-lg transition-colors"
          >
            Add to Chrome — Free
          </a>
          <p className="text-gray-500 text-sm mt-3">
            Free to use. Chrome browser required.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">Organize by dragging</h3>
            <p className="text-gray-400 text-sm">
              Create labeled frames and drag your subscriptions into them — no more endless scrolling
              to find a channel.
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">Search inside a channel</h3>
            <p className="text-gray-400 text-sm">
              Even channels with thousands of videos become searchable — find exactly the video
              you're thinking of.
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">Your data stays yours</h3>
            <p className="text-gray-400 text-sm">
              Everything is stored locally in your browser. No tracking, no account required to
              get started.
            </p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 text-center">
          <h2 className="text-xl font-bold text-white mb-3">Already using SubTamer?</h2>
          <p className="text-gray-400">
            SubTamer Premium ($4.99/mo) credits toward an upgrade to{' '}
            <Link href="/" className="text-blue-400 hover:text-blue-300 underline">
              Tutorial Clarity
            </Link>
            , our full AI-powered YouTube learning toolkit.
          </p>
        </div>
      </main>

      <footer className="border-t border-gray-800 px-8 py-10 text-center text-gray-500 text-sm">
        <p className="mb-2">
          <span className="font-semibold text-gray-400">Tutorial Clarity</span> — by Eppler Publishing LLC
        </p>
        <div className="flex justify-center gap-6">
          <Link href="/" className="hover:text-gray-300 transition-colors">Home</Link>
          <Link href="/privacy" className="hover:text-gray-300 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-gray-300 transition-colors">Terms of Service</Link>
          <Link href="/about" className="hover:text-gray-300 transition-colors">About</Link>
        </div>
      </footer>
    </div>
  );
}
