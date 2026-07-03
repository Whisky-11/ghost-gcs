import type { Metadata } from 'next'
import './globals.css'

// English-only UI (plan's Global Constraints — deliberate, no i18n layer).
export const metadata: Metadata = {
  title: 'GHOST GCS',
  description: 'GHOST GCS — live ground control station',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
