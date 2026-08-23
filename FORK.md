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

### 2. `server/src/config.ts` — **modified**

`defaults.newVersionCheck.enabled`: `true` → `false`.

The version check does *not* use `IMMICH_REPOSITORY`. It calls a hardcoded
immich-hosted endpoint (`https://version.immich.cloud/version`, set in
`config.repository.ts`, with no env override) and compares the result against
`serverVersion` from `server/package.json`. Because this branch sits on an
unmodified release tag, that comparison is technically correct — but a "new
version available" banner is not actionable for our users, since updating
requires a rebase and rebuild here. We track releases out-of-band instead.

Only deltas from `defaults` are persisted to `system_metadata`
(`utils/config.ts` `updateConfig` skips values equal to the default), so
flipping the default takes effect without a DB change.

**Conflict risk on rebase: LOW but non-zero** — this is the only upstream file
we edit. If it conflicts, re-apply by setting `enabled: false` in the
`newVersionCheck` block of `defaults`. If upstream restructures that config,
verify the setting still exists rather than blindly resolving.

### 3. Android app — `mobile/android/app/build.gradle` — **modified**

`applicationId`: `app.alextran.immich` → `io.orangebuffalo.immich`.

`namespace` deliberately stays `app.alextran.immich`, so every Kotlin package,
all pigeon-generated code, and the widget receiver class names in
`mobile/lib/constants/constants.dart` keep working untouched. Only the install
identity changes.

This lets our app coexist with an official Play Store install instead of
colliding on signature (Android refuses to install over an app signed with a
different key). Migration is therefore side-by-side: install ours, confirm it
works, then remove the official one.

**Conflict risk on rebase: LOW** — a one-line change in a rarely-touched file.

### 4. `.github/workflows/fork-android.yml` — added

Builds the release APK on a hosted runner and publishes it as a `scratch`
artifact image at `ghcr.io/orange-buffalo/immich-apk`, following the same
pattern as `openchamber-web-artifact`. Verifies the signing certificate and
applicationId before publishing.

Upstream's `build-mobile.yml` is unusable here for the same reasons as
`docker.yml`, plus it runs on the self-hosted `mich` runner.

**Signing:** our own keystore, held in repo secrets `KEY_JKS` (base64),
`ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_STORE_PASSWORD`. Load them with:

```bash
.github/scripts/fork-setup-android-signing.sh <keystore.jks> <password-file>
# or, to mint a fresh key:
.github/scripts/fork-setup-android-signing.sh --generate new-key.jks
```

The keystore is deliberately **not** in this repository. Current certificate:

```
SHA-256: 47:D8:CB:56:48:11:54:08:3D:F5:97:AD:B6:05:A4:2F:45:70:40:D0:FC:42:66:3D:DF:23:FC:79:D7:33:60:45
```

**Back the keystore up.** If it is lost, the next APK cannot upgrade an
installed one: every user must uninstall and reinstall, and uninstalling wipes
the app's data (`android:allowBackup="false"`), so they lose login and backup
album selection. Already-uploaded photos are unaffected, and no re-upload
happens — backup candidates are computed by checksum against the server
(`backup.repository.dart`), not from local state.

**arm64-v8a only.** Built with `--split-per-abi --target-platform android-arm64`,
since all target devices are 64-bit ARM and this APK ships inside the server
image. Both flags are needed: `--target-platform` only strips Flutter's own
engine and AOT libraries, while Gradle still packages every plugin's `.so` for
all ABIs (175MB universal -> 98MB, still three architectures). `--split-per-abi`
is what restricts the packaged native libs, and it renames the output to
`app-arm64-v8a-release.apk`. The build fails if the APK ever contains other
ABIs. Side-loading has no
Play-Store-style split delivery, so if a 32-bit or x86 device ever needs to be
supported, drop the flag and accept the universal size.

**Runner note:** Gradle must run on JDK 21 even though the app module targets
17, because the `maplibre_gl` plugin compiles with source release 21. Upstream
pins 17 in `build-mobile.yml`; that fails here with
`error: invalid source release: 21`.

**Conflict risk on rebase:** none (new file).

### 5. Android update check — `server_update_notification.dart`, `constants.dart` — **modified**

The app already routes its update check through the server: it listens for
`on_new_release` over the websocket (`websocket.provider.dart`) and compares its
own `PackageInfo` version against the server's in
`server_info.provider.dart:_checkServerVersionMismatch`. Nothing had to be
implemented for that.

The only upstream-bound part was the *link*: on Android it opened the Play
Store, which would install the upstream app. It now points at
`<server>/immich.apk`, derived from `StoreKey.serverEndpoint` (a trailing `api`
segment is stripped, so sub-path deployments work).

**This means the APK and the server image must be rebuilt together on every
version bump**, or the app will report itself out of date and download an
identically-old APK.

**Conflict risk on rebase: MEDIUM** — `server_update_notification.dart` is
active upstream code. If it conflicts, re-apply by replacing the Android branch
of `openUpdateLink()` with `forkApkUrl()`.

### 6. `server/Dockerfile` — **modified**

One `COPY --from=ghcr.io/orange-buffalo/immich-apk:latest` line placing the APK
at `/build/www/immich.apk`. `app.common.ts` serves `/build/www` through `sirv`
as a static directory, so the APK is downloadable at `<server>/immich.apk` with
no server code changes.

**Ordering constraint:** the server image build depends on the APK artifact
image existing. `fork-android.yml` must publish before `fork-docker.yml` can
build. The `:latest` tag also means a server rebuild picks up whatever APK was
published last, so bump and rebuild both together.

**Conflict risk on rebase: LOW-MEDIUM** — upstream restructures this Dockerfile
between releases (it changed substantially between v3.1.0 and main). Re-apply
the `COPY` next to the `LICENSE` copies in the final stage.

### 7. `FORK.md` — added

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
- **System config via `IMMICH_CONFIG_FILE`.** Would make settings declarative,
  but it makes the *entire* admin settings UI read-only
  (`system-config.service.ts`: "Cannot update configuration while
  IMMICH_CONFIG_FILE is in use"). Not worth it for one toggle.

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
5. Push, let the workflow publish, then pin the new `sha-<short>` tag in the
   deployment.

## Deployment

Published image: `ghcr.io/orange-buffalo/immich-server`

| Tag             | Meaning                                            |
| --------------- | -------------------------------------------------- |
| `orange-buffalo`| Moving tag, latest build of this branch.           |
| `sha-<short>`   | Immutable, 7-char commit sha. **Pin this in the Swarm stack** — Swarm will not redeploy on an unchanged tag. |

Consumed by `orange-buffalo-cloud/immich/immich.yml`.

### Package visibility

The package is **public**, and was created that way by the first workflow run —
no manual step was needed.

Container packages published from GitHub Actions are linked to the source
repository and inherit its visibility, so a public repo yields a public package.
(GitHub's docs state that packages default to private; that applies to packages
published with a PAT scoped to a personal account, not to Actions-published
packages linked to a public repo. Verified empirically: an anonymous ghcr.io
token with no credentials pulls the manifest with HTTP 200.)

Note that GitHub exposes no REST endpoint to change package visibility, so if it
ever does come out private, the fix is a manual toggle in the web UI:
Profile → Packages → `immich-server` → Package settings → Danger Zone.
