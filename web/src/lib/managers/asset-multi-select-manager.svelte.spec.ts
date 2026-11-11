import { AssetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { partnerManager } from '#lib/managers/partner-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { AssetVisibility } from '@immich/sdk';

describe('AssetMultiSelectManager', () => {
  let sut: AssetMultiSelectManager;

  beforeEach(() => {
    sut = new AssetMultiSelectManager();
  });

  it('calculates derived values from selection', () => {
    sut.selectAsset(factory.timelineAsset({ isFavorite: true, visibility: AssetVisibility.Archive, isTrashed: true }));
    sut.selectAsset(
      factory.timelineAsset({ isFavorite: true, visibility: AssetVisibility.Timeline, isTrashed: false }),
    );

    expect(sut.selectionActive).toBe(true);
    expect(sut.isAllTrashed).toBe(false);
    expect(sut.isAllArchived).toBe(false);
    expect(sut.isAllFavorite).toBe(true);
  });

  it('updates isAllUserOwned when the active user changes', () => {
    const [user1, user2] = factory.many(2, () => factory.user());
    sut.selectAsset(factory.timelineAsset({ ownerId: user1.id }));

    const cleanup = $effect.root(() => {
      expect(sut.isAllUserOwned).toBe(false);

      authManager.setUser(user1);
      authManager.setPreferences(factory.preferences());
      expect(sut.isAllUserOwned).toBe(true);

      authManager.setUser(user2);
      expect(sut.isAllUserOwned).toBe(false);
    });

    cleanup();
    authManager.reset();
  });

  it('treats assets shared by a partner as deletable', () => {
    const [user, partner, stranger] = factory.many(3, () => factory.user());

    const ownAsset = factory.timelineAsset({ ownerId: user.id });
    const partnerAsset = factory.timelineAsset({ ownerId: partner.id });
    const strangerAsset = factory.timelineAsset({ ownerId: stranger.id });
    sut.selectAssets([ownAsset, partnerAsset, strangerAsset]);

    const cleanup = $effect.root(() => {
      authManager.setUser(user);
      authManager.setPreferences(factory.preferences());
      partnerManager.setPermissions({ grantedByMe: [], grantedToMe: [partner.id] });

      expect(sut.deletableAssets.map(({ id }) => id)).toEqual([ownAsset.id, partnerAsset.id]);
      expect(sut.isAllDeletable).toBe(false);

      // permanently deleting is never shared with partners
      expect(sut.permanentlyDeletableAssets.map(({ id }) => id)).toEqual([ownAsset.id]);

      sut.removeAssetFromMultiselectGroup(strangerAsset.id);
      expect(sut.isAllDeletable).toBe(true);
      expect(sut.isAllUserOwned).toBe(false);
    });

    cleanup();
    authManager.reset();
    partnerManager.reset();
  });
});
