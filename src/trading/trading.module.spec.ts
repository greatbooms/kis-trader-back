import { MODULE_METADATA } from '@nestjs/common/constants';
import { TradingModule } from './trading.module';
import { TradingSellApprovalService } from './trading-sell-approval.service';

describe('TradingModule', () => {
  it('registers TradingSellApprovalService as a provider before exporting it', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TradingModule) || [];

    expect(providers).toContain(TradingSellApprovalService);
  });
});
