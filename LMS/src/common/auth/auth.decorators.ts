import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, UserRole } from './roles';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Marks a route as reachable without a JWT (health, dev token). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Role-based access control, the in-process equivalent of the gateway rules. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated principal into a controller method. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    return context.switchToHttp().getRequest().user as AuthenticatedUser;
  },
);
