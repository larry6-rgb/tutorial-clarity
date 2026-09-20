'use client';

import { UserButton } from '@clerk/nextjs';

export default function AccountUserButton() {
  return <UserButton userProfileMode="navigation" userProfileUrl="/account" />;
}
