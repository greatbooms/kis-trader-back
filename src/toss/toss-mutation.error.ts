import {
  BrokerMutationError,
  type BrokerMutationErrorKind,
} from '../common/broker-mutation.error';

export class TossMutationError extends BrokerMutationError {
  readonly name = TossMutationError.name;

  constructor(kind: BrokerMutationErrorKind, message: string) {
    super(kind, message);
  }
}
