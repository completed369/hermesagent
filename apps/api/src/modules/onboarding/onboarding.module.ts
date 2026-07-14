import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { envProvider } from '../../config/env.provider';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, envProvider],
})
export class OnboardingModule {}
