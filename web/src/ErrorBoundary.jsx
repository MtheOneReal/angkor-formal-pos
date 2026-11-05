import React from 'react';

// Shows a short message instead of a blank page when one screen fails.
export default class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error('Screen error:', err); } catch { /* ignore */ } }
  render() {
    if (!this.state.err) return this.props.children;
    const msg = String(this.state.err?.message || this.state.err).slice(0, 300);
    return (
      <div className="card" style={{ maxWidth: 520, margin: '24px auto', textAlign: 'center' }}>
        <h3 style={{ marginTop: 0 }}>Something went wrong on this page</h3>
        <p className="muted">Your data is safe. Tap Reload. If it happens again, send this line to Claude:</p>
        <p className="small" style={{ wordBreak: 'break-word', fontFamily: 'monospace' }}>{msg}</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
      </div>);
  }
}
