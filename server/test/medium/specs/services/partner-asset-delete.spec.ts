import { Kysely } from 'kysely';
import { AssetStatus } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { TrashRepository } from 'src/repositories/trash.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { AssetService } from 'src/services/asset.service';
import { PartnerPermissionService } from 'src/services/partner-permission.service';
import { PartnerService } from 'src/services/partner.service';
import { TrashService } from 'src/services/trash.service';
import { getPartnerPermissions, setPartnerDeleteGrant } from 'src/utils/partner-permissions';
import { MediumTestContext, newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const mock = [EventRepository, LoggingRepository, JobRepository];

const setupAssetService = () =>
  newMediumService(AssetService, {
    database: defaultDatabase,
    real: [AssetRepository, AccessRepository, UserRepository],
    mock,
  });

const setupTrashService = () =>
  newMediumService(TrashService, {
    database: defaultDatabase,
    real: [AssetRepository, AccessRepository, TrashRepository, UserRepository],
    mock,
  });

const setupPartnerPermissionService = () =>
  newMediumService(PartnerPermissionService, {
    database: defaultDatabase,
    real: [AccessRepository, PartnerRepository, SystemMetadataRepository, UserRepository],
    mock,
  });

const setupPartnerService = () =>
  newMediumService(PartnerService, {
    database: defaultDatabase,
    real: [AccessRepository, PartnerRepository, SystemMetadataRepository, UserRepository],
    mock,
  });

const grantDelete = (ctx: MediumTestContext, sharedById: string, sharedWithId: string) =>
  setPartnerDeleteGrant(ctx.get(SystemMetadataRepository), { sharedById, sharedWithId, allowDelete: true });

/** The automock is strict, so anything that emits has to be given an implementation up front. */
const withEvents = <T extends { ctx: MediumTestContext<any> }>(setup: T): T => {
  setup.ctx.getMock(EventRepository).emit.mockResolvedValue();
  return setup;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/**
 * Fork-only, see FORK.md. A partner that has been granted delete permission gets the same
 * trash/restore rights over the shared assets as the owner, so that deleting a partner's photo
 * works exactly like deleting one of your own. Permanent deletion is never shared.
 */
describe('partner asset deletion', () => {
  describe(`${AssetService.name}.deleteAll`, () => {
    it('should let a granted partner move a shared asset to the trash', async () => {
      const { sut, ctx } = withEvents(setupAssetService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });
      await grantDelete(ctx, owner.id, recipient.id);
      const { asset } = await ctx.newAsset({ ownerId: owner.id });

      await sut.deleteAll(factory.auth({ user: { id: recipient.id } }), { ids: [asset.id] });

      const [after] = await ctx.get(AssetRepository).getByIds([asset.id]);
      expect(after).toMatchObject({ ownerId: owner.id, status: AssetStatus.Trashed, deletedAt: expect.any(Date) });
    });

    it('should not let a partner delete a shared asset without a grant', async () => {
      const { sut, ctx } = withEvents(setupAssetService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });

      await expect(sut.deleteAll(factory.auth({ user: { id: recipient.id } }), { ids: [asset.id] })).rejects.toThrow(
        'Not found or no asset.delete access',
      );
    });

    it('should not let a granted partner permanently delete a shared asset', async () => {
      const { sut, ctx } = withEvents(setupAssetService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });
      await grantDelete(ctx, owner.id, recipient.id);
      const { asset } = await ctx.newAsset({ ownerId: owner.id });

      await expect(
        sut.deleteAll(factory.auth({ user: { id: recipient.id } }), { ids: [asset.id], force: true }),
      ).rejects.toThrow('Not found or no asset.delete access');

      const [after] = await ctx.get(AssetRepository).getByIds([asset.id]);
      expect(after).toMatchObject({ status: AssetStatus.Active, deletedAt: null });
    });

    it('should let the owner permanently delete their own asset', async () => {
      const { sut, ctx } = withEvents(setupAssetService());
      const { user: owner } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });

      await sut.deleteAll(factory.auth({ user: { id: owner.id } }), { ids: [asset.id], force: true });

      const [after] = await ctx.get(AssetRepository).getByIds([asset.id]);
      expect(after).toMatchObject({ status: AssetStatus.Deleted });
    });

    it('should not let a granted user delete assets without a partnership', async () => {
      const { sut, ctx } = withEvents(setupAssetService());
      const { user: owner } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      // a grant on its own means nothing, the partner row is what the access check resolves
      await grantDelete(ctx, owner.id, other.id);
      const { asset } = await ctx.newAsset({ ownerId: owner.id });

      await expect(sut.deleteAll(factory.auth({ user: { id: other.id } }), { ids: [asset.id] })).rejects.toThrow(
        'Not found or no asset.delete access',
      );
    });

    it('should not let the sharing user delete the assets of the user they share with', async () => {
      const { sut, ctx } = withEvents(setupAssetService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      // owner shares with recipient and grants delete, but not the other way around
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });
      await grantDelete(ctx, owner.id, recipient.id);
      const { asset } = await ctx.newAsset({ ownerId: recipient.id });

      await expect(sut.deleteAll(factory.auth({ user: { id: owner.id } }), { ids: [asset.id] })).rejects.toThrow(
        'Not found or no asset.delete access',
      );
    });
  });

  describe(`${TrashService.name}.restoreAssets`, () => {
    it('should let a granted partner restore a shared asset from the trash', async () => {
      const { sut, ctx } = withEvents(setupTrashService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });
      await grantDelete(ctx, owner.id, recipient.id);
      const { asset } = await ctx.newAsset({
        ownerId: owner.id,
        status: AssetStatus.Trashed,
        deletedAt: new Date(),
      });

      await sut.restoreAssets(factory.auth({ user: { id: recipient.id } }), { ids: [asset.id] });

      const [after] = await ctx.get(AssetRepository).getByIds([asset.id]);
      expect(after).toMatchObject({ ownerId: owner.id, status: AssetStatus.Active, deletedAt: null });
    });

    it('should not let a partner restore a shared asset without a grant', async () => {
      const { sut, ctx } = withEvents(setupTrashService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });
      const { asset } = await ctx.newAsset({
        ownerId: owner.id,
        status: AssetStatus.Trashed,
        deletedAt: new Date(),
      });

      await expect(
        sut.restoreAssets(factory.auth({ user: { id: recipient.id } }), { ids: [asset.id] }),
      ).rejects.toThrow('Not found or no asset.delete access');
    });
  });

  describe(PartnerPermissionService.name, () => {
    it('should report grants in both directions', async () => {
      const { sut, ctx } = withEvents(setupPartnerPermissionService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });

      await sut.setDeletePermission(factory.auth({ user: { id: owner.id } }), recipient.id, { allowDelete: true });

      await expect(sut.get(factory.auth({ user: { id: owner.id } }))).resolves.toMatchObject({
        grantedByMe: [recipient.id],
        grantedToMe: [],
      });
      await expect(sut.get(factory.auth({ user: { id: recipient.id } }))).resolves.toMatchObject({
        grantedByMe: [],
        grantedToMe: [owner.id],
      });
    });

    it('should not report a grant left behind by a removed partnership', async () => {
      const { sut, ctx } = withEvents(setupPartnerPermissionService());
      const { user: owner } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      // e.g. the partner row went away through the cascade from a deleted user
      await grantDelete(ctx, owner.id, other.id);

      await expect(sut.get(factory.auth({ user: { id: owner.id } }))).resolves.toEqual({
        grantedByMe: [],
        grantedToMe: [],
      });
    });

    it('should refuse to grant delete permission without a partnership', async () => {
      const { sut, ctx } = withEvents(setupPartnerPermissionService());
      const { user: owner } = await ctx.newUser();
      const { user: other } = await ctx.newUser();

      await expect(
        sut.setDeletePermission(factory.auth({ user: { id: owner.id } }), other.id, { allowDelete: true }),
      ).rejects.toThrow('Partner not found');
    });

    it('should revoke a grant', async () => {
      const { sut, ctx } = withEvents(setupPartnerPermissionService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });
      const auth = factory.auth({ user: { id: owner.id } });

      await sut.setDeletePermission(auth, recipient.id, { allowDelete: true });
      await sut.setDeletePermission(auth, recipient.id, { allowDelete: false });

      await expect(sut.get(auth)).resolves.toMatchObject({ grantedByMe: [] });
    });
  });

  describe(`${PartnerService.name}.remove`, () => {
    it('should drop the delete grant when the partnership is removed', async () => {
      const { sut, ctx } = withEvents(setupPartnerService());
      const { user: owner } = await ctx.newUser();
      const { user: recipient } = await ctx.newUser();
      await ctx.newPartner({ sharedById: owner.id, sharedWithId: recipient.id });
      await grantDelete(ctx, owner.id, recipient.id);

      await sut.remove(factory.auth({ user: { id: owner.id } }), recipient.id);

      const { allowDelete } = await getPartnerPermissions(ctx.get(SystemMetadataRepository));
      expect(allowDelete).not.toContain(`${owner.id}:${recipient.id}`);
    });
  });
});
