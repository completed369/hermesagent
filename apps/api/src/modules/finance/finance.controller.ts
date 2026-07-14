import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import {
  upsertFinancialAssumptionSchema,
  generateForecastSchema,
  createExpenseSchema,
  createRevenueEntrySchema,
  createBudgetSchema,
  createExperimentSchema,
  recordExperimentResultSchema,
  decideExperimentSchema,
} from './finance.dto';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('finance')
@Controller('finance')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // --- Assumptions & forecasts ---------------------------------------------

  @Get('ventures/:ventureProposalId/assumptions')
  @RequirePermission('finance:view')
  getAssumption(
    @Param('ventureProposalId') ventureProposalId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.getAssumption(user.workspaceId, ventureProposalId);
  }

  @Post('ventures/:ventureProposalId/assumptions')
  @RequirePermission('finance:manage')
  upsertAssumption(
    @Param('ventureProposalId') ventureProposalId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = upsertFinancialAssumptionSchema.parse(body);
    return this.financeService.upsertAssumption(
      user.workspaceId,
      ventureProposalId,
      input,
      user.userId,
    );
  }

  @Post('ventures/:ventureProposalId/forecast')
  @RequirePermission('finance:manage')
  createForecast(
    @Param('ventureProposalId') ventureProposalId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = generateForecastSchema.parse(body);
    return this.financeService.createForecast(
      user.workspaceId,
      ventureProposalId,
      input.baseUnitsSold,
      input.scenarioMultipliers,
      user.userId,
    );
  }

  @Get('ventures/:ventureProposalId/forecast')
  @RequirePermission('finance:view')
  getLatestForecast(
    @Param('ventureProposalId') ventureProposalId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.getLatestForecast(user.workspaceId, ventureProposalId);
  }

  @Get('ventures/:ventureProposalId/forecast-vs-actual')
  @RequirePermission('finance:view')
  getForecastVsActual(
    @Param('ventureProposalId') ventureProposalId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.getForecastVsActual(user.workspaceId, ventureProposalId);
  }

  // --- Expenses & revenue ---------------------------------------------------

  @Post('ventures/:ventureProposalId/expenses')
  @RequirePermission('finance:manage')
  createExpense(
    @Param('ventureProposalId') ventureProposalId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = createExpenseSchema.parse(body);
    return this.financeService.createExpense(
      user.workspaceId,
      ventureProposalId,
      input,
      user.userId,
    );
  }

  @Get('ventures/:ventureProposalId/expenses')
  @RequirePermission('finance:view')
  listExpenses(
    @Param('ventureProposalId') ventureProposalId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.listExpenses(user.workspaceId, ventureProposalId);
  }

  @Post('ventures/:ventureProposalId/revenue')
  @RequirePermission('finance:manage')
  createRevenueEntry(
    @Param('ventureProposalId') ventureProposalId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = createRevenueEntrySchema.parse(body);
    return this.financeService.createRevenueEntry(
      user.workspaceId,
      ventureProposalId,
      input,
      user.userId,
    );
  }

  @Get('ventures/:ventureProposalId/revenue')
  @RequirePermission('finance:view')
  listRevenueEntries(
    @Param('ventureProposalId') ventureProposalId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.listRevenueEntries(user.workspaceId, ventureProposalId);
  }

  // --- Budgets ---------------------------------------------------------------

  @Post('budgets')
  @RequirePermission('finance:manage')
  createBudget(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = createBudgetSchema.parse(body);
    return this.financeService.createBudget(user.workspaceId, input, user.userId);
  }

  @Get('budgets')
  @RequirePermission('finance:view')
  listBudgets(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.listBudgets(user.workspaceId);
  }

  @Get('ledger')
  @RequirePermission('finance:view')
  listCostLedger(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.listCostLedger(user.workspaceId);
  }

  @Get('model-usage')
  @RequirePermission('finance:view')
  listModelUsage(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.listModelUsage(user.workspaceId);
  }

  // --- Experiments -------------------------------------------------------

  @Post('ventures/:ventureProposalId/experiments')
  @RequirePermission('finance:manage')
  createExperiment(
    @Param('ventureProposalId') ventureProposalId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = createExperimentSchema.parse(body);
    return this.financeService.createExperimentForVenture(
      user.workspaceId,
      ventureProposalId,
      input,
      user.userId,
    );
  }

  @Get('ventures/:ventureProposalId/experiments')
  @RequirePermission('finance:view')
  listExperiments(
    @Param('ventureProposalId') ventureProposalId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.listExperiments(user.workspaceId, ventureProposalId);
  }

  @Get('experiments/:experimentId')
  @RequirePermission('finance:view')
  getExperiment(
    @Param('experimentId') experimentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.getExperiment(user.workspaceId, experimentId);
  }

  @Post('experiments/:experimentId/start')
  @RequirePermission('finance:manage')
  startExperiment(
    @Param('experimentId') experimentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.startExperimentRun(user.workspaceId, experimentId, user.userId);
  }

  @Post('experiments/:experimentId/results')
  @RequirePermission('finance:manage')
  recordResult(
    @Param('experimentId') experimentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = recordExperimentResultSchema.parse(body);
    return this.financeService.recordResult(user.workspaceId, experimentId, input, user.userId);
  }

  @Post('experiments/:experimentId/request-scale-approval')
  @RequirePermission('finance:manage')
  requestScaleApproval(
    @Param('experimentId') experimentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.financeService.requestScaleApproval(user.workspaceId, experimentId, user.userId);
  }

  @Post('experiments/:experimentId/decide')
  @RequirePermission('finance:manage')
  decideExperiment(
    @Param('experimentId') experimentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = decideExperimentSchema.parse(body);
    return this.financeService.decideExperimentOutcome(
      user.workspaceId,
      experimentId,
      input,
      user.userId,
    );
  }
}
