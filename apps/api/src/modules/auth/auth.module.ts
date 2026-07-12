import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { envProvider } from '../../config/env.provider';

@Module({
  controllers: [AuthController],
  providers: [AuthService, envProvider],
  exports: [AuthService],
})
export class AuthModule {}
