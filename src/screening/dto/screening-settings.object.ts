import { ObjectType, InputType, Field } from '@nestjs/graphql';

@ObjectType()
export class ScreeningCountrySetting {
  @Field() country: string;
  @Field() label: string;
  @Field() enabled: boolean;
}

@ObjectType()
export class ScreeningSettingsType {
  @Field(() => [ScreeningCountrySetting])
  countries: ScreeningCountrySetting[];
}

@InputType()
export class UpdateScreeningSettingsInput {
  @Field() country: string;
  @Field() enabled: boolean;
}
