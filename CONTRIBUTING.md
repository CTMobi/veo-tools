# Contributing to veo-tools (CTMobi fork)

This repository is a fork of [`kdowswell/veo-tools`](https://github.com/kdowswell/veo-tools). It evolves independently while keeping the door open to contribute changes back upstream.

## Repository structure

The fork uses **two long-lived branches** to separate "what upstream looks like" from "what CTMobi has built on top":

| Branch | Purpose | Modification rules |
|---|---|---|
| `main` | Default branch of the fork. Reflects CTMobi's evolved state: includes upstream changes that have been synced **plus** customizations not in upstream (yet or ever). | Only via PR for feature work, fixes, and non-trivial sync merges. The narrow exception is documented under "Bringing upstream changes into `main`": a maintainer may merge `upstream-sync` into `main` directly when the sync is clean with no conflicts and no customizations affected. |
| `upstream-sync` | Clean mirror of `kdowswell/veo-tools:main`. Never modified by hand. | Updated only via the atomic sync procedure below (`git fetch upstream main:upstream-sync --force` + force-push with lease). |

**Remotes** (standard convention):

- `origin` → `git@github.com:CTMobi/veo-tools.git` (this fork)
- `upstream` → `https://github.com/kdowswell/veo-tools.git` (original)

If a contributor has the legacy naming (`origin` pointing at kdowswell), they should re-map locally:

```bash
git remote set-url origin git@github.com:CTMobi/veo-tools.git
git remote add upstream https://github.com/kdowswell/veo-tools.git
```

## Workflows

> **Prerequisites** (all workflows): the [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated against `github.com` (`gh auth login`). The PR-creation steps below all use `gh pr create`.
>
> **Preflight for workflows that touch your working tree** (feature branches and sync-to-main; the atomic `upstream-sync` refresh in the next section is exempt because it doesn't checkout or modify any working files): start from a clean working tree (`git status` should report no modified or untracked files). Stash (`git stash -u`) or commit your local work first — the `git checkout` and `git merge` steps assume the working tree won't get contaminated. If you've been working on `main` directly (despite the rule), reconcile that first by **backing up and resetting in one step**: `git branch -f backup/local-main && git reset --hard origin/main`. The `-f` flag makes the branch creation idempotent — if `backup/local-main` already exists from an earlier recovery attempt, it's force-updated to the current `main` rather than failing. Then the reset moves `main` in place. (Avoid `git checkout -b backup/local-main` alone — it creates the backup but leaves `main` still diverged, so the subsequent `git pull --ff-only` steps will fail with the same error.)

### Syncing `upstream-sync` with upstream

Run periodically (e.g., weekly, or before starting a PR meant for upstream). We use the atomic `git fetch <remote> <src>:<dst>` form rather than `checkout + reset --hard`: it updates the local mirror branch in a single operation without touching the working tree or the currently-checked-out branch. No risk of contaminating `main` if you forgot to switch, no requirement that the working tree be clean.

```bash
# Make sure you're NOT currently on upstream-sync — git refuses to update the
# active branch via a fetch refspec. Per the policy you should never be on it,
# but if you are, switch first: e.g. `git checkout main`.
git fetch upstream main:upstream-sync --force        # atomic update of local upstream-sync from upstream/main
git fetch origin                                     # refresh remote-tracking refs so --force-with-lease sees the current state
git push --force-with-lease origin upstream-sync
```

`--force-with-lease` is required because `upstream-sync` is a mirror, not an additive branch. No work ever lives there directly, so the force push is safe by design. Two failure modes to know:

- **Push rejected by lease** — another maintainer synced concurrently. Re-run the three commands: since `git fetch upstream main:upstream-sync --force` always pulls the same upstream state, the second attempt picks up whatever the concurrent maintainer pushed and the re-run is a safe no-op for `origin/upstream-sync` content.
- **Fetch refuses "current branch"** — you're checked out on `upstream-sync`. Switch to `main` (or any other branch) and retry.

### Bringing upstream changes into `main`

After `upstream-sync` is refreshed, merge it into `main` **via a PR** (consistent with the "Never push directly to `main`" rule). Use a `sync/<date>` branch as the PR head — this keeps the merge auditable and lets reviewers see how customizations reconcile with upstream changes:

```bash
SYNC_DATE=$(date +%Y-%m-%d)                          # captured once to avoid date drift across commands

git fetch origin                                     # refreshes origin/upstream-sync remote-tracking branch
git checkout main
git pull --ff-only origin main                       # if this fails, your local main diverged — see "If main has diverged" below
git checkout -B sync/$SYNC_DATE                      # `-B` overwrites the local branch on retry. If sync/<date> was
                                                     # already pushed earlier (a prior attempt was pushed but the merge
                                                     # needs redoing), the subsequent git push will need
                                                     # --force-with-lease since the remote ref has moved.
git merge --no-edit origin/upstream-sync             # --no-edit skips opening the editor for the merge commit message
# If conflicts: edit files, then `git add <resolved-files>` and `git merge --continue`
# (or `git rebase --continue` if you rebased). Confirm `git status` shows a clean
# state with no in-progress merge before pushing.
git push -u --force-with-lease origin sync/$SYNC_DATE  # --force-with-lease is a no-op on first push but lets same-day retries succeed (the `-B` above can have moved the local ref past what's on origin)
gh pr create --repo CTMobi/veo-tools --base main          # interactive: gh prompts for title and body so you can
                                                            # write a real summary of which upstream changes landed and
                                                            # how customizations reconciled. Don't pass --fill here:
                                                            # --fill auto-publishes using the last commit message
                                                            # (often a terse "Merge origin/upstream-sync" merge commit),
                                                            # leaving reviewers with no useful context.
```

**If `main` has diverged** (the `--ff-only` fails because you have commits on local `main` that aren't on `origin/main`): you've broken the "never push to main" rule, but recovery is straightforward. Confirm you have no irreplaceable uncommitted work, then reset: `git checkout main && git reset --hard origin/main`. If those local commits represent real work, save them in one step with `git checkout main && git branch -f recovery/local-main && git reset --hard origin/main` (the explicit `checkout main` first guards against the case where the user is sitting on a feature branch — without it, `git reset --hard origin/main` would silently rewrite the current branch instead of `main`; `git branch -f` creates or force-updates the backup ref idempotently across retries, consistent with the Preflight block's warning against `git checkout -b` alone), then port them via a normal feature PR.

For a trivial sync with no conflicts and no customizations affected, the maintainer may merge directly. This is the workflow that bypasses the PR rule, so it deserves the same multi-line presentation as the safer paths:

```bash
# Direct merge — only when: no conflicts, no customizations affected, truly nothing to review.
# The PR path is the default. If in doubt, use the PR workflow above.
git checkout main
git pull --ff-only origin main             # fast-fails if local main diverged — see "If main has diverged" above
git fetch origin                           # refreshes origin/upstream-sync (the pull only fetches main)
git merge --no-edit origin/upstream-sync   # --no-edit skips the editor; merge from the remote-tracking ref
git push origin main
```

Note this is **not** a fast-forward in the strict git sense — once `main` has any customization (including this `CONTRIBUTING.md`), `main` diverges from `upstream/main` and `git merge --ff-only` would fail. We just mean "merge without conflicts or PR". The final `git push origin main` may also be blocked if branch protection rules are configured on GitHub (e.g., "require pull request before merging") — maintainers without bypass permissions must use the PR workflow above instead.

The choice between `merge` and `rebase` inside the sync branch is a team policy decision. Default for this repo: **merge** (preserves history, makes upstream provenance visible). Switch to rebase only with team agreement.

### Feature branches — base from `main` (fork-internal work)

For changes that live in CTMobi's fork (customizations, internal tools, experiments, work that may not be upstreamable):

```bash
git checkout main
git pull --ff-only origin main                # --ff-only fast-fails if local main has diverged, prompting recovery
git checkout -b feat/<short-name>
# ... commits ...
git push -u origin feat/<short-name>
gh pr create --repo CTMobi/veo-tools --base main
```

### Feature branches — base from `upstream-sync` (PRs intended for upstream)

For changes you want to propose to `kdowswell/veo-tools`, branch from `upstream-sync` so the diff is clean (no CTMobi-only customizations bleeding into the upstream PR):

```bash
git fetch origin                                          # refreshes origin/upstream-sync
git checkout -b upstream/<short-name> origin/upstream-sync   # branch directly from the remote-tracking ref — no need to reset a local mirror first
# ... commits ...
git push -u origin upstream/<short-name>
gh pr create --repo kdowswell/veo-tools --base main --head CTMobi:upstream/<short-name>
```

If upstream **merges** the PR, the change flows back into our fork via the normal sync cycle: `upstream-sync` picks it up on its next refresh, then `main` merges from `upstream-sync`.

If upstream **declines** the PR, the change does *not* land in `upstream/main`, so it won't flow back through the sync cycle — cherry-pick the relevant commits into a fork-internal feature branch instead:

```bash
git checkout main
git pull --ff-only origin main                # start the fork branch from current origin/main, not stale local
git checkout -b feat/<short-name>-fork
git cherry-pick <commit-sha>                  # one or more commit SHAs, space-separated
git push -u origin feat/<short-name>-fork
gh pr create --repo CTMobi/veo-tools --base main
```

## Branch naming

- `feat/<name>` — fork-internal new feature (base: `main`)
- `fix/<name>` — fork-internal bugfix (base: `main`)
- `chore/<name>` — fork-internal maintenance/docs (base: `main`)
- `upstream/<name>` — change proposed to upstream (base: `upstream-sync`)
- `sync/<date>` — periodic sync PRs from `upstream-sync` into `main` when the merge is non-trivial and deserves review

## Pull request rules

- **Never push directly to `main` for feature work, fixes, or non-trivial syncs**. Always go through a PR. The narrow exception is the trivial conflict-free sync merge documented above ("Bringing upstream changes into `main`") — and even there, a PR is preferred for visibility.
- **`upstream-sync` is exempt from the PR rule** because it's a mirror, not a working branch. It is refreshed via the documented atomic sync procedure (`git fetch upstream main:upstream-sync --force && git fetch origin && git push --force-with-lease origin upstream-sync`). No PR, no code review for the reset itself — there's nothing reviewable about replicating upstream verbatim.
- **`main` sync PRs**: when `upstream-sync` is merged into `main`, do it via a PR (e.g., `sync/<date>` branch) — especially if the merge has conflicts that resolved against customizations. Trivial conflict-free merges may be done directly by a maintainer, but a PR is preferred for visibility.
- **`main` feature PRs**: regular review process. CI must pass. At least one approver other than the author when the team has more than one active contributor.
- **Upstream PRs**: follow `kdowswell/veo-tools` contribution rules; reference the corresponding CTMobi PR (if any) in the description so the team can track the cross-repo state.

## Decision: where does a change go?

Single decision tree — read top to bottom, stop at the first match:

```text
Is the change intended to be fork-specific (not appropriate for upstream)?
├── Yes → base from main, PR to CTMobi. Not relevant to upstream.
│         (Examples: CONTRIBUTING.md, internal scripts, CTMobi-only branding,
│         or new files explicitly scoped to the fork)
│
└── No → continue to the next question.

Is the change something kdowswell would likely accept?
├── No → base from main, PR to CTMobi. The change lives in the fork.
│
├── Yes, and we don't need it urgently in our fork
│       → base from upstream-sync, PR to kdowswell. The change returns to our main
│         through the normal sync cycle once kdowswell merges it.
│
└── Yes, but we need it in our fork now (e.g., a security fix, or a feature blocking
    internal work)
        → open BOTH PRs in parallel: one from upstream-sync to kdowswell, one
          equivalent from main to CTMobi. When upstream merges, the next sync
          either merges cleanly (if the change has no overlap with what landed) or
          produces a conflict to resolve in the sync PR.
```

When in doubt, base from `main` and PR to CTMobi — it's the safer default. Promoting a fork-internal commit to an upstream PR later is straightforward: create a new branch from `upstream-sync` and cherry-pick the commit onto it.

## Release documentation

Release information lives at three levels, each with a distinct audience. Keep the detail in one place to avoid drift:

| File | Audience | Content |
|---|---|---|
| `CHANGELOG.md` | Anyone reading the diff | Technical log, [Keep a Changelog](https://keepachangelog.com/) format (`BREAKING` / `Added` / `Changed` / `Removed`). |
| `docs/releases/X.Y.Z.md` | Anyone upgrading to that version | Full user-facing notes: breaking changes, migration guide, new features, known limitations. One file per version. |
| `RELEASE_NOTES.md` (root) | Anyone browsing the repo | Newest-first **index**: a short summary + breaking-changes + highlights per version, each linking to its `docs/releases/X.Y.Z.md`. Summary only — never duplicate the detail. |

### Cutting a release `X.Y.Z`

1. Update `CHANGELOG.md` (`## [X.Y.Z] — <date>` with `BREAKING`/`Added`/`Changed`/`Removed`).
2. Write `docs/releases/X.Y.Z.md` (full user-facing notes + migration guide).
3. Prepend a summary entry to `RELEASE_NOTES.md` linking to the new `docs/releases/X.Y.Z.md`.
4. Bump `.claude-plugin/plugin.json` `version` (and `package.json`) — MAJOR for any incompatible API change (SemVer §8).
5. After merge, tag and publish from the per-version file:
   ```bash
   gh release create vX.Y.Z --notes-file docs/releases/X.Y.Z.md
   ```

Use the same date in `CHANGELOG.md`, the `docs/releases/` file, and the tag.
