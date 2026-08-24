import { Broker } from '@prisma/client';

const BROKER_LABELS: Record<Broker, string> = {
  KIS: '한국투자',
  TOSS: '토스',
};

export function brokerLabel(broker?: Broker | null): string {
  return broker ? (BROKER_LABELS[broker] ?? broker) : 'UNKNOWN';
}
