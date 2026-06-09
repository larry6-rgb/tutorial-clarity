'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ConnectedContent() {
  const params = useSearchParams();
  const code = params.get('code');
  const link = code ? `https://tutorialclarity.com/?ref=${code}` : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl mb-6">🎉</div>
      <h1 className="text-3xl font-bold mb-4">You're all set!</h1>
      <p className="text-gray-400 mb-8 max-w-md">
        Your affiliate account is active. Share your unique link and start earning 30% recurring commission on every subscription.
      </p>
      {link && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl px-6 py-4 mb-8 w-full max-w-md">
          <p className="text-xs text-gray-500 mb-2">Your referral link</p>
          <p className="font-mono text-blue-400 break-all text-sm">{link}</p>
          <button
            onClick={() => navigator.clipboard.writeText(link)}
            className="mt-3 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Click to copy
          </button>
        </div>
      )}
      <p className="text-gray-500 text-sm mb-6">
        Commissions are paid automatically on the 1st of each month directly to your bank account.
      </p>
      <Link href="/" className="text-blue-400 hover:underline text-sm">← Back to Tutorial Clarity</Link>
    </div>
  );
}

export default function ConnectedPage() {
  return (
    <Suspense>
      <ConnectedContent />
    </Suspense>
  );
}
