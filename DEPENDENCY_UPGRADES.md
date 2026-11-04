# Dependency upgrades — standing rule (read this before answering any "should I upgrade X?" question)

Kept as its own file rather than an entry in `CLAUDE_CHANGELOG.md` because that file has
grown past the platform's editable-size limit (17k+ lines), so new entries can no longer be
appended to it. This file is the live record for package/tooling security work.

## STANDING RULE — dependency advisories are ours to fix, not Enda's to track

Enda's instruction (2026-11-04): *"if it doesn't break stuff and it doesn't cost anything,
why not"* — plus, explicitly: **don't make him remember to revisit an upgrade; do it when
it's safe.**

So, whenever a security review or `npm audit` reports an advisory:

1. Check whether a fixed version is published (`npm view <pkg> version`).
2. Upgrade it yourself. **Do not** hand Enda a "which one do you want?" choice on a plain
   version bump — these packages are free and the decision is technical, not his.
3. **Prove it**: `npm run build` must exit 0 (roll back immediately if it doesn't), and
   after any install confirm `package.json` and `node_modules` agree — a failed platform
   install can leave `node_modules` newer than the manifest, after which the app builds
   with the wrong toolchain.
4. Report the outcome in one line, and state plainly whether a backend redeploy is needed.

## Hard-won constraint: `vite` and `@vitejs/plugin-react` move as a PAIR

The React plugin's `peerDependencies` is what actually blocks a vite major. On 2026-11-04
upgrading vite alone to 8 failed (`npm ERESOLVE`) because `@vitejs/plugin-react` 4.7.0 caps
its peer range at vite ^7. Fix: move the plugin too. Check first with
`npm view @vitejs/plugin-react peerDependencies`. `@base44/vite-plugin` declares no vite
peer range.

## Current state (verified working, `npm run build` exits 0)

| Package | Version | Why |
| --- | --- | --- |
| `vite` | ^8.3.5 | Clears all outstanding vite advisories (fixed by 8.3.3 / 8.0.16 / 8.0.5) |
| `@vitejs/plugin-react` | ^6.2.1 | Needed for vite 8 — peer is exactly `^8.0.0`. Its extra peers (`oxc-transform-react`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler`) are all OPTIONAL |
| `zod` | ^4.6.7 | Clears the high finding (fixed in 4.6.6). Nothing in `src/` or `base44/` imports zod, and no `@hookform/resolvers`/`zodResolver` usage exists, so it is transitive only |

Verified on 2026-11-04: `vite build` exits 0, `dist/index.html` plus fresh hashed
`dist/assets` bundles are produced, the platform dev server restarts cleanly, and
`bumpSwVersion()` in `vite.config.js` still fires (it uses only the plain `buildStart` hook,
which vite 8 keeps).

## Re-checking later

Re-run this check periodically — if any of these go stale by more than one major, it is
worth a look rather than a guess: `npm view vite version`,
`npm view @vitejs/plugin-react peerDependencies`, `npm view zod version`, `npm audit`.

No backend function was touched by the upgrade work itself. The separate review fixes
(`saveAppUserAdmin` password gating, `generateTts` key encoding, `getWalkCatalog` log
dedupe) still need their own manual per-function redeploy.