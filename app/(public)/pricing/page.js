import Link from 'next/link'
import { T, F, S } from '@/lib/constants'

const COPPER = '#D4956B'

export const metadata = {
  title: 'Pricing | Curators',
  description: 'Curate your world, find great recommendations, and earn from your perspective.',
}

export default function PricingPage() {
  return (
    <>
      <style>{`
        .tier-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 20px;
        }
        @media (min-width: 768px) {
          .tier-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
            align-items: stretch;
          }
        }
      `}</style>

      <div style={{
        minHeight: '100vh',
        background: T.bg,
        color: T.ink,
        fontFamily: F,
      }}>
        <div style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '32px 24px 64px',
        }}>
          {/* Wordmark */}
          <div style={{ marginBottom: 72 }}>
            <Link
              href="/"
              style={{
                fontFamily: S,
                fontSize: 22,
                color: T.acc,
                fontWeight: 400,
                textDecoration: 'none',
              }}
            >
              Curators
            </Link>
          </div>

          {/* Hero */}
          <section style={{ marginBottom: 112 }}>
            <h1 style={{
              fontFamily: S,
              fontSize: 'clamp(32px, 5vw, 56px)',
              fontWeight: 400,
              color: T.ink,
              lineHeight: 1.15,
              margin: '0 0 40px',
              maxWidth: 840,
              letterSpacing: '-0.01em',
            }}>
              Curators you trust, recommending things they love.
            </h1>

            <p style={{
              fontFamily: F,
              fontSize: 18,
              fontWeight: 400,
              color: T.ink2,
              lineHeight: 1.65,
              margin: '0 0 28px',
              maxWidth: 720,
            }}>
              Curators is for people who want to share and learn from trusted perspectives. We&apos;re building a place where you can curate your world, find your people, and earn from your perspective. There&apos;s a vital world of life, art, and information beyond the grasp of training data and outside our algorithmic orbits. We&apos;ll meet you there on Curators.
            </p>

            <p style={{
              fontFamily: F,
              fontSize: 16,
              fontWeight: 500,
              color: T.ink,
              lineHeight: 1.6,
              margin: 0,
              maxWidth: 720,
            }}>
              Reading and receiving recommendations is always free. Making recommendations and earning from them is part of the Supporter tier, which builds your Record, a living portrait of your perspective from what you curate. The Seat tier includes direct messaging, paid curation requests, and your Lens, a personal intelligence that uses your Record to represent you and automate your curation.
            </p>
          </section>

          {/* What we believe */}
          <section style={{ marginBottom: 128 }}>
            <div style={{
              fontFamily: F,
              fontSize: 13,
              fontWeight: 600,
              color: T.ink3,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 48,
            }}>
              What we believe
            </div>

            <div style={{ display: 'grid', gap: 56, maxWidth: 760 }}>
              <ValueBlock
                name="Honesty"
                body="Most recommendation systems are built to keep you scrolling. Curators is built to tell you the truth. Your Lens declines rather than surface something mediocre. It tells you when it doesn't know enough yet. It will never fabricate or paraphrase a recommendation in your voice or anyone else's."
              />
              <ValueBlock
                name="Fellowship"
                body="When you subscribe, a portion of your subscription flows directly to the curators whose recommendations you cosign. When others cosign yours, you earn. No advertising, no algorithmic middleman taking a cut of attention. Money moves from the people who appreciate a recommendation to the person who made it."
              />
              <ValueBlock
                name="Ownership"
                body="You own all your data. You can export your Record, your recommendations, and your subscriber list at any time. If you leave, you take everything with you. We're an instrument for your curation, not a landlord of it."
              />
            </div>
          </section>

          {/* Pricing */}
          <section style={{ marginBottom: 96 }}>
            <h2 style={{
              fontFamily: F,
              fontSize: 28,
              fontWeight: 600,
              color: T.ink,
              margin: '0 0 40px',
            }}>
              Pricing
            </h2>

            <div className="tier-grid">
              <TierCard
                name="Always Free"
                price="$0"
                annual={null}
                description="View and receive recommendations from curators you trust."
                introLine={null}
                features={[
                  'Subscribe to any curator on the network',
                  'Receive recommendations by email, text, app, and digest',
                  'Browse curator profiles and recommendations',
                  'Directly support curators financially',
                ]}
                checkColor={T.ink}
                ctaLabel="Get started"
                primary={false}
              />

              <TierCard
                name="Supporter"
                price="$5/month"
                annual="or $48/year (save 20%)"
                description="Make recommendations and join the network's economy."
                introLine="Everything in Free, plus:"
                features={[
                  'Save recommendations to a personal reading list',
                  'Make recommendations of your own',
                  'Your Record: a living portrait of your perspective built from your cosigns, saves, and recommendations, shared with people and agents you choose',
                  'Public profile you can customize at curators.com/your-handle',
                  'Cosign and comment on recommendations that moved you',
                  'A portion of your $5 flows to the curators you cosign',
                  'Earn from cosigns, saves, and subscriptions to your own recommendations',
                ]}
                checkColor={COPPER}
                ctaLabel="Start Supporter"
                primary={false}
              />

              <TierCard
                name="Seat"
                price="$15/month"
                annual="or $144/year (save 20%)"
                description="More automation and intelligence tools for your curation needs."
                introLine="Everything in Supporter, plus:"
                features={[
                  "A personal Lens that helps you make recommendations, find what you'll love, and keep you up to date",
                  'The Read: Submit any link, article, music, video, or podcast. Lens analyzes it through your Record and tells you how it fits',
                  "A visitor Lens on your public profile, so people can explore your perspective when you're not there",
                  'Direct messages and paid requests',
                  "Recommendation watch: Background agents track news, releases, and events around the things you've recommended or saved",
                  'Recommendation analytics',
                  "Catalog import: Connect Spotify, Letterboxd, Goodreads, and more. Lens reads what you've loved and helps build your Record with you",
                ]}
                checkColor={COPPER}
                ctaLabel="Start Seat"
                primary={true}
              />
            </div>
          </section>

          {/* Founding Curator */}
          <section style={{
            margin: '128px 0',
            textAlign: 'center',
          }}>
            <h2 style={{
              fontFamily: F,
              fontSize: 28,
              fontWeight: 600,
              color: T.ink,
              margin: '0 0 28px',
            }}>
              Founding Curator
            </h2>
            <p style={{
              fontFamily: F,
              fontSize: 17,
              fontWeight: 400,
              color: T.ink2,
              lineHeight: 1.7,
              maxWidth: 580,
              margin: '0 auto 18px',
            }}>
              For the first 100 curators who help shape this platform: lifetime Seat access at no cost, by invitation.
            </p>
            <p style={{
              fontFamily: F,
              fontSize: 17,
              fontWeight: 400,
              color: T.ink2,
              lineHeight: 1.7,
              maxWidth: 580,
              margin: '0 auto',
            }}>
              If you&apos;re one of the curators we&apos;ve reached out to, your Seat is already active.
            </p>
          </section>

          {/* FAQ */}
          <section style={{ marginBottom: 96 }}>
            <h2 style={{
              fontFamily: F,
              fontSize: 28,
              fontWeight: 600,
              color: T.ink,
              margin: '0 0 40px',
            }}>
              Frequently asked questions
            </h2>

            <div style={{ display: 'grid', gap: 40, maxWidth: 760 }}>
              <FaqItem
                q="Why isn't Free unlimited?"
                a="Free will always cover everything a subscriber needs to receive recommendations and support curators directly. Making recommendations and participating in the network's economy is what Supporter and Seat unlock. We chose this because a healthy economy needs both sides to have skin in the game."
              />
              <FaqItem
                q="Where does my subscription actually go?"
                a="70% of your subscription flows to curators. Of that, the largest share goes to curators whose recommendations you cosign, then to ones whose recommendations you save, then a floor amount distributed across the active curators you subscribe to. The remaining 30% covers the platform, including AI costs for Seat members."
              />
              <FaqItem
                q="Can I cancel anytime?"
                a="Yes. Monthly plans cancel at the end of the current month. Annual plans can cancel anytime and refund the unused portion."
              />
              <FaqItem
                q="What happens to my recommendations if I leave?"
                a="You can export everything, your recommendations, your Record, your subscriber relationships, as a portable file. We don't hold your work hostage."
              />
              <FaqItem
                q="Is my data used to train AI models?"
                a="No. Your Lens reads only your own recommendations, saves, cosigns, and reads. Nothing leaves your account to train any model, ours or anyone else's."
              />
              <FaqItem
                q="Can I gift a subscription?"
                a="Yes, on both Supporter and Seat tiers."
              />
            </div>
          </section>

          {/* Footer */}
          <footer style={{
            borderTop: `1px solid ${T.bdr}`,
            paddingTop: 32,
            marginTop: 80,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            alignItems: 'flex-start',
          }}>
            <Link
              href="/"
              style={{
                fontFamily: S,
                fontSize: 18,
                color: T.acc,
                fontWeight: 400,
                textDecoration: 'none',
              }}
            >
              Curators
            </Link>
            <div style={{ fontFamily: F, fontSize: 13, color: T.ink3 }}>
              © 2026 Curators
            </div>
            <Link
              href="/"
              style={{
                fontFamily: F,
                fontSize: 13,
                color: T.ink2,
                textDecoration: 'none',
              }}
            >
              Back to home
            </Link>
          </footer>
        </div>
      </div>
    </>
  )
}

function ValueBlock({ name, body }) {
  return (
    <div>
      <h3 style={{
        fontFamily: F,
        fontSize: 22,
        fontWeight: 600,
        color: T.ink,
        margin: '0 0 12px',
        letterSpacing: '-0.005em',
      }}>
        {name}
      </h3>
      <p style={{
        fontFamily: F,
        fontSize: 16,
        fontWeight: 400,
        color: T.ink2,
        lineHeight: 1.7,
        margin: 0,
      }}>
        {body}
      </p>
    </div>
  )
}

function TierCard({ name, price, annual, description, introLine, features, checkColor, ctaLabel, primary }) {
  return (
    <div style={{
      background: T.bg2,
      border: primary ? `1px solid ${COPPER}` : `1px solid ${T.bdr}`,
      borderRadius: 8,
      padding: '32px 28px',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        fontFamily: F,
        fontSize: 18,
        fontWeight: 600,
        color: T.ink,
        marginBottom: 18,
      }}>
        {name}
      </div>

      <div style={{
        fontFamily: S,
        fontSize: 40,
        fontWeight: 500,
        color: T.ink,
        lineHeight: 1.1,
      }}>
        {price}
      </div>

      {annual && (
        <div style={{
          fontFamily: F,
          fontSize: 13,
          color: T.ink3,
          marginTop: 8,
        }}>
          {annual}
        </div>
      )}

      <p style={{
        fontFamily: F,
        fontSize: 14,
        color: T.ink2,
        lineHeight: 1.6,
        margin: '24px 0 24px',
      }}>
        {description}
      </p>

      {introLine && (
        <div style={{
          fontFamily: F,
          fontSize: 13,
          fontWeight: 600,
          color: T.ink,
          marginBottom: 16,
        }}>
          {introLine}
        </div>
      )}

      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: '0 0 32px',
        display: 'grid',
        gap: 12,
      }}>
        {features.map((feat, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              fontFamily: F,
              fontSize: 14,
              color: T.ink,
              lineHeight: 1.55,
            }}
          >
            <span style={{ color: checkColor, flexShrink: 0, lineHeight: 1.55 }}>✓</span>
            <span>{feat}</span>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 'auto' }}>
        <Link
          href="/signup"
          style={{
            display: 'block',
            textAlign: 'center',
            padding: '12px 16px',
            borderRadius: 6,
            fontFamily: F,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
            background: primary ? COPPER : 'transparent',
            color: primary ? T.bg : T.ink,
            border: primary ? `1px solid ${COPPER}` : `1px solid ${T.bdr}`,
          }}
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  )
}

function FaqItem({ q, a }) {
  return (
    <div>
      <div style={{
        fontFamily: F,
        fontSize: 16,
        fontWeight: 600,
        color: T.ink,
        marginBottom: 10,
      }}>
        {q}
      </div>
      <p style={{
        fontFamily: F,
        fontSize: 15,
        fontWeight: 400,
        color: T.ink2,
        lineHeight: 1.7,
        margin: 0,
      }}>
        {a}
      </p>
    </div>
  )
}
