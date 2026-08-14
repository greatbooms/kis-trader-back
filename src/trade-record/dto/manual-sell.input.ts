import { InputType, Field } from '@nestjs/graphql';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Broker } from '@prisma/client';

@InputType()
export class ManualSellInput {
  @Field(() => Broker, { nullable: true })
  @IsOptional()
  broker?: Broker;

  @Field()
  stockCode: string;

  @Field()
  market: string;

  @Field()
  exchangeCode: string;

  @Field({ nullable: true, description: '매도 수량 (미지정 시 전량)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
