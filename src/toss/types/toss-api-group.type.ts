export type TossApiGroup =
  | 'AUTH'
  | 'ACCOUNT'
  | 'ASSET'
  | 'ORDER'
  | 'ORDER_INFO'
  | 'MARKET_DATA';

export interface TossRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number>;
  body?: unknown;
  accountScoped?: boolean;
  mutation?: boolean;
}
