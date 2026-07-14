import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { KisAuthService } from './kis-auth.service';
import { KisBaseService } from './kis-base.service';
import { KisDomesticService } from './kis-domestic.service';
import { KisMutationError } from './kis-mutation.error';
import { KisOrderHistoryPaginationService } from './kis-order-history-pagination.service';
import { KisOrderHistoryService } from './kis-order-history.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('KisDomesticService mutation outcomes', () => {
  const mockKisBase = {
    get: jest.fn(),
    getWithMetadata: jest.fn(),
    post: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'kis.accountNo':
          return '1234567801';
        case 'kis.prodCode':
          return '01';
        case 'kis.env':
          return 'prod';
        default:
          return undefined;
      }
    }),
  } as unknown as ConfigService;

  let service: KisDomesticService;
  const pagination = new KisOrderHistoryPaginationService();
  let orderHistory: KisOrderHistoryService;

  beforeEach(() => {
    jest.useFakeTimers();
    mockKisBase.get.mockReset();
    mockKisBase.getWithMetadata.mockReset();
    mockKisBase.post.mockReset();
    mockedAxios.post.mockReset();
    orderHistory = new KisOrderHistoryService(
      mockKisBase as unknown as KisBaseService,
      configService,
      pagination,
    );
    service = new KisDomesticService(
      mockKisBase as unknown as KisBaseService,
      configService,
      orderHistory,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function successResponse(orderNo: string, orderTime: string) {
    return {
      rt_cd: '0',
      msg_cd: '0000',
      msg1: '정상처리 되었습니다',
      output: {
        KRX_FWDG_ORD_ORGNO: '',
        ODNO: orderNo,
        ORD_TMD: orderTime,
      },
    };
  }

  it('accepts a six-digit broker time across KST midnight using the nearest date', async () => {
    jest.setSystemTime(new Date('2026-07-13T15:02:00.000Z')); // 2026-07-14 00:02 KST
    mockKisBase.post.mockResolvedValue(successResponse(' 0001234567 ', '235959'));

    const result = await service.orderSell('005930', 1, 70000, '00');

    expect(result).toEqual(expect.objectContaining({
      outcome: 'ACCEPTED',
      success: true,
      orderNo: '0001234567',
      brokerOrderDate: '20260713',
      orderTime: '235959',
    }));
  });

  it('uses the actual call start when the response completes much later', async () => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z')); // 10:00 KST
    mockKisBase.post.mockImplementation(async () => {
      jest.setSystemTime(new Date('2026-07-13T01:20:00.000Z'));
      return successResponse('0001234567', '100000');
    });

    const result = await service.orderBuy('005930', 1, 70000, '00');

    expect(result).toEqual(expect.objectContaining({
      outcome: 'ACCEPTED',
      success: true,
      brokerOrderDate: '20260713',
      orderTime: '100000',
    }));
  });

  it('accepts a valid explicit 14-digit KST broker timestamp', async () => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z')); // 10:00 KST
    mockKisBase.post.mockResolvedValue(successResponse('0001234567', '20260713100500'));

    const result = await service.orderBuy('005930', 1, 70000, '00');

    expect(result).toEqual(expect.objectContaining({
      outcome: 'ACCEPTED',
      success: true,
      brokerOrderDate: '20260713',
      orderTime: '100500',
    }));
  });

  it('returns UNKNOWN for a blank broker order number', async () => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    mockKisBase.post.mockResolvedValue(successResponse('   ', '100000'));

    const result = await service.orderSell('005930', 1, 70000, '00');

    expect(result).toEqual(expect.objectContaining({ outcome: 'UNKNOWN', success: false }));
  });

  it.each(['246000', '20260230090000'])('returns UNKNOWN for invalid broker time %s', async (orderTime) => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    mockKisBase.post.mockResolvedValue(successResponse('0001234567', orderTime));

    const result = await service.orderSell('005930', 1, 70000, '00');

    expect(result).toEqual(expect.objectContaining({ outcome: 'UNKNOWN', success: false }));
  });

  it('returns UNKNOWN when broker time is farther than ten minutes from call start', async () => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    mockKisBase.post.mockResolvedValue(successResponse('0001234567', '101001'));

    const result = await service.orderSell('005930', 1, 70000, '00');

    expect(result).toEqual(expect.objectContaining({ outcome: 'UNKNOWN', success: false }));
  });

  it('does not flatten a malformed rt_cd response into REJECTED', async () => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    mockKisBase.post.mockResolvedValue({
      ...successResponse('0001234567', '100000'),
      rt_cd: '0 ',
    });

    const result = await service.orderSell('005930', 1, 70000, '00');

    expect(result).toEqual(expect.objectContaining({ outcome: 'UNKNOWN', success: false }));
  });

  it('returns REJECTED for an explicit KIS business rejection', async () => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    mockKisBase.post.mockRejectedValue(new KisMutationError(
      'BUSINESS_REJECTION',
      'KIS rejected the order',
      { rt_cd: '1', msg_cd: 'APBK0919', msg1: '주문가능수량을 초과했습니다' },
    ));

    const result = await service.orderSell('005930', 1, 70000, '00');

    expect(result).toEqual({
      outcome: 'REJECTED',
      success: false,
      message: 'KIS rejected the order',
    });
  });

  it('returns REJECTED when auth setup proves the order was not submitted', async () => {
    const authService = {
      getAccessToken: jest.fn().mockRejectedValue(new Error('sensitive access token')),
      getAppKey: jest.fn().mockReturnValue('app-key'),
      getAppSecret: jest.fn().mockReturnValue('app-secret'),
      getBaseUrl: jest.fn().mockReturnValue('https://kis.example'),
    } as unknown as KisAuthService;
    const baseConfigService = {
      get: jest.fn().mockReturnValue('prod'),
    } as unknown as ConfigService;
    const realKisBase = new KisBaseService(authService, baseConfigService);
    const realService = new KisDomesticService(
      realKisBase,
      configService,
      orderHistory,
    );

    const resultPromise = realService.orderSell('005930', 1, 70000, '00');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      outcome: 'REJECTED',
      success: false,
      message: 'KIS mutation not submitted [TTTC0011U] /uapi/domestic-stock/v1/trading/order-cash: request setup failed',
    });
    expect(result.message).not.toContain('sensitive');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'bare HTTP error'])('returns UNKNOWN for %s ambiguity', async (message) => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    mockKisBase.post.mockRejectedValue(new KisMutationError('TRANSPORT_UNKNOWN', message));

    const result = await service.orderSell('005930', 1, 70000, '00');

    expect(result).toEqual({
      outcome: 'UNKNOWN',
      success: false,
      message,
    });
  });

  it('classifies a verified cancellation response as ACCEPTED', async () => {
    jest.setSystemTime(new Date('2026-07-13T01:00:00.000Z'));
    mockKisBase.post.mockResolvedValue(successResponse('0007654321', '100100'));

    const result = await service.cancelOrder('0001234567', '005930', 1);

    expect(result).toEqual(expect.objectContaining({
      outcome: 'ACCEPTED',
      success: true,
      orderNo: '0007654321',
      brokerOrderDate: '20260713',
      orderTime: '100100',
    }));
  });

  it('keeps an ambiguous cancellation outcome UNKNOWN', async () => {
    mockKisBase.post.mockRejectedValue(new KisMutationError('TRANSPORT_UNKNOWN', 'cancel timeout'));

    const result = await service.cancelOrder('0001234567', '005930', 1);

    expect(result).toEqual({
      outcome: 'UNKNOWN',
      success: false,
      message: 'cancel timeout',
    });
  });

  function executionRow(overrides: Record<string, string> = {}) {
    return {
      odno: '1001',
      pdno: '005930',
      sll_buy_dvsn_cd: '02',
      ord_qty: '3',
      tot_ccld_qty: '1',
      ord_unpr: '70000',
      avg_prvs: '69900',
      ord_dt: '20260713',
      ord_tmd: '100000',
      ...overrides,
    };
  }

  function unfilledRow(overrides: Record<string, string> = {}) {
    return {
      odno: '2001',
      pdno: '000660',
      sll_buy_dvsn_cd: '01',
      psbl_qty: '2',
      ord_unpr: '120000',
      ...overrides,
    };
  }

  it('follows domestic M/F FK/NK100 pages, sends continuation header, and de-duplicates executions', async () => {
    mockKisBase.getWithMetadata
      .mockResolvedValueOnce({
        data: {
          output1: [executionRow()],
          ctx_area_fk100: ' fk-1 ',
          ctx_area_nk100: ' nk-1 ',
        },
        trCont: 'M',
      })
      .mockResolvedValueOnce({
        data: {
          output1: [
            executionRow(),
            executionRow({
              odno: '1002',
              ord_tmd: '100100',
              rjct_qty: '0',
            }),
          ],
          ctx_area_fk100: 'fk-2',
          ctx_area_nk100: 'nk-2',
        },
        trCont: 'F',
      })
      .mockResolvedValueOnce({
        data: {
          output1: [executionRow({
            odno: '1003',
            ord_tmd: '100200',
            rjct_qty: '1',
            rjct_rson_name: '주문 거부',
          })],
          ctx_area_fk100: '',
          ctx_area_nk100: '',
        },
        trCont: 'D',
      });

    const result = await service.getOrderExecutions('20260713', '20260713');

    expect(result).toHaveLength(3);
    expect(result.map((row) => row.orderNo)).toEqual(['1001', '1002', '1003']);
    expect(result.map((row) => (row as any).rejectionState)).toEqual([
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
    expect(mockKisBase.get).not.toHaveBeenCalled();
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(3);
    expect(mockKisBase.getWithMetadata.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ CTX_AREA_FK100: '', CTX_AREA_NK100: '' }),
    );
    expect(mockKisBase.getWithMetadata.mock.calls[0]?.[3]).toBeUndefined();
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ CTX_AREA_FK100: 'fk-1', CTX_AREA_NK100: 'nk-1' }),
    );
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[3]).toEqual({ tr_cont: 'N' });
    expect(mockKisBase.getWithMetadata.mock.calls[2]?.[2]).toEqual(
      expect.objectContaining({ CTX_AREA_FK100: 'fk-2', CTX_AREA_NK100: 'nk-2' }),
    );
    expect(mockKisBase.getWithMetadata.mock.calls[2]?.[3]).toEqual({ tr_cont: 'N' });
  });

  it('paginates and de-duplicates domestic unfilled orders', async () => {
    mockKisBase.getWithMetadata
      .mockResolvedValueOnce({
        data: {
          output: [unfilledRow()],
          ctx_area_fk100: 'unfilled-fk',
          ctx_area_nk100: 'unfilled-nk',
        },
        trCont: 'M',
      })
      .mockResolvedValueOnce({
        data: {
          output: [unfilledRow(), unfilledRow({ odno: '2002', pdno: '035420' })],
          ctx_area_fk100: '',
          ctx_area_nk100: '',
        },
        trCont: 'D',
      });

    const result = await service.getUnfilledOrders();

    expect(result.map((row) => row.orderNo)).toEqual(['2001', '2002']);
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        CTX_AREA_FK100: 'unfilled-fk',
        CTX_AREA_NK100: 'unfilled-nk',
      }),
    );
    expect(mockKisBase.getWithMetadata.mock.calls[1]?.[3]).toEqual({ tr_cont: 'N' });
  });

  it('throws instead of returning partial domestic rows when continuation context is missing', async () => {
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output1: [executionRow()],
        ctx_area_fk100: 'fk-only',
        ctx_area_nk100: '   ',
      },
      trCont: 'M',
    });

    await expect(service.getOrderExecutions('20260713', '20260713')).rejects.toThrow(
      'Domestic order pagination missing continuation context at page 1',
    );
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(1);
  });

  it('throws instead of treating a missing domestic tr_cont header as a final page', async () => {
    mockKisBase.getWithMetadata.mockResolvedValue({
      data: {
        output1: [executionRow()],
        ctx_area_fk100: '',
        ctx_area_nk100: '',
      },
    });

    await expect(service.getOrderExecutions('20260713', '20260713')).rejects.toThrow(
      'Domestic order pagination missing tr_cont at page 1',
    );
  });

  it('throws instead of returning partial domestic rows when a continuation tuple loops', async () => {
    mockKisBase.getWithMetadata
      .mockResolvedValueOnce({
        data: {
          output1: [executionRow()],
          ctx_area_fk100: 'loop-fk',
          ctx_area_nk100: 'loop-nk',
        },
        trCont: 'M',
      })
      .mockResolvedValueOnce({
        data: {
          output1: [executionRow({ odno: '1002' })],
          ctx_area_fk100: 'loop-fk',
          ctx_area_nk100: 'loop-nk',
        },
        trCont: 'M',
      });

    await expect(service.getOrderExecutions('20260713', '20260713')).rejects.toThrow(
      'Domestic order pagination repeated continuation tuple at page 2',
    );
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(2);
  });

  it('throws instead of returning partial domestic rows when a later page fails', async () => {
    mockKisBase.getWithMetadata
      .mockResolvedValueOnce({
        data: {
          output1: [executionRow()],
          ctx_area_fk100: 'next-fk',
          ctx_area_nk100: 'next-nk',
        },
        trCont: 'F',
      })
      .mockRejectedValueOnce(new Error('page two unavailable'));

    await expect(service.getOrderExecutions('20260713', '20260713')).rejects.toThrow(
      'Domestic order pagination failed at page 2: page two unavailable',
    );
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(2);
  });

  it('throws at the domestic 100-page cap without requesting page 101 or returning partial rows', async () => {
    let page = 0;
    mockKisBase.getWithMetadata.mockImplementation(async () => {
      page += 1;
      return {
        data: {
          output: [unfilledRow({ odno: String(2000 + page) })],
          ctx_area_fk100: `fk-${page}`,
          ctx_area_nk100: `nk-${page}`,
        },
        trCont: 'M',
      };
    });

    await expect(service.getUnfilledOrders()).rejects.toThrow(
      'Domestic order pagination exceeded 100 pages',
    );
    expect(mockKisBase.getWithMetadata).toHaveBeenCalledTimes(100);
  });
});
