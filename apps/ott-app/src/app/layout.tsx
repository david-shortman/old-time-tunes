import './global.css';

export const metadata = {
  title: 'Old Time Tunes',
  description: 'See the notes and fingerings in a fiddle recording.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
