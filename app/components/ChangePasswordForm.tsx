'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';

function clerkErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'errors' in error) {
    const errors = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
    const first = errors?.[0];
    if (first?.longMessage || first?.message) return first.longMessage || first.message || '';
  }
  return 'The password could not be changed. Please check your current password and try again.';
}

export default function ChangePasswordForm() {
  const { isLoaded, user } = useUser();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [signOutOtherSessions, setSignOutOtherSessions] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const passwordEnabled = Boolean(user?.passwordEnabled);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    if (newPassword.length < 8) {
      setStatus('error');
      setMessage('Your new password must contain at least 8 characters.');
      return;
    }
    if (newPassword !== confirmation) {
      setStatus('error');
      setMessage('The two new-password entries do not match.');
      return;
    }
    if (passwordEnabled && !currentPassword) {
      setStatus('error');
      setMessage('Enter your current password first.');
      return;
    }

    setStatus('saving');
    try {
      await user?.updatePassword({
        currentPassword: passwordEnabled ? currentPassword : undefined,
        newPassword,
        signOutOfOtherSessions: signOutOtherSessions,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setStatus('success');
      setMessage(passwordEnabled ? 'Your password has been changed.' : 'Your password has been created.');
    } catch (error) {
      setStatus('error');
      setMessage(clerkErrorMessage(error));
    }
  }

  if (!isLoaded) return <div className="text-gray-400">Loading password settings…</div>;

  return (
    <section className="w-full max-w-2xl rounded-2xl border border-gray-700 bg-gray-900 p-6 text-white">
      <h2 className="mb-2 text-2xl font-bold">{passwordEnabled ? 'Change password' : 'Create a password'}</h2>
      <p className="mb-6 text-sm text-gray-400">You can make this change without signing out of Tutorial Clarity.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        {passwordEnabled && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-300">Current password</span>
            <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="w-full rounded-lg border border-gray-600 bg-gray-950 px-4 py-3 text-white focus:border-blue-500 focus:outline-none" required />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-300">New password</span>
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="w-full rounded-lg border border-gray-600 bg-gray-950 px-4 py-3 text-white focus:border-blue-500 focus:outline-none" minLength={8} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-300">Confirm new password</span>
          <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-lg border border-gray-600 bg-gray-950 px-4 py-3 text-white focus:border-blue-500 focus:outline-none" minLength={8} required />
        </label>
        <label className="flex items-start gap-3 text-sm text-gray-300">
          <input type="checkbox" checked={signOutOtherSessions} onChange={(event) => setSignOutOtherSessions(event.target.checked)} className="mt-1" />
          <span>Sign out other devices after changing my password. This device will remain signed in.</span>
        </label>
        {message && (
          <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${status === 'success' ? 'border-green-700 bg-green-950 text-green-300' : 'border-red-700 bg-red-950 text-red-300'}`}>{message}</div>
        )}
        <button type="submit" disabled={status === 'saving'} className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">
          {status === 'saving' ? 'Saving…' : passwordEnabled ? 'Change password' : 'Create password'}
        </button>
      </form>
    </section>
  );
}
