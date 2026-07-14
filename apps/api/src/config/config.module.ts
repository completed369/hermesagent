import { Global, Module } from '@nestjs/common';
import { envProvider } from './env.provider';

/**
 * Global module providing ENV_TOKEN application-wide. Marked @Global() so
 * every feature module (including guards instantiated via @UseGuards, like
 * SessionAuthGuard/PermissionGuard which depend on it) can resolve it
 * without each module having to remember to list envProvider itself - the
 * bug this module fixes (AuditModule and SecurityModule both forgot to).
 */
@Global()
@Module({
  providers: [envProvider],
  exports: [envProvider],
})
export class ConfigModule {}
