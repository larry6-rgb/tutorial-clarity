import Link from 'next/link';

export const metadata = { title: 'Terms of Service — Tutorial Clarity' };

export default function TermsPage() {
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
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-gray-500 text-sm mb-10">Effective date: June 6, 2026</p>

        <section className="space-y-10 text-gray-300 leading-relaxed">

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">1. Agreement</h2>
            <p>
              By creating an account or using Tutorial Clarity, you agree to these Terms of Service.
              Tutorial Clarity is operated by <strong className="text-white">Eppler Publishing LLC</strong>.
              If you do not agree to these terms, please do not use the service.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">2. Your account</h2>
            <p>
              You are responsible for keeping your account credentials secure and for all activity that occurs
              under your account. You must provide accurate information when creating your account. You may not
              share your account with others.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">3. Free trial</h2>
            <p>
              New accounts receive a 14-day free trial with full access to all premium features. No credit card
              is required to start a trial. At the end of the trial period, access to premium features will
              require a paid subscription.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">4. Subscriptions and billing</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Subscriptions are billed monthly or annually, in advance.</li>
              <li>You may cancel your subscription at any time. Your access continues until the end of the current billing period — we do not provide prorated refunds for partial periods.</li>
              <li>Prices may change with 30 days' notice to your registered email address.</li>
              <li>Overage session packs are one-time purchases and are non-refundable once sessions have been used.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">5. Usage limits</h2>
            <p>
              Each paid plan includes 20 Clarify Audio sessions per billing month. Sessions reset at the start of
              each billing period. Additional sessions may be purchased as an overage pack. We reserve the right
              to adjust usage limits with notice to subscribers.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">6. Acceptable use</h2>
            <p className="mb-3">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Use Tutorial Clarity for any unlawful purpose</li>
              <li>Attempt to circumvent usage limits or access controls</li>
              <li>Reverse-engineer, copy, or redistribute any part of the service</li>
              <li>Use the service to process content you do not have the right to process</li>
              <li>Interfere with the operation of the service or its infrastructure</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">7. Third-party content</h2>
            <p>
              Tutorial Clarity processes YouTube videos at your request. We do not host or distribute YouTube
              content. You are responsible for ensuring that your use of any video content complies with
              YouTube's Terms of Service and applicable copyright law.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">8. Disclaimer of warranties</h2>
            <p>
              Tutorial Clarity is provided "as is" without warranties of any kind. We do not guarantee that
              the service will be uninterrupted, error-free, or that AI-generated outputs (summaries,
              transcripts, translations) will be perfectly accurate. AI outputs are provided for convenience
              and should not be relied upon for critical decisions.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">9. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, Eppler Publishing LLC shall not be liable for any
              indirect, incidental, special, or consequential damages arising from your use of Tutorial Clarity.
              Our total liability to you for any claim shall not exceed the amount you paid us in the three
              months preceding the claim.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">10. Termination</h2>
            <p>
              We reserve the right to suspend or terminate your account if you violate these terms. You may
              close your account at any time by contacting us at{' '}
              <a href="mailto:support@tutorialclarity.com" className="text-blue-400 hover:text-blue-300 underline">
                support@tutorialclarity.com
              </a>.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">11. Governing law</h2>
            <p>
              These terms are governed by the laws of the United States. Any disputes shall be resolved
              in the courts of the state where Eppler Publishing LLC is registered.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">12. Changes to these terms</h2>
            <p>
              We may update these terms from time to time. We will notify you of significant changes by
              email. Continued use of Tutorial Clarity after changes take effect constitutes acceptance
              of the updated terms.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-3">13. Contact</h2>
            <p>
              Questions about these terms? Email us at{' '}
              <a href="mailto:support@tutorialclarity.com" className="text-blue-400 hover:text-blue-300 underline">
                support@tutorialclarity.com
              </a>.
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
