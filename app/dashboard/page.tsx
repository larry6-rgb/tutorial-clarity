'use client';

import { useUser, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  const { user } = useUser();
  const [sessionsUsed, setSessionsUsed] = useState(0);
  const [bonusSessions, setBonusSessions] = useState(0);
  const sessionsTotal = 20;
  const totalAvailable = sessionsTotal + bonusSessions;
  const percentUsed = Math.min((sessionsUsed / totalAvailable) * 100, 100);
  const planName = 'Free Trial';
  const daysLeft = 14;
  const [manageStatus, setManageStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [manageError, setManageError] = useState('');

  async function handleManageSubscription() {
    setManageStatus('loading');
    setManageError('');
    try {
      const res = await fetch('/api/subscription-portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setManageStatus('error');
        setManageError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      window.location.href = data.url;
    } catch {
      setManageStatus('error');
      setManageError('Something went wrong. Please try again.');
    }
  }

  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then(data => {
        if (data.sessionsUsed !== undefined) setSessionsUsed(data.sessionsUsed);
        if (data.bonusSessions !== undefined) setBonusSessions(data.bonusSessions);
      })
      .catch(() => {});
  }, []);

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
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">
            {user?.emailAddresses[0]?.emailAddress}
          </span>
          <UserButton  />
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12">

        {/* Welcome */}
        <h1 className="text-3xl font-bold mb-2">
          Welcome back{user?.firstName ? `, ${user.firstName}` : ''}!
        </h1>
        <p className="text-gray-400 mb-10">Here's your account overview.</p>

        {/* Plan + Usage */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">

          {/* Plan card */}
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6">
            <div className="text-sm text-gray-400 mb-1">Current Plan</div>
            <div className="text-2xl font-bold mb-1">{planName}</div>
            <div className="text-blue-400 text-sm">{daysLeft} days remaining in trial</div>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <Link
                href="/subscribe"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                Upgrade to Premium
              </Link>
              <button
                onClick={handleManageSubscription}
                disabled={manageStatus === 'loading'}
                className="inline-block bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {manageStatus === 'loading' ? 'Loading…' : 'Manage Subscription'}
              </button>
            </div>
            {manageStatus === 'error' && (
              <div className="text-red-400 text-sm mt-2">{manageError}</div>
            )}
          </div>

          {/* Usage card */}
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6">
            <div className="text-sm text-gray-400 mb-1">Clarify Audio Sessions</div>
            <div className="text-2xl font-bold mb-3">
              {sessionsUsed} <span className="text-gray-500 text-lg">of {totalAvailable} used this month</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div
                className="bg-blue-500 h-3 rounded-full transition-all"
                style={{ width: `${percentUsed}%` }}
              />
            </div>
            <div className="text-gray-500 text-sm mt-2">
              {totalAvailable - sessionsUsed} sessions remaining
              {bonusSessions > 0 && (
                <span className="text-green-400 ml-2">(includes {bonusSessions} bonus)</span>
              )}
            </div>
          </div>
        </div>

        {/* Start watching */}
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-4">▶️</div>
          <h2 className="text-xl font-bold mb-2">Ready to watch?</h2>
          <p className="text-gray-400 mb-6">
            Paste any YouTube URL to get started with all your Tutorial Clarity tools.
          </p>
          <Link
            href="/"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          >
            Watch a Video
          </Link>
        </div>

      </div>
    </div>
  );
}
