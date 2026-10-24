import { Controller, Get, Post, Patch, Param, Query, Body, ParseIntPipe, DefaultValuePipe, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger'
import { UserService } from './user.service'
import { CreateUserDto, UpdateUserDto, CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/user.dto'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { StaffAccessService } from '../auth/staff-access.service'

@ApiTags('users')
@Controller()
@RequirePermissions('role:manage')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly service: UserService, private readonly access: StaffAccessService) {}

  @Get('users')
  @ApiOperation({ summary: '用户列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async listUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number = 10,
    @Req() req: any
  ) { return this.service.listUsers(page, pageSize, await this.access.actor(Number(req.user.sub))) }

  @Post('users')
  @ApiOperation({ summary: '创建用户' })
  async createUser(@Body() dto: CreateUserDto, @Req() req: any) { return this.service.createUser(dto, await this.access.actor(Number(req.user.sub))) }

  @Get('users/:id')
  @ApiOperation({ summary: '用户详情' })
  async getUser(@Param('id', ParseIntPipe) id: number, @Req() req: any) { return this.service.getUser(id, await this.access.actor(Number(req.user.sub))) }

  @Patch('users/:id')
  @ApiOperation({ summary: '更新用户' })
  async updateUser(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @Req() req: any) { return this.service.updateUser(id, dto, await this.access.actor(Number(req.user.sub))) }

  @Get('roles')
  @ApiOperation({ summary: '角色列表' })
  async listRoles(@Req() req: any) { return this.service.listRoles(await this.access.actor(Number(req.user.sub))) }

  @Post('roles')
  @ApiOperation({ summary: '创建角色' })
  async createRole(@Body() dto: CreateRoleDto, @Req() req: any) { return this.service.createRole(dto, await this.access.actor(Number(req.user.sub))) }

  @Patch('roles/:id')
  @ApiOperation({ summary: '更新角色' })
  async updateRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto, @Req() req: any) { return this.service.updateRole(id, dto, await this.access.actor(Number(req.user.sub))) }

  @Post('roles/:id/permissions')
  @ApiOperation({ summary: '分配权限' })
  async assignPermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignPermissionsDto, @Req() req: any) {
    return this.service.assignPermissions(id, dto, await this.access.actor(Number(req.user.sub)))
  }

  @Get('permissions')
  @ApiOperation({ summary: '权限列表' })
  async listPermissions(@Req() req: any) { await this.access.actor(Number(req.user.sub)); return this.service.listPermissions() }
}
