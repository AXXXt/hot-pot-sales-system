import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator'

class FeaturesDto {
  @IsBoolean() products: boolean
  @IsBoolean() vision: boolean
  @IsBoolean() analytics: boolean
  @IsBoolean() tasks: boolean
}

export class AiSettingsDto {
  @IsBoolean() enabled: boolean
  @IsString() @MaxLength(500) baseUrl: string
  @IsString() @MaxLength(100) textModel: string
  @IsString() @MaxLength(100) visionModel: string
  @IsBoolean() allowWrites: boolean
  @IsInt() @Min(1) @Max(10000) dailyRequests: number
  @IsDefined() @ValidateNested() @Type(() => FeaturesDto) features: FeaturesDto
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string
}

export class AiRunDto {
  @IsString() @MaxLength(4000) text: string
  @IsOptional() @IsIn(['chat', 'today', 'metrics', 'tasks', 'help', 'product']) kind?: string
  @IsOptional() @IsIn(['today', 'week', 'month']) period?: string
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsUUID('4', { each: true }) attachmentIds?: string[]
  @IsOptional() @IsString() @MaxLength(100) page?: string
}

export class UpdateAiDraftDto {
  @IsInt() @Min(1) version: number
  @IsObject() payload: Record<string, unknown>
}

export class ConfirmAiDraftDto {
  @IsInt() @Min(1) version: number
  @IsString() @MaxLength(64) digest: string
}

export class TaskStatusDto {
  @IsIn(['pending', 'completed', 'cancelled']) status: string
}

export class AiScheduleDto {
  @IsString() @MaxLength(100) name: string
  @IsIn(['daily_todos', 'weekly_metrics']) kind: string
  @IsInt() @Min(0) @Max(23) hour: number
  @IsBoolean() enabled: boolean
}

export class AiRoleAccessDto {
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) codes: string[]
}

export class AiBrandAccessDto {
  @IsArray() @ArrayMaxSize(200) @IsInt({ each: true }) @Min(1, { each: true }) brandIds: number[]
}
