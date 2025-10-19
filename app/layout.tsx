
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as SonnerToaster } from 'sonner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Tutorial Clarity - Enhanced YouTube Tutorial Player',
  description: 'Watch YouTube tutorials with enhanced controls: perfect spacebar control, smart bookmarks, adjustable speed, and draggable interface designed for learners.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <script src="https://www.youtube.com/iframe_api" async></script>
      </head>
      <body className={`${inter.className} bg-gray-900 text-white`}>
        <div id="root">
          {children}
        </div>
        <Toaster />
        <SonnerToaster theme="dark" />
      </body>
    </html>
  )
}
