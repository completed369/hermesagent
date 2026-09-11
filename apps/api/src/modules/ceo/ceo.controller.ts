import {
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  NotFoundException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { CeoSlackService } from './ceo-slack.service';
import { verifySlackSignature } from './slack-signature';

@Controller('ceo/slack')
export class CeoController {
  constructor(private readonly service: CeoSlackService) {}

  @Post('events')
  @HttpCode(200)
  async events(@Req() request: RawBodyRequest<Request>) {
    if (
      process.env.CEO_SLACK_ENABLED !== 'true' ||
      process.env.DEPLOYMENT_ENVIRONMENT !== 'production'
    )
      throw new NotFoundException();
    if (
      !request.rawBody ||
      !verifySlackSignature(
        request.rawBody,
        request.headers['x-slack-request-timestamp'],
        request.headers['x-slack-signature'],
        process.env.SLACK_SIGNING_SECRET ?? '',
      )
    )
      throw new UnauthorizedException();
    const body: unknown = JSON.parse(request.rawBody.toString('utf8'));
    if (
      body &&
      typeof body === 'object' &&
      'type' in body &&
      body.type === 'url_verification' &&
      'challenge' in body &&
      typeof body.challenge === 'string' &&
      body.challenge.length < 500
    )
      return { challenge: body.challenge };
    await this.service.accept(body);
    return { ok: true };
  }
}
