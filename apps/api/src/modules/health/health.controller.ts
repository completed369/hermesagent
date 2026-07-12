import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { TemporalHealthService } from './temporal-health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly temporalHealthService: TemporalHealthService,
  ) {}

  @Get('live')
  live() {
    return this.healthService.liveness();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    const result = await this.healthService.readiness();
    return result;
  }

  @Get('temporal')
  temporal() {
    return this.temporalHealthService.runConnectivityCheck();
  }
}
