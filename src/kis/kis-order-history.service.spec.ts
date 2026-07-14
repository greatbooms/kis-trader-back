import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import { OVERSEAS_ORDER_TR_IDS } from './types/kis-config.types';
import { KisOrderHistoryPaginationService } from './kis-order-history-pagination.service';
import { KisOrderHistoryService } from './kis-order-history.service';

describe('KisOrderHistoryService', () => {
  const mockKisBase = {
    getWithMetadata: jest.fn(),
  };
  const pagination = new KisOrderHistoryPaginationService();

  const buildConfigService = (env: 'paper' | 'prod') => ({
    get: jest.fn((key: string) => {
      switch (key) {
        case 'kis.accountNo':
          return '1234567801';
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
    jest.resetAllMocks();
  });

  it('owns domestic execution endpoint mapping and conservative rejection normalization', async () => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output1: [
          {
            odno: '1001',
            pdno: '005930',
            sll_buy_dvsn_cd: '02',
            ord_qty: '3',
            tot_ccld_qty: '1',
            ord_unpr: '70000',
            avg_prvs: '69900',
            ord_dt: '20260713',
            ord_tmd: '100000',
          },
          {
            odno: '1002',
            pdno: '000660',
            sll_buy_dvsn_cd: '01',
            ord_qty: '2',
            tot_ccld_qty: '0',
            ord_dt: '20260713',
            ord_tmd: '100100',
            rjct_qty: '0',
          },
          {
            odno: '1003',
            pdno: '035420',
            sll_buy_dvsn_cd: '02',
            ord_qty: '1',
            tot_ccld_qty: '0',
            ord_dt: '20260713',
            ord_tmd: '100200',
            rjct_qty: '1',
            rjct_rson_name: '주문 거부',
          },
        ],
        ctx_area_fk100: '',
        ctx_area_nk100: '',
      },
      trCont: 'D',
    });

    const result = await service.getOrderExecutions(
      'DOMESTIC',
      '20260713',
      '20260713',
    );

    expect(mockKisBase.getWithMetadata).toHaveBeenCalledWith(
      '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
      'TTTC0081R',
      expect.objectContaining({
        CANO: '12345678',
        ACNT_PRDT_CD: '01',
        INQR_STRT_DT: '20260713',
        INQR_END_DT: '20260713',
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: '',
      }),
      undefined,
    );
    expect(result.map((row) => row.rejectionState)).toEqual([
      'UNKNOWN',
      'NOT_REJECTED',
      'REJECTED',
    ]);
    expect(result[0]?.rejected).toBeUndefined();
    expect(result[1]?.rejected).toBe(false);
    expect(result[2]).toMatchObject({
      rejected: true,
      rejectedReason: '주문 거부',
    });
  });

  it('owns overseas execution endpoint mapping and never fabricates false without a rejection field', async () => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [
          {
            odno: '3001',
            pdno: 'TQQQ',
            sll_buy_dvsn_cd: '02',
            ft_ord_qty: '3',
            ft_ccld_qty: '1',
            nccs_qty: '2',
            ovrs_excg_cd: 'NASD',
            ord_dt: '20260713',
            ord_tmd: '100000',
            dmst_ord_dt: '20260714',
            thco_ord_tmd: '000000',
          },
          {
            odno: '3002',
            pdno: 'AAPL',
            sll_buy_dvsn_cd: '01',
            ft_ord_qty: '1',
            ft_ccld_qty: '0',
            nccs_qty: '1',
            ovrs_excg_cd: 'NASD',
            ord_dt: '20260713',
            ord_tmd: '100100',
            dmst_ord_dt: '20260714',
            thco_ord_tmd: '000100',
            rjct_rson_name: ' ',
          },
          {
            odno: '3003',
            pdno: 'MSFT',
            sll_buy_dvsn_cd: '02',
            ft_ord_qty: '1',
            ft_ccld_qty: '0',
            nccs_qty: '1',
            ovrs_excg_cd: 'NYSE',
            ord_dt: '20260713',
            ord_tmd: '100200',
            dmst_ord_dt: '20260714',
            thco_ord_tmd: '000200',
            rjct_rson: '가격 제한 초과',
          },
        ],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      },
      trCont: 'D',
    });

    const result = await service.getOrderExecutions(
      'OVERSEAS',
      '20260713',
      '20260713',
    );

    expect(mockKisBase.getWithMetadata).toHaveBeenCalledWith(
      '/uapi/overseas-stock/v1/trading/inquire-ccnl',
      'TTTS3035R',
      expect.objectContaining({
        PDNO: '%',
        OVRS_EXCG_CD: '%',
        ORD_STRT_DT: '20260712',
        ORD_END_DT: '20260713',
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: '',
      }),
      undefined,
    );
    expect(result.map((row) => row.rejectionState)).toEqual([
      'UNKNOWN',
      'NOT_REJECTED',
      'REJECTED',
    ]);
    expect(result[0]?.rejected).toBeUndefined();
    expect(result[1]?.rejected).toBe(false);
    expect(result[2]?.rejected).toBe(true);
    expect(result[0]).toMatchObject({
      orderDate: '20260714',
      orderTime: '000000',
    });
  });

  it.each([
    ['20260230', '20260714'],
    ['20260714', '20260732'],
  ])('rejects an invalid overseas KST calendar range (%s - %s)', async (
    startDate,
    endDate,
  ) => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      },
      trCont: 'D',
    });

    await expect(service.getOrderExecutions(
      'OVERSEAS',
      startDate,
      endDate,
    )).rejects.toThrow('Invalid KIS calendar date');
    expect(mockKisBase.getWithMetadata).not.toHaveBeenCalled();
  });

  it.each([
    [{ thco_ord_tmd: '120000' }],
    [{ dmst_ord_dt: '20260230', thco_ord_tmd: '246000' }],
  ])('fails the whole overseas execution read for an invalid KST broker timestamp', async (
    brokerTimestamp,
  ) => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [{
          odno: '3999',
          pdno: 'AAPL',
          sll_buy_dvsn_cd: '01',
          ft_ord_qty: '1',
          ft_ccld_qty: '0',
          nccs_qty: '1',
          ovrs_excg_cd: 'NASD',
          ord_dt: '20260713',
          ord_tmd: '230000',
          ...brokerTimestamp,
        }],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      },
      trCont: 'D',
    });

    await expect(service.getOrderExecutions(
      'OVERSEAS',
      '20260714',
      '20260714',
    )).rejects.toThrow('Invalid overseas order KST broker timestamp');
  });

  it('fails closed when a malformed overseas timestamp is hidden behind a duplicate identity', async () => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    const order = {
      odno: '3998',
      pdno: 'AAPL',
      sll_buy_dvsn_cd: '01',
      ft_ord_qty: '1',
      ft_ccld_qty: '0',
      nccs_qty: '1',
      ovrs_excg_cd: 'NASD',
      ord_dt: '20260713',
      ord_tmd: '230000',
      dmst_ord_dt: '20260714',
    };
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [
          { ...order, thco_ord_tmd: '120000' },
          { ...order, thco_ord_tmd: '999999' },
        ],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      },
      trCont: 'D',
    });

    await expect(service.getOrderExecutions(
      'OVERSEAS',
      '20260714',
      '20260714',
    )).rejects.toThrow('Invalid overseas order KST broker timestamp');
  });

  it.each([
    ['order number', { odno: '   ' }],
    ['stock code', { pdno: '' }],
    ['side discriminator', { sll_buy_dvsn_cd: '00' }],
    ['order quantity', { ord_qty: '1.5' }],
    ['filled quantity', { tot_ccld_qty: '-1' }],
    ['order date', { ord_dt: '20260230' }],
    ['order time', { ord_tmd: '246000' }],
  ])('fails the whole domestic execution read for a malformed %s before de-duplication', async (
    _field,
    malformedFields,
  ) => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    const validOrder = {
      odno: '3900',
      pdno: '005930',
      sll_buy_dvsn_cd: '02',
      ord_qty: '2',
      tot_ccld_qty: '1',
      ord_dt: '20260714',
      ord_tmd: '100000',
    };
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output1: [validOrder, { ...validOrder, ...malformedFields }],
        ctx_area_fk100: '',
        ctx_area_nk100: '',
      },
      trCont: 'D',
    });

    await expect(service.getOrderExecutions(
      'DOMESTIC',
      '20260714',
      '20260714',
    )).rejects.toThrow('Invalid domestic execution order row');
  });

  it.each([
    ['order number', { odno: '   ' }],
    ['stock code', { pdno: '' }],
    ['side discriminator', { sll_buy_dvsn_cd: '00' }],
    ['exchange', { ovrs_excg_cd: 'INVALID' }],
    ['order quantity', { ft_ord_qty: '1.5' }],
    ['filled quantity', { ft_ccld_qty: '-1' }],
    ['remaining quantity', { nccs_qty: 'invalid' }],
    ['inconsistent quantities', { nccs_qty: '2' }],
  ])('fails the whole overseas execution read for a malformed %s before de-duplication', async (
    _field,
    malformedFields,
  ) => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    const validOrder = {
      odno: '3901',
      pdno: 'AAPL',
      sll_buy_dvsn_cd: '02',
      ft_ord_qty: '2',
      ft_ccld_qty: '1',
      nccs_qty: '1',
      ovrs_excg_cd: 'NASD',
      dmst_ord_dt: '20260714',
      thco_ord_tmd: '100000',
    };
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [validOrder, { ...validOrder, ...malformedFields }],
        ctx_area_fk200: '',
        ctx_area_nk200: '',
      },
      trCont: 'D',
    });

    await expect(service.getOrderExecutions(
      'OVERSEAS',
      '20260714',
      '20260714',
    )).rejects.toThrow('Invalid overseas execution order row');
  });

  it.each([
    ['DOMESTIC', '/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl', 'TTTC0084R'],
    ['OVERSEAS', '/uapi/overseas-stock/v1/trading/inquire-nccs', 'TTTS3018R'],
  ] as const)('owns %s unfilled endpoint and mapping', async (market, path, trId) => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    const domestic = market === 'DOMESTIC';
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [{
          odno: '4001',
          pdno: domestic ? '005930' : 'AAPL',
          sll_buy_dvsn_cd: '01',
          ...(domestic
            ? { psbl_qty: '2', ord_unpr: '70000' }
            : { nccs_qty: '2', ft_ord_unpr3: '210.50', ovrs_excg_cd: 'NASD' }),
        }],
        ...(domestic
          ? { ctx_area_fk100: '', ctx_area_nk100: '' }
          : { ctx_area_fk200: '', ctx_area_nk200: '' }),
      },
      trCont: 'D',
    });

    const result = await service.getUnfilledOrders(market);

    expect(mockKisBase.getWithMetadata).toHaveBeenCalledWith(
      path,
      trId,
      expect.any(Object),
      undefined,
    );
    expect(result).toEqual([expect.objectContaining({
      orderNo: '4001',
      side: 'SELL',
      quantity: 2,
      ...(domestic ? {} : { exchangeCode: 'NASD' }),
    })]);
  });

  it('fails the whole overseas unfilled read when any exchange scope fails', async () => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    const exchangeScopes = Object.keys(OVERSEAS_ORDER_TR_IDS);
    mockKisBase.getWithMetadata.mockImplementation(
      async (_path, _trId, params: Record<string, string>) => {
        if (params.OVRS_EXCG_CD === exchangeScopes[1]) {
          throw new Error('scope failed');
        }
        return {
          data: {
            output: [],
            ctx_area_fk200: '',
            ctx_area_nk200: '',
          },
          trCont: 'D',
        };
      },
    );

    await expect(service.getUnfilledOrders('OVERSEAS'))
      .rejects.toThrow('scope failed');
    expect(mockKisBase.getWithMetadata.mock.calls.map(
      (call) => call[2].OVRS_EXCG_CD,
    )).toEqual(exchangeScopes.slice(0, 2));
  });

  it('fully paginates every overseas exchange sequentially and dedupes by exchange and order number', async () => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    const exchangeScopes = Object.keys(OVERSEAS_ORDER_TR_IDS);
    const nasdOrder = {
      odno: '4001',
      pdno: 'AAPL',
      sll_buy_dvsn_cd: '01',
      nccs_qty: '2',
      ft_ord_unpr3: '210.50',
      ovrs_excg_cd: 'NASD',
    };
    mockKisBase.getWithMetadata.mockImplementation(
      async (_path, _trId, params: Record<string, string>) => {
        const exchangeCode = params.OVRS_EXCG_CD;
        if (exchangeCode === 'NASD' && params.CTX_AREA_FK200 === '') {
          return {
            data: {
              output: [nasdOrder],
              ctx_area_fk200: 'nasd-fk',
              ctx_area_nk200: 'nasd-nk',
            },
            trCont: 'M',
          };
        }
        if (exchangeCode === 'NASD') {
          return {
            data: {
              output: [nasdOrder],
              ctx_area_fk200: '',
              ctx_area_nk200: '',
            },
            trCont: 'D',
          };
        }
        if (exchangeCode === 'NYSE') {
          return {
            data: {
              output: [
                nasdOrder,
                { ...nasdOrder, pdno: 'IBM', ovrs_excg_cd: 'NYSE' },
              ],
              ctx_area_fk200: '',
              ctx_area_nk200: '',
            },
            trCont: 'D',
          };
        }
        return {
          data: {
            output: [],
            ctx_area_fk200: '',
            ctx_area_nk200: '',
          },
          trCont: 'D',
        };
      },
    );

    const result = await service.getUnfilledOrders('OVERSEAS');

    expect(mockKisBase.getWithMetadata.mock.calls.map(
      (call) => call[2].OVRS_EXCG_CD,
    )).toEqual(['NASD', 'NASD', ...exchangeScopes.slice(1)]);
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[3]).toEqual({
      tr_cont: 'N',
    });
    expect(result.map(
      (order) => `${order.exchangeCode}|${order.orderNo}`,
    )).toEqual(['NASD|4001', 'NYSE|4001']);
  });

  it('uses the query scope when an overseas unfilled row has a blank exchange', async () => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    mockKisBase.getWithMetadata.mockImplementation(
      async (_path, _trId, params: Record<string, string>) => ({
        data: {
          output: params.OVRS_EXCG_CD === 'NYSE'
            ? [{
              odno: '4100',
              pdno: 'IBM',
              sll_buy_dvsn_cd: '01',
              nccs_qty: '1',
              ft_ord_unpr3: '280.00',
              ovrs_excg_cd: '   ',
            }]
            : [],
          ctx_area_fk200: '',
          ctx_area_nk200: '',
        },
        trCont: 'D',
      }),
    );

    await expect(service.getUnfilledOrders('OVERSEAS')).resolves.toEqual([
      expect.objectContaining({
        orderNo: '4100',
        exchangeCode: 'NYSE',
      }),
    ]);
  });

  it.each([
    ['order number', { odno: '   ' }],
    ['stock code', { pdno: '' }],
    ['side discriminator', { sll_buy_dvsn_cd: '00' }],
    ['exchange', { ovrs_excg_cd: 'INVALID' }],
  ])('fails closed for a malformed overseas unfilled %s', async (
    _field,
    malformedFields,
  ) => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    const validOrder = {
      odno: '4200',
      pdno: 'AAPL',
      sll_buy_dvsn_cd: '01',
      nccs_qty: '1',
      ft_ord_unpr3: '210.50',
      ovrs_excg_cd: 'NASD',
    };
    mockKisBase.getWithMetadata.mockImplementation(
      async (_path, _trId, params: Record<string, string>) => ({
        data: {
          output: params.OVRS_EXCG_CD === 'NASD'
            ? [validOrder, { ...validOrder, ...malformedFields }]
            : [],
          ctx_area_fk200: '',
          ctx_area_nk200: '',
        },
        trCont: 'D',
      }),
    );

    await expect(service.getUnfilledOrders('OVERSEAS'))
      .rejects.toThrow('Invalid overseas unfilled order row');
  });

  it.each([
    ['order number', { odno: '   ' }],
    ['stock code', { pdno: '' }],
    ['side discriminator', { sll_buy_dvsn_cd: '00' }],
    ['remaining quantity', { psbl_qty: '1.5' }],
  ])('fails the whole domestic unfilled read for a malformed positive %s before de-duplication', async (
    _field,
    malformedFields,
  ) => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    const validOrder = {
      odno: '4300',
      pdno: '005930',
      sll_buy_dvsn_cd: '02',
      psbl_qty: '2',
      ord_unpr: '70000',
    };
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output: [validOrder, { ...validOrder, ...malformedFields }],
        ctx_area_fk100: '',
        ctx_area_nk100: '',
      },
      trCont: 'D',
    });

    await expect(service.getUnfilledOrders('DOMESTIC'))
      .rejects.toThrow('Invalid domestic unfilled order row');
  });

  it('fails the whole overseas unfilled read for a malformed positive remaining quantity', async () => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('prod'),
      pagination,
    );
    mockKisBase.getWithMetadata.mockImplementation(
      async (_path, _trId, params: Record<string, string>) => ({
        data: {
          output: params.OVRS_EXCG_CD === 'NASD'
            ? [{
              odno: '4301',
              pdno: 'AAPL',
              sll_buy_dvsn_cd: '02',
              nccs_qty: '1.5',
              ft_ord_unpr3: '210.50',
              ovrs_excg_cd: 'NASD',
            }]
            : [],
          ctx_area_fk200: '',
          ctx_area_nk200: '',
        },
        trCont: 'D',
      }),
    );

    await expect(service.getUnfilledOrders('OVERSEAS'))
      .rejects.toThrow('Invalid overseas unfilled order row');
  });

  it.each([
    ['DOMESTIC', 'VTTC0081R'],
    ['OVERSEAS', 'VTTS3035R'],
  ] as const)('uses the paper execution TR ID for %s', async (market, trId) => {
    const service = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      buildConfigService('paper'),
      pagination,
    );
    const domestic = market === 'DOMESTIC';
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        ...(domestic ? { output1: [] } : { output: [] }),
        ...(domestic
          ? { ctx_area_fk100: '', ctx_area_nk100: '' }
          : { ctx_area_fk200: '', ctx_area_nk200: '' }),
      },
      trCont: 'D',
    });

    await service.getOrderExecutions(market, '20260713', '20260713');

    expect(mockKisBase.getWithMetadata.mock.calls[0]?.[1]).toBe(trId);
    if (!domestic) {
      expect(mockKisBase.getWithMetadata.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({
          PDNO: '',
          OVRS_EXCG_CD: '',
        }),
      );
    }
  });
});
