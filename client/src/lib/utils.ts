import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 거래소 코드 → 통화 코드 매핑 */
const EXCHANGE_CURRENCY: Record<string, string> = {
  KRX: 'KRW',
  NASD: 'USD', NYSE: 'USD', AMEX: 'USD',
  SEHK: 'HKD',
  SHAA: 'CNY', SZAA: 'CNY',
  TKSE: 'JPY',
  HASE: 'VND', VNSE: 'VND',
}

/** 통화 코드 → 로케일 매핑 */
const CURRENCY_LOCALE: Record<string, string> = {
  KRW: 'ko-KR', USD: 'en-US', HKD: 'en-HK',
  CNY: 'zh-CN', JPY: 'ja-JP', VND: 'vi-VN',
}

export function formatCurrency(value: number, market?: string, exchangeCode?: string): string {
  const currency = exchangeCode
    ? (EXCHANGE_CURRENCY[exchangeCode] || 'USD')
    : (market === 'OVERSEAS' ? 'USD' : 'KRW')

  const locale = CURRENCY_LOCALE[currency] || 'en-US'
  const fractionDigits = currency === 'KRW' || currency === 'VND' || currency === 'JPY' ? 0 : 2

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ko-KR').format(value)
}

export function formatPercent(value: number): string {
  const pct = value * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}
