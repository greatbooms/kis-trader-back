import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { inflateRawSync } from 'zlib';
import { buildOpenDartDomesticSignals } from './opendart-signal.util';
import { OpenDartDisclosureItem, OpenDartDomesticSignals, OpenDartOwnershipItem } from './types';

interface CachedValue<T> {
  data: T;
  expiresAt: number;
}

@Injectable()
export class OpenDartService {
  private readonly logger = new Logger(OpenDartService.name);
  private readonly apiKey: string;
  private readonly signalCache = new Map<string, CachedValue<OpenDartDomesticSignals | undefined>>();
  private corpCodeCache?: CachedValue<Map<string, string>>;
  private lastRequestAt = 0;
  private static readonly BASE_URL = 'https://opendart.fss.or.kr/api';
  private static readonly CORP_CODE_CACHE_MS = 24 * 60 * 60 * 1000;
  private static readonly SIGNAL_CACHE_MS = 6 * 60 * 60 * 1000;
  private static readonly REQUEST_INTERVAL_MS = 120;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('openDart.apiKey') || '';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async getDomesticSignals(stockCode: string): Promise<OpenDartDomesticSignals | undefined> {
    if (!this.isConfigured()) return undefined;

    const cached = this.signalCache.get(stockCode);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    try {
      const corpCode = await this.getCorpCodeByStockCode(stockCode);
      if (!corpCode) {
        this.signalCache.set(stockCode, { data: undefined, expiresAt: Date.now() + OpenDartService.SIGNAL_CACHE_MS });
        return undefined;
      }

      const [disclosures, ownership] = await Promise.all([
        this.fetchDisclosures(corpCode),
        this.fetchOwnershipReports(corpCode),
      ]);

      const signals = buildOpenDartDomesticSignals(disclosures, ownership);
      this.signalCache.set(stockCode, { data: signals, expiresAt: Date.now() + OpenDartService.SIGNAL_CACHE_MS });
      return signals;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`OpenDART fetch failed for ${stockCode}: ${message}`);
      this.signalCache.set(stockCode, { data: undefined, expiresAt: Date.now() + 30 * 60 * 1000 });
      return undefined;
    }
  }

  private async getCorpCodeByStockCode(stockCode: string): Promise<string | undefined> {
    const map = await this.getCorpCodeMap();
    return map.get(stockCode);
  }

  private async getCorpCodeMap(): Promise<Map<string, string>> {
    if (this.corpCodeCache && this.corpCodeCache.expiresAt > Date.now()) {
      return this.corpCodeCache.data;
    }

    const response = await this.request<Buffer>(
      `${OpenDartService.BASE_URL}/corpCode.xml`,
      { crtfc_key: this.apiKey },
      { responseType: 'arraybuffer' },
    );
    const xml = this.extractFirstZipEntry(Buffer.from(response));
    const entries = [...xml.matchAll(/<list>([\s\S]*?)<\/list>/g)];
    const map = new Map<string, string>();

    for (const [, block] of entries) {
      const corpCode = this.readXmlTag(block, 'corp_code');
      const stockCode = this.readXmlTag(block, 'stock_code');
      if (corpCode && stockCode && stockCode !== ' ') {
        map.set(stockCode.trim(), corpCode.trim());
      }
    }

    this.corpCodeCache = {
      data: map,
      expiresAt: Date.now() + OpenDartService.CORP_CODE_CACHE_MS,
    };
    return map;
  }

  private async fetchDisclosures(corpCode: string): Promise<OpenDartDisclosureItem[]> {
    const { startDate, endDate } = this.getDateRange(90);
    const response = await this.request<{ status: string; list?: OpenDartDisclosureItem[] }>(
      `${OpenDartService.BASE_URL}/list.json`,
      {
        crtfc_key: this.apiKey,
        corp_code: corpCode,
        bgn_de: startDate,
        end_de: endDate,
        last_reprt_at: 'Y',
        page_count: '100',
        sort: 'date',
        sort_mth: 'desc',
      },
    );
    return response.status === '013' ? [] : response.list ?? [];
  }

  private async fetchOwnershipReports(corpCode: string): Promise<OpenDartOwnershipItem[]> {
    const response = await this.request<{ status: string; list?: OpenDartOwnershipItem[] }>(
      `${OpenDartService.BASE_URL}/elestock.json`,
      {
        crtfc_key: this.apiKey,
        corp_code: corpCode,
      },
    );
    return response.status === '013' ? [] : response.list ?? [];
  }

  private async request<T>(
    url: string,
    params: Record<string, string>,
    config: AxiosRequestConfig = {},
  ): Promise<T> {
    const waitMs = Math.max(0, OpenDartService.REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.lastRequestAt = Date.now();
    const response = await axios.get<T>(url, {
      ...config,
      params,
      timeout: 15000,
    });
    return response.data;
  }

  private extractFirstZipEntry(buffer: Buffer): string {
    const eocdSignature = 0x06054b50;
    const centralSignature = 0x02014b50;
    const localSignature = 0x04034b50;
    let eocdOffset = -1;

    for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
      if (buffer.readUInt32LE(offset) === eocdSignature) {
        eocdOffset = offset;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error('OpenDART corp code ZIP EOCD not found');

    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    let offset = centralDirectoryOffset;
    while (offset + 46 <= buffer.length) {
      if (buffer.readUInt32LE(offset) !== centralSignature) break;
      const compressionMethod = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraFieldLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

      if (!fileName.endsWith('/')) {
        if (buffer.readUInt32LE(localHeaderOffset) !== localSignature) {
          throw new Error('OpenDART corp code ZIP local header missing');
        }
        const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
        const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) return compressed.toString('utf8');
        if (compressionMethod === 8) return inflateRawSync(compressed).toString('utf8');
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
      }

      offset += 46 + fileNameLength + extraFieldLength + commentLength;
    }

    throw new Error('OpenDART corp code ZIP entry not found');
  }

  private readXmlTag(xml: string, tag: string): string | undefined {
    const matched = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return matched?.[1];
  }

  private getDateRange(days: number): { startDate: string; endDate: string } {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const endDate = now.toISOString().slice(0, 10).replace(/-/g, '');
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - days);
    const startDate = start.toISOString().slice(0, 10).replace(/-/g, '');
    return { startDate, endDate };
  }
}
