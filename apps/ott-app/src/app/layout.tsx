import Link from 'next/link';
import './global.css';

export const metadata = {
  title: 'Old Time Tunes',
  description:
    'Record a tune, see every note and fingering, and build a library to learn from.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            Old Time Tunes
          </Link>
          <nav aria-label="main">
            <Link href="/">Library</Link>
            <Link href="/new" className="nav-cta">
              + Add a recording
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
