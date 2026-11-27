import type { Metadata } from 'next'
import './globals.css'

const DESCRIPTION =
  'Construction draw management on the XRP Ledger: a draw is released only when the inspection and the lien waiver are both recorded. Now in pilot on the test network.'

export const metadata: Metadata = {
  metadataBase: new URL('https://www.buildchain.finance'),
  title: 'BuildChain Protocol',
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    url: 'https://www.buildchain.finance',
    siteName: 'BuildChain Protocol',
    title: 'BuildChain Protocol',
    description: DESCRIPTION,
    images: [{ url: '/apple-touch-icon.png' }],
  },
  twitter: { card: 'summary', title: 'BuildChain Protocol', description: DESCRIPTION },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
