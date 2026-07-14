import { Injectable, Logger } from '@nestjs/common';
import { KisOrderHistoryPaginationOptions } from './types/kis-order-history-pagination.type';

const MAX_ORDER_HISTORY_PAGES = 100;

@Injectable()
export class KisOrderHistoryPaginationService {
  private readonly logger = new Logger(KisOrderHistoryPaginationService.name);

  async paginate<T extends Record<string, any> = Record<string, any>>(
    options: KisOrderHistoryPaginationOptions<T>,
  ): Promise<T[]> {
    const rowsByIdentity = new Map<string, T>();
    const visitedContinuationTuples = new Set<string>();
    let fk = '';
    let nk = '';
    let additionalHeaders: Record<string, string> | undefined;

    for (let page = 1; page <= MAX_ORDER_HISTORY_PAGES; page++) {
      let response;
      try {
        response = await options.fetchPage({ page, fk, nk, additionalHeaders });
      } catch (error) {
        this.fail(
          `${options.label} pagination failed at page ${page}: ${this.errorMessage(error)}`,
        );
      }

      if (!response || !Array.isArray(response.rows)) {
        this.fail(`${options.label} pagination returned malformed rows at page ${page}`);
      }

      for (const row of response.rows) {
        const identity = options.getDedupeKey(row);
        if (!rowsByIdentity.has(identity)) {
          rowsByIdentity.set(identity, row);
        }
      }

      const trCont = this.normalize(response.trCont);
      if (!trCont) {
        this.fail(`${options.label} pagination missing tr_cont at page ${page}`);
      }

      if (trCont !== 'M' && trCont !== 'F') {
        return Array.from(rowsByIdentity.values());
      }

      const nextFk = this.normalize(response.fk, false);
      const nextNk = this.normalize(response.nk, false);
      if (!nextFk || !nextNk) {
        this.fail(
          `${options.label} pagination missing continuation context at page ${page}`,
        );
      }

      const continuationTuple = JSON.stringify([trCont, nextFk, nextNk]);
      if (visitedContinuationTuples.has(continuationTuple)) {
        this.fail(
          `${options.label} pagination repeated continuation tuple at page ${page}`,
        );
      }
      visitedContinuationTuples.add(continuationTuple);

      if (page === MAX_ORDER_HISTORY_PAGES) {
        this.fail(`${options.label} pagination exceeded 100 pages`);
      }

      fk = nextFk;
      nk = nextNk;
      additionalHeaders = { tr_cont: 'N' };
    }

    return this.fail(`${options.label} pagination exceeded 100 pages`);
  }

  private normalize(value: unknown, uppercase = true): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    return uppercase ? normalized.toUpperCase() : normalized;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private fail(message: string): never {
    this.logger.warn(message);
    throw new Error(message);
  }
}
