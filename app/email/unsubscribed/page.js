import { siteUrl } from '@/lib/site-url';

export const metadata = { title: 'Unsubscribed — Curators' };

export default function UnsubscribedPage() {
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
          You've been unsubscribed
        </h1>
        <p style={{
          fontSize: 14, color: '#A09888', lineHeight: 1.6, margin: '0 0 28px',
        }}>
          You won't receive these email notifications anymore. You can always
          re-enable them in your settings.
        </p>
        <a href={siteUrl('/settings')} style={{
          display: 'inline-block', padding: '10px 24px', borderRadius: 8,
          background: '#D4956B', color: '#131210', fontSize: 13,
          fontWeight: 700, textDecoration: 'none',
        }}>
          Manage settings
        </a>
      </div>
    </div>
  );
}
