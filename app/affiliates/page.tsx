'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function AffiliatesPage() {
  const [form, setForm] = useState({ name: '', email: '', address: '', phone: '', website: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/affiliates/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return; }
      // Redirect to Stripe onboarding
      window.location.href = data.onboardingUrl;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
        <Link href="/" className="text-2xl font-bold" style={{
          background: 'linear-gradient(135deg, #E6E6FA 0%, #4169E1 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          Tutorial Clarity
        </Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-14">
          <h1 className="text-4xl font-bold mb-4">Earn with Tutorial Clarity</h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Share Tutorial Clarity with your audience and earn <strong className="text-white">30% recurring commission</strong> on every subscription — for as long as your referrals stay subscribed.
          </p>
        </div>

        {/* How it works */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {[
            { step: '1', title: 'Sign up below', desc: 'Fill out your info and connect your bank account via Stripe. Takes about 2 minutes.' },
            { step: '2', title: 'Share your link', desc: 'You\'ll get a unique referral link. Share it anywhere — YouTube, blog, social media.' },
            { step: '3', title: 'Get paid monthly', desc: 'Earn 30% of every payment your referrals make, deposited directly to your bank each month.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-bold mb-4">{step}</div>
              <h3 className="font-semibold mb-2">{title}</h3>
              <p className="text-gray-400 text-sm">{desc}</p>
            </div>
          ))}
        </div>

        {/* Perks callout */}
        <div className="bg-blue-950/40 border border-blue-800/50 rounded-xl p-6 mb-12 text-sm text-blue-200">
          <strong className="text-white">Bonus for your audience:</strong> Anyone who signs up through your link gets an extra free month on top of the standard 2-week trial — giving them over 6 weeks to explore Tutorial Clarity before paying anything.
        </div>

        {/* Signup form */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
          <h2 className="text-xl font-bold mb-6">Apply to become an affiliate</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Full name *</label>
                <input required value={form.name} onChange={set('name')} placeholder="Jane Smith"
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Email address *</label>
                <input required type="email" value={form.email} onChange={set('email')} placeholder="jane@example.com"
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Mailing address *</label>
              <input required value={form.address} onChange={set('address')} placeholder="123 Main St, City, State, ZIP"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Phone number *</label>
                <input required value={form.phone} onChange={set('phone')} placeholder="+1 (555) 000-0000"
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Your website or channel URL</label>
                <input value={form.website} onChange={set('website')} placeholder="https://youtube.com/@yourchannel"
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button type="submit" disabled={submitting}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors mt-2">
              {submitting ? 'Setting up your account…' : 'Continue to bank setup →'}
            </button>

            <p className="text-xs text-gray-500 text-center">
              After submitting you'll be taken to Stripe to securely connect your bank account for payouts. Tutorial Clarity never sees your banking details.
            </p>
          </form>
        </div>

        {/* Commission details */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          {[
            { label: 'Commission rate', value: '30%', sub: 'of every payment' },
            { label: 'Recurring', value: '∞', sub: 'for life of subscription' },
            { label: 'Payout schedule', value: 'Monthly', sub: 'direct to your bank' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-3xl font-bold text-blue-400 mb-1">{value}</div>
              <div className="text-sm font-medium text-white">{label}</div>
              <div className="text-xs text-gray-500">{sub}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
