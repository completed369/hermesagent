import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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
  async ready(@Res({ passthrough: true }) response: Response) {
    const result = await this.healthService.readiness();
    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }

  @Get('temporal')
  async temporal(@Res({ passthrough: true }) response: Response) {
    const temporal = await this.temporalHealthService.runConnectivityCheck();
    response.status(temporal.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: temporal.status,
      checks: { temporal },
      timestamp: new Date().toISOString(),
    };
  }
}
