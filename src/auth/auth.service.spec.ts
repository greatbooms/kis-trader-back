import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        'auth.adminUsername': 'admin',
        'auth.adminPassword': 'password123',
      };
      return config[key];
    }),
  };

  const mockPrisma = {
    loginAttempt: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should return accessToken for valid credentials', async () => {
      const result = await service.login('admin', 'password123', 'test-client');

      expect(result).toEqual({ accessToken: 'mock-jwt-token' });
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: 'admin',
        username: 'admin',
      });
    });

    it('should throw UnauthorizedException for wrong username', async () => {
      await expect(service.login('wrong', 'password123', 'test-client')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      await expect(service.login('admin', 'wrong', 'test-client')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for both wrong', async () => {
      await expect(service.login('wrong', 'wrong', 'test-client')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('validateToken', () => {
    it('should return user info for valid admin payload', () => {
      const result = service.validateToken({ sub: 'admin', username: 'admin' });
      expect(result).toEqual({ userId: 'admin', username: 'admin' });
    });

    it('should return null for non-admin payload', () => {
      const result = service.validateToken({ sub: 'user', username: 'user' });
      expect(result).toBeNull();
    });

    it('should return null for empty payload', () => {
      const result = service.validateToken({});
      expect(result).toBeNull();
    });
  });
});
