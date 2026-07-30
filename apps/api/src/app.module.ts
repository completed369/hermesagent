import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { loadEnv } from '@ventureos/config';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { AuditModule } from './modules/audit/audit.module';
import { SecurityModule } from './modules/security/security.module';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module';
import { BoardModule } from './modules/board/board.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ProductsModule } from './modules/products/products.module';
import { ResearchModule } from './modules/research/research.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { FinanceModule } from './modules/finance/finance.module';
import { BillingModule } from './modules/billing/billing.module';
import { VenturesModule } from './modules/ventures/ventures.module';
import { HealthModule } from './modules/health/health.module';
import { ConfigModule } from './config/config.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { SafeExceptionFilter } from './common/filters/safe-exception.filter';
import { CsrfOriginGuard } from './common/guards/csrf-origin.guard';

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([{ ttl: env.API_RATE_LIMIT_WINDOW_MS, limit: env.API_RATE_LIMIT_MAX }]),
    HealthModule,
    AuthModule,
    WorkspacesModule,
    OnboardingModule,
    AuditModule,
    SecurityModule,
    OpportunitiesModule,
    BoardModule,
    ApprovalsModule,
    ProductsModule,
    ResearchModule,
    MarketplaceModule,
    FinanceModule,
    BillingModule,
    VenturesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfOriginGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
