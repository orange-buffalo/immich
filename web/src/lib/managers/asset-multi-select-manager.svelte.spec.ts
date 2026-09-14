import { AssetVisibility } from '@immich/sdk';
import { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { partnerManager } from '$lib/managers/partner-manager.svelte';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';

describe('AssetMultiSelectManager', () => {
  let sut: AssetMultiSelectManager;

  beforeEach(() => {
    sut = new AssetMultiSelectManager();
  });

  it('calculates derived values from selection', () => {
    sut.selectAsset(
      timelineAssetFactory.build({ isFavorite: true, visibility: AssetVisibility.Archive, isTrashed: true }),
    );
    sut.selectAsset(
      timelineAssetFactory.build({ isFavorite: true, visibility: AssetVisibility.Timeline, isTrashed: false }),
    );

    expect(sut.selectionActive).toBe(true);
    expect(sut.isAllTrashed).toBe(false);
    expect(sut.isAllArchived).toBe(false);
    expect(sut.isAllFavorite).toBe(true);
  });

  it('updates isAllUserOwned when the active user changes', () => {
    const [user1, user2] = userAdminFactory.buildList(2);
    sut.selectAsset(timelineAssetFactory.build({ ownerId: user1.id }));

    const cleanup = $effect.root(() => {
      expect(sut.isAllUserOwned).toBe(false);

      authManager.setUser(user1);
      authManager.setPreferences(preferencesFactory.build());
      expect(sut.isAllUserOwned).toBe(true);

      authManager.setUser(user2);
      expect(sut.isAllUserOwned).toBe(false);
    });

    cleanup();
    authManager.reset();
  });

  it('treats assets shared by a partner as deletable', () => {
    const [user, partner, stranger] = userAdminFactory.buildList(3);

    const ownAsset = timelineAssetFactory.build({ ownerId: user.id });
    const partnerAsset = timelineAssetFactory.build({ ownerId: partner.id });
    const strangerAsset = timelineAssetFactory.build({ ownerId: stranger.id });
    sut.selectAssets([ownAsset, partnerAsset, strangerAsset]);

    const cleanup = $effect.root(() => {
      authManager.setUser(user);
      authManager.setPreferences(preferencesFactory.build());
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
