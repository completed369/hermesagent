import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AUDIT_SERVICE } from './audit.tokens';

@Module({
  controllers: [AuditController],
  providers: [AuditService, { provide: AUDIT_SERVICE, useExisting: AuditService }],
  exports: [AuditService, AUDIT_SERVICE],
})
export class AuditModule {}
