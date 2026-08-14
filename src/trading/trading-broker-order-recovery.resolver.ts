import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Broker, BrokerOrderActionChannel } from '@prisma/client';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import {
  AssignBrokerContextInput,
  BrokerContextPreviewType,
  BrokerOrderCandidateIdentityInput,
  BrokerOrderCandidateInspectionType,
  BrokerOrderRecoveryItemType,
  BrokerOrderRecoveryTradeInput,
  MatchExistingBrokerOrderInput,
} from './dto';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';
import { AuthenticatedGraphqlContext } from './types/authenticated-graphql-context.type';
import { BrokerActionContext } from './types/broker-action-context.type';

@Resolver()
@UseGuards(GqlAuthGuard)
export class TradingBrokerOrderRecoveryResolver {
  constructor(
    private readonly recoveryService: TradingBrokerOrderRecoveryService,
  ) {}

  @Query(() => [BrokerOrderRecoveryItemType], { name: 'brokerOrderRecoveryItems' })
  getRecoveryItems(): Promise<BrokerOrderRecoveryItemType[]> {
    return this.recoveryService.listRecoveryItems();
  }

  @Query(() => BrokerContextPreviewType, { name: 'currentBrokerContextPreview' })
  getCurrentContextPreview(
    @Args('broker', { type: () => Broker }) broker: Broker,
  ): BrokerContextPreviewType {
    return this.recoveryService.getCurrentContextPreview(broker);
  }

  @Mutation(() => BrokerOrderCandidateInspectionType, {
    name: 'inspectBrokerOrderCandidates',
  })
  inspectBrokerOrderCandidates(
    @Args('input') input: BrokerOrderRecoveryTradeInput,
    @Context() context: AuthenticatedGraphqlContext,
  ): Promise<BrokerOrderCandidateInspectionType> {
    return this.recoveryService.inspectCandidates(
      input.tradeRecordId,
      this.webActionContext(context),
    );
  }

  @Mutation(() => BrokerOrderRecoveryItemType, { name: 'assignCurrentBrokerContext' })
  assignCurrentBrokerContext(
    @Args('input') input: AssignBrokerContextInput,
    @Context() context: AuthenticatedGraphqlContext,
  ): Promise<BrokerOrderRecoveryItemType> {
    return this.recoveryService.assignCurrentContext(
      input.tradeRecordId,
      input.contextToken,
      this.webActionContext(context),
    );
  }

  @Mutation(() => BrokerOrderRecoveryItemType, { name: 'linkBrokerOrderCandidate' })
  linkBrokerOrderCandidate(
    @Args('input') input: BrokerOrderCandidateIdentityInput,
    @Context() context: AuthenticatedGraphqlContext,
  ): Promise<BrokerOrderRecoveryItemType> {
    return this.recoveryService.linkCandidate(input, this.webActionContext(context));
  }

  @Mutation(() => BrokerOrderRecoveryItemType, {
    name: 'confirmBrokerOrderNotSubmitted',
  })
  confirmBrokerOrderNotSubmitted(
    @Args('input') input: BrokerOrderRecoveryTradeInput,
    @Context() context: AuthenticatedGraphqlContext,
  ): Promise<BrokerOrderRecoveryItemType> {
    return this.recoveryService.confirmNotSubmitted(
      input.tradeRecordId,
      this.webActionContext(context),
    );
  }

  @Mutation(() => BrokerOrderRecoveryItemType, {
    name: 'confirmBrokerOrderMatchesExisting',
  })
  confirmBrokerOrderMatchesExisting(
    @Args('input') input: MatchExistingBrokerOrderInput,
    @Context() context: AuthenticatedGraphqlContext,
  ): Promise<BrokerOrderRecoveryItemType> {
    return this.recoveryService.confirmMatchesExisting(
      input,
      this.webActionContext(context),
    );
  }

  @Mutation(() => BrokerOrderRecoveryItemType, { name: 'inspectUnknownCancellation' })
  inspectUnknownCancellation(
    @Args('input') input: BrokerOrderRecoveryTradeInput,
    @Context() context: AuthenticatedGraphqlContext,
  ): Promise<BrokerOrderRecoveryItemType> {
    return this.recoveryService.inspectCancellation(
      input.tradeRecordId,
      this.webActionContext(context),
    );
  }

  @Mutation(() => BrokerOrderRecoveryItemType, {
    name: 'confirmCancellationNotAccepted',
  })
  confirmCancellationNotAccepted(
    @Args('input') input: BrokerOrderRecoveryTradeInput,
    @Context() context: AuthenticatedGraphqlContext,
  ): Promise<BrokerOrderRecoveryItemType> {
    return this.recoveryService.confirmCancellationNotAccepted(
      input.tradeRecordId,
      this.webActionContext(context),
    );
  }

  private webActionContext(context: AuthenticatedGraphqlContext): BrokerActionContext {
    const username = context.req.user?.username?.trim();
    if (!username) {
      throw new UnauthorizedException('Authenticated username is required');
    }
    return {
      channel: BrokerOrderActionChannel.WEB,
      actor: `web:${username}`,
    };
  }
}
