import { Transform, Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator'

export const SERVICE_REQUEST_TYPES = ['after_sales', 'profile_change', 'account_closure', 'invoice', 'delivery'] as const
export const SERVICE_REQUEST_STATUSES = ['pending', 'processing', 'completed', 'rejected'] as const
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value

export class CreateServiceRequestDto {
  @IsUUID('4') clientKey: string
  @IsIn(SERVICE_REQUEST_TYPES) type: typeof SERVICE_REQUEST_TYPES[number]
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) subject: string
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) description: string
  @IsOptional() @IsInt() @Min(1) orderId?: number
}

export class ServiceRequestQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
  @IsOptional() @IsIn(SERVICE_REQUEST_STATUSES) status?: typeof SERVICE_REQUEST_STATUSES[number]
  @IsOptional() @IsIn(SERVICE_REQUEST_TYPES) type?: typeof SERVICE_REQUEST_TYPES[number]
}

export class ProcessServiceRequestDto {
  @IsIn(['processing', 'completed', 'rejected']) status: 'processing' | 'completed' | 'rejected'
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) message: string
  @IsInt() @Min(0) expectedVersion: number
}

export class ServiceOrderQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(64) keyword?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) orderId?: number
}
