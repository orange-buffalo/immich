import { LoginResponseDto, createPartner, getAssetInfo, removePartner } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

const setDeletePermission = (accessToken: string, userId: string, allowDelete: boolean) =>
  request(app)
    .put(`/partner-permissions/${userId}`)
    .send({ allowDelete })
    .set('Authorization', `Bearer ${accessToken}`);

const getPermissions = (accessToken: string) =>
  request(app).get('/partner-permissions').set('Authorization', `Bearer ${accessToken}`);

const deleteAssets = (accessToken: string, ids: string[], force = false) =>
  request(app).delete('/assets').send({ ids, force }).set('Authorization', `Bearer ${accessToken}`);

/**
 * Fork-only, see FORK.md. Partner sharing can grant the recipient the same trash/restore rights
 * over the shared assets as the owner has. Off by default, and never covers permanent deletion.
 */
describe('partner asset deletion', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let recipient: LoginResponseDto;
  let stranger: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();

    admin = await utils.adminSetup({ onboarding: false });

    [owner, recipient, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.user1),
      utils.userSetup(admin.accessToken, createUserDto.user2),
      utils.userSetup(admin.accessToken, createUserDto.user3),
    ]);

    // owner shares with recipient, and not the other way around
    await createPartner(
      { partnerCreateDto: { sharedWithId: recipient.userId } },
      { headers: asBearerAuth(owner.accessToken) },
    );
  });

  describe('endpoint access control', () => {
    it('should require authentication to read grants', async () => {
      const { status, body } = await request(app).get('/partner-permissions');

      expect(status).toBe(401);
      expect(body).toEqual({ message: expect.any(String) });
    });

    it('should require authentication to change a grant', async () => {
      const { status, body } = await request(app)
        .put(`/partner-permissions/${recipient.userId}`)
        .send({ allowDelete: true });

      expect(status).toBe(401);
      expect(body).toEqual({ message: expect.any(String) });
    });

    it('should reject a non-uuid target', async () => {
      const { status } = await setDeletePermission(owner.accessToken, 'not-a-uuid', true);

      expect(status).toBe(400);
    });

    it('should reject a non-boolean body', async () => {
      const { status } = await request(app)
        .put(`/partner-permissions/${recipient.userId}`)
        .send({ allowDelete: 'yes' })
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(status).toBe(400);
    });

    it('should not let the recipient grant themselves permission over the sharer', async () => {
      // there is no partnership in this direction, so the recipient cannot grant anything
      const { status } = await setDeletePermission(recipient.accessToken, owner.userId, true);

      expect(status).toBe(400);
    });
  });

  describe('without a delete grant', () => {
    it('should not let a partner delete a shared asset', async () => {
      const { id: assetId } = await utils.createAsset(owner.accessToken);

      const { status, body } = await deleteAssets(recipient.accessToken, [assetId]);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Not found or no asset.delete access'));
    });

    it('should report no grants', async () => {
      const { status, body } = await getPermissions(recipient.accessToken);

      expect(status).toBe(200);
      expect(body).toEqual({ grantedByMe: [], grantedToMe: [] });
    });
  });

  describe('with a delete grant', () => {
    beforeAll(async () => {
      const { status } = await setDeletePermission(owner.accessToken, recipient.userId, true);
      expect(status).toBe(200);
    });

    it('should report the grant to both sides', async () => {
      const [byOwner, byRecipient] = await Promise.all([
        getPermissions(owner.accessToken),
        getPermissions(recipient.accessToken),
      ]);

      expect(byOwner.body).toEqual({ grantedByMe: [recipient.userId], grantedToMe: [] });
      expect(byRecipient.body).toEqual({ grantedByMe: [], grantedToMe: [owner.userId] });
    });

    it('should let a partner move a shared asset to the trash', async () => {
      const { id: assetId } = await utils.createAsset(owner.accessToken);

      const { status } = await deleteAssets(recipient.accessToken, [assetId]);
      expect(status).toBe(204);

      const after = await getAssetInfo({ id: assetId }, { headers: asBearerAuth(owner.accessToken) });
      expect(after).toStrictEqual(expect.objectContaining({ id: assetId, isTrashed: true }));
    });

    it('should let a partner restore a shared asset from the trash', async () => {
      const { id: assetId } = await utils.createAsset(owner.accessToken);
      await utils.deleteAssets(owner.accessToken, [assetId]);

      const { status } = await request(app)
        .post('/trash/restore/assets')
        .send({ ids: [assetId] })
        .set('Authorization', `Bearer ${recipient.accessToken}`);
      expect(status).toBe(200);

      const after = await getAssetInfo({ id: assetId }, { headers: asBearerAuth(owner.accessToken) });
      expect(after).toStrictEqual(expect.objectContaining({ id: assetId, isTrashed: false }));
    });

    it('should not let a partner permanently delete a shared asset', async () => {
      const { id: assetId } = await utils.createAsset(owner.accessToken);

      const { status, body } = await deleteAssets(recipient.accessToken, [assetId], true);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Not found or no asset.delete access'));

      const after = await getAssetInfo({ id: assetId }, { headers: asBearerAuth(owner.accessToken) });
      expect(after).toStrictEqual(expect.objectContaining({ id: assetId, isTrashed: false }));
    });

    it('should not let the sharing user delete the assets of the user they share with', async () => {
      const { id: assetId } = await utils.createAsset(recipient.accessToken);

      const { status, body } = await deleteAssets(owner.accessToken, [assetId]);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Not found or no asset.delete access'));
    });

    it('should not let a user who is not a partner delete the assets', async () => {
      const { id: assetId } = await utils.createAsset(owner.accessToken);

      const { status, body } = await deleteAssets(stranger.accessToken, [assetId]);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Not found or no asset.delete access'));
    });

    it('should refuse to grant delete permission to a non-partner', async () => {
      const { status } = await setDeletePermission(owner.accessToken, stranger.userId, true);

      expect(status).toBe(400);
    });
  });

  describe('after the grant is revoked', () => {
    it('should stop letting the partner delete', async () => {
      const { id: assetId } = await utils.createAsset(owner.accessToken);
      await setDeletePermission(owner.accessToken, recipient.userId, false);

      const { status, body } = await deleteAssets(recipient.accessToken, [assetId]);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Not found or no asset.delete access'));
    });
  });

  describe('after the partnership is removed', () => {
    it('should drop the grant', async () => {
      await setDeletePermission(owner.accessToken, recipient.userId, true);
      await removePartner({ id: recipient.userId }, { headers: asBearerAuth(owner.accessToken) });

      const { body } = await getPermissions(owner.accessToken);

      expect(body).toEqual({ grantedByMe: [], grantedToMe: [] });
    });
  });
});
