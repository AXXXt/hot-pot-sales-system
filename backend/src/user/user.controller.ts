import { Controller, Get, Post, Patch, Param, Query, Body, ParseIntPipe, DefaultValuePipe, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger'
import { UserService } from './user.service'
import { CreateUserDto, UpdateUserDto, CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/user.dto'
import { JwtAuthGuard } from '../auth/auth.guard'

@ApiTags('users')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get('users')
  @ApiOperation({ summary: '用户列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async listUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number = 10
  ) { return this.service.listUsers(page, pageSize) }

  @Post('users')
  @ApiOperation({ summary: '创建用户' })
  async createUser(@Body() dto: CreateUserDto) { return this.service.createUser(dto) }

  @Get('users/:id')
  @ApiOperation({ summary: '用户详情' })
  async getUser(@Param('id', ParseIntPipe) id: number) { return this.service.getUser(id) }

  @Patch('users/:id')
  @ApiOperation({ summary: '更新用户' })
  async updateUser(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) { return this.service.updateUser(id, dto) }

  @Get('roles')
  @ApiOperation({ summary: '角色列表' })
  async listRoles() { return this.service.listRoles() }

  @Post('roles')
  @ApiOperation({ summary: '创建角色' })
  async createRole(@Body() dto: CreateRoleDto) { return this.service.createRole(dto) }

  @Patch('roles/:id')
  @ApiOperation({ summary: '更新角色' })
  async updateRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) { return this.service.updateRole(id, dto) }

  @Post('roles/:id/permissions')
  @ApiOperation({ summary: '分配权限' })
  async assignPermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignPermissionsDto) {
    return this.service.assignPermissions(id, dto)
  }

  @Get('permissions')
  @ApiOperation({ summary: '权限列表' })
  async listPermissions() { return this.service.listPermissions() }
}
