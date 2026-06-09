'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

type Affiliate = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  createdAt: string;
  signups: number;
  conversions: number;
};

type Subscriber = {
  id: string;
  email: string;
  createdAt: string;
  plan: string;
  status: string;
  trialEndsAt: string;
  trialActive: boolean;
  trialExpired: boolean;
  currentPeriodEnd: string | null;
  sessionsUsed: number;
  bonusSessions: number;
  sessionsLimit: number;
  stripeCustomerId: string | null;
};

const planColors: Record<string, string> = {
  trial: 'bg-yellow-900 text-yellow-300',
  monthly: 'bg-blue-900 text-blue-300',
  annual: 'bg-green-900 text-green-300',
  free: 'bg-gray-700 text-gray-300',
  none: 'bg-gray-800 text-gray-500',
};

const statusColors: Record<string, string> = {
  active: 'text-green-400',
  canceled: 'text-red-400',
  past_due: 'text-amber-400',
  '—': 'text-gray-600',
};

export default function AdminPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [affiliates, setAffiliates] = useState<Affiliate[] | null>(null);
  const [newAffiliateName, setNewAffiliateName] = useState('');
  const [newAffiliateCode, setNewAffiliateCode] = useState('');
  const [newAffiliateEmail, setNewAffiliateEmail] = useState('');
  const [affiliateError, setAffiliateError] = useState('');
  const [affiliateSaving, setAffiliateSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/admin/subscribers')
      .then(async (r) => {
        if (r.status === 403) { setError('Access denied.'); return; }
        if (!r.ok) { setError('Failed to load subscribers.'); return; }
        setSubscribers(await r.json());
      })
      .catch(() => setError('Network error.'));
    fetch('/api/admin/affiliates')
      .then(async (r) => { if (r.ok) setAffiliates(await r.json()); })
      .catch(() => null);
  }, []);

  const createAffiliate = async () => {
    if (!newAffiliateName || !newAffiliateCode) { setAffiliateError('Name and code are required.'); return; }
    setAffiliateSaving(true);
    setAffiliateError('');
    try {
      const res = await fetch('/api/admin/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAffiliateName, code: newAffiliateCode, email: newAffiliateEmail }),
      });
      if (res.status === 409) { setAffiliateError('That code is already taken.'); return; }
      if (!res.ok) { setAffiliateError('Failed to create affiliate.'); return; }
      const created = await res.json();
      setAffiliates(prev => [{ ...created, signups: 0, conversions: 0 }, ...(prev ?? [])]);
      setNewAffiliateName(''); setNewAffiliateCode(''); setNewAffiliateEmail('');
    } finally {
      setAffiliateSaving(false);
    }
  };

  const deleteAffiliate = async (id: string) => {
    if (!confirm('Delete this affiliate? Their referral history will remain on existing users.')) return;
    await fetch('/api/admin/affiliates', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setAffiliates(prev => prev?.filter(a => a.id !== id) ?? null);
  };

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const filtered = subscribers?.filter(s =>
    s.email.toLowerCase().includes(search.toLowerCase()) ||
    s.plan.includes(search.toLowerCase())
  ) ?? [];

  // Summary counts
  const counts = subscribers ? {
    total: subscribers.length,
    trial: subscribers.filter(s => s.trialActive).length,
    paid: subscribers.filter(s => s.plan === 'monthly' || s.plan === 'annual').length,
    expired: subscribers.filter(s => s.trialExpired && s.plan !== 'monthly' && s.plan !== 'annual').length,
  } : null;

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
          <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1 rounded-full">Admin</span>
          <UserButton />
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-8">Subscribers</h1>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-xl p-6 mb-8">
            {error}
          </div>
        )}

        {/* Summary cards */}
        {counts && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total accounts" value={counts.total} color="text-white" />
            <StatCard label="Active trials" value={counts.trial} color="text-yellow-400" />
            <StatCard label="Paid subscribers" value={counts.paid} color="text-green-400" />
            <StatCard label="Expired / free" value={counts.expired} color="text-gray-400" />
          </div>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Search by email or plan..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Table */}
        {subscribers === null && !error && (
          <div className="text-gray-500 text-center py-20">Loading...</div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Trial / Renewal</th>
                  <th className="px-4 py-3 font-medium text-right">Sessions</th>
                  <th className="px-4 py-3 font-medium text-right">Bonus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-900/60 transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{s.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${planColors[s.plan] ?? 'bg-gray-800 text-gray-400'}`}>
                        {s.plan}
                      </span>
                    </td>
                    <td className={`px-4 py-3 font-medium ${statusColors[s.status] ?? 'text-gray-400'}`}>
                      {s.trialActive ? 'In trial' : s.trialExpired && s.plan !== 'monthly' && s.plan !== 'annual' ? 'Trial expired' : s.status}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{fmt(s.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {s.trialActive
                        ? `Trial ends ${fmt(s.trialEndsAt)}`
                        : s.currentPeriodEnd
                        ? `Renews ${fmt(s.currentPeriodEnd)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={s.sessionsUsed >= s.sessionsLimit ? 'text-red-400 font-semibold' : 'text-gray-300'}>
                        {s.sessionsUsed} / {s.sessionsLimit}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">
                      {s.bonusSessions > 0 ? <span className="text-green-400">+{s.bonusSessions}</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {subscribers !== null && filtered.length === 0 && !error && (
          <div className="text-gray-500 text-center py-20">No subscribers found.</div>
        )}

        {/* ── Affiliates ── */}
        <h2 className="text-2xl font-bold mt-16 mb-6">Affiliate Links</h2>

        {/* Create form */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Create New Affiliate</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Name</label>
              <input value={newAffiliateName} onChange={e => setNewAffiliateName(e.target.value)}
                placeholder="John Smith" className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Code (URL slug)</label>
              <input value={newAffiliateCode} onChange={e => setNewAffiliateCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                placeholder="johnsmith" className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Email (optional)</label>
              <input value={newAffiliateEmail} onChange={e => setNewAffiliateEmail(e.target.value)}
                placeholder="john@example.com" className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
            </div>
            <button onClick={createAffiliate} disabled={affiliateSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
              {affiliateSaving ? 'Creating...' : 'Create'}
            </button>
          </div>
          {affiliateError && <p className="text-red-400 text-sm mt-3">{affiliateError}</p>}
          {newAffiliateCode && (
            <p className="text-gray-500 text-xs mt-3">
              Link: <span className="text-blue-400 font-mono">https://tutorialclarity.com/?ref={newAffiliateCode}</span>
            </p>
          )}
        </div>

        {/* Affiliates table */}
        {affiliates && affiliates.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Code / Link</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium text-right">Signups</th>
                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {affiliates.map(a => (
                  <tr key={a.id} className="hover:bg-gray-900/60 transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{a.name}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-blue-400 text-xs">tutorialclarity.com/?ref={a.code}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{a.email ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{a.signups}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={a.conversions > 0 ? 'text-green-400 font-semibold' : 'text-gray-600'}>{a.conversions}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{fmt(a.createdAt)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteAffiliate(a.id)} className="text-gray-600 hover:text-red-400 transition-colors text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {affiliates !== null && affiliates.length === 0 && (
          <p className="text-gray-600 text-sm">No affiliates yet.</p>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-gray-500 text-sm mt-1">{label}</div>
    </div>
  );
}
