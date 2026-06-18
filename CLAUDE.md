# CLAUDE.md

Operational pointers for agents working in this repo. Keep this file short — process detail lives in `CONTRIBUTING.md`.

- **Contribution & fork workflow** (branching, `main` vs `upstream-sync`, where a change goes): see [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Release process** (CHANGELOG + `docs/releases/X.Y.Z.md` + `RELEASE_NOTES.md` index, version bump, `gh release create`): see the "Release documentation" section of [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Before every commit**: run `npm test` and `npx tsc --noEmit` and confirm both are green. Do not commit or push on a red gate.
- **Shared library** lives in `skills/_shared/veo-core/` (imported via the `@veo-core/*` alias). CLI entry scripts are thin wrappers; the first executable line is the `bootstrap` require.
