import { Module } from '@nestjs/common';
import { SecService } from './sec.service';

@Module({
  providers: [SecService],
  exports: [SecService],
})
export class SecModule {}
