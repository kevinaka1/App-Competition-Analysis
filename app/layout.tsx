import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'App Competition Analysis — Market research, made tangible',
  description: 'Explore competitors and review patterns around your mobile app idea.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  </head><body>{children}</body></html>;
}
