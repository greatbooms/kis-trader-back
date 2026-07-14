import { KisOrderHistoryPaginationService } from './kis-order-history-pagination.service';

describe('KisOrderHistoryPaginationService', () => {
  let service: KisOrderHistoryPaginationService;

  beforeEach(() => {
    service = new KisOrderHistoryPaginationService();
  });

  it('collects M/F pages, requests continuation with N, and de-duplicates by broker identity', async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: '20260713:NASD:1001', value: 'first' }],
        trCont: ' m ',
        fk: ' fk-1 ',
        nk: ' nk-1 ',
      })
      .mockResolvedValueOnce({
        rows: [
          { id: '20260713:NASD:1001', value: 'duplicate' },
          { id: '20260713:NASD:1002', value: 'second' },
        ],
        trCont: 'F',
        fk: 'fk-2',
        nk: 'nk-2',
      })
      .mockResolvedValueOnce({
        rows: [{ id: '20260713:NASD:1003', value: 'third' }],
        trCont: 'D',
      });

    const result = await service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row) => row.id,
    });

    expect(result).toEqual([
      { id: '20260713:NASD:1001', value: 'first' },
      { id: '20260713:NASD:1002', value: 'second' },
      { id: '20260713:NASD:1003', value: 'third' },
    ]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      page: 1,
      fk: '',
      nk: '',
      additionalHeaders: undefined,
    });
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      page: 2,
      fk: 'fk-1',
      nk: 'nk-1',
      additionalHeaders: { tr_cont: 'N' },
    });
    expect(fetchPage).toHaveBeenNthCalledWith(3, {
      page: 3,
      fk: 'fk-2',
      nk: 'nk-2',
      additionalHeaders: { tr_cont: 'N' },
    });
  });

  it('requires a nonempty tr_cont header before declaring a read complete', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ rows: [{ id: 'partial' }] });

    await expect(service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row) => row.id,
    })).rejects.toThrow('Test order pagination missing tr_cont at page 1');
  });

  it.each([
    ['FK', ' ', 'nk'],
    ['NK', 'fk', ' '],
  ])('requires nonempty %s continuation context for M/F', async (_field, fk, nk) => {
    const fetchPage = jest.fn().mockResolvedValue({
      rows: [{ id: 'partial' }],
      trCont: 'M',
      fk,
      nk,
    });

    await expect(service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row) => row.id,
    })).rejects.toThrow('Test order pagination missing continuation context at page 1');
  });

  it('tracks the normalized tr_cont/FK/NK tuple and rejects an exact loop', async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'first' }],
        trCont: 'M',
        fk: 'loop-fk',
        nk: 'loop-nk',
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'second' }],
        trCont: ' m ',
        fk: ' loop-fk ',
        nk: ' loop-nk ',
      });

    await expect(service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row) => row.id,
    })).rejects.toThrow('Test order pagination repeated continuation tuple at page 2');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('allows the same FK/NK tokens when the response continuation mode changes', async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'first' }],
        trCont: 'M',
        fk: 'same-fk',
        nk: 'same-nk',
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'second' }],
        trCont: 'F',
        fk: 'same-fk',
        nk: 'same-nk',
      })
      .mockResolvedValueOnce({ rows: [{ id: 'third' }], trCont: 'D' });

    await expect(service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row) => row.id,
    })).resolves.toHaveLength(3);
  });

  it('wraps a later page error and never returns accumulated partial rows', async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'partial' }],
        trCont: 'M',
        fk: 'next-fk',
        nk: 'next-nk',
      })
      .mockRejectedValueOnce(new Error('broker read failed'));

    await expect(service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row) => row.id,
    })).rejects.toThrow('Test order pagination failed at page 2: broker read failed');
  });

  it('rejects a malformed rows payload instead of treating it as an empty complete result', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ rows: undefined, trCont: 'D' });

    await expect(service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row: { id: string }) => row.id,
    })).rejects.toThrow('Test order pagination returned malformed rows at page 1');
  });

  it('allows a final page 100', async () => {
    const fetchPage = jest.fn().mockImplementation(async ({ page }) => ({
      rows: [{ id: String(page) }],
      trCont: page === 100 ? 'D' : 'M',
      fk: `fk-${page}`,
      nk: `nk-${page}`,
    }));

    await expect(service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row) => row.id,
    })).resolves.toHaveLength(100);
    expect(fetchPage).toHaveBeenCalledTimes(100);
  });

  it('throws after page 100 indicates page 101 is required, without requesting page 101', async () => {
    const fetchPage = jest.fn().mockImplementation(async ({ page }) => ({
      rows: [{ id: String(page) }],
      trCont: 'M',
      fk: `fk-${page}`,
      nk: `nk-${page}`,
    }));

    await expect(service.paginate({
      label: 'Test order',
      fetchPage,
      getDedupeKey: (row) => row.id,
    })).rejects.toThrow('Test order pagination exceeded 100 pages');
    expect(fetchPage).toHaveBeenCalledTimes(100);
  });
});
