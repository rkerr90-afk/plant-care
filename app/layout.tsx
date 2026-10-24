import type { Metadata, Viewport } from 'next';
import { RegisterSW } from '@/components/RegisterSW';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grow 🍃',
  description: 'Identify your plants and get a daily reminder of what needs watering.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/favicon-48.png',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'Grow 🍃', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f3ec' },
    { media: '(prefers-color-scheme: dark)', color: '#151a16' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <RegisterSW />
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
