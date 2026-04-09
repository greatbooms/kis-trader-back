import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import { KisOverseasService } from './kis-overseas.service';

describe('KisOverseasService', () => {
  const mockKisBase = {
    get: jest.fn(),
  };

  const buildConfigService = (env: 'paper' | 'prod') =>
    ({
      get: jest.fn((key: string) => {
        switch (key) {
          case 'kis.accountNo':
            return '6841383501';
          case 'kis.prodCode':
            return '01';
          case 'kis.env':
            return env;
          default:
            return undefined;
        }
      }),
    }) as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fallback to standard balance when present balance returns INVALID_CHECK_ACNO', async () => {
    const service = new KisOverseasService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
    );

    mockKisBase.get
      .mockRejectedValueOnce(new Error('KIS API error [CTRP6504R] /uapi/overseas-stock/v1/trading/inquire-present-balance: OPSQ2000 - ERROR : INPUT INVALID_CHECK_ACNO'))
      .mockResolvedValueOnce({
        output1: [
          {
            pdno: 'AAPL',
            prdt_name: '애플',
            ccld_qty_smtl1: '10.00000000',
            evlu_pfls_amt2: '120000.00000',
            evlu_pfls_rt1: '5.10',
            ovrs_now_pric1: '212277.75600',
            avg_unpr3: '160290.7250',
            bass_exrt: '1212.60000000',
            unit_amt: '1',
            ovrs_excg_cd: 'NASD',
          },
        ],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      })
      .mockResolvedValue({
        output1: [],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      });

    const first = await service.getBalance();
    const second = await service.getBalance();

    expect(first).toEqual([
      expect.objectContaining({
        stockCode: 'AAPL',
        stockName: '애플',
        quantity: 10,
        exchangeCode: 'NASD',
      }),
    ]);
    expect(mockKisBase.get).toHaveBeenNthCalledWith(
      1,
      '/uapi/overseas-stock/v1/trading/inquire-present-balance',
      'CTRP6504R',
      expect.any(Object),
    );
    expect(mockKisBase.get).toHaveBeenNthCalledWith(
      2,
      '/uapi/overseas-stock/v1/trading/inquire-balance',
      'TTTS3012R',
      expect.objectContaining({
        OVRS_EXCG_CD: 'NASD',
        TR_CRCY_CD: 'USD',
      }),
      {},
    );
    expect(mockKisBase.get).not.toHaveBeenNthCalledWith(
      3,
      '/uapi/overseas-stock/v1/trading/inquire-present-balance',
      'CTRP6504R',
      expect.any(Object),
    );
    expect(second).toEqual([]);
  });

  it('should use standard balance API directly in paper mode', async () => {
    const service = new KisOverseasService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('paper'),
    );

    mockKisBase.get.mockResolvedValue({
      output1: [],
      ctx_area_fk200: '',
      ctx_area_nk200: '',
    });

    await service.getBalance();

    expect(mockKisBase.get).toHaveBeenCalled();
    expect(mockKisBase.get).toHaveBeenCalledWith(
      '/uapi/overseas-stock/v1/trading/inquire-balance',
      'VTTS3012R',
      expect.objectContaining({
        OVRS_EXCG_CD: 'NASD',
        TR_CRCY_CD: 'USD',
      }),
      {},
    );
    expect(mockKisBase.get).not.toHaveBeenCalledWith(
      '/uapi/overseas-stock/v1/trading/inquire-present-balance',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('should fetch overseas balance and cash balances in a single present-balance request', async () => {
    const service = new KisOverseasService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
    );

    mockKisBase.get.mockResolvedValue({
      output1: [
        {
          ovrs_pdno: 'AAPL',
          ovrs_item_name: '애플',
          ovrs_cblc_qty: '3',
          pchs_avg_pric: '180.50',
          now_pric2: '190.25',
          ovrs_stck_evlu_pfls_amt: '29.25',
          evlu_pfls_rt: '5.40',
          ovrs_excg_cd: 'NASD',
        },
      ],
      output2: [
        {
          crcy_cd: 'USD',
          crcy_cd_name: '미국달러',
          frcr_dncl_amt_2: '1200.50',
          frcr_drwg_psbl_amt_1: '1000.25',
        },
      ],
      ctx_area_fk200: '   ',
      ctx_area_nk200: '   ',
    });

    const snapshot = await service.getAccountSnapshot();

    expect(mockKisBase.get).toHaveBeenCalledTimes(1);
    expect(snapshot.balance).toEqual([
      expect.objectContaining({
        stockCode: 'AAPL',
        quantity: 3,
        exchangeCode: 'NASD',
      }),
    ]);
    expect(snapshot.cashBalances).toEqual([
      {
        currencyCode: 'USD',
        currencyName: '미국달러',
        amount: 1200.5,
        withdrawableAmount: 1000.25,
      },
    ]);
  });
});
