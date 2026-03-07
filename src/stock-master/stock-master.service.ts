import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { StockInfo } from './types';

const BASE_URL = 'https://new.real.download.dws.co.kr/common/master';
const TEMP_DIR = path.join(process.cwd(), '.stock-master-tmp');

interface DomesticMasterConfig {
  zipName: string;
  mstName: string;
  exchangeCode: string;
}

interface OverseasMasterConfig {
  zipName: string;
  codName: string;
  exchangeCode: string;
}

const DOMESTIC_MASTERS: DomesticMasterConfig[] = [
  { zipName: 'kospi_code.mst.zip', mstName: 'kospi_code.mst', exchangeCode: 'KRX' },
  { zipName: 'kosdaq_code.mst.zip', mstName: 'kosdaq_code.mst', exchangeCode: 'KRX' },
];

const OVERSEAS_MASTERS: OverseasMasterConfig[] = [
  { zipName: 'nasmst.cod.zip', codName: 'NASMST.COD', exchangeCode: 'NASD' },
  { zipName: 'nysmst.cod.zip', codName: 'NYSMST.COD', exchangeCode: 'NYSE' },
  { zipName: 'amsmst.cod.zip', codName: 'AMSMST.COD', exchangeCode: 'AMEX' },
  { zipName: 'hksmst.cod.zip', codName: 'HKSMST.COD', exchangeCode: 'SEHK' },
  { zipName: 'shsmst.cod.zip', codName: 'SHSMST.COD', exchangeCode: 'SHAA' },
  { zipName: 'szsmst.cod.zip', codName: 'SZSMST.COD', exchangeCode: 'SZAA' },
  { zipName: 'tsemst.cod.zip', codName: 'TSEMST.COD', exchangeCode: 'TKSE' },
  { zipName: 'hnxmst.cod.zip', codName: 'HNXMST.COD', exchangeCode: 'HASE' },
  { zipName: 'hsxmst.cod.zip', codName: 'HSXMST.COD', exchangeCode: 'VNSE' },
];

@Injectable()
export class StockMasterService implements OnModuleInit {
  private readonly logger = new Logger(StockMasterService.name);
  private domesticStocks: StockInfo[] = [];
  private overseasStocks: StockInfo[] = [];
  private lastUpdated: Date | null = null;

  async onModuleInit() {
    try {
      await this.loadAllMasters();
    } catch (e) {
      this.logger.warn(`Stock master init failed: ${e.message}. Will retry on next cron.`);
    }
  }

  // 매일 오전 8시 (장 시작 전) 갱신
  @Cron('0 0 8 * * *', { timeZone: 'Asia/Seoul' })
  async refreshMasters() {
    this.logger.log('Refreshing stock master data...');
    await this.loadAllMasters();
  }

  searchStocks(keyword: string, market?: 'DOMESTIC' | 'OVERSEAS', limit = 20): StockInfo[] {
    if (!keyword || keyword.length < 1) return [];

    const lowerKeyword = keyword.toLowerCase();
    const stocks = market === 'DOMESTIC'
      ? this.domesticStocks
      : market === 'OVERSEAS'
        ? this.overseasStocks
        : [...this.domesticStocks, ...this.overseasStocks];

    const results: StockInfo[] = [];
    for (const stock of stocks) {
      if (results.length >= limit) break;
      if (
        stock.stockCode.toLowerCase().includes(lowerKeyword) ||
        stock.stockName.toLowerCase().includes(lowerKeyword) ||
        (stock.englishName && stock.englishName.toLowerCase().includes(lowerKeyword))
      ) {
        results.push(stock);
      }
    }

    return results;
  }

  getStats() {
    return {
      domesticCount: this.domesticStocks.length,
      overseasCount: this.overseasStocks.length,
      lastUpdated: this.lastUpdated,
    };
  }

  private async loadAllMasters(): Promise<void> {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const [domestic, overseas] = await Promise.all([
      this.loadDomesticMasters(),
      this.loadOverseasMasters(),
    ]);

    this.domesticStocks = domestic;
    this.overseasStocks = overseas;
    this.lastUpdated = new Date();

    const exchangeCounts: Record<string, number> = {};
    for (const s of [...domestic, ...overseas]) {
      exchangeCounts[s.exchangeCode] = (exchangeCounts[s.exchangeCode] || 0) + 1;
    }
    const detail = Object.entries(exchangeCounts)
      .map(([code, count]) => `${code}=${count}`)
      .join(', ');
    this.logger.log(`Stock master loaded: ${detail} (total=${domestic.length + overseas.length})`);

    // cleanup
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  private async loadDomesticMasters(): Promise<StockInfo[]> {
    const allStocks: StockInfo[] = [];

    for (const config of DOMESTIC_MASTERS) {
      try {
        const stocks = await this.downloadAndParseDomestic(config);
        allStocks.push(...stocks);
      } catch (e) {
        this.logger.error(`Failed to load ${config.zipName}: ${e.message}`);
      }
    }

    return allStocks;
  }

  private async loadOverseasMasters(): Promise<StockInfo[]> {
    const allStocks: StockInfo[] = [];

    for (const config of OVERSEAS_MASTERS) {
      try {
        const stocks = await this.downloadAndParseOverseas(config);
        allStocks.push(...stocks);
      } catch (e) {
        this.logger.error(`Failed to load ${config.zipName}: ${e.message}`);
      }
    }

    return allStocks;
  }

  private async downloadAndExtract(zipUrl: string, extractName: string): Promise<string> {
    const zipPath = path.join(TEMP_DIR, path.basename(zipUrl));
    const extractPath = path.join(TEMP_DIR, extractName);

    const response = await axios.get(zipUrl, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(zipPath, response.data);

    const { execSync } = require('child_process');
    try {
      execSync(`unzip -o -q "${zipPath}" -d "${TEMP_DIR}"`, { timeout: 10000 });
    } catch {
      throw new Error(`Failed to extract ${zipPath}`);
    }

    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    // zip 내부 파일명이 대소문자가 다를 수 있으므로 case-insensitive 탐색
    if (!fs.existsSync(extractPath)) {
      const files = fs.readdirSync(TEMP_DIR);
      const match = files.find(
        (f) => f.toLowerCase() === extractName.toLowerCase(),
      );
      if (match) {
        return path.join(TEMP_DIR, match);
      }
    }

    return extractPath;
  }

  private async downloadAndParseDomestic(config: DomesticMasterConfig): Promise<StockInfo[]> {
    const url = `${BASE_URL}/${config.zipName}`;
    const filePath = await this.downloadAndExtract(url, config.mstName);

    if (!fs.existsSync(filePath)) {
      this.logger.warn(`File not found after extraction: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, { encoding: 'latin1' });
    const buf = fs.readFileSync(filePath);
    const stocks: StockInfo[] = [];

    // Parse line by line
    // Format: each line has variable length, last 228 bytes are fixed-width fields
    // First part: 단축코드(9) + 표준코드(12) + 한글명(variable)
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.length < 230) continue;

      const mainPart = line.substring(0, line.length - 228);
      const shortCode = mainPart.substring(0, 9).trim();
      const stockName = mainPart.substring(21).trim();

      if (!shortCode || !stockName) continue;

      // Decode Korean name from cp949 buffer
      const lineBytes = Buffer.from(line, 'latin1');
      const mainBytes = lineBytes.subarray(0, lineBytes.length - 228);
      const nameBytes = mainBytes.subarray(21);
      let decodedName: string;
      try {
        const decoder = new TextDecoder('euc-kr');
        decodedName = decoder.decode(nameBytes).trim();
      } catch {
        decodedName = stockName;
      }

      stocks.push({
        stockCode: shortCode,
        stockName: decodedName,
        market: 'DOMESTIC',
        exchangeCode: config.exchangeCode,
      });
    }

    return stocks;
  }

  private async downloadAndParseOverseas(config: OverseasMasterConfig): Promise<StockInfo[]> {
    const url = `${BASE_URL}/${config.zipName}`;
    const filePath = await this.downloadAndExtract(url, config.codName);

    if (!fs.existsSync(filePath)) {
      this.logger.warn(`File not found after extraction: ${filePath}`);
      return [];
    }

    const buf = fs.readFileSync(filePath);
    let content: string;
    try {
      const decoder = new TextDecoder('euc-kr');
      content = decoder.decode(buf);
    } catch {
      content = fs.readFileSync(filePath, 'utf-8');
    }

    const stocks: StockInfo[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length < 8) continue;

      const symbol = cols[4]?.trim();
      const koreanName = cols[6]?.trim();
      const englishName = cols[7]?.trim();
      const securityType = cols[8]?.trim();

      // Only include stocks (type 2) and ETFs (type 3)
      if (!symbol || !koreanName) continue;
      if (securityType && securityType !== '2' && securityType !== '3') continue;

      stocks.push({
        stockCode: symbol,
        stockName: koreanName,
        englishName: englishName || undefined,
        market: 'OVERSEAS',
        exchangeCode: config.exchangeCode,
      });
    }

    return stocks;
  }
}
