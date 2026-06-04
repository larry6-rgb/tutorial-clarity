'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

const MONTHLY_PRICE_ID = 'price_1TeihB3eI6L9ZOHZQTUS1Q6k';
const ANNUAL_PRICE_ID = 'price_1TeilR3eI6L9ZOHZbTtRZNiD';

export default function SubscribePage() {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  const handleSubscribe = async (priceId: string, plan: string) => {
    setLoading(plan);
    try {
      const res = await fetch('/api/stripe-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Checkout error:', error);
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
        <Link
          href="/"
          className="text-2xl font-bold"
          style={{
            background: 'linear-gradient(135deg, #E6E6FA 0%, #4169E1 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}
        >
          Tutorial Clarity
        </Link>
        <UserButton afterSignOutUrl="/" />
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-center mb-4">Choose your plan</h1>
        <p className="text-gray-400 text-center mb-4">
          Start with a full 14-day free trial — no credit card required.
        </p>
        <p className="text-gray-500 text-center max-w-2xl mx-auto mb-12">
          We only charge for features that cost us real money to provide. Every dollar goes directly toward making your experience better.
        </p>

        <div className="flex flex-col md:flex-row gap-8 justify-center">

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
            <button
              onClick={() => handleSubscribe(MONTHLY_PRICE_ID, 'monthly')}
              disabled={loading !== null}
              className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold transition-colors"
            >
              {loading === 'monthly' ? 'Redirecting...' : 'Start Free Trial'}
            </button>
          </div>

          {/* Annual */}
          <div className="bg-blue-900 border border-blue-500 rounded-2xl p-8 flex-1 relative">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-sm font-bold px-4 py-1 rounded-full">
              Best Value — Save 36%
            </div>
            <h3 className="text-xl font-bold mb-2">Annual</h3>
            <div className="text-4xl font-bold mb-1">$99</div>
            <div className="text-blue-300 mb-1">per year</div>
            <div className="text-blue-300 text-sm mb-6">Just $8.25/month</div>
            <ul className="space-y-3 text-blue-100 mb-8">
              {planFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleSubscribe(ANNUAL_PRICE_ID, 'annual')}
              disabled={loading !== null}
              className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold transition-colors"
            >
              {loading === 'annual' ? 'Redirecting...' : 'Start Free Trial'}
            </button>
          </div>
        </div>

        <p className="text-center text-gray-500 text-sm mt-8">
          You won't be charged until your 14-day trial ends. Cancel anytime.
        </p>
      </div>
    </div>
  );
}

const planFeatures = [
  '20 Clarify Audio sessions/month',
  'AI Video Summaries',
  'Clean Transcript Downloads',
  'Zoom & Resume features',
  'Keyboard Shortcuts',
  '14-day free trial — no credit card',
];
