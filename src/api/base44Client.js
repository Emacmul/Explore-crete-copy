import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { wrapClientWithRetry } from '@/lib/withEntityRetry';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
const rawClient = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

// Per Enda, quoting Base44 support: with every narrator sharing one app and one database,
// a burst of reads/writes from several people at once can genuinely hit Base44's own
// pooled rate limits — see src/lib/withEntityRetry.js for the full reasoning. Wrapping the
// client here means every entities.*/functions.invoke call anywhere in this app (every
// page, every admin tool) automatically gets a short, bounded retry on a real 429, with no
// other file needing to change.
export const base44 = wrapClientWithRetry(rawClient);
