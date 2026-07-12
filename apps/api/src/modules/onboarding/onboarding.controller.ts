import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { onboardingSchema } from './onboarding.dto';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(SessionAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.get(user.workspaceId);
  }

  @Put()
  save(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = onboardingSchema.parse(body);
    return this.onboardingService.save(user.workspaceId, input);
  }
}
