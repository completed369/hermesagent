import { Module } from '@nestjs/common';
import { CeoSlackService } from './ceo-slack.service';
import { CeoController } from './ceo.controller';

@Module({ providers: [CeoSlackService], controllers: [CeoController] })
export class CeoModule {}
