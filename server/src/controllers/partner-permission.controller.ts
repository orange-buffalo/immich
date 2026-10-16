import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { PartnerPermissionsResponseDto } from 'src/services/partner-permission.service.js';
import { Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { PartnerPermissionService } from 'src/services/partner-permission.service.js';
import { UUIDParamDto } from 'src/validation.js';

class PartnerDeletePermissionDto extends createZodDto(
  z.object({ allowDelete: z.boolean().describe('Allow this partner to trash and restore my assets') }),
) {}

/**
 * Fork-only, see FORK.md.
 *
 * `@ApiExcludeController` keeps this out of the generated OpenAPI document, so
 * `open-api/immich-openapi-specs.json`, `packages/sdk` and `mobile/openapi` stay byte-identical to
 * upstream and never conflict on a version bump. Both clients call these two routes by hand.
 */
@ApiExcludeController()
@Controller('partner-permissions')
export class PartnerPermissionController {
  constructor(private service: PartnerPermissionService) {}

  @Get()
  @Authenticated({ permission: Permission.PartnerRead })
  getPartnerPermissions(@Auth() auth: AuthDto): Promise<PartnerPermissionsResponseDto> {
    return this.service.get(auth);
  }

  @Put(':id')
  @Authenticated({ permission: Permission.PartnerUpdate })
  setPartnerDeletePermission(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: PartnerDeletePermissionDto,
  ): Promise<PartnerPermissionsResponseDto> {
    return this.service.setDeletePermission(auth, id, dto);
  }
}
