import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { LegalController } from './legal.controller'

@Module({ imports: [AuthModule], controllers: [LegalController] })
export class LegalModule {}
