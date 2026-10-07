import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title: 'VISITE — A Journey Into Nature · Notosan',
 description: 'Leave the everyday behind. An immersive illustrated journey through golden mountains, quiet waterfalls, and a world alive with wonder.',
 metadataBase: new URL('https://visite-nature.kolligireeshkumarred.chatgpt.site'),
 openGraph: { title: 'VISITE — A Journey Into Nature', description: 'Slow down. Look closer. Find your sense of wonder.', images: ['/art/hero.webp'] },
 icons: { icon: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
 return <html lang="en"><body>{children}</body></html>;
}
