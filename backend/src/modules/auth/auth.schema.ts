import { z } from 'zod';
import { strongPassword } from '../../utils/validation.js';

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
