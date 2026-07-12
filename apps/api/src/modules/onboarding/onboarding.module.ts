import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { envProvider } from '../../config/env.provider';

@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService, envProvider],
})
export class OnboardingModule {}
