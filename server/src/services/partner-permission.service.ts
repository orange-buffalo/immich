import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { BaseService } from 'src/services/base.service';
import { getPartnerPermissions, partnerGrantKey, setPartnerDeleteGrant } from 'src/utils/partner-permissions';

export type PartnerPermissionsResponseDto = {
  /** Users I have allowed to delete my assets. */
  grantedByMe: string[];
  /** Users whose assets I am allowed to delete. */
  grantedToMe: string[];
};

/**
 * Fork-only, see FORK.md. Upstream's `PUT /partners/:id` is the *recipient* adjusting their own
 * view of a partner (`inTimeline`), so it is the wrong shape for a permission the *sharer* grants.
 * This service backs a separate fork endpoint instead of widening the upstream one, which keeps the
 * upstream partner API — and therefore the generated OpenAPI clients — untouched.
 */
@Injectable()
export class PartnerPermissionService extends BaseService {
  async get(auth: AuthDto): Promise<PartnerPermissionsResponseDto> {
    const userId = auth.user.id;
    const [{ allowDelete }, partners] = await Promise.all([
      getPartnerPermissions(this.systemMetadataRepository),
      this.partnerRepository.getAll(userId),
    ]);

    const granted = new Set(allowDelete);
    const grantedByMe: string[] = [];
    const grantedToMe: string[] = [];

    // resolved against live partnerships rather than read straight off the grant list: a partner
    // row can also disappear via the `ON DELETE CASCADE` from a deleted user, which leaves a grant
    // behind that the access check already ignores
    for (const { sharedById, sharedWithId } of partners) {
      if (sharedById === userId && granted.has(partnerGrantKey(userId, sharedWithId))) {
        grantedByMe.push(sharedWithId);
      }
      if (sharedWithId === userId && granted.has(partnerGrantKey(sharedById, userId))) {
        grantedToMe.push(sharedById);
      }
    }

    return { grantedByMe, grantedToMe };
  }

  async setDeletePermission(
    auth: AuthDto,
    sharedWithId: string,
    { allowDelete }: { allowDelete: boolean },
  ): Promise<PartnerPermissionsResponseDto> {
    const sharedById = auth.user.id;

    // only a live partnership can carry a grant, otherwise the setting would silently take effect
    // if the same partnership were recreated later
    const partner = await this.partnerRepository.get({ sharedById, sharedWithId });
    if (!partner) {
      throw new BadRequestException('Partner not found');
    }

    await setPartnerDeleteGrant(this.systemMetadataRepository, { sharedById, sharedWithId, allowDelete });
    this.logger.log(
      `${allowDelete ? 'Granted' : 'Revoked'} partner delete permission ${partnerGrantKey(sharedById, sharedWithId)}`,
    );

    return this.get(auth);
  }
}
