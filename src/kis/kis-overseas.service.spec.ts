import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import { KisMutationError } from './kis-mutation.error';
import { KisOrderHistoryPaginationService } from './kis-order-history-pagination.service';
import { KisOrderHistoryService } from './kis-order-history.service';
import { KisOverseasBalanceService } from './kis-overseas-balance.service';
import { KisOverseasCashBalanceService } from './kis-overseas-cash-balance.service';
import { KisOverseasService } from './kis-overseas.service';

describe('KisOverseasService', () => {
  const pagination = new KisOrderHistoryPaginationService();
  const mockKisBase = {
    get: jest.fn(),
    getWithMetadata: jest.fn(),
    post: jest.fn(),
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

  const buildService = (env: 'paper' | 'prod') => {
    const configService = buildConfigService(env);
    const orderHistory = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      configService,
      pagination,
    );
    const cashBalance = new KisOverseasCashBalanceService(
      mockKisBase as unknown as KisBaseService,
      configService,
    );
    const balance = new KisOverseasBalanceService(
      mockKisBase as unknown as KisBaseService,
      configService,
      cashBalance,
    );
    return new KisOverseasService(
      mockKisBase as unknown as KisBaseService,
      configService,
      orderHistory,
      balance,
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should fallback to standard balance when present balance returns INVALID_CHECK_ACNO', async () => {
    const service = buildService('prod');

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
    const service = buildService('paper');

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
    const service = buildService('prod');

    mockKisBase.get
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        output: [
          {
            natn_name: '미국',
            crcy_cd: 'USD',
            frcr_dncl_amt1: '1200.50',
            ustl_buy_amt: '25.00',
            ustl_sll_amt: '61.27',
            frcr_gnrl_ord_psbl_amt: '1236.77',
            frcr_ord_psbl_amt1: '0.000000',
            itgr_ord_psbl_amt: '1237.10',
          },
          {
            natn_name: '캐나다',
            crcy_cd: 'USD',
            frcr_dncl_amt1: '1200.50',
            ustl_buy_amt: '0.00',
            ustl_sll_amt: '0.00',
            frcr_gnrl_ord_psbl_amt: '0.00',
            frcr_ord_psbl_amt1: '0.000000',
            itgr_ord_psbl_amt: '1237.10',
          },
          {
            natn_name: '홍콩',
            crcy_cd: 'HKD',
            frcr_dncl_amt1: '0.000000',
            ustl_buy_amt: '0.00',
            ustl_sll_amt: '0.00',
            frcr_gnrl_ord_psbl_amt: '0.00',
            frcr_ord_psbl_amt1: '0.000000',
            itgr_ord_psbl_amt: '9632.41',
          },
        ],
      });

    const snapshot = await service.getAccountSnapshot();

    expect(mockKisBase.get).toHaveBeenCalledTimes(2);
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
        orderableAmount: 1236.77,
        generalOrderableAmount: 1236.77,
        integratedOrderableAmount: 1237.1,
        pendingBuyAmount: 25,
        pendingSellAmount: 61.27,
      },
    ]);
  });

  it('should fallback to standard balance when present balance items exist but parsed holdings are empty', async () => {
    const service = buildService('prod');

    mockKisBase.get
      .mockResolvedValueOnce({
        output1: [
          {
            ovrs_pdno: 'TQQQ',
            ovrs_item_name: 'PROSHARES QQQ 3X',
            ovrs_cblc_qty: '0',
            pchs_avg_pric: '49.33',
            now_pric2: '49.50',
            ovrs_stck_evlu_pfls_amt: '0',
            evlu_pfls_rt: '0',
            frcr_evlu_pfls_amt: '0',
            ovrs_excg_cd: 'NASD',
          },
        ],
        output2: [
          {
            crcy_cd: 'USD',
            crcy_cd_name: '미국달러',
            frcr_dncl_amt_2: '900.00',
            frcr_drwg_psbl_amt_1: '900.00',
          },
        ],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      })
      .mockResolvedValueOnce({
        output1: [
          {
            pdno: 'TQQQ',
            prdt_name: 'PROSHARES QQQ 3X',
            ccld_qty_smtl1: '1.00000000',
            evlu_pfls_amt2: '0',
            evlu_pfls_rt1: '0',
            ovrs_now_pric1: '49.50000000',
            avg_unpr3: '49.33000000',
            bass_exrt: '1.00000000',
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

    const snapshot = await service.getAccountSnapshot();

    expect(snapshot.balance).toEqual([
      expect.objectContaining({
        stockCode: 'TQQQ',
        quantity: 1,
        exchangeCode: 'NASD',
      }),
    ]);
    expect(snapshot.cashBalances).toEqual([
      expect.objectContaining({
        currencyCode: 'USD',
        amount: 900,
      }),
    ]);
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
  });

  it('should parse current production present-balance and standard-balance response shapes', async () => {
    const service = buildService('prod');

    mockKisBase.get
      .mockResolvedValueOnce({
        output1: [
          {
            prdt_name: 'PROSHARES QQQ 3X',
            cblc_qty13: '0.00000000',
            thdt_buy_ccld_qty1: '1.00000000',
            thdt_sll_ccld_qty1: '0.00000000',
            ccld_qty_smtl1: '1.00000000',
            ord_psbl_qty1: '1.00000000',
            frcr_pchs_amt: '73491.00000',
            frcr_evlu_amt2: '76501.000000',
            evlu_pfls_amt2: '3010.00000',
            evlu_pfls_rt1: '4.09000000',
            pdno: 'TQQQ',
            bass_exrt: '1489.80000000',
            buy_crcy_cd: 'USD',
            ovrs_now_pric1: '76501.23000',
            avg_unpr3: '73491.0000',
            tr_mket_name: '나스닥',
            natn_kor_name: '미국',
            unit_amt: '1',
            ovrs_excg_cd: 'NASD',
          },
        ],
        output2: [
          {
            crcy_cd: 'USD',
            crcy_cd_name: '미국 달러',
            frcr_dncl_amt_2: '1000.000000',
            frcr_drwg_psbl_amt_1: '950.550000',
          },
        ],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      })
      .mockResolvedValueOnce({
        output: [
          {
            crcy_cd: 'USD',
            frcr_dncl_amt1: '1000.000000',
            ustl_buy_amt: '0.000000',
            ustl_sll_amt: '0.000000',
            frcr_ord_psbl_amt1: '950.550000',
          },
        ],
      });

    const snapshot = await service.getAccountSnapshot();

    expect(snapshot.balance).toHaveLength(1);
    expect(snapshot.balance[0]).toMatchObject({
      stockCode: 'TQQQ',
      stockName: 'PROSHARES QQQ 3X',
      quantity: 1,
      exchangeCode: 'NASD',
      profitRate: 4.09,
    });
    expect(snapshot.balance[0]?.avgPrice).toBeCloseTo(49.33, 2);
    expect(snapshot.balance[0]?.currentPrice).toBeCloseTo(51.35, 2);
    expect(snapshot.balance[0]?.profitLoss).toBeCloseTo(2.02, 2);
    expect(snapshot.cashBalances).toEqual([
      {
        currencyCode: 'USD',
        currencyName: '미국 달러',
        amount: 1000,
        withdrawableAmount: 950.55,
        orderableAmount: 950.55,
        pendingBuyAmount: 0,
        pendingSellAmount: 0,
      },
    ]);
  });

  it('should convert negative KRW-based profit/loss to local currency (regression for $-20,374 slack alert)', async () => {
    // 회귀 테스트: present-balance 응답에 frcr_evlu_pfls_amt가 없고 evlu_pfls_amt2(KRW)만 있는 경우,
    // 이전엔 `parsedPrice <= 0` 가드 때문에 음수 값이 환율 변환 없이 KRW 그대로 흘러
    // 슬랙 알림에 "$-20,374" 같이 단위 오류로 표시됐다. 음수도 정상적으로 USD 환산되어야 한다.
    const service = buildService('prod');

    mockKisBase.get
      .mockResolvedValueOnce({
        output1: [
          {
            prdt_name: 'PROSHARES QQQ 3X',
            cblc_qty13: '0.00000000',
            ccld_qty_smtl1: '7.00000000',
            ord_psbl_qty1: '7.00000000',
            evlu_pfls_amt2: '-20374.00000', // KRW 평가손익 (음수)
            evlu_pfls_rt1: '-2.57000000',
            pdno: 'TQQQ',
            bass_exrt: '1500.00000000',
            buy_crcy_cd: 'USD',
            ovrs_now_pric1: '109965.00000', // KRW 환산 현재가 → 73.31 USD
            avg_unpr3: '112875.00000', // KRW 환산 평단 → 75.25 USD
            tr_mket_name: '나스닥',
            natn_kor_name: '미국',
            unit_amt: '1',
            ovrs_excg_cd: 'NASD',
          },
        ],
        output2: [
          {
            crcy_cd: 'USD',
            crcy_cd_name: '미국 달러',
            frcr_dncl_amt_2: '500.000000',
            frcr_drwg_psbl_amt_1: '500.000000',
          },
        ],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      })
      .mockResolvedValueOnce({
        output: [
          {
            crcy_cd: 'USD',
            frcr_dncl_amt1: '500.000000',
            ustl_buy_amt: '0.000000',
            ustl_sll_amt: '0.000000',
            frcr_ord_psbl_amt1: '500.000000',
          },
        ],
      });

    const snapshot = await service.getAccountSnapshot();

    expect(snapshot.balance).toHaveLength(1);
    expect(snapshot.balance[0]?.avgPrice).toBeCloseTo(75.25, 2);
    expect(snapshot.balance[0]?.currentPrice).toBeCloseTo(73.31, 2);
    // -20374 KRW / 1500 환율 ≈ -13.58 USD
    expect(snapshot.balance[0]?.profitLoss).toBeCloseTo(-13.58, 2);
    expect(snapshot.balance[0]?.profitRate).toBe(-2.57);
  });

  it('should use dedicated overseas cancel TR ID and zero unit price when cancelling', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    const service = buildService('prod');

    mockKisBase.post.mockResolvedValue({
      rt_cd: '0',
      msg_cd: '0000',
      msg1: '정상처리 되었습니다',
      output: {
        KRX_FWDG_ORD_ORGNO: '',
        ODNO: '0000000001',
        ORD_TMD: '100100',
      },
    });

    const result = await service.cancelOrder('NASD', '12345678', 'TQQQ', 1, 56.73);

    expect(mockKisBase.post).toHaveBeenCalledWith(
      '/uapi/overseas-stock/v1/trading/order-rvsecncl',
      'TTTT1004U',
      expect.objectContaining({
        OVRS_EXCG_CD: 'NASD',
        PDNO: 'TQQQ',
        ORGN_ODNO: '12345678',
        RVSE_CNCL_DVSN_CD: '02',
        ORD_QTY: '1',
        OVRS_ORD_UNPR: '0',
      }),
    );
    expect(result).toEqual({
      outcome: 'ACCEPTED',
      success: true,
      orderNo: '0000000001',
      brokerOrderDate: '20260713',
      orderTime: '100100',
      message: 'Cancel order placed: NASD:TQQQ #12345678',
    });
  });

  it('should use exchange-specific cancel TR ID for asia markets', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    const service = buildService('prod');

    mockKisBase.post.mockResolvedValue({
      rt_cd: '0',
      msg_cd: '0000',
      msg1: '정상처리 되었습니다',
      output: {
        KRX_FWDG_ORD_ORGNO: '',
        ODNO: '0000000002',
        ORD_TMD: '100100',
      },
    });

    await service.cancelOrder('SEHK', '87654321', '0700', 2, 450);

    expect(mockKisBase.post).toHaveBeenCalledWith(
      '/uapi/overseas-stock/v1/trading/order-rvsecncl',
      'TTTS1003U',
      expect.objectContaining({
        OVRS_EXCG_CD: 'SEHK',
        PDNO: '0700',
        ORGN_ODNO: '87654321',
        RVSE_CNCL_DVSN_CD: '02',
        ORD_QTY: '2',
        OVRS_ORD_UNPR: '0',
      }),
    );
  });

  it('classifies a verified overseas order as ACCEPTED', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    const service = buildService('prod');
    mockKisBase.post.mockResolvedValue({
      rt_cd: '0',
      msg_cd: '0000',
      msg1: '정상처리 되었습니다',
      output: {
        KRX_FWDG_ORD_ORGNO: '',
        ODNO: ' 0000000010 ',
        ORD_TMD: '20260713100400',
      },
    });

    const result = await service.orderSell('NASD', 'TQQQ', 1, 56.73, '00');

    expect(result).toEqual(expect.objectContaining({
      outcome: 'ACCEPTED',
      success: true,
      orderNo: '0000000010',
      brokerOrderDate: '20260713',
      orderTime: '100400',
    }));
  });

  it.each([
    ['order', (service: KisOverseasService) => service.orderBuy('UNKNOWN', 'TQQQ', 1, 56.73, '00')],
    ['cancel', (service: KisOverseasService) => service.cancelOrder('UNKNOWN', '12345678', 'TQQQ', 1, 56.73)],
  ])('rejects an unsupported exchange before POST for %s', async (_label, mutate) => {
    const service = buildService('prod');

    const result = await mutate(service);

    expect(result).toEqual(expect.objectContaining({ outcome: 'REJECTED', success: false }));
    expect(mockKisBase.post).not.toHaveBeenCalled();
  });

  it('keeps a timeout order outcome UNKNOWN', async () => {
    const service = buildService('prod');
    mockKisBase.post.mockRejectedValue(new KisMutationError('TRANSPORT_UNKNOWN', 'order timeout'));

    const result = await service.orderBuy('NASD', 'TQQQ', 1, 56.73, '00');

    expect(result).toEqual({ outcome: 'UNKNOWN', success: false, message: 'order timeout' });
  });

  it('keeps a bare HTTP cancellation outcome UNKNOWN', async () => {
    const service = buildService('prod');
    mockKisBase.post.mockRejectedValue(new KisMutationError('TRANSPORT_UNKNOWN', 'bare HTTP 500'));

    const result = await service.cancelOrder('NASD', '12345678', 'TQQQ', 1, 56.73);

    expect(result).toEqual({ outcome: 'UNKNOWN', success: false, message: 'bare HTTP 500' });
  });

  it('classifies an explicit overseas KIS rejection as REJECTED', async () => {
    const service = buildService('prod');
    mockKisBase.post.mockRejectedValue(new KisMutationError(
      'BUSINESS_REJECTION',
      'KIS rejected cancellation',
      { rt_cd: '1', msg_cd: 'APBK0919', msg1: '취소할 수 없는 주문입니다' },
    ));

    const result = await service.cancelOrder('NASD', '12345678', 'TQQQ', 1, 56.73);

    expect(result).toEqual({ outcome: 'REJECTED', success: false, message: 'KIS rejected cancellation' });
  });

  it('should map overseas intraday bars for VWAP calculation', async () => {
    const service = buildService('prod');

    mockKisBase.get.mockResolvedValue({
      output2: [
        {
          xymd: '20260418',
          xhms: '013000',
          open: '56.0000',
          high: '56.4000',
          low: '55.9000',
          last: '56.2000',
          evol: '100',
          eamt: '5620',
        },
      ],
    });

    const result = await service.getIntradayPrices('NASD', 'TQQQ', 5, 120);

    expect(mockKisBase.get).toHaveBeenCalledWith(
      '/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice',
      'HHDFS76950200',
      {
        AUTH: '',
        EXCD: 'NAS',
        SYMB: 'TQQQ',
        NMIN: '5',
        PINC: '0',
        NEXT: '',
        NREC: '120',
        FILL: '',
        KEYB: '',
      },
    );
    expect(result).toEqual([
      {
        date: '20260418',
        time: '013000',
        open: 56,
        high: 56.4,
        low: 55.9,
        close: 56.2,
        volume: 100,
        amount: 5620,
      },
    ]);
  });

  function executionRow(overrides: Record<string, string> = {}) {
    return {
      odno: '3001',
      pdno: 'TQQQ',
      sll_buy_dvsn_cd: '02',
      ft_ord_qty: '3',
      ft_ccld_qty: '1',
      nccs_qty: '2',
      ft_ord_unpr3: '75.10',
      ft_ccld_unpr3: '75.00',
      ovrs_excg_cd: 'NASD',
      ord_dt: '20260713',
      ord_tmd: '100000',
      dmst_ord_dt: '20260714',
      thco_ord_tmd: '000000',
      ...overrides,
    };
  }

  function unfilledRow(overrides: Record<string, string> = {}) {
    return {
      odno: '4001',
      pdno: 'AAPL',
      sll_buy_dvsn_cd: '01',
      nccs_qty: '2',
      ft_ord_unpr3: '210.50',
      ovrs_excg_cd: 'NASD',
      ...overrides,
    };
  }

  it('follows overseas M/F FK/NK200 pages, sends continuation header, and de-duplicates executions', async () => {
    const service = buildService('prod');
    mockKisBase.getWithMetadata
      .mockResolvedValueOnce({
        data: {
          output: [executionRow()],
          ctx_area_fk200: ' fk-1 ',
          ctx_area_nk200: ' nk-1 ',
        },
        trCont: 'M',
      })
      .mockResolvedValueOnce({
        data: {
          output: [
            executionRow(),
            executionRow({
              odno: '3002',
              ord_tmd: '100100',
              thco_ord_tmd: '000100',
              rjct_rson_name: '   ',
            }),
          ],
          ctx_area_fk200: 'fk-2',
          ctx_area_nk200: 'nk-2',
        },
        trCont: 'F',
      })
      .mockResolvedValueOnce({
        data: {
          output: [executionRow({
            odno: '3003',
            ord_tmd: '100200',
            thco_ord_tmd: '000200',
            rjct_rson_name: '가격 제한 초과',
          })],
          ctx_area_fk200: '',
          ctx_area_nk200: '',
        },
        trCont: 'D',
      });

    const result = await service.getOrderExecutions('20260713', '20260713');

    expect(result).toHaveLength(3);
    expect(result.map((row) => row.orderNo)).toEqual(['3001', '3002', '3003']);
    expect(result.map((row) => (row as any).rejectionState)).toEqual([
      'UNKNOWN',
      'NOT_REJECTED',
      'REJECTED',
    ]);
    expect(result[0]?.rejected).toBeUndefined();
    expect(result[1]?.rejected).toBe(false);
    expect(result[2]).toMatchObject({
      rejected: true,
      rejectedReason: '가격 제한 초과',
    });
    expect(mockKisBase.get).not.toHaveBeenCalled();
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(3);
    expect(mockKisBase.getWithMetadata.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ CTX_AREA_FK200: '', CTX_AREA_NK200: '' }),
    );
    expect(mockKisBase.getWithMetadata.mock.calls[0]?.[3]).toBeUndefined();
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ CTX_AREA_FK200: 'fk-1', CTX_AREA_NK200: 'nk-1' }),
    );
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[3]).toEqual({ tr_cont: 'N' });
    expect(mockKisBase.getWithMetadata.mock.calls[2]?.[2]).toEqual(
      expect.objectContaining({ CTX_AREA_FK200: 'fk-2', CTX_AREA_NK200: 'nk-2' }),
    );
    expect(mockKisBase.getWithMetadata.mock.calls[2]?.[3]).toEqual({ tr_cont: 'N' });
  });

  it('paginates and de-duplicates overseas unfilled orders', async () => {
    const service = buildService('prod');
    mockKisBase.getWithMetadata
      .mockResolvedValue({
        data: {
          output: [],
          ctx_area_fk200: '',
          ctx_area_nk200: '',
        },
        trCont: 'D',
      })
      .mockResolvedValueOnce({
        data: {
          output: [unfilledRow()],
          ctx_area_fk200: 'unfilled-fk',
          ctx_area_nk200: 'unfilled-nk',
        },
        trCont: 'M',
      })
      .mockResolvedValueOnce({
        data: {
          output: [unfilledRow(), unfilledRow({ odno: '4002', pdno: 'MSFT' })],
          ctx_area_fk200: '',
          ctx_area_nk200: '',
        },
        trCont: 'D',
      });

    const result = await service.getUnfilledOrders();

    expect(result.map((row) => row.orderNo)).toEqual(['4001', '4002']);
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        CTX_AREA_FK200: 'unfilled-fk',
        CTX_AREA_NK200: 'unfilled-nk',
      }),
    );
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[3]).toEqual({ tr_cont: 'N' });
  });

  it('throws instead of returning partial overseas rows when continuation context is missing', async () => {
    const service = buildService('prod');
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [executionRow()],
        ctx_area_fk200: '',
        ctx_area_nk200: 'nk-only',
      },
      trCont: 'F',
    });

    await expect(service.getOrderExecutions('20260713', '20260713')).rejects.toThrow(
      'Overseas order pagination missing continuation context at page 1',
    );
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(1);
  });

  it('throws instead of treating a missing overseas tr_cont header as a final page', async () => {
    const service = buildService('prod');
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [executionRow()],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      },
    });

    await expect(service.getOrderExecutions('20260713', '20260713')).rejects.toThrow(
      'Overseas order pagination missing tr_cont at page 1',
    );
  });

  it('throws instead of returning partial overseas rows when a continuation tuple loops', async () => {
    const service = buildService('prod');
    mockKisBase.getWithMetadata
      .mockResolvedValueOnce({
        data: {
          output: [executionRow()],
          ctx_area_fk200: 'loop-fk',
          ctx_area_nk200: 'loop-nk',
        },
        trCont: 'M',
      })
      .mockResolvedValueOnce({
        data: {
          output: [executionRow({ odno: '3002' })],
          ctx_area_fk200: 'loop-fk',
          ctx_area_nk200: 'loop-nk',
        },
        trCont: 'M',
      });

    await expect(service.getOrderExecutions('20260713', '20260713')).rejects.toThrow(
      'Overseas order pagination repeated continuation tuple at page 2',
    );
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(2);
  });

  it('throws instead of returning partial overseas rows when a later page fails', async () => {
    const service = buildService('prod');
    mockKisBase.getWithMetadata
      .mockResolvedValueOnce({
        data: {
          output: [executionRow()],
          ctx_area_fk200: 'next-fk',
          ctx_area_nk200: 'next-nk',
        },
        trCont: 'F',
      })
      .mockRejectedValueOnce(new Error('page two unavailable'));

    await expect(service.getOrderExecutions('20260713', '20260713')).rejects.toThrow(
      'Overseas order pagination failed at page 2: page two unavailable',
    );
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(2);
  });

  it('throws at the overseas 100-page cap without requesting page 101 or returning partial rows', async () => {
    const service = buildService('prod');
    let page = 0;
    mockKisBase.getWithMetadata.mockImplementation(async () => {
      page += 1;
      return {
        data: {
          output: [unfilledRow({ odno: String(4000 + page) })],
          ctx_area_fk200: `fk-${page}`,
          ctx_area_nk200: `nk-${page}`,
        },
        trCont: 'M',
      };
    });

    await expect(service.getUnfilledOrders()).rejects.toThrow(
      'Overseas order pagination exceeded 100 pages',
    );
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(100);
  });
});
