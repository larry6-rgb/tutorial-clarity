'use client';

import { useUser } from '@clerk/nextjs';
import LandingPage from './components/LandingPage';
import AppHome from './components/AppHome';

export default function Home() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isSignedIn) {
    return <AppHome />;
  }

  return <LandingPage />;
}
