import Link from 'next/link';

export const metadata = { title: 'Privacy Policy — Tutorial Clarity' };

export default function PrivacyPage() {
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
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-gray-500 text-sm mb-10">Effective date: June 6, 2026</p>

        <section className="space-y-10 text-gray-300 leading-relaxed">

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">1. Who we are</h2>
            <p>
              Tutorial Clarity is operated by <strong className="text-white">Eppler Publishing LLC</strong>.
              When this policy says "we," "us," or "our," it refers to Eppler Publishing LLC.
              You can reach us at <a href="mailto:support@tutorialclarity.com" className="text-blue-400 hover:text-blue-300 underline">support@tutorialclarity.com</a>.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">2. What information we collect</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong className="text-white">Account information</strong> — name and email address collected when you sign up via Clerk.</li>
              <li><strong className="text-white">Payment information</strong> — billing details are collected and stored by Stripe. We never see or store your full card number.</li>
              <li><strong className="text-white">Usage data</strong> — we record how many Clarify Audio sessions you have used each billing period so we can enforce your plan limits.</li>
              <li><strong className="text-white">YouTube data</strong> — when you use Tutorial Clarity on a YouTube video, we process the video's audio or transcript in order to provide our AI features. We do not store your YouTube watch history.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">3. How we use your information</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>To create and manage your account</li>
              <li>To process subscription payments and one-time purchases</li>
              <li>To deliver the features you request (audio translation, summaries, transcripts)</li>
              <li>To enforce usage limits on your plan</li>
              <li>To send you transactional emails (receipts, subscription notices) — we do not send marketing email without your consent</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">4. Third-party services</h2>
            <p className="mb-3">We use the following third-party services that may process your data:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong className="text-white">Clerk</strong> — authentication and account management</li>
              <li><strong className="text-white">Stripe</strong> — payment processing</li>
              <li><strong className="text-white">AssemblyAI</strong> — audio transcription</li>
              <li><strong className="text-white">OpenAI</strong> — AI summaries and definitions</li>
              <li><strong className="text-white">Railway</strong> — cloud hosting and database</li>
            </ul>
            <p className="mt-3">Each of these services has its own privacy policy governing how they handle data.</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">5. Data retention</h2>
            <p>
              We retain your account and usage data for as long as your account is active. If you delete your account,
              we will delete your personal data within 30 days, except where we are required to retain it for legal or
              financial compliance purposes.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">6. Your rights</h2>
            <p>
              You may request access to, correction of, or deletion of your personal data at any time by emailing
              us at <a href="mailto:support@tutorialclarity.com" className="text-blue-400 hover:text-blue-300 underline">support@tutorialclarity.com</a>.
              We will respond within 30 days.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">7. Cookies</h2>
            <p>
              We use cookies only as required for authentication (Clerk session cookies) and to keep you signed in.
              We do not use advertising or tracking cookies.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">8. Children</h2>
            <p>
              Tutorial Clarity is not directed at children under 13. We do not knowingly collect personal data
              from children. If you believe a child has provided us with personal information, please contact us
              and we will delete it promptly.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">9. SubTamer Chrome Extension</h2>
            <p className="mb-3">
              SubTamer is a Chrome extension also operated by Eppler Publishing LLC that helps you organize
              your YouTube subscriptions into a visual canvas. The following applies specifically to the extension:
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong className="text-white">Subscription data</strong> — SubTamer reads your YouTube subscription list directly from the YouTube page you have open. This data is stored locally in your browser using Chrome&apos;s built-in storage and is never transmitted to our servers.</li>
              <li><strong className="text-white">Canvas layout</strong> — the frames, groupings, and organization you create are stored locally in your browser. We do not have access to your layout.</li>
              <li><strong className="text-white">License key</strong> — if you enter a license key to unlock premium features, that key is sent to our server solely to verify its validity. No other personal data is transmitted.</li>
              <li><strong className="text-white">No tracking</strong> — SubTamer does not track your browsing activity, collect analytics, or share any data with third parties.</li>
              <li><strong className="text-white">Permissions</strong> — SubTamer requests access to YouTube pages only in order to read your subscription list. It does not access any other websites.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">10. Changes to this policy</h2>
            <p>
              We may update this policy from time to time. We will notify you of significant changes by email
              or by posting a notice on the site. Continued use of Tutorial Clarity after changes take effect
              constitutes acceptance of the updated policy.
            </p>
          </div>

        </section>
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
