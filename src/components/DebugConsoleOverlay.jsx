import React, { useEffect, useState, useRef } from 'react';
import { Bug, X, Trash2 } from 'lucide-react';

// Temporary, on-screen stand-in for the browser's own DevTools Console — for exactly the
// situation that came up today: needing to see JS errors on a phone where getting to real
// remote debugging (USB + a manufacturer account, in this case) is more hassle than it's
// worth for a one-off diagnostic. Only ever shows up with ?debug=1 in the address bar, so
// it can never appear for a real customer by accident.
//
// Safe to leave in the codebase — it does nothing at all unless that query parameter is
// present, and it's careful not to let a bug in the debug tool itself break the real app
// (every capture is wrapped so it can never throw).
export default function DebugConsoleOverlay() {
  const [enabled] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(true);
  const [logs, setLogs] = useState([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const push = (level, args) => {
      try {
        const text = args.map(a => {
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
          return String(a);
        }).join(' ');
        setLogs(prev => [...prev, { id: idRef.current++, level, text, time: new Date().toLocaleTimeString() }].slice(-200));
      } catch {
        // Never let the debug overlay itself be the thing that breaks the page.
      }
    };

    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...args) => { push('log', args); original.log(...args); };
    console.warn = (...args) => { push('warn', args); original.warn(...args); };
    console.error = (...args) => { push('error', args); original.error(...args); };

    const onError = (e) => push('error', [`Uncaught: ${e.message}`, `(${e.filename}:${e.lineno})`]);
    const onRejection = (e) => push('error', ['Unhandled promise rejection:', e.reason]);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    push('log', ['Debug console started.']);

    return () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-4 right-4 z-[10000] w-11 h-11 rounded-full bg-slate-900 text-white shadow-lg flex items-center justify-center"
        aria-label="Toggle debug console"
      >
        <Bug className="w-5 h-5" />
        {logs.some(l => l.level === 'error') && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
        )}
      </button>

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-[9999] h-[45vh] bg-slate-950 text-slate-100 flex flex-col border-t-2 border-slate-700 shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
            <span className="text-sm font-semibold">Debug Console</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setLogs([])} className="text-slate-400 hover:text-white" aria-label="Clear">
                <Trash2 className="w-4 h-4" />
              </button>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs space-y-1">
            {logs.length === 0 && <p className="text-slate-500">No output yet.</p>}
            {logs.map(l => (
              <div
                key={l.id}
                className={
                  l.level === 'error' ? 'text-red-400' :
                  l.level === 'warn' ? 'text-amber-400' : 'text-slate-300'
                }
              >
                <span className="text-slate-600">[{l.time}]</span> {l.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
