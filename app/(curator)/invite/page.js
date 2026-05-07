'use client'

import { useState, useEffect, useContext } from 'react'
import { T, F, S, MN, MAX_UNUSED_INVITES } from '@/lib/constants'
import { CuratorContext } from '@/context/CuratorContext'
import SegmentedControl from '@/components/ui/SegmentedControl'

const PAGE_SIZE = 10

const emptyTab = { rows: [], hasMore: false, loaded: false, loading: false }

function formatRelative(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;opacity:0;left:-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

export default function InvitePage() {
  const { profileId } = useContext(CuratorContext)
  const [activeTab, setActiveTab] = useState('used')
  const [pending, setPending] = useState(emptyTab)
  const [used, setUsed] = useState(emptyTab)
  const [counts, setCounts] = useState({ pending: 0, used: 0 })
  const [unlimitedInvites, setUnlimitedInvites] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [shareToast, setShareToast] = useState(null)
  const [revokingId, setRevokingId] = useState(null)
  const [generating, setGenerating] = useState(false)

  async function fetchPage(status, offset) {
    const url = `/api/invite?profileId=${profileId}&mode=all&status=${status}&limit=${PAGE_SIZE}&offset=${offset}`
    const res = await fetch(url)
    return res.json()
  }

  async function loadFirstPage(status) {
    if (!profileId) return
    const setter = status === 'pending' ? setPending : setUsed
    setter(prev => ({ ...prev, loading: true }))
    try {
      const data = await fetchPage(status, 0)
      if (data?.error) throw new Error(data.error)
      setter({
        rows: data.rows || [],
        hasMore: !!data.hasMore,
        loaded: true,
        loading: false,
      })
      setCounts(data.counts || { pending: 0, used: 0 })
      setUnlimitedInvites(!!data.unlimitedInvites)
    } catch (err) {
      console.error('[INVITE_FETCH_ERROR]', err)
      setter(prev => ({ ...prev, loading: false, loaded: true }))
    }
  }

  async function loadMore(status) {
    if (!profileId) return
    const current = status === 'pending' ? pending : used
    const setter = status === 'pending' ? setPending : setUsed
    setter(prev => ({ ...prev, loading: true }))
    try {
      const data = await fetchPage(status, current.rows.length)
      if (data?.error) throw new Error(data.error)
      setter(prev => ({
        rows: [...prev.rows, ...(data.rows || [])],
        hasMore: !!data.hasMore,
        loaded: true,
        loading: false,
      }))
      if (data.counts) setCounts(data.counts)
    } catch (err) {
      console.error('[INVITE_FETCH_ERROR]', err)
      setter(prev => ({ ...prev, loading: false }))
    }
  }

  useEffect(() => {
    if (!profileId) return
    loadFirstPage('used')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  const onTabChange = (id) => {
    setActiveTab(id)
    setExpandedId(null)
    setEditingNoteId(null)
    const tab = id === 'pending' ? pending : used
    if (!tab.loaded && !tab.loading) loadFirstPage(id)
  }

  const toggleExpand = (id) => {
    if (expandedId === id) {
      setExpandedId(null)
      setEditingNoteId(null)
    } else {
      setExpandedId(id)
      setEditingNoteId(null)
    }
  }

  const generate = async () => {
    if (!profileId) return
    setGenerating(true)
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, action: 'generate' }),
      })
      const data = await res.json()
      if (data?.code) {
        setActiveTab('pending')
        await loadFirstPage('pending')
        setExpandedId(data.code.id)
      }
    } catch (err) {
      console.error('[INVITE_GENERATE_ERROR]', err)
    }
    setGenerating(false)
  }

  const revoke = async (codeId) => {
    if (!profileId || !codeId) return
    setRevokingId(codeId)
    try {
      const res = await fetch('/api/invite', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, codeId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'revoke_failed')
      setPending(prev => ({
        ...prev,
        rows: prev.rows.filter(r => r.id !== codeId),
      }))
      setCounts(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1) }))
      if (expandedId === codeId) setExpandedId(null)
    } catch (err) {
      console.error('[INVITE_REVOKE_ERROR]', err)
    }
    setRevokingId(null)
  }

  const saveNote = async (codeId) => {
    try {
      await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeId, inviterNote: noteText.trim() }),
      })
      setPending(prev => ({
        ...prev,
        rows: prev.rows.map(r => r.id === codeId ? { ...r, inviter_note: noteText.trim() } : r),
      }))
      setEditingNoteId(null)
    } catch (err) {
      console.error('[INVITE_NOTE_SAVE_ERROR]', err)
    }
  }

  const copy = (text, id) => {
    copyToClipboard(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const share = (code, id) => {
    const msg = `Join me on curators.ai with this exclusive invite code: ${code}`
    if (navigator.share) {
      navigator.share({ text: msg }).catch(() => {})
    } else {
      copyToClipboard(msg)
      setShareToast(id)
      setTimeout(() => setShareToast(null), 2500)
    }
  }

  const limitReached = !unlimitedInvites && counts.pending >= MAX_UNUSED_INVITES
  const tab = activeTab === 'pending' ? pending : used

  // ── Sticky header ──
  const headerNode = (
    <div style={{
      position: 'sticky', top: 0, zIndex: 1,
      background: T.bg, paddingTop: 24, paddingBottom: 12,
      borderBottom: `1px solid ${T.bdr}`,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ fontFamily: S, fontSize: 26, color: T.ink, fontWeight: 400, margin: 0 }}>Invites</h1>
        <button
          onClick={generate}
          disabled={generating || limitReached}
          style={{
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: limitReached ? T.s : T.acc,
            color: limitReached ? T.ink3 : T.accText,
            fontFamily: F, fontSize: 13, fontWeight: 600,
            cursor: (generating || limitReached) ? 'default' : 'pointer',
            opacity: generating ? 0.6 : 1,
          }}
        >
          {generating ? 'Generating...' : '+ Generate'}
        </button>
      </div>
      <div style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>
        {counts.pending} pending · {counts.used} used
        {!unlimitedInvites && ` · ${counts.pending}/${MAX_UNUSED_INVITES} slots`}
      </div>
    </div>
  )

  // ── Pending row ──
  const renderPendingRow = (row) => {
    const expanded = expandedId === row.id
    const editing = editingNoteId === row.id
    return (
      <div key={row.id} style={{
        borderRadius: 10, background: T.s, border: `1px solid ${T.bdr}`,
        marginBottom: 6, overflow: 'hidden',
      }}>
        <div
          onClick={() => toggleExpand(row.id)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, padding: '10px 14px', cursor: 'pointer',
          }}
        >
          <div style={{
            fontFamily: MN, fontSize: 14, fontWeight: 600, color: T.ink, letterSpacing: '.04em',
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {row.code}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontFamily: F, fontSize: 11, color: T.ink3 }}>{formatRelative(row.created_at)}</span>
            <span style={{ color: T.ink3, fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
          </div>
        </div>
        {expanded && (
          <div style={{ padding: '10px 14px 12px', borderTop: `1px solid ${T.bdr}` }}>
            {!editing && row.inviter_note && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 10 }}>
                <span style={{ flex: 1, fontFamily: F, fontSize: 12, color: T.ink2, fontStyle: 'italic', lineHeight: 1.4 }}>
                  "{row.inviter_note}"
                </span>
                <button onClick={() => { setEditingNoteId(row.id); setNoteText(row.inviter_note || '') }} style={{
                  background: 'none', border: 'none', color: T.ink3, fontSize: 11, cursor: 'pointer', fontFamily: F, padding: 0,
                }}>Edit</button>
              </div>
            )}
            {!editing && !row.inviter_note && (
              <button onClick={() => { setEditingNoteId(row.id); setNoteText('') }} style={{
                background: 'none', border: 'none', color: T.ink3, fontSize: 11, cursor: 'pointer', fontFamily: F,
                padding: '0 0 10px',
              }}>+ Add note</button>
            )}
            {editing && (
              <div style={{ marginBottom: 10 }}>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="What makes them a great curator?"
                  rows={2}
                  autoFocus
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 6,
                    border: `1.5px solid ${T.bdr}`, fontSize: 12, fontFamily: F,
                    outline: 'none', resize: 'none', background: T.bg, color: T.ink,
                    lineHeight: 1.4, boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button onClick={() => saveNote(row.id)} style={{
                    padding: '5px 10px', borderRadius: 6, border: 'none',
                    background: T.acc, color: T.accText, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: F,
                  }}>Save</button>
                  <button onClick={() => setEditingNoteId(null)} style={{
                    padding: '5px 10px', borderRadius: 6, border: `1px solid ${T.bdr}`,
                    background: 'transparent', color: T.ink3, fontSize: 11, cursor: 'pointer', fontFamily: F,
                  }}>Cancel</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => copy(row.code, row.id)} style={{
                padding: '6px 12px', borderRadius: 6, border: `1px solid ${T.bdr}`,
                background: copiedId === row.id ? T.accSoft : T.bg,
                color: copiedId === row.id ? T.acc : T.ink2,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: F,
              }}>{copiedId === row.id ? '✓ Copied' : 'Copy'}</button>
              <button onClick={() => share(row.code, row.id)} style={{
                padding: '6px 12px', borderRadius: 6, border: `1px solid ${T.bdr}`,
                background: T.bg, color: T.ink2,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: F,
              }}>Share</button>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => revoke(row.id)}
                disabled={revokingId === row.id}
                style={{
                  padding: '6px 12px', borderRadius: 6, border: '1px solid #E85C5C40',
                  background: 'transparent', color: '#E85C5C',
                  fontSize: 11, fontWeight: 600, cursor: revokingId === row.id ? 'default' : 'pointer',
                  fontFamily: F, opacity: revokingId === row.id ? 0.6 : 1,
                }}
              >
                {revokingId === row.id ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
            {shareToast === row.id && (
              <div style={{ marginTop: 6, fontFamily: F, fontSize: 11, color: T.acc, fontWeight: 500 }}>
                ✓ Message copied — paste it anywhere to share.
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Used row ──
  const renderUsedRow = (row) => {
    const expanded = expandedId === row.id
    const handle = row.profile_handle ? `@${row.profile_handle.replace('@', '')}` : null
    return (
      <div key={row.id} style={{
        borderRadius: 10, background: T.s, border: `1px solid ${T.bdr}`,
        marginBottom: 6, overflow: 'hidden',
      }}>
        <div
          onClick={() => toggleExpand(row.id)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, padding: '10px 14px', cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: MN, fontSize: 13, color: T.ink3, letterSpacing: '.04em', flexShrink: 0,
            }}>
              {row.code}
            </div>
            {handle && (
              <div style={{
                fontFamily: F, fontSize: 12, color: T.ink2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {handle}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontFamily: F, fontSize: 11, color: T.ink3 }}>{formatRelative(row.used_at)}</span>
            <span style={{ color: T.ink3, fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
          </div>
        </div>
        {expanded && (
          <div style={{ padding: '10px 14px 12px', borderTop: `1px solid ${T.bdr}` }}>
            {row.profile_name && (
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink, marginBottom: 4 }}>
                {row.profile_name}{handle ? ` (${handle})` : ''}
              </div>
            )}
            {row.inviter_note && (
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink2, fontStyle: 'italic', lineHeight: 1.4, marginBottom: 4 }}>
                "{row.inviter_note}"
              </div>
            )}
            <div style={{ fontFamily: F, fontSize: 11, color: T.ink3 }}>
              Joined {new Date(row.used_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
            </div>
          </div>
        )}
      </div>
    )
  }

  const showLoading = !tab.loaded && tab.loading
  const showEmpty = tab.loaded && tab.rows.length === 0
  const emptyText = activeTab === 'pending'
    ? 'No pending invite codes. Generate one above.'
    : 'No one has used your invites yet.'

  return (
    <div style={{ flex: 1, overflow: 'auto', background: T.bg }}>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 16px 80px' }}>
        {headerNode}

        <SegmentedControl
          options={[
            { id: 'used', label: 'Used' },
            { id: 'pending', label: 'Pending' },
          ]}
          active={activeTab}
          onChange={onTabChange}
          style={{ marginBottom: 16 }}
        />

        {showLoading && (
          <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: F, fontSize: 13, color: T.ink3 }}>
            Loading...
          </div>
        )}

        {showEmpty && (
          <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: F, fontSize: 13, color: T.ink3 }}>
            {emptyText}
          </div>
        )}

        {!showLoading && !showEmpty && tab.rows.map(row =>
          activeTab === 'pending' ? renderPendingRow(row) : renderUsedRow(row)
        )}

        {tab.hasMore && (
          <button
            onClick={() => loadMore(activeTab)}
            disabled={tab.loading}
            style={{
              width: '100%', padding: '10px', borderRadius: 8,
              border: `1px solid ${T.bdr}`, background: 'transparent',
              color: T.ink3, fontSize: 12, cursor: tab.loading ? 'default' : 'pointer',
              fontFamily: F, marginTop: 8, opacity: tab.loading ? 0.6 : 1,
            }}
          >
            {tab.loading ? 'Loading...' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}
