import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { WorkspaceProvider, clearPlaygroundDrafts } from './store.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <main className="fatal-error"><h1>Tracegrade couldn’t load this workspace.</h1><p>Your saved data is still in this browser. Reload to try again, or export the stored data before resetting it.</p><div className="inline"><button className="button primary" onClick={() => window.location.reload()}>Reload workspace</button><button className="button secondary" onClick={() => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([localStorage.getItem('tracegrade.workspace.v1') || '{}'], { type: 'application/json' })); link.download = 'tracegrade-recovery.json'; link.click(); }}>Export recovery data</button><button className="button secondary" onClick={() => { if (window.confirm('Remove saved workspace data and restore the sample workspace?')) { localStorage.removeItem('tracegrade.workspace.v1'); clearPlaygroundDrafts(); window.location.reload(); } }}>Reset workspace</button></div><details><summary>Error details</summary><pre>{this.state.error.message}</pre></details></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><WorkspaceProvider><App /></WorkspaceProvider></ErrorBoundary></React.StrictMode>);
