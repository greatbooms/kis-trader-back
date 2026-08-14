import { createHash } from 'crypto';

export function hashBrokerAccount(account: string): string {
  return createHash('sha256').update(account).digest('hex');
}
