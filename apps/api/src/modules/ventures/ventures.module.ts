import { Module } from '@nestjs/common';
import { VenturesController } from './ventures.controller';
import { VenturesService } from './ventures.service';

@Module({
  controllers: [VenturesController],
  providers: [VenturesService],
})
export class VenturesModule {}
