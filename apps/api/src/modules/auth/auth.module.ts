import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { envProvider } from '../../config/env.provider';
import { AuditModule } from '../audit/audit.module';
import { AUTH_CLOCK, AuthAbuseService, systemAuthClock } from './auth-abuse.service';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthAbuseService,
    { provide: AUTH_CLOCK, useValue: systemAuthClock },
    envProvider,
  ],
  exports: [AuthService],
})
export class AuthModule {}
