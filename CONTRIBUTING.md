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
> **Preflight for workflows that touch your working tree** (feature branches and sync-to-main; the atomic `upstream-sync` refresh in the next section is exempt because it doesn't checkout or modify any working files): start from a clean working tree (`git status` should report no modified or untracked files). Stash (`git stash -u`) or commit your local work first — the `git checkout` and `git merge` steps assume the working tree won't get contaminated. If you've been working on `main` directly (despite the rule), reconcile that first: either reset (`git checkout main && git reset --hard origin/main` after backing up your work) or branch it off (`git checkout -b backup/local-main`).

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
git checkout -B sync/$SYNC_DATE                      # `-B` so a retry on the same day overwrites the previous attempt
git merge origin/upstream-sync                       # merge the remote-tracking branch directly, no local checkout needed
# If conflicts: edit files, then `git add <resolved-files>` and `git merge --continue`
# (or `git rebase --continue` if you rebased). Confirm `git status` shows a clean
# state with no in-progress merge before pushing.
git push -u origin sync/$SYNC_DATE
gh pr create --repo CTMobi/veo-tools --base main --fill   # then edit the auto-filled title/body before publishing —
                                                            # --fill takes them from the last commit (often a merge commit
                                                            # like "Merge origin/upstream-sync") which is terse for reviewers
```

**If `main` has diverged** (the `--ff-only` fails because you have commits on local `main` that aren't on `origin/main`): you've broken the "never push to main" rule, but recovery is straightforward. Confirm you have no irreplaceable uncommitted work, then reset: `git checkout main && git reset --hard origin/main`. If those local commits represent real work, branch them off first (`git checkout -b recovery/local-main`) before resetting, then port them via a normal feature PR.

For a trivial sync with no conflicts and no customizations affected, the maintainer may merge directly with an explicit branch switch and a pull-first to stay consistent with the other workflows: `git checkout main && git pull --ff-only origin main && git fetch origin && git merge origin/upstream-sync && git push origin main`. The `git pull` refreshes `main`; `git fetch origin` refreshes `origin/upstream-sync` (the pull only fetches `main`, so without this step the merge could pick up a stale mirror state). Merging `origin/upstream-sync` (rather than the local `upstream-sync` ref) ensures the merge takes the latest state pushed to the remote mirror. Note this is **not** a fast-forward in the strict git sense — once `main` has any customization (including this `CONTRIBUTING.md`), `main` diverges from `upstream/main` and `git merge --ff-only` would fail. We just mean "merge without conflicts or PR". The PR path is the default; the direct merge is the documented exception when there's literally nothing to review.

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

```
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
          deduplicates the commit (or we resolve the conflict in the sync PR).
```

When in doubt, base from `main` and PR to CTMobi — it's the safer default. Promoting a fork-internal commit to an upstream PR later is straightforward: create a new branch from `upstream-sync` and cherry-pick the commit onto it.
