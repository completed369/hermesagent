import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BoardService } from './board.service';
import { SessionAuthGuard, type AuthenticatedUser } from '../../common/guards/session-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('board')
@Controller()
@UseGuards(SessionAuthGuard, PermissionGuard)
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  @Post('venture-proposals/:id/board-reviews')
  @RequirePermission('board:manage')
  startReview(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boardService.startReview(user.workspaceId, id, user.userId);
  }

  @Get('venture-proposals/:id/board-reviews')
  @RequirePermission('board:view')
  listForProposal(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boardService.listForProposal(user.workspaceId, id);
  }

  @Get('board-reviews/:id')
  @RequirePermission('board:view')
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boardService.getById(user.workspaceId, id);
  }
}
