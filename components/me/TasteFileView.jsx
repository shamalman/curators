'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurator } from '@/context/CuratorContext'
import { supabase } from '@/lib/supabase'
import { T, F, S, MN } from '@/lib/constants'
import { extractPublicSections } from '@/lib/taste-profile/parse'

function parseTasteProfile(markdown) {
  if (!markdown) return null

  const sections = {}
  let currentSection = null

  const lines = markdown.split('\n')
  for (const line of lines) {
    if (line.startsWith('# ')) {
      sections.title = line.replace('# ', '').trim()
      continue
    }
    if (line.startsWith('## ')) {
      currentSection = line.replace('## ', '').trim()
      sections[currentSection] = ''
      continue
    }
    if (currentSection && sections[currentSection] !== undefined) {
      sections[currentSection] += line + '\n'
    }
  }

  for (const key of Object.keys(sections)) {
    if (typeof sections[key] === 'string') {
      sections[key] = sections[key].trim()
    }
  }

  return sections
}

function parseDomains(domainsText) {
  if (!domainsText) return []

  const domains = []
  const blocks = domainsText.split(/\n(?=\*\*)/).filter(Boolean)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    const headerLine = lines[0] || ''

    const nameMatch = headerLine.match(/\*\*([^(*]+)/)
    const name = nameMatch ? nameMatch[1].trim() : headerLine

    // Description = everything after the bold name on the header line (the
    // `**Name**: description` case, stripping the leading colon), joined with
    // any subsequent lines (the `**Name**\ndescription` case). A header with
    // no trailing text and no following lines yields an empty description.
    const afterBold = headerLine
      .replace(/\*\*[^*]+\*\*/, '')
      .replace(/^\s*:\s*/, '')
      .trim()
    const restLines = lines.slice(1).join(' ').trim()
    const description = [afterBold, restLines].filter(Boolean).join(' ').trim()

    domains.push({
      name,
      description,
    })
  }

  return domains
}

function parseSubscriptions(subsText) {
  if (!subsText) return []
  return subsText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- @'))
    .map(line => line.replace('- ', '').trim())
}

export default function TasteFileView() {
  const { profileId, profile } = useCurator()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profileData, setProfileData] = useState(null)

  const handleDownload = () => {
    if (!profileData?.content) return
    const handle = (profile?.handle || '').replace(/^@/, '') || 'mine'
    const publicContent = extractPublicSections(profileData.content) || profileData.content
    const blob = new Blob([publicContent], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `personal-record-${handle}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (!profileId) return

    async function fetchTasteProfile() {
      const { data, error } = await supabase
        .from('taste_profiles')
        .select('content, version, generated_at')
        .eq('profile_id', profileId)
        .order('version', { ascending: false })
        .limit(1)
        .single()

      if (error || !data) {
        setProfileData(null)
      } else {
        setProfileData(data)
      }
      setLoading(false)
    }

    fetchTasteProfile()
  }, [profileId])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', color: T.ink3, fontSize: 13, padding: '80px 24px' }}>
        Loading...
      </div>
    )
  }

  if (!profileData) {
    return (
      <div style={{ textAlign: 'center', color: T.ink3, fontSize: 14, lineHeight: 1.7, padding: '80px 24px' }}>
        <p>Your AI is still getting to know you. Make a few Recommendations, or do some Taste Reads on what you've been reading, and your Record will take shape.</p>
        <p
          style={{ color: T.acc, fontWeight: 500, cursor: 'pointer', marginTop: 16 }}
          onClick={() => router.push('/myai')}
        >
          Start a conversation &rarr;
        </p>
      </div>
    )
  }

  const sections = parseTasteProfile(profileData.content)
  if (!sections) return null

  const thesis = sections['Working Interpretation']
  const hasThesis = thesis && thesis !== 'Building...'

  // Compact stats strip: version first, "Last updated" last, the rest between.
  const statItems = []
  if (profileData.version) statItems.push(`v${profileData.version}`)
  if (sections['Stats']) {
    const statLines = sections['Stats']
      .split('\n')
      .map(l => l.replace(/^-\s*/, '').trim())
      .filter(Boolean)
    const updated = statLines.filter(l => /^Last updated:/i.test(l))
    const rest = statLines.filter(l => !/^Last updated:/i.test(l))
    statItems.push(...rest, ...updated)
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Working Interpretation is the lede. No label: the Thesis IS the headline. */}
      {hasThesis ? (
        <p style={{ fontFamily: S, fontSize: 18, fontWeight: 400, color: T.ink, lineHeight: 1.5, marginTop: 0, marginBottom: 24 }}>
          {thesis}
        </p>
      ) : (
        <p style={{ fontFamily: F, fontSize: 14, color: T.ink3, fontStyle: 'italic', marginTop: 0, marginBottom: 24 }}>
          Your Record is still taking shape. Make a few recommendations or confirm some Reads and an interpretation will appear here.
        </p>
      )}

      {/* Stats strip */}
      {statItems.length > 0 && (
        <div style={{ fontFamily: MN, fontSize: 11, color: T.ink3, marginBottom: 32 }}>
          {statItems.join(' \u00B7 ')}
        </div>
      )}

      {/* Domains */}
      {sections['Domains'] && (
        <>
          <SectionHeader>Domains</SectionHeader>
          {parseDomains(sections['Domains']).map((domain, i, arr) => (
            <div key={i} style={{
              paddingBottom: 12,
              marginBottom: 12,
              borderBottom: i < arr.length - 1 ? '1px solid ' + T.bg2 : 'none',
            }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: T.ink, fontFamily: F }}>
                {domain.name}
              </div>
              {domain.description && (
                <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5, fontFamily: F, marginTop: 4 }}>
                  {domain.description}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* Patterns */}
      {sections['Patterns'] && (
        <>
          <SectionHeader>Patterns</SectionHeader>
          <p style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, fontFamily: F, margin: 0 }}>
            {sections['Patterns']}
          </p>
        </>
      )}

      {/* Voice & Style */}
      {sections['Voice & Style'] && (
        <>
          <SectionHeader>Voice & Style</SectionHeader>
          <p style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, fontFamily: F, margin: 0 }}>
            {sections['Voice & Style']}
          </p>
        </>
      )}

      <button
        onClick={handleDownload}
        style={{ fontSize: 14, color: T.ink2, background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 1v8M4 6l3 3 3-3M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Download .md
      </button>

      <div style={{ fontSize: 11, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 20 }}>Private to you</div>
      <div style={{ borderTop: `0.5px solid ${T.bdr}`, margin: '0 0 4px' }} />

      {/* Curators They Subscribe To */}
      {sections['Curators They Subscribe To'] && (
        <>
          <SectionHeader>Curators They Subscribe To</SectionHeader>
          {parseSubscriptions(sections['Curators They Subscribe To']).map((handle, i) => (
            <div key={i} style={{
              fontFamily: MN,
              fontSize: 12,
              color: T.acc,
              padding: '8px 0',
              borderTop: i > 0 ? '1px solid ' + T.bg2 : 'none',
            }}>
              {handle}
            </div>
          ))}
        </>
      )}

      {/* Confirmed Observations */}
      {sections['Confirmed Observations'] && (
        <>
          <SectionHeader>Confirmed Observations</SectionHeader>
          {sections['Confirmed Observations'].split('\n').filter(l => l.trim()).map((line, i) => (
            <div key={i} style={{
              paddingLeft: 12,
              borderLeft: '2px solid ' + T.acc,
              marginBottom: 6,
            }}>
              <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.45, fontFamily: F }}>
                {line.replace(/^[>-]\s*/, '').replace(/\*\*/g, '')}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Anti-Taste */}
      {sections['Anti-Taste'] && (
        <>
          <SectionHeader>Anti-Taste</SectionHeader>
          {sections['Anti-Taste'].split('\n').filter(l => l.trim()).map((line, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%', background: '#E24B4A',
                flexShrink: 0, marginTop: 6,
              }} />
              <div style={{ fontSize: 13, color: T.ink2, fontFamily: F }}>
                {line.replace(/^[>-]\s*/, '').replace(/\*\*/g, '')}
              </div>
            </div>
          ))}
        </>
      )}

      <a
        href="/me/timeline"
        style={{ fontSize: 14, color: T.ink2, textDecoration: 'none', display: 'inline-block', marginTop: 8 }}
      >
        How this was built &rarr;
      </a>

      {/* CTA */}
      <button
        onClick={() => router.push('/myai')}
        style={{
          display: 'block',
          width: '100%',
          background: T.accSoft,
          border: '1px solid rgba(212,149,107,0.18)',
          color: T.acc,
          borderRadius: 8,
          padding: 11,
          fontSize: 13,
          fontWeight: 500,
          fontFamily: F,
          textAlign: 'center',
          cursor: 'pointer',
          marginTop: 24,
        }}
      >
        Want to refine this? Talk to your AI &rarr;
      </button>
    </div>
  )
}

function SectionHeader({ children }) {
  return (
    <div style={{
      fontFamily: S,
      fontSize: 16,
      fontWeight: 500,
      color: T.ink,
      marginTop: 24,
      marginBottom: 10,
      paddingBottom: 6,
      borderBottom: '1px solid ' + T.s,
    }}>
      {children}
    </div>
  )
}
