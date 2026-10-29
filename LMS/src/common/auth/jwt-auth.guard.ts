import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { UnauthenticatedException } from '../exceptions/domain.exception';
import { AuthenticatedUser, UserRole } from './roles';

interface JwtPayload {
  sub: string;
  role: UserRole;
  name?: string;
}

/**
 * Verifies the bearer JWT. In the full architecture this happens at the API
 * gateway; the monolith performs the same validation locally.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthenticatedException();
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(header.slice(7));
      if (!payload.sub || !payload.role) throw new Error('invalid payload');
      request.user = {
        userId: payload.sub,
        role: payload.role,
        name: payload.name,
      };
      return true;
    } catch {
      throw new UnauthenticatedException();
    }
  }
}
