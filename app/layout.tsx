import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MUJAHI Chess Engine API',
  description:
    'Production-oriented Stockfish 19 (sf_19) hosting platform, static Vercel web console, and Chess Helper 2.1.0 provider architecture.',
  openGraph: {
    title: 'MUJAHI Chess Engine API',
    description:
      'Production-oriented Stockfish 19 (sf_19) hosting platform, static Vercel web console, and Chess Helper 2.1.0 provider architecture.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MUJAHI Chess Engine API',
    description:
      'Production-oriented Stockfish 19 (sf_19) hosting platform, static Vercel web console, and Chess Helper 2.1.0 provider architecture.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased bg-[#0B0F14] text-[#F1F5F9]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
