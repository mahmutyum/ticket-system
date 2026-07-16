import { z } from 'zod';
import { strongPassword } from '../../utils/validation.js';
import { StaffRole } from '@prisma/client';

export const staffLoginSchema = z.object({
  email: z.string().email('Geçerli bir email adresi girin'),
  password: z.string().min(1, 'Şifre gerekli'),
});

export const emailLookupSchema = z.object({
  email: z.string().email('Geçerli bir email adresi girin'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut şifre gerekli'),
  newPassword: strongPassword,
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: 'Yeni şifre mevcut şifreden farklı olmalı',
  path: ['newPassword'],
});

export const mfaVerifySchema = z.object({
  challenge: z.string().min(16),
  code: z.string().regex(/^\d{6}$/, 'Kod 6 haneli olmalı'),
});

export const mfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const disableMfaSchema = z.object({
  password: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

const staffProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  role: z.nativeEnum(StaffRole),
  department: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

export const loginResponseSchema = z.object({
  success: z.literal(true),
  data: z.union([
    z.object({ mfaRequired: z.literal(true), challenge: z.string() }),
    z.object({ accessToken: z.string(), user: staffProfileSchema }),
  ]),
});

export const refreshResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ accessToken: z.string() }),
});
