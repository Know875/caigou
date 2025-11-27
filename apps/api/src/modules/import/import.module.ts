import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { RfqModule } from '../rfq/rfq.module';

@Module({
  imports: [RfqModule],
  controllers: [ImportController],
})
export class ImportModule {}

