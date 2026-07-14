import { Request } from 'express';

export interface AuthenticatedGraphqlContext {
  req: Request & {
    user: {
      username: string;
    };
  };
}
