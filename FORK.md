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

Current base: **`v3.2.0`** (merged into this branch, 2026-09-14; previously `v3.1.0`)

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

### 2. `server/src/dtos/config.dto.ts` — **modified**

`defaults.newVersionCheck.enabled`: `true` → `false`. (`defaults` lived in
`server/src/config.ts` until `v3.2.0` moved it here.)

This breaks 9 upstream unit tests in `version.service.spec.ts` and
`system-config.service.spec.ts`, which assume the check is on. Upstream's
`test.yml` does not run on this branch, so they are left failing rather than
patched.

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
image, and `:latest` means it picks up whatever APK was published last. This is
enforced in CI: `fork-docker.yml` is the only triggered workflow. Its `changes`
job diffs the push for `mobile/`, `i18n/`, `open-api/` and
`fork-android.yml`; if anything matched, it calls `fork-android.yml` (a
`workflow_call`-only reusable workflow) and the server job `needs` it. Mobile-only
pushes therefore rebuild the server image too. A manual "Fork Docker" dispatch
rebuilds the APK unless `build_apk` is unticked.

**Conflict risk on rebase: LOW-MEDIUM** — upstream restructures this Dockerfile
between releases (it changed substantially between v3.1.0 and main). Re-apply
the `COPY` next to the `LICENSE` copies in the final stage.

### 7. `FORK.md` — added

This file.

**Conflict risk on rebase:** none (new file).

### 8. Partners can trash each other's assets — **modified** (server, web, mobile)

Upstream partner sharing is read-only: `Permission.AssetDelete` resolves to
owner-only access, and both clients hide their delete controls for assets they
do not own. This fork lets partners trash and restore each other's photos with
the same flow they use for their own.

The trashed asset lands in the **owner's** trash, not the actor's, so the owner
keeps the usual restore/retention window.

**Delete is opt-in per partner, and one-directional.** Sharing alone grants
nothing; the *sharer* has to turn on "Allow X to delete" (web: user settings →
partner sharing, mobile: the partner list). `A` granting `B` lets `B` delete
`A`'s assets, and the reverse needs `B` to share with and grant `A` separately.

**Permanent deletion is explicitly excluded.** `Permission.AssetDelete` also
covers `{ force: true }`, which bypasses the owner's trash entirely, so
`AssetService.deleteAll` re-checks owner access whenever `force` is set (and
`DuplicateService` does the same on the path where a disabled trash feature
makes its deletes permanent). Both clients hide the permanent-delete control for
partner assets, which also means **partners get no delete control at all when
the trash feature is disabled server-wide** — there would be nothing safe to
offer.

**Storage, and why not a migration.** The grant needs somewhere to live, and the obvious spot — a column on the
`partner` table — **would permanently break going back to upstream on the same
database**. Immich runs kysely's `Migrator` with a `FileMigrationProvider` over
`server/src/schema/migrations` plus a `kysely_migrations` table; if that table
holds a row whose file is not in upstream's folder, kysely reports corrupted
migrations and `runMigrations` throws, so upstream's server refuses to start
until you delete the row and the column by hand.

`user_metadata` is also unsuitable: no migration is needed (`key` is
`character varying`), but it is streamed to clients as
`SyncEntityType.UserMetadataV1`, and mobile's `sync_stream.repository.dart` maps
the key through an exhaustive `switch` with no default — an unknown key breaks
sync on the *upstream* app.

So grants live in **`system_metadata`** under the key
`fork:partner-permissions`. That table's `key` is `character varying`, it is
never synced, and it is only ever read by exact key through
`SystemMetadataRepository.get(key)`. Upstream never looks at our row, there is
no migration to undo, and switching back leaves exactly one orphan row that can
be dropped or ignored. Helpers live in `src/utils/partner-permissions.ts`
(added).

Known limitation: the grant list is a single JSONB row updated read-modify-write,
so two people toggling permissions at the same instant can lose one update.
Re-toggling fixes it; not worth a lock at this scale.

Server:

- `src/utils/access.ts` — `Permission.AssetDelete` is now owner ∪ partner
  instead of owner-only. This covers `DELETE /assets` and
  `POST /trash/restore/assets`, both of which authorize on that permission.
- `src/services/asset.service.ts`, `src/services/duplicate.service.ts` — an
  extra owner check on the `force` (permanent delete) paths, see above. A
  dedicated `Permission` value would have been cleaner but every enum member is
  API-visible through `ApiKeyCreateDto`, and we do not want to touch the
  OpenAPI surface.
- `src/repositories/access.repository.ts` — a new
  `AssetAccess.checkPartnerDeleteAccess`. Upstream's `checkPartnerAccess` is
  left untouched: the new one additionally requires a grant, and includes
  already-trashed assets so a partner can undo a delete they just made.
- `src/services/partner-permission.service.ts`,
  `src/controllers/partner-permission.controller.ts` — added, exposing
  `GET /partner-permissions` and `PUT /partner-permissions/:id`. Upstream's
  `PUT /partners/:id` is the *recipient* adjusting their own view
  (`inTimeline`), so it is the wrong shape for a permission the sharer grants.
- `src/services/partner.service.ts` — `remove()` drops the grant, so recreating
  a partnership does not silently restore it.
- `src/enum.ts`, `src/types.ts` — one line each for the new
  `SystemMetadataKey`. `SystemMetadataKey` does not appear in the OpenAPI
  document, so this is invisible to clients.
- `src/controllers/index.ts`, `src/services/index.ts` — one registration line
  each.
- `src/queries/access.repository.sql` — updated by hand (documentation only,
  nothing reads it at runtime and no CI job regenerates it).
- `test/medium/specs/services/partner-asset-delete.spec.ts` and
  `e2e/src/specs/server/api/partner-asset-delete.e2e-spec.ts` — added.

**Endpoint security.** Both routes go through the standard `@Authenticated`
guard, so: unauthenticated requests get 401; shared-link sessions get 403
(neither route opts into `sharedLink`); and API keys must carry
`partner.read` / `partner.update`. There is no admin bypass and no way to act on
another user's behalf — `setDeletePermission` takes `sharedById` from
`auth.user.id` only, and refuses unless a `partner` row already exists for that
exact pair. `:id` is validated as a v4 UUID by the global `ZodValidationPipe`,
which is what makes the `"<sharedById>:<sharedWithId>"` grant key unforgeable.
`GET` resolves grants against live partnerships instead of reading the grant
list directly, so a grant orphaned by the `ON DELETE CASCADE` from a deleted
user is never reported. Session cookies are `SameSite=Lax`, so the
state-changing `PUT` cannot be driven cross-site.

Note that an API key scoped to `partner.update` can now grant delete rights over
its owner's library — narrower than the `asset.delete` such a key would need to
do the damage itself, but a step up from what `partner.update` meant upstream.

Partners still cannot touch Archived or Locked-folder assets: the access query
keeps upstream's `visibility IN (timeline, hidden)` filter.

**The fork endpoint is marked `@ApiExcludeController`,** which keeps it out of
the generated OpenAPI document. Verified: after this change,
`node ./dist/bin/sync-open-api.js` leaves
`open-api/immich-openapi-specs.json` byte-identical, so `packages/sdk` and
`mobile/openapi` need no regeneration and can never conflict on a bump. The
price is that both clients call the two routes by hand instead of through a
generated client — a deliberate trade, since `generate-dart-sdk.sh` does
`rm -rf mobile/openapi` and regenerating that tree on every upstream bump would
be far worse.

Web:

- `src/lib/services/partner-permission.service.ts` — added, a hand-written
  `fetch` wrapper for the two fork routes.
- `src/lib/managers/partner-manager.svelte.ts` — added. Holds the delete grants,
  loaded in `utils/server.ts` `init()` and refreshed on `AuthUserLoaded` and
  from `PartnerSettings.svelte`.
- `SharingSettings.svelte` (was `PartnerSettings.svelte` before `v3.2.0`) — the
  "Allow X to delete" switch, on the *I share with them* side of each partner
  card.
- `asset-multi-select-manager.svelte.ts` — added `deletableAssets` /
  `isAllDeletable` alongside the existing `ownedAssets` / `isAllUserOwned`.
  `DeleteAssetsAction.svelte` switched to `deletableAssets`.
- `AssetViewerNavBar.svelte` — the delete button uses `partnerManager.canDelete`
  instead of `isOwner`, and passes `allowForce` so `Shift+Delete` cannot force a
  permanent delete of a partner's asset.
- `DeleteAssetsAction.svelte` / `TimelineKeyboardActions.svelte` — a forced
  delete falls back to `permanentlyDeletableAssets` (own assets only).
- The partner timeline gained a delete button; the photos / recently-added /
  map / search control bars gained an `{:else if …isAllDeletable}` branch with a
  Download + Delete menu, for selections that are not all owned.

Mobile:

- `repositories/partner_permission_api.repository.dart` — added. Calls the two
  fork routes through `ApiClient.invokeAPI` (reached via
  `apiService.partnersApi.apiClient`), which reuses the configured base URL and
  auth without touching `mobile/openapi`.
- `providers/user.provider.dart` — added `partnerPermissionsProvider` and
  `deletableOwnerIdsProvider`.
- `presentation/widgets/people/partner_allow_delete_switch.widget.dart` — added,
  rendered under each row of `pages/library/partner/partner.page.dart`. Built
  from a `Row` rather than a `SwitchListTile` on purpose: upstream's
  `partner_page_test.dart` counts `ListTile`s.
- `i18n/en.json` — two new keys. `mobile/lib/generated/` is gitignored and the
  fork's Android workflow runs the full `mise //mobile:codegen`, so
  the typed `context.t.partner_can_delete_assets(...)` accessor is generated at
  build time.
- `presentation/actions/action.dart` — added `deletableAssetsActionProvider`
  next to upstream's `ownedAssetsActionProvider`.
- `presentation/actions/delete.action.dart` — `DeleteAction`'s state provider
  trashes own ∪ granted-partner assets, but falls back to own assets only
  whenever the result would be a permanent delete (trash disabled, or everything
  already trashed/locked). With only partner assets selected and trash disabled
  the action hides itself. Every other action stays owner-only, and the
  filtering still matters: the server rejects the whole request if *any* id is
  unauthorized, so assets from shared albums must keep being dropped.
- `presentation/actions/restore.action.dart` — `RestoreAction` uses
  `deletableAssetsActionProvider` instead of `ownedAssetsActionProvider`.
- `partner_detail_bottom_sheet.widget.dart` — gained a `DeleteAction`.
- Tests: `test/unit/presentation/presentation_context.dart` overrides
  `partnerPermissionsProvider` from a `partnerDeleteGrants` field; partner cases
  added to `delete_action_test.dart` / `restore_action_test.dart`;
  `bottom_bar_test.dart` overrides `deletableAssetsActionProvider`.

`v3.2.0` replaced the old action buttons (`action.provider.dart` trash methods,
`ActionButtonType.trash`, `DeleteActionButton` etc.) with self-gating
`ActionBuilder`s in `presentation/actions/`. The bottom bar and kebab menu now
render `DeleteAction`/`RestoreAction` unconditionally, so they need no fork
change.

**Conflict risk on rebase: MEDIUM-HIGH.** This is the one change that edits
active upstream code across all three trees, though most of the volume sits in
added files. The load-bearing parts are `src/utils/access.ts` and
`src/repositories/access.repository.ts` — if the clients conflict badly, the
fastest recovery is to re-apply the server change and re-derive the client
gating from `git log -p` on this commit. After a bump, re-run
`mise //mobile:codegen:translation` so the two new i18n keys exist. Watch for upstream adding its own partner
permission model (there are long-standing feature requests for it); if that
lands, drop this change in favour of theirs.

### 9. Test harness fixes — **modified**

Small changes needed to actually run the tests behind entry 8:

- `server/test/medium.factory.ts` — `TrashRepository` added to
  `newRealRepository`. It was simply missing, so any medium test using
  `TrashService` threw "Unable to create repository instance".
- `server/test/medium/globalSetup.ts` — use `postgresContainer.getHost()`
  instead of a hardcoded `localhost`. Testcontainers already resolves the right
  host from `DOCKER_HOST` / `TESTCONTAINERS_HOST_OVERRIDE`; hardcoding
  `localhost` only works when the docker daemon is on the same host as the test
  process.

**Conflict risk on rebase: LOW** (both are one-liners in test-only files).

**Running the suites against a remote docker daemon** (e.g. `DOCKER_HOST` set to
a rootless daemon on another host, which is how the dev sandbox is set up):

```bash
# medium — works as-is with the globalSetup fix above
pnpm --filter immich test:medium run

# e2e — published ports live on the daemon host, not on localhost
cd e2e
docker compose up -d          # needs e2e/test-assets checked out (git submodule)
VITEST_DISABLE_DOCKER_SETUP=true \
  PLAYWRIGHT_HOST=<daemon-host> PLAYWRIGHT_DB_HOST=<daemon-host> \
  pnpm exec vitest run
```

Two caveats in that setup, neither fixable from this repo: the `./test-assets`
bind mount cannot be resolved by a remote daemon (so `library.e2e-spec.ts` and
the three offline-asset cases in `trash.e2e-spec.ts` cannot pass), and the
`cli/*` specs need `packages/cli` built.

## Deliberately NOT changed

- **Machine learning image.** We do not modify `machine-learning/`, so we do not
  build it. The deployment keeps pulling `ghcr.io/immich-app/immich-machine-learning`,
  pinned to the upstream tag matching our base version (`v3.2.0`). If we ever
  patch `machine-learning/`, this fork must start building that image too.
- **`server/Dockerfile` build metadata.** It hardcodes
  `IMMICH_REPOSITORY=immich-app/immich` and the associated URLs, so the server's
  About dialog links to upstream rather than to this fork. Cosmetic only, and
  patching it would mean editing an upstream file for no functional gain.
- **Media location.** Deployment mounts photos at `/data`, which is upstream's
  default since `v1.137.0`. No patch needed.
- **Live websocket notification to the *owner* when a partner trashes their
  asset.** `on_asset_trash` is emitted to the acting user only, so an owner with
  the web app already open sees the photo disappear on the next refresh rather
  than instantly. Mobile is unaffected — the sync stream carries the change.
  Widening this would mean changing the shape of the `AssetTrashAll` event,
  which upstream also uses for archive/duplicate/integrity flows.
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
