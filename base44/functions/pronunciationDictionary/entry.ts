import { createClient, createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

// Bridge to LinguaGloss (linguagloss.magicalcrete.com) — Enda's SEPARATE Base44 app that
// holds the pronunciation dictionary used to steer PCV audio (PronunciationEntry:
// original_word, language_origin, ipa_notation — plus a small Language list for the
// dropdown). It is a completely different app from this one, so the only way in is its own API key, exactly
// the same "server-side only, never in the repo, never sent to the browser" pattern every
// other API key in this app already follows (see manageApiKeys/entry.ts).
//
// Set these two as SECRETS on THIS app (Explore Crete), in the Base44 editor's environment
// variables — never commit them:
//   LINGUAGLOSS_APP_ID  — LinguaGloss's own Base44 app id
//   LINGUAGLOSS_API_KEY — an API key generated from LinguaGloss's own Settings/API page
//
// Anyone already allowed to touch a tour's narration (an admin, or a narrator via their
// usual email+token) is allowed to read and write this dictionary — pronunciation checks
// happen mid-edit, right on the script, so gating this any tighter than the script itself
// would just send people back to asking an admin to look something up for them.
function linguaglossClient() {
  const appId = Deno.env.get('LINGUAGLOSS_APP_ID');
  const apiKey = Deno.env.get('LINGUAGLOSS_API_KEY');
  if (!appId || !apiKey) return null;
  return createClient({ appId, headers: { api_key: apiKey } });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action } = body || {};

    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    const linguagloss = linguaglossClient();
    if (!linguagloss) {
      return Response.json({
        error: 'The pronunciation dictionary isn’t connected yet — ask an admin to add the LinguaGloss API key in Explore Crete’s backend settings.',
      }, { status: 500 });
    }

    if (action === 'list') {
      // Both come back small (a working pronunciation dictionary is at most a few
      // hundred names, not thousands) so one full fetch each, no pagination — the
      // pop-up filters/searches client-side.
      const [entries, languages] = await Promise.all([
        linguagloss.entities.PronunciationEntry.list('original_word', 2000),
        linguagloss.entities.Language.list('name', 200),
      ]);
      return Response.json({
        entries: (entries || []).map((e) => ({
          id: e.id,
          original_word: e.original_word || '',
          language_origin: e.language_origin || '',
          ipa_notation: e.ipa_notation || '',
        })),
        languages: (languages || []).map((l) => l.name).filter(Boolean),
      });
    }

    if (action === 'create') {
      const original_word = String(body.original_word || '').trim();
      const language_origin = String(body.language_origin || '').trim();
      const ipa_notation = String(body.ipa_notation || '').trim();
      if (!original_word) {
        return Response.json({ error: 'A word or name is required.' }, { status: 400 });
      }
      if (!language_origin) {
        return Response.json({ error: 'A language is required.' }, { status: 400 });
      }
      const created = await linguagloss.entities.PronunciationEntry.create({
        original_word,
        language_origin,
        ipa_notation,
      });
      return Response.json({
        entry: {
          id: created.id,
          original_word: created.original_word || original_word,
          language_origin: created.language_origin || language_origin,
          ipa_notation: created.ipa_notation || ipa_notation,
        },
      });
    }

    if (action === 'update') {
      const id = body.id ? String(body.id) : '';
      if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });

      const updates: Record<string, string> = {};
      if (body.original_word !== undefined) {
        const v = String(body.original_word).trim();
        if (!v) return Response.json({ error: 'A word or name is required.' }, { status: 400 });
        updates.original_word = v;
      }
      if (body.language_origin !== undefined) {
        const v = String(body.language_origin).trim();
        if (!v) return Response.json({ error: 'A language is required.' }, { status: 400 });
        updates.language_origin = v;
      }
      if (body.ipa_notation !== undefined) {
        updates.ipa_notation = String(body.ipa_notation).trim();
      }
      const updated = await linguagloss.entities.PronunciationEntry.update(id, updates);
      return Response.json({
        entry: {
          id: updated.id || id,
          original_word: updated.original_word,
          language_origin: updated.language_origin,
          ipa_notation: updated.ipa_notation || '',
        },
      });
    }

    return Response.json({ error: 'action must be "list", "create", or "update"' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
