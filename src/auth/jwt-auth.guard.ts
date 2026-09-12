import {
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }

  /**
   * Determines whether the current request can proceed.
   *
   * @param context - The execution context.
   * @returns A promise that resolves when the operation completes.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const canActivate = await super.canActivate(context);
    if (!canActivate) {
      throw new UnauthorizedException();
    }
    context.switchToHttp().getRequest();
    return true;
  }
}
