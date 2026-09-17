import { IsString, IsOptional, IsInt, IsArray, IsIn, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateUserDto {
  @ApiProperty({ description: '手机号' })
  @IsString() @MaxLength(20)
  phone: string

  @ApiProperty({ description: '姓名' })
  @IsString() @MaxLength(100)
  name: string

  @ApiProperty({ description: '验证码' })
  @IsString() @MaxLength(10)
  code: string

  @ApiProperty({ description: '用户类型', enum: ['super_admin','admin','sales','warehouse','customer_service','finance'] })
  @IsIn(['super_admin','admin','sales','warehouse','customer_service','finance'])
  userType: string

  @ApiPropertyOptional({ description: '关联客户ID' })
  @IsOptional() @IsInt()
  customerId?: number

  @ApiPropertyOptional({ description: '角色ID列表' })
  @IsOptional() @IsArray() @IsInt({ each: true })
  roleIds?: number[]
}

export class UpdateUserDto {
  @ApiPropertyOptional({ description: '姓名' })
  @IsOptional() @IsString() @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ description: '用户类型' })
  @IsOptional() @IsIn(['super_admin','admin','sales','warehouse','customer_service','finance'])
  userType?: string

  @ApiPropertyOptional({ description: '关联客户ID' })
  @IsOptional() @IsInt()
  customerId?: number

  @ApiPropertyOptional({ description: '状态', enum: ['active','disabled'] })
  @IsOptional() @IsIn(['active','disabled'])
  status?: string

  @ApiPropertyOptional({ description: '角色ID列表' })
  @IsOptional() @IsArray() @IsInt({ each: true })
  roleIds?: number[]
}

export class CreateRoleDto {
  @ApiProperty({ description: '角色名称' })
  @IsString() @MaxLength(100)
  name: string

  @ApiProperty({ description: '角色编码' })
  @IsString() @MaxLength(64)
  code: string

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional() @IsString() @MaxLength(255)
  description?: string
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ description: '角色名称' })
  @IsOptional() @IsString() @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional() @IsString() @MaxLength(255)
  description?: string
}

export class AssignPermissionsDto {
  @ApiProperty({ description: '权限ID列表' })
  @IsArray() @IsInt({ each: true })
  permissionIds: number[]
}