import { z } from 'zod';

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
