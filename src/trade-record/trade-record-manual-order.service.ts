import { Injectable, Logger } from '@nestjs/common';
import {
  Broker,
  BrokerEnvironment,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  OrderType,
  Prisma,
  TradeRecord,
} from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { BrokerOrderStatus, UnfilledOrder } from '../kis/types/kis-api.types';
import { PrismaService } from '../prisma.service';
import { CancelTradeOrderInput, ManualSellInput } from './dto';
import { TradingBrokerContextService } from '../trading/trading-broker-context.service';
import { TradingBrokerOrderRecoveryService } from '../trading/trading-broker-order-recovery.service';
import { TradingLiveSwitchService } from '../trading/trading-live-switch.service';
import { TradingOrderGuardService } from '../trading/trading-order-guard.service';
import { TradingPositionRefreshService } from '../trading/trading-position-refresh.service';
import { OrderAdmissionKey } from '../trading/types/order-admission-key.type';

@Injectable()
export class TradeRecordManualOrderService {
  private readonly logger = new Logger(TradeRecordManualOrderService.name);

  constructor(
    private prisma: PrismaService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private readonly registry: BrokerPortRegistry,
    private readonly liveSwitch: TradingLiveSwitchService,
    private readonly brokerContext: TradingBrokerContextService,
    private readonly orderGuard: TradingOrderGuardService,
    private readonly positionRefresh: TradingPositionRefreshService,
    private readonly recoveryService: TradingBrokerOrderRecoveryService,
  ) {}

  /** 수동 매도 */
  async manualSell(input: ManualSellInput): Promise<{ success: boolean; message?: string; orderNo?: string }> {
    if (!input.broker) {
      throw new Error('브로커를 지정해주세요.');
    }
    if (!this.liveSwitch.isEnabled()) {
      return { success: false, message: '현재 환경에서는 실거래가 비활성화되어 수동 매도를 실행할 수 없습니다.' };
    }
    if (
      input.quantity !== undefined
      && input.quantity !== null
      && (!Number.isSafeInteger(input.quantity) || input.quantity < 1)
    ) {
      return { success: false, message: '매도 수량은 1 이상의 정수여야 합니다.' };
    }

    let canonicalKey: OrderAdmissionKey = {
      // Resolved from the unique matching position before admission.
      broker: input.broker,
      market: input.market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode: input.market === 'DOMESTIC'
        ? 'KRX'
        : input.exchangeCode.trim().toUpperCase(),
      stockCode: input.stockCode.trim().toUpperCase(),
      side: 'SELL',
    };
    const positions = await this.prisma.position.findMany({
      where: {
        broker: input.broker,
        market: canonicalKey.market as Market,
        exchangeCode: canonicalKey.exchangeCode,
        stockCode: canonicalKey.stockCode,
      },
    });

    if (positions.length !== 1) {
      if (positions.length === 0) {
        throw new Error('보유 포지션을 찾을 수 없습니다.');
      }
      throw new Error('보유 포지션을 하나로 식별할 수 없습니다.');
    }
    const position = positions[0];
    if (input.broker && position.broker !== input.broker) {
      throw new Error('요청한 브로커의 보유 포지션을 찾을 수 없습니다.');
    }
    if (!this.registry.isActive(position.broker)) {
      return {
        success: false,
        message: `${position.broker} 브로커가 비활성화되어 수동 매도를 실행할 수 없습니다.`,
      };
    }
    canonicalKey = { ...canonicalKey, broker: position.broker };

    if (position.quantity <= 0) {
      return { success: false, message: '보유 포지션이 없습니다.' };
    }

    const sellQty = input.quantity ?? position.quantity;
    if (sellQty > position.quantity) {
      return { success: false, message: `보유 수량(${position.quantity})보다 많은 수량입니다.` };
    }

    // 현재가 조회
    let currentPrice: number;
    try {
      if (canonicalKey.market === 'DOMESTIC') {
        const price = await this.kisDomestic.getPrice(canonicalKey.stockCode);
        currentPrice = price.currentPrice;
      } else {
        const price = await this.kisOverseas.getPrice(
          canonicalKey.exchangeCode,
          canonicalKey.stockCode,
        );
        currentPrice = price.currentPrice;
      }
    } catch (e) {
      return { success: false, message: `현재가 조회 실패: ${e.message}` };
    }

    const isOverseas = canonicalKey.market === 'OVERSEAS';
    const roundPrice = isOverseas
      ? Math.round(currentPrice * 100) / 100
      : Math.round(currentPrice);

    const context = this.brokerContext.getCurrentContext(position.broker);
    const record = await this.orderGuard.admit(
      canonicalKey,
      (tx, normalizedKey = canonicalKey) => {
        canonicalKey = normalizedKey;
        return tx.tradeRecord.create({
          data: {
            broker: position.broker,
            market: canonicalKey.market as Market,
            exchangeCode: canonicalKey.exchangeCode,
            stockCode: canonicalKey.stockCode,
            stockName: position.stockName,
            side: canonicalKey.side,
            orderType: OrderType.LIMIT,
            quantity: sellQty,
            price: new Prisma.Decimal(roundPrice),
            status: OrderStatus.SUBMITTING,
            strategyName: 'manual',
            reason: '수동 매도',
            submissionStartedAt: null,
            brokerEnvironment: context.environment,
            brokerAccountHash: context.accountHash,
          },
        });
      },
    );
    if (!record) {
      return { success: false, message: '동일 종목의 미해결 매도 주문이 이미 있습니다.' };
    }

    let snapshot;
    try {
      snapshot = await this.positionRefresh.refresh(position.broker, canonicalKey.market);
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[${canonicalKey.broker} ${canonicalKey.stockCode}] Manual sell position refresh failed: ${message}`);
      await this.cancelPreSubmit(record.id, '포지션 동기화 실패로 수동 매도 취소');
      return { success: false, message: `보유 수량 동기화 실패: ${message}` };
    }

    if (!this.matchesCapturedBrokerContext(
      position.broker,
      context.environment,
      context.accountHash,
      canonicalKey.stockCode,
    )) {
      await this.cancelPreSubmit(
        record.id,
        '브로커 컨텍스트 검증 실패로 수동 매도 취소',
      );
      return {
        success: false,
        message: `${position.broker} 계좌 정보를 확인할 수 없어 수동 매도를 중단했습니다.`,
      };
    }

    const holding = snapshot.find((item) => (
      item.stockCode.trim().toUpperCase() === canonicalKey.stockCode
      && (canonicalKey.market === 'DOMESTIC'
        ? (item.exchangeCode || 'KRX').trim().toUpperCase() === 'KRX'
        : item.exchangeCode?.trim().toUpperCase() === canonicalKey.exchangeCode)
    ));
    const executableQty = Math.min(sellQty, holding?.quantity || 0);
    if (executableQty <= 0) {
      await this.cancelPreSubmit(record.id, '보유 수량 없음으로 수동 매도 취소');
      return { success: false, message: '보유 포지션이 없습니다.' };
    }

    if (!this.liveSwitch.isEnabled()) {
      await this.cancelPreSubmit(record.id, '실거래 비활성화로 수동 매도 취소');
      return { success: false, message: '현재 환경에서는 실거래가 비활성화되어 수동 매도를 실행할 수 없습니다.' };
    }
    if (!this.registry.isActive(position.broker)) {
      await this.cancelPreSubmit(record.id, '브로커 비활성화로 수동 매도 취소');
      return {
        success: false,
        message: `${position.broker} 브로커가 비활성화되어 수동 매도를 실행할 수 없습니다.`,
      };
    }

    const submissionStartedAt = new Date();
    const claim = await this.prisma.tradeRecord.updateMany({
      where: {
        id: record.id,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: {
        quantity: executableQty,
        submissionStartedAt,
      },
    });
    if (claim.count === 0) {
      return { success: false, message: '수동 매도 주문이 이미 처리 중입니다.' };
    }

    if (!this.matchesCapturedBrokerContext(
      position.broker,
      context.environment,
      context.accountHash,
      canonicalKey.stockCode,
    )) {
      await this.cancelClaimedSubmission(
        record.id,
        submissionStartedAt,
        '브로커 컨텍스트 검증 실패로 수동 매도 취소',
      );
      return {
        success: false,
        message: `${position.broker} 계좌 정보를 확인할 수 없어 수동 매도를 중단했습니다.`,
      };
    }

    if (!this.liveSwitch.isEnabled()) {
      await this.cancelClaimedSubmission(
        record.id,
        submissionStartedAt,
        '실거래 비활성화로 수동 매도 취소',
      );
      return {
        success: false,
        message: '현재 환경에서는 실거래가 비활성화되어 수동 매도를 실행할 수 없습니다.',
      };
    }
    if (!this.registry.isActive(position.broker)) {
      await this.cancelClaimedSubmission(
        record.id,
        submissionStartedAt,
        '브로커 비활성화로 수동 매도 취소',
      );
      return {
        success: false,
        message: `${position.broker} 브로커가 비활성화되어 수동 매도를 실행할 수 없습니다.`,
      };
    }

    let result;
    try {
      result = await this.registry.requireActive(position.broker).submitOrder({
        broker: position.broker,
        market: canonicalKey.market,
        exchangeCode: canonicalKey.exchangeCode,
        stockCode: canonicalKey.stockCode,
        side: 'SELL',
        quantity: executableQty,
        price: roundPrice,
        orderDivision: '00',
        reason: '수동 매도',
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[${canonicalKey.broker} ${canonicalKey.stockCode}] Manual sell outcome is unknown: ${message}`);
      await this.recoveryService.markSubmissionUnknown(record.id, message);
      return { success: false, message };
    }

    if (result.outcome === 'ACCEPTED' && !this.hasCompleteOrderIdentity(result)) {
      const message = 'Accepted broker response missing required order identity';
      await this.recoveryService.markSubmissionUnknown(record.id, message);
      return { success: false, message };
    }

    if (result.outcome === 'UNKNOWN') {
      await this.recoveryService.markSubmissionUnknown(record.id, result.message);
      return { success: false, message: result.message };
    }

    if (result.outcome === 'REJECTED') {
      await this.prisma.tradeRecord.updateMany({
        where: {
          id: record.id,
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: { not: null },
        },
        data: {
          status: OrderStatus.FAILED,
          brokerMessage: result.message,
        },
      });
      return { success: false, message: result.message };
    }

    const persisted = await this.persistAcceptedManualOrder(
      record.id,
      position.broker,
      canonicalKey.stockCode,
      result,
    );
    if (!persisted) {
      await this.recoveryService.warnAcceptedOrderPersistenceFailure({
        broker: position.broker,
        market: canonicalKey.market,
        stockCode: canonicalKey.stockCode,
        tradeRecordId: record.id,
        orderNo: result.orderNo || 'unknown',
      });
      return {
        success: false,
        orderNo: result.orderNo,
        message: `브로커 주문은 접수되었으나 로컬 저장에 실패했습니다. ${position.broker} 주문 내역 확인이 필요합니다.`,
      };
    }
    this.logger.log(`[${position.broker} ${canonicalKey.stockCode}] Manual sell order submitted: ${executableQty} @ ${roundPrice}`);
    return { success: true, orderNo: result.orderNo, message: `${executableQty}주 매도 주문 접수` };
  }

  private async persistAcceptedManualOrder(
    tradeRecordId: string,
    broker: Broker,
    stockCode: string,
    result: {
      orderNo?: string;
      brokerOrderDate?: string;
      orderTime?: string;
      message: string;
    },
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const persisted = await this.prisma.tradeRecord.updateMany({
          where: {
            id: tradeRecordId,
            status: OrderStatus.SUBMITTING,
            submissionStartedAt: { not: null },
          },
          data: {
            status: OrderStatus.PENDING,
            orderNo: result.orderNo,
            brokerOrderDate: result.brokerOrderDate,
            brokerOrderTime: result.orderTime,
            brokerMessage: result.message,
          },
        });
        return persisted.count > 0;
      } catch (error) {
        this.logger.warn(
          `[${broker} ${stockCode}] Accepted manual order DB persistence failed (${attempt}/3, order ${result.orderNo || 'unknown'}): ${this.errorMessage(error)}`,
        );
      }
    }
    return false;
  }

  private async cancelPreSubmit(tradeRecordId: string, brokerMessage: string): Promise<void> {
    await this.prisma.tradeRecord.updateMany({
      where: {
        id: tradeRecordId,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        brokerMessage,
      },
    });
  }

  private async cancelClaimedSubmission(
    tradeRecordId: string,
    submissionStartedAt: Date,
    brokerMessage: string,
  ): Promise<void> {
    await this.prisma.tradeRecord.updateMany({
      where: {
        id: tradeRecordId,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt,
      },
      data: {
        status: OrderStatus.CANCELLED,
        submissionStartedAt: null,
        brokerMessage,
      },
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private matchesCapturedBrokerContext(
    broker: Broker,
    environment: BrokerEnvironment | null | undefined,
    accountHash: string | null | undefined,
    stockCode: string,
  ): boolean {
    try {
      return this.brokerContext.matchesCurrentContext(broker, environment, accountHash);
    } catch (error) {
      this.logger.warn(
        `[${broker} ${stockCode}] Broker context validation failed: ${this.errorMessage(error)}`,
      );
      return false;
    }
  }

  private hasCompleteOrderIdentity(result: {
    orderNo?: string;
    brokerOrderDate?: string;
    orderTime?: string;
  }): boolean {
    return [result.orderNo, result.brokerOrderDate, result.orderTime]
      .every((value) => typeof value === 'string' && value.trim().length > 0);
  }

  async cancelTradeOrder(
    input: CancelTradeOrderInput,
  ): Promise<{ success: boolean; message?: string; orderNo?: string }> {
    if (!this.liveSwitch.isEnabled()) {
      return { success: false, message: '현재 환경에서는 실거래가 비활성화되어 주문 취소를 실행할 수 없습니다.' };
    }

    const record = await this.prisma.tradeRecord.findUnique({
      where: { id: input.tradeRecordId },
    });

    if (!record) {
      return { success: false, message: '주문 기록을 찾을 수 없습니다.' };
    }

    if (record.status !== OrderStatus.PENDING && record.status !== OrderStatus.PARTIAL) {
      return { success: false, message: '취소 가능한 주문 상태가 아닙니다.' };
    }

    if (!this.hasCompleteCancellationIdentity(record)) {
      return {
        success: false,
        message: '브로커 주문 식별 정보가 완전하지 않아 취소할 수 없습니다.',
      };
    }
    if (!this.matchesCapturedBrokerContext(
      record.broker,
      record.brokerEnvironment,
      record.brokerAccountHash,
      record.stockCode,
    )) {
      return {
        success: false,
        message: `저장된 브로커 주문 정보가 현재 ${record.broker} 계좌와 일치하지 않아 취소할 수 없습니다.`,
      };
    }
    if (!this.registry.isActive(record.broker)) {
      return {
        success: false,
        message: `${record.broker} 브로커가 비활성화되어 주문 취소를 실행할 수 없습니다.`,
      };
    }
    const initialRemainingQty = Math.max(0, record.quantity - (record.executedQty || 0));
    if (initialRemainingQty <= 0) {
      return { success: false, message: '남아 있는 미체결 수량이 없습니다.' };
    }

    const claimed = await this.recoveryService.claimCancellation(record.id, record.broker);
    if (!claimed) {
      return {
        success: false,
        message: '주문 취소가 이미 처리 중이거나 결과 확인이 필요합니다.',
      };
    }

    const claimedRecord = await this.prisma.tradeRecord.findUnique({
      where: { id: record.id, broker: record.broker },
    });
    if (!this.isSameClaimedCancellationTarget(record, claimedRecord)) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        record.broker,
        '취소 대상 주문 정보 변경',
      );
      return {
        success: false,
        message: '취소 대상 주문 정보가 변경되어 취소를 중단했습니다.',
      };
    }
    const orderNo = claimedRecord.orderNo!.trim();
    const remainingQty = Math.max(
      0,
      claimedRecord.quantity - (claimedRecord.executedQty || 0),
    );

    if (!this.liveSwitch.isEnabled()) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        record.broker,
        '실거래 비활성화로 주문 취소 중단',
      );
      return {
        success: false,
        message: '현재 환경에서는 실거래가 비활성화되어 주문 취소를 실행할 수 없습니다.',
      };
    }
    if (!this.registry.isActive(claimedRecord.broker)) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        record.broker,
        '브로커 비활성화로 주문 취소 중단',
      );
      return {
        success: false,
        message: `${claimedRecord.broker} 브로커가 비활성화되어 주문 취소를 실행할 수 없습니다.`,
      };
    }
    let executions: BrokerOrderStatus[];
    let unfilledOrders: UnfilledOrder[];
    try {
      const orderDate = claimedRecord.brokerOrderDate as string;
      const port = this.registry.get(claimedRecord.broker);
      executions = await port.getOrderExecutions(claimedRecord.market, orderDate, orderDate);
      unfilledOrders = await port.getUnfilledOrders(claimedRecord.market);
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(
        `[${claimedRecord.broker} ${claimedRecord.stockCode}] Complete cancellation-state read failed: ${message}`,
      );
      await this.recoveryService.releaseCancellationClaim(
        claimedRecord.id,
        claimedRecord.broker,
        `${claimedRecord.broker} 주문 상태 조회 실패`,
      );
      return {
        success: false,
        message: `${claimedRecord.broker} 주문 상태 조회에 실패하여 취소를 중단했습니다.`,
      };
    }

    const hasExactExecution = executions.some((execution) => (
      typeof execution?.orderDate === 'string'
      && execution.orderDate.trim() === claimedRecord.brokerOrderDate
      && this.matchesOrderTuple(claimedRecord, execution)
      && execution.orderQuantity === claimedRecord.quantity
    ));
    const hasExactOpenOrder = unfilledOrders.some((unfilledOrder) => (
      this.matchesOrderTuple(claimedRecord, unfilledOrder)
      && Number.isInteger(unfilledOrder.quantity)
      && unfilledOrder.quantity === remainingQty
    ));
    if (!hasExactExecution || !hasExactOpenOrder) {
      await this.recoveryService.releaseCancellationClaim(
        claimedRecord.id,
        claimedRecord.broker,
        `${claimedRecord.broker} 주문 상태 검증 실패`,
      );
      return {
        success: false,
        message: `현재 ${claimedRecord.broker} 계좌에서 취소 대상 주문을 정확히 확인할 수 없어 취소를 중단했습니다.`,
      };
    }

    if (!this.matchesCapturedBrokerContext(
      claimedRecord.broker,
      claimedRecord.brokerEnvironment,
      claimedRecord.brokerAccountHash,
      claimedRecord.stockCode,
    )) {
      await this.recoveryService.releaseCancellationClaim(
        claimedRecord.id,
        claimedRecord.broker,
        '브로커 컨텍스트 변경으로 주문 취소 중단',
      );
      return {
        success: false,
        message: `${claimedRecord.broker} 계좌 정보가 변경되어 취소를 중단했습니다.`,
      };
    }

    if (!this.liveSwitch.isEnabled()) {
      await this.recoveryService.releaseCancellationClaim(
        claimedRecord.id,
        claimedRecord.broker,
        '실거래 비활성화로 주문 취소 중단',
      );
      return {
        success: false,
        message: '현재 환경에서는 실거래가 비활성화되어 주문 취소를 실행할 수 없습니다.',
      };
    }
    if (!this.registry.isActive(claimedRecord.broker)) {
      await this.recoveryService.releaseCancellationClaim(
        claimedRecord.id,
        claimedRecord.broker,
        '브로커 비활성화로 주문 취소 중단',
      );
      return {
        success: false,
        message: `${claimedRecord.broker} 브로커가 비활성화되어 주문 취소를 실행할 수 없습니다.`,
      };
    }
    let result;
    try {
      result = await this.registry.requireActive(claimedRecord.broker).cancelOrder({
        market: claimedRecord.market,
        exchangeCode: claimedRecord.exchangeCode,
        orderNo,
        stockCode: claimedRecord.stockCode,
        qty: remainingQty,
        price: Number(claimedRecord.price),
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[${claimedRecord.broker} ${claimedRecord.stockCode}] Cancellation outcome is unknown: ${message}`);
      await this.recoveryService.markCancellationUnknown(
        claimedRecord.id,
        claimedRecord.broker,
        message,
      );
      return { success: false, message };
    }

    if (result.outcome === 'ACCEPTED') {
      await this.recoveryService.markCancellationAccepted(
        claimedRecord.id,
        claimedRecord.broker,
        result.message,
      );
      this.logger.log(
        `[${claimedRecord.broker} ${claimedRecord.stockCode}] Manual cancel order accepted: #${claimedRecord.orderNo}`,
      );
      return {
        success: true,
        orderNo,
        message: `${claimedRecord.stockCode} 주문 취소 요청을 접수했습니다.`,
      };
    }

    if (result.outcome === 'REJECTED') {
      await this.recoveryService.markCancellationRejected(
        claimedRecord.id,
        claimedRecord.broker,
        result.message,
      );
      return { success: false, message: result.message };
    }

    if (result.outcome === 'UNKNOWN') {
      await this.recoveryService.markCancellationUnknown(
        claimedRecord.id,
        claimedRecord.broker,
        result.message,
      );
      return { success: false, message: result.message };
    }

    return { success: false, message: result.message };
  }

  private hasCompleteCancellationIdentity(record: TradeRecord): boolean {
    return !!record.orderNo?.trim()
      && !!record.brokerEnvironment
      && !!record.brokerAccountHash?.trim()
      && this.isValidBrokerOrderDate(record.brokerOrderDate);
  }

  private isSameClaimedCancellationTarget(
    initial: TradeRecord,
    claimed: TradeRecord | null,
  ): claimed is TradeRecord {
    return claimed !== null
      && claimed.broker === initial.broker
      && claimed.cancellationStatus === CancellationAttemptStatus.SUBMITTING
      && claimed.status === initial.status
      && claimed.market === initial.market
      && claimed.exchangeCode === initial.exchangeCode
      && claimed.stockCode === initial.stockCode
      && claimed.side === initial.side
      && claimed.quantity === initial.quantity
      && claimed.executedQty === initial.executedQty
      && claimed.price.toString() === initial.price.toString()
      && claimed.orderNo === initial.orderNo
      && claimed.brokerOrderDate === initial.brokerOrderDate
      && claimed.brokerEnvironment === initial.brokerEnvironment
      && claimed.brokerAccountHash === initial.brokerAccountHash;
  }

  private matchesOrderTuple(
    record: TradeRecord,
    order: Pick<
      BrokerOrderStatus | UnfilledOrder,
      'orderNo' | 'exchangeCode' | 'stockCode' | 'side'
    >,
  ): boolean {
    if (!order || typeof order !== 'object') return false;

    const orderNo: unknown = order.orderNo;
    const exchangeCode: unknown = order.exchangeCode;
    const stockCode: unknown = order.stockCode;
    if (
      typeof orderNo !== 'string'
      || !orderNo.trim()
      || (exchangeCode !== null
        && exchangeCode !== undefined
        && typeof exchangeCode !== 'string')
      || typeof stockCode !== 'string'
      || !stockCode.trim()
      || (order.side !== 'BUY' && order.side !== 'SELL')
    ) {
      return false;
    }

    return orderNo.trim() === record.orderNo?.trim()
      && this.normalizeExchange(record.market, exchangeCode)
        === this.normalizeExchange(record.market, record.exchangeCode)
      && stockCode.trim().toUpperCase() === record.stockCode.trim().toUpperCase()
      && order.side === record.side;
  }

  private normalizeExchange(
    market: Market,
    exchangeCode?: unknown,
  ): string {
    if (
      exchangeCode !== null
      && exchangeCode !== undefined
      && typeof exchangeCode !== 'string'
    ) {
      return '';
    }
    const normalized = exchangeCode?.trim().toUpperCase() ?? '';
    return market === Market.DOMESTIC && !normalized ? 'KRX' : normalized;
  }

  private isValidBrokerOrderDate(value?: string | null): value is string {
    if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }
}
