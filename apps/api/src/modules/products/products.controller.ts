import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('products')
@Controller()
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('venture-proposals/:id/products')
  @RequirePermission('product:manage')
  startGeneration(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.startGeneration(user.workspaceId, id, user.userId);
  }

  @Get('venture-proposals/:id/products')
  @RequirePermission('product:view')
  listForProposal(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.listForProposal(user.workspaceId, id);
  }

  @Get('products/:id')
  @RequirePermission('product:view')
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.getById(user.workspaceId, id);
  }

  @Get('products')
  @RequirePermission('product:view')
  listForWorkspace(@CurrentUser() user: AuthenticatedUser) {
    return this.productsService.listForWorkspace(user.workspaceId);
  }
}
