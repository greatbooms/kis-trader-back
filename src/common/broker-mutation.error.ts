export type BrokerMutationErrorKind = 'BUSINESS_REJECTION' | 'TRANSPORT_UNKNOWN';

export class BrokerMutationError extends Error {
  constructor(
    readonly kind: BrokerMutationErrorKind,
    message: string,
  ) {
    super(message);
  }
}
