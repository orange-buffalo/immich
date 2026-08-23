# orange-buffalo fork of Immich

This fork exists to build and publish an Immich server image under our own
ownership, so `orange-buffalo-cloud` can deploy a build we control instead of
pulling `ghcr.io/immich-app/immich-server` directly.

**This file is the ledger of every deviation from upstream.** Keep it accurate:
it is what makes a version bump a mechanical operation instead of an
archaeology exercise.

## Branch model

| Branch           | Contents                                                       |
| ---------------- | -------------------------------------------------------------- |
| `main`           | Pristine mirror of `immich-app/immich`. **Never commit here.** GitHub's "Sync fork" button must keep working. |
| `orange-buffalo` | Our branch. Based on an upstream **release tag**, never on `main`. |

Current base: **`v3.1.0`** (`8aa95c674`, 2026-07-27)

Release tags are deliberate. `main` is unreleased development code with
in-flight schema migrations, which is not what we want running against the
photo library.

## Guiding rule for changes

**Prefer adding new files over editing upstream files.** A new file can never
conflict during a rebase; an edited upstream file can. Every change below is
currently an *added* file, which is why the conflict column reads as it does.
If you must edit an upstream file, record it here with enough context that the
next person can re-apply it by hand.

## Changes

### 1. `.github/workflows/fork-docker.yml` — added

Builds `server/Dockerfile` and pushes to `ghcr.io/orange-buffalo/immich-server`.

Upstream's own `.github/workflows/docker.yml` cannot run in this fork:

- `pre-job` mints a token via `immich-app/devtools/actions/create-workflow-token`
  using the `PUSH_O_MATIC_APP_CLIENT_ID` / `PUSH_O_MATIC_APP_KEY` secrets, which
  only exist in the `immich-app` org. Every other job `needs` it, so the whole
  workflow fails at the first step.
- The machine-learning `rocm` variant pins `runner-mapping` to `pokedex-large`,
  an `immich-app` self-hosted runner. That job would queue forever.
- `retag_server` / `retag_ml` re-tag an image that is assumed to already exist.
- `mirror` needs `DOCKERHUB_*` secrets and targets `docker.io/altran1502`.

We add a separate workflow rather than patching theirs, so upstream changes to
`docker.yml` never conflict.

**Conflict risk on rebase:** none (new file).

**Watch for:** the build args consumed by `server/Dockerfile`
(`BUILD_ID`, `BUILD_IMAGE`, `BUILD_SOURCE_REF`, `BUILD_SOURCE_COMMIT`) and the
build context (repo root, not `server/`). If upstream changes either, this
workflow needs the same change. The Dockerfile was restructured substantially
between `v3.1.0` and `main`, so re-verify the build on every version bump.

### 2. `FORK.md` — added

This file.

**Conflict risk on rebase:** none (new file).

## Deliberately NOT changed

- **Machine learning image.** We do not modify `machine-learning/`, so we do not
  build it. The deployment keeps pulling `ghcr.io/immich-app/immich-machine-learning`,
  pinned to the upstream tag matching our base version (`v3.1.0`). If we ever
  patch `machine-learning/`, this fork must start building that image too.
- **`server/Dockerfile` build metadata.** It hardcodes
  `IMMICH_REPOSITORY=immich-app/immich` and the associated URLs, so the server's
  About dialog links to upstream rather than to this fork. Cosmetic only, and
  patching it would mean editing an upstream file for no functional gain.
- **Media location.** Deployment mounts photos at `/data`, which is upstream's
  default since `v1.137.0`. No patch needed.

## Bumping to a new upstream release

```bash
git fetch upstream --tags
git rebase --onto v3.2.0 v3.1.0 orange-buffalo    # replace with actual versions
```

Then:

1. Update the **Current base** line above.
2. Re-verify the image builds — the Dockerfile changes shape between releases:
   ```bash
   docker buildx build -f server/Dockerfile -t immich-server:test .
   ```
3. Re-read upstream's release notes for breaking changes to the deployment
   (volume mounts, required env vars, Postgres extension versions).
4. Bump the machine-learning tag in `orange-buffalo-cloud/immich/immich.yml` to
   match the new base version.
5. Push, let the workflow publish, then pin the new `commit-<sha>` tag in the
   deployment.

## Deployment

Published image: `ghcr.io/orange-buffalo/immich-server`

| Tag             | Meaning                                            |
| --------------- | -------------------------------------------------- |
| `orange-buffalo`| Moving tag, latest build of this branch.           |
| `commit-<sha>`  | Immutable. **Pin this in the Swarm stack** — Swarm will not redeploy on an unchanged tag. |

Consumed by `orange-buffalo-cloud/immich/immich.yml`.

### Package visibility

GHCR container packages are created **private**, regardless of repository
visibility, and GitHub exposes **no REST endpoint** to change that — it is a
one-time manual toggle in the web UI:

> Profile → Packages → `immich-server` → Package settings → Danger Zone →
> Change visibility → Public

This must be done once, right after the first successful publish. Until it is,
any consumer needs `docker login ghcr.io`. There is nothing sensitive in this
image (the source is a public AGPL-3.0 fork), so it is public.
