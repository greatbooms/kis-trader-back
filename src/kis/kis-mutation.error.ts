import { KisApiResponse, KisOrderOutput } from './types/kis-api.types';
import { OrderResult } from './types/order-result.type';
import { BrokerMutationError } from '../common/broker-mutation.error';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_BROKER_TIME_SKEW_MS = 10 * 60 * 1000;

export class KisMutationError extends BrokerMutationError {
  readonly name = KisMutationError.name;

  constructor(
    readonly kind: 'BUSINESS_REJECTION' | 'TRANSPORT_UNKNOWN',
    message: string,
    readonly response?: KisApiResponse,
  ) {
    super(kind, message);
  }
}

export function isKisBusinessRejectionCode(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

export function classifyKisOrderResponse(
  response: KisApiResponse<KisOrderOutput>,
  callStartedAt: Date,
  acceptedMessage: string,
): OrderResult {
  if (response?.rt_cd !== '0') {
    const isExplicitRejection = isKisBusinessRejectionCode(response?.rt_cd)
      && typeof response.msg_cd === 'string'
      && typeof response.msg1 === 'string'
      && (response.msg_cd.trim().length > 0 || response.msg1.trim().length > 0);
    return isExplicitRejection
      ? rejectedResult(`KIS API rejection: ${response.msg_cd} - ${response.msg1}`)
      : unknownResult('KIS mutation response could not be verified: malformed response envelope');
  }

  const orderNo = typeof response.output?.ODNO === 'string'
    ? response.output.ODNO.trim()
    : '';
  if (!orderNo) {
    return unknownResult('KIS mutation response could not be verified: missing broker order number');
  }

  const brokerTimestamp = resolveBrokerTimestamp(response.output?.ORD_TMD, callStartedAt);
  if (!brokerTimestamp) {
    return unknownResult('KIS mutation response could not be verified: invalid or stale broker time');
  }

  return {
    outcome: 'ACCEPTED',
    success: true,
    orderNo,
    brokerOrderDate: brokerTimestamp.brokerOrderDate,
    orderTime: brokerTimestamp.orderTime,
    message: acceptedMessage,
  };
}

export function classifyKisMutationFailure(error: unknown): OrderResult {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown KIS mutation error');
  if (error instanceof BrokerMutationError) {
    if (error.kind === 'BUSINESS_REJECTION') {
      return rejectedResult(message);
    }
    if (error.kind === 'TRANSPORT_UNKNOWN') {
      return unknownResult(message);
    }
  }
  return unknownResult(message);
}

function rejectedResult(message: string): OrderResult {
  return { outcome: 'REJECTED', success: false, message };
}

function unknownResult(message: string): OrderResult {
  return { outcome: 'UNKNOWN', success: false, message };
}

function resolveBrokerTimestamp(
  rawTimestamp: unknown,
  callStartedAt: Date,
): { brokerOrderDate: string; orderTime: string } | undefined {
  if (!(callStartedAt instanceof Date) || !Number.isFinite(callStartedAt.getTime())) return undefined;
  if (typeof rawTimestamp !== 'string') return undefined;

  const timestamp = rawTimestamp.trim();
  const resolved = timestamp.length === 6
    ? resolveSixDigitTimestamp(timestamp, callStartedAt)
    : timestamp.length === 14
      ? resolveExplicitTimestamp(timestamp)
      : undefined;
  if (!resolved) return undefined;
  if (Math.abs(resolved.instantMs - callStartedAt.getTime()) > MAX_BROKER_TIME_SKEW_MS) return undefined;

  return {
    brokerOrderDate: resolved.brokerOrderDate,
    orderTime: resolved.orderTime,
  };
}

function resolveSixDigitTimestamp(
  timestamp: string,
  callStartedAt: Date,
): { brokerOrderDate: string; orderTime: string; instantMs: number } | undefined {
  const time = parseTime(timestamp);
  if (!time) return undefined;

  const callKst = new Date(callStartedAt.getTime() + KST_OFFSET_MS);
  const candidates = [-1, 0, 1].map((dayOffset) => {
    const kstWallClockMs = Date.UTC(
      callKst.getUTCFullYear(),
      callKst.getUTCMonth(),
      callKst.getUTCDate() + dayOffset,
      time.hour,
      time.minute,
      time.second,
    );
    return {
      brokerOrderDate: formatDate(new Date(kstWallClockMs)),
      orderTime: timestamp,
      instantMs: kstWallClockMs - KST_OFFSET_MS,
    };
  });

  return candidates.reduce((nearest, candidate) => (
    Math.abs(candidate.instantMs - callStartedAt.getTime())
      < Math.abs(nearest.instantMs - callStartedAt.getTime())
      ? candidate
      : nearest
  ));
}

function resolveExplicitTimestamp(
  timestamp: string,
): { brokerOrderDate: string; orderTime: string; instantMs: number } | undefined {
  if (!/^\d{14}$/.test(timestamp)) return undefined;

  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(4, 6));
  const day = Number(timestamp.slice(6, 8));
  const orderTime = timestamp.slice(8);
  const time = parseTime(orderTime);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || !time) return undefined;

  const kstWallClockMs = Date.UTC(year, month - 1, day, time.hour, time.minute, time.second);
  const normalized = new Date(kstWallClockMs);
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
  ) {
    return undefined;
  }

  return {
    brokerOrderDate: timestamp.slice(0, 8),
    orderTime,
    instantMs: kstWallClockMs - KST_OFFSET_MS,
  };
}

function parseTime(timestamp: string): { hour: number; minute: number; second: number } | undefined {
  if (!/^\d{6}$/.test(timestamp)) return undefined;
  const hour = Number(timestamp.slice(0, 2));
  const minute = Number(timestamp.slice(2, 4));
  const second = Number(timestamp.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return { hour, minute, second };
}

function formatDate(kstWallClock: Date): string {
  return [
    String(kstWallClock.getUTCFullYear()).padStart(4, '0'),
    String(kstWallClock.getUTCMonth() + 1).padStart(2, '0'),
    String(kstWallClock.getUTCDate()).padStart(2, '0'),
  ].join('');
}
