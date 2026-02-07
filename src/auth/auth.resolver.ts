import { Resolver, Mutation, Args, ObjectType, Field } from '@nestjs/graphql';
import { AuthService } from './auth.service';

@ObjectType()
export class AuthPayload {
  @Field()
  accessToken: string;
}

@Resolver()
export class AuthResolver {
  constructor(private authService: AuthService) {}

  @Mutation(() => AuthPayload)
  login(
    @Args('username') username: string,
    @Args('password') password: string,
  ) {
    return this.authService.login(username, password);
  }
}
