import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TradingSlackActorAuthorizationService {
  private readonly logger = new Logger(TradingSlackActorAuthorizationService.name);

  constructor(private readonly configService: ConfigService) {}

  authorize(userId: unknown): string | null {
    const actor = typeof userId === 'string' ? userId.trim() : '';
    if (!actor) return null;

    const configured = this.configService.get<unknown>('slack.approverUserIds');
    if (!Array.isArray(configured)) return null;

    const authorized = configured.some(
      (value) => typeof value === 'string' && value.trim() === actor,
    );
    return authorized ? actor : null;
  }
}
