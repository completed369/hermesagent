import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { TemporalHealthService } from './temporal-health.service';
import { envProvider } from '../../config/env.provider';

@Module({
  controllers: [HealthController],
  providers: [HealthService, TemporalHealthService, envProvider],
})
export class HealthModule {}
