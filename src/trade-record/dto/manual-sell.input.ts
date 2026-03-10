import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class ManualSellInput {
  @Field()
  stockCode: string;

  @Field()
  market: string;

  @Field({ nullable: true })
  exchangeCode?: string;

  @Field({ nullable: true, description: '매도 수량 (미지정 시 전량)' })
  quantity?: number;
}
