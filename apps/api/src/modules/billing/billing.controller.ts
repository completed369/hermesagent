import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { changePlanSchema, issueLicenseKeySchema } from './billing.dto';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('billing')
@Controller('billing')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @RequirePermission('billing:view')
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.getSummary(user.workspaceId);
  }

  @Post('change-plan')
  @RequirePermission('billing:manage')
  changePlan(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = changePlanSchema.parse(body);
    return this.billingService.changePlan(user.workspaceId, input.planKey, user.userId);
  }

  @Post('cancel')
  @RequirePermission('billing:manage')
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.cancel(user.workspaceId, user.userId);
  }

  @Post('reactivate')
  @RequirePermission('billing:manage')
  reactivate(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.reactivate(user.workspaceId, user.userId);
  }

  @Get('license-keys')
  @RequirePermission('billing:view')
  listLicenseKeys(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.listLicenseKeys(user.workspaceId);
  }

  @Post('license-keys')
  @RequirePermission('billing:manage')
  issueLicenseKey(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = issueLicenseKeySchema.parse(body);
    return this.billingService.issueLicenseKey(user.workspaceId, input.expiresInDays, user.userId);
  }

  @Delete('license-keys/:id')
  @RequirePermission('billing:manage')
  revokeLicenseKey(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billingService.revokeLicenseKey(user.workspaceId, id, user.userId);
  }
}
