import { SITE_URL } from '@/lib/site-url';

export const metadata = { title: 'Rec Saved — Curators' };

export default function SavedPage() {
  return (
    <div style={{
      minHeight: '100vh', background: '#131210', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 20,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{
          fontSize: 16, fontWeight: 700, color: '#D4956B',
          letterSpacing: '0.02em', marginBottom: 32,
        }}>
          curators.com
        </div>
        <h1 style={{
          fontSize: 22, fontWeight: 600, color: '#E8E2D6',
          margin: '0 0 12px', lineHeight: 1.3,
        }}>
          Rec saved to your library
        </h1>
        <p style={{
          fontSize: 14, color: '#A09888', lineHeight: 1.6, margin: '0 0 28px',
        }}>
          You'll find it in your saved recs next time you open the app.
        </p>
        <a href={SITE_URL} style={{
          display: 'inline-block', padding: '10px 24px', borderRadius: 8,
          background: '#D4956B', color: '#131210', fontSize: 13,
          fontWeight: 700, textDecoration: 'none',
        }}>
          Open Curators
        </a>
      </div>
    </div>
  );
}
