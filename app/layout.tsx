import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mujahi Chess — Browser Chess Analysis Extension',
  description:
    'Clean, adaptive browser chess analysis with floating panel controls, subtle human-style move suggestions, and fast desktop or mobile installation.',
  openGraph: {
    title: 'Mujahi Chess — Browser Chess Analysis Extension',
    description:
      'Clean, adaptive browser chess analysis with floating panel controls, subtle human-style move suggestions, and fast desktop or mobile installation.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mujahi Chess — Browser Chess Analysis Extension',
    description:
      'Clean, adaptive browser chess analysis with floating panel controls, subtle human-style move suggestions, and fast desktop or mobile installation.',
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
      <body className="min-h-screen antialiased bg-[#0C0C0F] text-white" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
