'use client';
import { useState, useEffect, useRef } from 'react';
import { T, F } from '@/lib/constants';
import Sheet from '@/components/ui/Sheet';

export default function ValidationSheet({ rec, curator, onClose, onSuccess }) {
  const [text, setText] = useState('');
  const [sendToCurator, setSendToCurator] = useState(true);
  const [postPublicly, setPostPublicly] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const textareaRef = useRef(null);

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
      if (onSuccess) onSuccess({ ...data, verbatim_text: text.trim() });
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setError(e.message || 'Send failed. Try again.');
      setSaving(false);
    }
  };

  const curatorHandle = curator?.handle ? (curator.handle.startsWith('@') ? curator.handle : '@' + curator.handle) : '@curator';

  const footer = (
    <div style={{ display: 'flex', gap: 10 }}>
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
  );

  return (
    <Sheet
      isOpen={true}
      onClose={handleClose}
      title="Cosign this Recommendation"
      subtitle={`Tell ${curatorHandle} how it made you feel.`}
      background={T.bg}
      footer={footer}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What worked for you? Be specific. Your words go to the curator and are (optionally) posted as a comment on this recommendation."
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
          label="Posts your note as a public comment on this recommendation"
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
    </Sheet>
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
