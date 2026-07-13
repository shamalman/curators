// force redeploy
import './globals.css'
import { Suspense } from 'react'
import ThemeProvider from '@/components/theme/ThemeProvider'

export const metadata = {
  metadataBase: new URL('https://curators.com'),
  title: 'Curators',
  description: 'Curate your world, find great recommendations, and earn from your perspective.',
  openGraph: {
    title: 'Curators',
    description: 'Curate your world, find great recommendations, and earn from your perspective.',
    url: 'https://curators.com',
    siteName: 'Curators',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Curators',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Curators',
    description: 'Curate your world, find great recommendations, and earn from your perspective.',
    images: ['/og-image.png'],
  },
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,300;1,6..72,400&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Suspense fallback={null}>
          <ThemeProvider />
        </Suspense>
      </body>
    </html>
  )
}
