'use client';

import Link from 'next/link';
import { UserProfile } from '@clerk/nextjs';
import ChangePasswordForm from '../../components/ChangePasswordForm';

export default function AccountPage() {
  return (
    <main className="min-h-screen bg-gray-950 px-6 py-10 text-white">
      <div className="mx-auto mb-8 flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-2xl font-bold text-blue-400 hover:text-blue-300">Tutorial Clarity</Link>
        <div className="flex items-center gap-3">
          <Link href="/subscribe" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500">View Plans / Upgrade</Link>
          <Link href="/" className="rounded-lg border border-gray-600 px-4 py-2 text-gray-300 hover:border-gray-400 hover:text-white">Back to app</Link>
        </div>
      </div>
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8">
        <UserProfile routing="path" path="/account" />
        <ChangePasswordForm />
      </div>
    </main>
  );
}
