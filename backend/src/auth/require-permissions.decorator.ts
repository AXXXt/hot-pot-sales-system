import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS_KEY = 'permissions'

/** 声明接口所需权限码；同时支持类级（整个控制器）与方法级使用。 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions)