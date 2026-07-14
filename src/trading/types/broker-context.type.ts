export interface BrokerContext {
  environment: 'PAPER' | 'PROD';
  accountHash: string;
  maskedAccount: string;
}
