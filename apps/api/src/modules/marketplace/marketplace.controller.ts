import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MarketplaceService } from './marketplace.service';
import { publishListingSchema } from './marketplace.dto';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('marketplace')
@Controller('marketplace/listings')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get(':listingVersionId')
  @RequirePermission('marketplace:view')
  getStatus(
    @Param('listingVersionId') listingVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.marketplaceService.getStatus(user.workspaceId, listingVersionId);
  }

  @Post(':listingVersionId/start')
  @RequirePermission('marketplace:manage')
  start(
    @Param('listingVersionId') listingVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.marketplaceService.startWorkflow(user.workspaceId, listingVersionId, user.userId);
  }

  @Post(':listingVersionId/prepare')
  @RequirePermission('marketplace:manage')
  prepare(
    @Param('listingVersionId') listingVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.marketplaceService.prepare(user.workspaceId, listingVersionId, user.userId);
  }

  @Post(':listingVersionId/request-publication-approval')
  @RequirePermission('marketplace:manage')
  requestApproval(
    @Param('listingVersionId') listingVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.marketplaceService.requestApproval(user.workspaceId, listingVersionId, user.userId);
  }

  @Post(':listingVersionId/publish')
  @RequirePermission('marketplace:manage')
  publish(
    @Param('listingVersionId') listingVersionId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = publishListingSchema.parse(body);
    return this.marketplaceService.publish(
      user.workspaceId,
      listingVersionId,
      input.approvalRequestId,
      user.userId,
    );
  }
}
