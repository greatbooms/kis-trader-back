import { Module } from '@nestjs/common';
import { OpenDartService } from './opendart.service';

@Module({
  providers: [OpenDartService],
  exports: [OpenDartService],
})
export class OpenDartModule {}
