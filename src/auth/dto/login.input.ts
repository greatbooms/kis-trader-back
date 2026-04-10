import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType()
export class LoginInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;
}
