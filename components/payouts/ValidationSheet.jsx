'use client';
import { useState, useEffect, useRef } from 'react';
import { T, F, S } from '@/lib/constants';

export default function ValidationSheet({ rec, curator, onClose, onSuccess }) {
  const [text, setText] = useState('');
  const [sendToCurator, setSendToCurator] = useState(true);
  const [postPublicly, setPostPublicly] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, []);

  const handleClose = () => {
    if (text.trim() && !done && !saving) {
      if (!confirm('Discard your note?')) return;
    }
    onClose();
  };

  const handleSubmit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/validations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rec_id: rec.id,
          verbatim_text: text.trim(),
          sent_to_curator: sendToCurator,
          posted_publicly: postPublicly,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setDone(true);
      if (onSuccess) onSuccess(data);
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setError(e.message || 'Send failed. Try again.');
      setSaving(false);
    }
  };

  const curatorHandle = curator?.handle ? (curator.handle.startsWith('@') ? curator.handle : '@' + curator.handle) : '@curator';

  const backdropStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999,
  };

  const sheetStyle = isDesktop
    ? {
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 480, maxWidth: '92vw', maxHeight: '80vh',
        background: T.bg, borderRadius: 16,
        border: '1px solid ' + T.bdr,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        zIndex: 1000, display: 'flex', flexDirection: 'column',
        fontFamily: F,
      }
    : {
        position: 'fixed', bottom: 0, left: 0, right: 0,
        maxHeight: '92dvh',
        background: T.bg, borderRadius: '16px 16px 0 0',
        border: '1px solid ' + T.bdr, borderBottom: 'none',
        zIndex: 1000, display: 'flex', flexDirection: 'column',
        fontFamily: F,
      };

  return (
    <>
      <div style={backdropStyle} onClick={handleClose} />
      <div style={sheetStyle}>
        <div style={{ padding: '20px 22px 12px', borderBottom: '1px solid ' + T.bdr }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontFamily: S, fontSize: 22, fontWeight: 500, color: T.ink, lineHeight: 1.2 }}>
                Validate this Rec
              </div>
              <div style={{ fontSize: 13, color: T.ink2, marginTop: 4 }}>
                Tell {curatorHandle} what worked.
              </div>
            </div>
            <button onClick={handleClose} style={{
              background: 'none', border: 'none', color: T.ink3, fontSize: 22,
              cursor: 'pointer', padding: 0, lineHeight: 1, fontFamily: F,
            }}>×</button>
          </div>
        </div>

        <div style={{ padding: '16px 22px', overflowY: 'auto', flex: 1 }}>
          <div style={{
            padding: '12px 14px', background: T.s, borderRadius: 10,
            border: '1px solid ' + T.bdr, marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, color: T.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4, fontWeight: 700 }}>
              Rec by {curatorHandle}
            </div>
            <div style={{ fontSize: 14, color: T.ink, fontWeight: 500 }}>
              {rec?.title || 'Recommendation'}
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What landed? Be specific. Your words go to the curator and on the rec."
            disabled={saving || done}
            rows={5}
            style={{
              width: '100%', padding: '12px 14px', fontFamily: F,
              fontSize: 15, lineHeight: 1.5, color: T.ink,
              background: T.s, border: '1.5px solid ' + T.bdr,
              borderRadius: 10, outline: 'none', resize: 'none',
              boxSizing: 'border-box',
            }}
          />

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ToggleRow
              checked={true}
              disabled
              label={`Allocates part of your subscription to ${curatorHandle} this month`}
            />
            <ToggleRow
              checked={sendToCurator}
              onChange={setSendToCurator}
              label={`Sends your note to ${curatorHandle} privately`}
            />
            <ToggleRow
              checked={postPublicly}
              onChange={setPostPublicly}
              label="Posts your note as a public comment on this rec"
            />
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#3a1a1a', color: '#f99', borderRadius: 8, fontSize: 13 }}>
              {error}
            </div>
          )}
          {done && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: T.s, color: T.acc, borderRadius: 8, fontSize: 13 }}>
              Sent to {curatorHandle}.
            </div>
          )}
        </div>

        <div style={{ padding: '12px 22px 18px', borderTop: '1px solid ' + T.bdr, display: 'flex', gap: 10 }}>
          <button
            onClick={handleClose}
            disabled={saving}
            style={{
              flex: 1, padding: '12px', fontFamily: F, fontSize: 14, fontWeight: 600,
              background: 'none', color: T.ink2, border: '1px solid ' + T.bdr,
              borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || saving || done}
            style={{
              flex: 2, padding: '12px', fontFamily: F, fontSize: 14, fontWeight: 600,
              background: text.trim() && !saving && !done ? T.acc : T.s2,
              color: text.trim() && !saving && !done ? T.accText : T.ink3,
              border: 'none', borderRadius: 10,
              cursor: !text.trim() || saving || done ? 'not-allowed' : 'pointer',
            }}
          >{saving ? 'Sending...' : done ? 'Sent' : 'Send'}</button>
        </div>
      </div>
    </>
  );
}

function ToggleRow({ checked, onChange, label, disabled }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', background: T.s, border: '1px solid ' + T.bdr,
      borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.7 : 1,
    }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: T.acc, cursor: disabled ? 'default' : 'pointer' }}
      />
      <span style={{ fontSize: 13, color: T.ink, lineHeight: 1.4 }}>{label}</span>
    </label>
  );
}
