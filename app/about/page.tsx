import Link from 'next/link';

export const metadata = { title: 'About — Tutorial Clarity' };

export default function AboutPage() {
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
        <div className="flex items-center gap-4">
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

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-10">About Tutorial Clarity</h1>

        <div className="space-y-8 text-gray-300 leading-relaxed">

          <p className="text-xl text-gray-200">
            Tutorial Clarity was built for people who just want YouTube to work better — no technical
            background required.
          </p>

          <p>
            YouTube is an incredible resource. But watching a tutorial or educational video often comes with
            frustrations that get in the way of actually learning: a presenter who speaks too fast, an accent
            that's hard to follow, small text on screen that's difficult to read, or simply losing your place
            after stepping away. These aren't problems with the content — they're problems with the experience.
          </p>

          <p>
            Tutorial Clarity gives you a set of tools to solve those problems. Zoom in on any part of the
            video. Pick up exactly where you left off. Get a plain-English summary before you invest an hour
            of your time. Read a clean, properly formatted transcript. And with Clarify Audio, hear any video
            translated into your language with natural-sounding AI voices — so the language barrier stops
            being a barrier.
          </p>

          <p>
            We built this to be genuinely useful to real people, not to impress anyone with technology.
            Every feature in Tutorial Clarity exists because someone had a real problem watching YouTube,
            and we found a way to fix it.
          </p>

          <div className="border-t border-gray-800 pt-8">
            <h2 className="text-2xl font-bold text-white mb-4">The company</h2>
            <p>
              Tutorial Clarity is a product of <strong className="text-white">Eppler Publishing LLC</strong>,
              an independent software company. We are a small team focused on building tools that make
              learning from video easier and more accessible for everyone.
            </p>
          </div>

          <div className="border-t border-gray-800 pt-8">
            <h2 className="text-2xl font-bold text-white mb-4">Get in touch</h2>
            <p>
              We'd love to hear from you — whether it's a question, a bug report, or a feature you wish
              existed. Email us at{' '}
              <a href="mailto:support@tutorialclarity.com" className="text-blue-400 hover:text-blue-300 underline">
                support@tutorialclarity.com
              </a>{' '}
              and a real person will respond.
            </p>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 mt-8">
            <h2 className="text-xl font-bold text-white mb-3">Try it free for 14 days</h2>
            <p className="text-gray-400 mb-6">
              No credit card required. Full access to every premium feature. Cancel anytime.
            </p>
            <Link
              href="/sign-up"
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold transition-colors"
            >
              Start Your Free Trial
            </Link>
          </div>

        </div>
      </main>

      <footer className="border-t border-gray-800 px-8 py-10 text-center text-gray-500 text-sm">
        <p className="mb-2">
          <span className="font-semibold text-gray-400">Tutorial Clarity</span> — by Eppler Publishing LLC
        </p>
        <div className="flex justify-center gap-6">
          <Link href="/privacy" className="hover:text-gray-300 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-gray-300 transition-colors">Terms of Service</Link>
          <Link href="/about" className="hover:text-gray-300 transition-colors">About</Link>
        </div>
      </footer>
    </div>
  );
}
