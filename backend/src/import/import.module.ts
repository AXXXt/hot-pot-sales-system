import { Module } from '@nestjs/common'
import { ImportController } from './import.controller'
import { ImportService } from './import.service'
import { PrismaService } from '../prisma.service'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  controllers: [ImportController],
  providers: [ImportService, PrismaService]
})
export class ImportModule {}