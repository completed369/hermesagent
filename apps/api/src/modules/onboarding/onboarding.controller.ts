import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { onboardingSchema } from './onboarding.dto';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(SessionAuthGuard, PermissionGuard)
@RequirePermission('workspace:manage')
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboardingService: OnboardingService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.get(user.workspaceId, user.userId);
  }

  @Put()
  save(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = onboardingSchema.parse(body);
    return this.onboardingService.save(user.workspaceId, input, user.userId);
  }
}
