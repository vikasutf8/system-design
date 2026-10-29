import { Body, Controller, Get, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { IsUUID } from 'class-validator';
import { LibraryConfigService } from '../config/library.config';
import {
  DomainNotFoundException,
  ForbiddenException,
} from '../exceptions/domain.exception';
import { CurrentUser, Public } from './auth.decorators';
import { AuthenticatedUser, UserRole } from './roles';

class DevTokenDto {
  @IsUUID()
  userId!: string;
}

interface UserRow {
  user_id: string;
  name: string;
  email: string;
  role: UserRole;
  status: string;
}

/**
 * Development-only token issuer. It mimics the external identity provider so
 * the stack can be exercised without a full auth service (LLD section 13).
 * Disabled automatically when NODE_ENV=production.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly config: LibraryConfigService,
  ) {}

  @Public()
  @Post('dev-token')
  @ApiOperation({ summary: 'Mint a JWT for a seeded user (development only)' })
  async devToken(@Body() dto: DevTokenDto) {
    if (this.config.isProduction) {
      throw new ForbiddenException('Development tokens are disabled in production');
    }

    const rows: UserRow[] = await this.dataSource.query(
      `SELECT user_id, name, email, role, status
         FROM users
        WHERE user_id = $1`,
      [dto.userId],
    );
    const user = rows[0];
    if (!user) {
      throw new DomainNotFoundException('USER_NOT_FOUND', `User ${dto.userId} was not found`);
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is not active');
    }

    const token = await this.jwtService.signAsync({
      sub: user.user_id,
      role: user.role,
      name: user.name,
    });

    return {
      token,
      tokenType: 'Bearer',
      expiresInSeconds: this.config.jwtExpiresInSeconds,
      user: {
        userId: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the authenticated principal' })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
