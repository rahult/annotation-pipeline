import { createContext, useContext, useEffect, useState } from 'react';
import { createInitialState } from './domain.js';
import { canonicalWorkspace } from './configurationState.js';

const STORAGE_KEY = 'tracegrade.workspace.v1';
const WorkspaceContext = createContext(null);

function loadWorkspace() {
  let serialized;
  try {
    serialized = localStorage.getItem(STORAGE_KEY);
  } catch { /* The workspace remains usable in memory if storage is unavailable. */ }
  if (!serialized) return canonicalWorkspace(createInitialState());
  const saved = JSON.parse(serialized);
  if (saved?.schemaVersion !== 1 || !saved.specs?.length || !Array.isArray(saved.traces) || !Array.isArray(saved.runs) || !Array.isArray(saved.annotations)) {
    throw new Error('The saved workspace has an unsupported structure. Export recovery data before resetting.');
  }
  // Invalid saved YAML must remain recoverable, rather than being replaced by demo data.
  return canonicalWorkspace(saved);
}

export function WorkspaceProvider({ children }) {
  const [state, setState] = useState(loadWorkspace);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveError('');
    } catch {
      setSaveError('Browser storage is full or unavailable. Changes are in memory only; export your workspace before closing.');
    }
  }, [state]);
  return <WorkspaceContext.Provider value={{ state, setState, saveError }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace provider is required.');
  return value;
}

export function clearPlaygroundDrafts() {
  try {
    Object.keys(localStorage).filter(key => key.startsWith('tracegrade.yamlDraft.v1.')).forEach(key => localStorage.removeItem(key));
  } catch { /* Nothing persisted if browser storage is unavailable. */ }
}

export function resetWorkspace() {
  clearPlaygroundDrafts();
  return canonicalWorkspace(createInitialState());
}
