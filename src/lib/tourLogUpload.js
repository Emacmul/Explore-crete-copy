/**
 * Test-drive log upload - ADMIN DRAFT PREVIEW ONLY.
 *
 * Per Enda (2026-09-20, BOR3 road test): while he drives a draft tour he cannot open the Audit Log
 * and export it. So during an admin's draft-tour test drive the log is saved to the server by
 * itself, a few seconds apart, and can be read afterwards. The server (saveTourTestLog) accepts it
 * ONLY from a genuine admin login. Nothing is ever sent for a customer or for a published tour:
 * DrivingTourPlayer starts this only when walk._is_draft_preview is true.
 *
 * Failures are silent and never affect the tour.
 */
import { base44 } from '@/api/base44Client';
import * as tourLogService from '@/lib/tourLogService';

const TOKEN_KEY = 'explore_crete_token';
const INTERVAL_MS = 15000;

export function startTestLogUpload(walk) {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let lastCount = -1;
  let busy = false;

  const flush = async () => {
    if (busy) return;
    const count = tourLogService.getEntryCount();
    if (count === lastCount) return;
    let token = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch { /* no storage */ }
    if (!token) return;
    busy = true;
    try {
      await base44.functions.invoke('saveTourTestLog', {
        token,
        sessionId,
        walkId: walk.id,
        walkName: walk.name,
        entryCount: count,
        logText: tourLogService.exportLogForUpload(),
      });
      lastCount = count;
    } catch {
      /* try again at the next tick - never bother the driver */
    }
    busy = false;
  };

  const timer = setInterval(flush, INTERVAL_MS);
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  flush();

  return function stop() {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
    return flush();
  };
}
