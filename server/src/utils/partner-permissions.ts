import { SystemMetadataKey } from 'src/enum';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { SystemMetadata } from 'src/types';

/**
 * Fork-only: per-partner permission grants, see FORK.md.
 *
 * Upstream has nowhere to hang a partner permission, and adding a column to the `partner` table
 * would mean shipping a migration, which permanently breaks going back to upstream on the same
 * database — kysely refuses to start when `kysely_migrations` holds a row it has no file for.
 * `system_metadata` needs no migration, is never synced to clients, and is only ever read by exact
 * key, so upstream ignores the row entirely.
 *
 * Grants are a flat list of `"<sharedById>:<sharedWithId>"` pairs so the access check can test
 * membership with a single `jsonb_exists` inside the query that already resolves the partner.
 */
export type PartnerPermissions = SystemMetadata[SystemMetadataKey.PartnerPermissions];

export const partnerGrantKey = (sharedById: string, sharedWithId: string) => `${sharedById}:${sharedWithId}`;

export const getPartnerPermissions = async (repository: SystemMetadataRepository): Promise<PartnerPermissions> => {
  const value = await repository.get(SystemMetadataKey.PartnerPermissions);
  return { allowDelete: value?.allowDelete ?? [] };
};

/** Grant or revoke `sharedById`'s permission for `sharedWithId` to delete their assets. */
export const setPartnerDeleteGrant = async (
  repository: SystemMetadataRepository,
  { sharedById, sharedWithId, allowDelete }: { sharedById: string; sharedWithId: string; allowDelete: boolean },
) => {
  const key = partnerGrantKey(sharedById, sharedWithId);
  const { allowDelete: grants } = await getPartnerPermissions(repository);
  const without = grants.filter((grant) => grant !== key);

  await repository.set(SystemMetadataKey.PartnerPermissions, {
    allowDelete: allowDelete ? [...without, key] : without,
  });
};

/** Drop every grant between two users, in both directions. Used when a partnership is removed. */
export const revokePartnerGrants = async (
  repository: SystemMetadataRepository,
  { sharedById, sharedWithId }: { sharedById: string; sharedWithId: string },
) => {
  const keys = new Set([partnerGrantKey(sharedById, sharedWithId), partnerGrantKey(sharedWithId, sharedById)]);
  const { allowDelete: grants } = await getPartnerPermissions(repository);
  const remaining = grants.filter((grant) => !keys.has(grant));

  if (remaining.length !== grants.length) {
    await repository.set(SystemMetadataKey.PartnerPermissions, { allowDelete: remaining });
  }
};
