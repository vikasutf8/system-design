import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './auth.decorators';
import { ForbiddenException, UnauthenticatedException } from '../exceptions/domain.exception';
import { AuthenticatedUser, UserRole } from './roles';

/**
 * Enforces @Roles(...) after JwtAuthGuard has populated request.user.
 * Members can only touch their own resources; controllers add ownership
 * checks where the resource id is involved (LLD section 9.4).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) throw new UnauthenticatedException();
    if (!required.includes(request.user.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
