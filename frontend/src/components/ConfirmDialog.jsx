import React, { useEffect, useId, useRef, useState } from 'react';

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const messageId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      dialog.close();
      const destination = trigger?.isConnected ? trigger : document.getElementById('main-content');
      destination?.focus({ preventScroll: true });
    };
  }, []);

  const confirm = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };

  const trapFocus = (event) => {
    if (event.key !== 'Tab') return;
    const controls = dialogRef.current.querySelectorAll('button:not(:disabled)');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={messageId} onKeyDown={trapFocus} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={confirm} aria-busy={busy}>
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{message}</p>
        {error && <p className="alert danger" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" autoFocus disabled={busy} onClick={onClose}>Keep as is</button>
          <button type="submit" className="btn btn-danger" disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
