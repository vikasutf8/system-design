import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LibraryConfigService } from '../config/library.config';
import { AuthController } from './auth.controller';

/**
 * Registers the JWT service globally so guards and controllers can verify and
 * mint tokens. In production the gateway is the token verifier (arch.md 3.1).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [LibraryConfigService],
      useFactory: (config: LibraryConfigService) => ({
        secret: config.jwtSecret,
        signOptions: { expiresIn: config.jwtExpiresInSeconds },
      }),
    }),
  ],
  controllers: [AuthController],
})
export class AuthModule {}
