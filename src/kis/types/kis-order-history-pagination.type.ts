export interface KisOrderHistoryPageRequest {
  page: number;
  fk: string;
  nk: string;
  additionalHeaders?: Record<string, string>;
}

export interface KisOrderHistoryPage<T> {
  rows?: T[];
  trCont?: string;
  fk?: string;
  nk?: string;
}

export interface KisOrderHistoryPaginationOptions<T> {
  label: string;
  fetchPage: (
    request: KisOrderHistoryPageRequest,
  ) => Promise<KisOrderHistoryPage<T>>;
  getDedupeKey: (row: T) => string;
}
