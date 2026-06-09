'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ReauthContent() {
  const params = useSearchParams();
  const code = params.get('code');

  useEffect(() => {
    if (code) {
      window.location.href = `/api/affiliates/connect/reauth?code=${code}`;
    }
  }, [code]);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <p className="text-gray-400">Resuming your Stripe setup…</p>
    </div>
  );
}

export default function ReauthPage() {
  return (
    <Suspense>
      <ReauthContent />
    </Suspense>
  );
}
