import { FastifyPluginAsync } from 'fastify';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, normalize } from 'path';
import { config } from '../../config/index.js';
import { getStaffCompanyScope, isCompanyInScope } from '../../utils/staff-scope.js';
import { z } from 'zod';

const attachmentParamsSchema = z.object({ id: z.string().min(1).max(128) });
const attachmentQuerySchema = z.object({ token: z.string().min(16).max(128).optional() });
const brandingParamsSchema = z.object({
  companyId: z.string().min(1).max(128),
  file: z.string().regex(/^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/),
});

/**
 * Ek indirme — KİMLİK DOĞRULAMALI.
 *
 * Ekler eskiden `@fastify/static` ile `/uploads/*` altından KİMLİKSİZ servis
 * ediliyordu. API tarafı şirket kapsamını doğru uyguluyordu ama dosyanın kendisi
 * için hiçbir kontrol yoktu: yol tahmin edilemezdi, o kadar. Bu bir yetkilendirme
 * değil, "URL'i bilen girer" idi — ve o URL nginx access_log'una, tarayıcı
 * geçmişine ve e-postalara düşüyor, ticket kapandıktan sonra da çalışmaya devam
 * ediyordu.
 *
 * Artık her indirme `Attachment → ticket → companyId` çözüp iki yoldan birini arar:
 *   - personel: şirket kapsamı içinde mi,
 *   - talep eden: geçerli (süresi dolmamış) `accessToken` sunuyor mu.
 */
export const attachmentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id', { schema: { params: attachmentParamsSchema, querystring: attachmentQuerySchema, tags: ['Attachments'], summary: 'Yetki kontrollü ticket eki indir' } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };

    const attachment = await app.prisma.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        fileName: true,
        filePath: true,
        mimeType: true,
        ticket: {
          select: { companyId: true, accessToken: true, accessTokenExpiresAt: true },
        },
      },
    });

    if (!attachment) {
      return reply.status(404).send({ success: false, error: 'Dosya bulunamadı' });
    }

    // --- Yetki: ya geçerli public token, ya kapsam içindeki personel ---
    let allowed = false;

    if (token) {
      const expired =
        attachment.ticket.accessTokenExpiresAt !== null &&
        attachment.ticket.accessTokenExpiresAt < new Date();
      allowed = attachment.ticket.accessToken === token && !expired;
    }

    if (!allowed) {
      // Personel yolu — authenticateOptional çağrılmadıysa staffUser yok.
      await app.authenticateOptional(request, reply);
      if (request.staffUser) {
        const scope = await getStaffCompanyScope(
          app.prisma,
          request.staffUser.id,
          request.staffUser.role,
        );
        allowed = isCompanyInScope(scope, attachment.ticket.companyId);
      }
    }

    if (!allowed) {
      // 404, 403 değil: bir ekin VARLIĞI bile bilgi sızdırır.
      return reply.status(404).send({ success: false, error: 'Dosya bulunamadı' });
    }

    // --- Dosyayı gönder ---
    //
    // filePath DB'den gelir ve sunucu üretir, ama yine de normalize edilip
    // UPLOAD_DIR içinde kaldığı doğrulanır: bir gün bu alana kullanıcı girdisi
    // sızarsa yol kaçışı burada durur.
    const fullPath = normalize(join(config.UPLOAD_DIR, attachment.filePath));
    const root = normalize(config.UPLOAD_DIR);
    if (!fullPath.startsWith(root + '/')) {
      app.log.error({ filePath: attachment.filePath }, 'Ek yolu UPLOAD_DIR dışına çıkıyor');
      return reply.status(404).send({ success: false, error: 'Dosya bulunamadı' });
    }

    try {
      await stat(fullPath);
    } catch {
      return reply.status(404).send({ success: false, error: 'Dosya bulunamadı' });
    }

    // Kullanıcı içeriği: hiçbir koşulda belge olarak yorumlanmasın.
    reply
      .header('Content-Type', attachment.mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('X-Frame-Options', 'DENY')
      // Ekler indirilir, gömülmez. Şirket logoları bunun DIŞINDA — onlar
      // ayrı bir uçtan (aşağıda) inline servis edilir.
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      )
      // Kimlik doğrulamalı içerik ara cache'lerde kalmamalı.
      .header('Cache-Control', 'private, no-store');

    return reply.send(createReadStream(fullPath));
  });
};

/**
 * Şirket logosu — PUBLIC ve inline.
 *
 * Logolar public portalda `<img>` ile gösterilir ve zaten public uçlardan
 * (`GET /companies`) URL'i dönüyor; gizli değiller. Eklerden ayrı tutulmalarının
 * sebebi `Content-Disposition: attachment` almamaları gerektiğidir.
 *
 * MIME allowlist SVG'yi dışlar (aktif içerik), uzantı doğrulanmış MIME'dan
 * türetilir ve burada da sandbox CSP + nosniff uygulanır.
 */
export const brandingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:companyId/:file', { schema: { params: brandingParamsSchema, tags: ['Branding'], summary: 'Şirket logosunu getir' } }, async (request, reply) => {
    const { companyId, file } = request.params as { companyId: string; file: string };

    // Yol bileşenleri istemciden geliyor — normalize edip kök içinde kal.
    const fullPath = normalize(join(config.UPLOAD_DIR, 'branding', companyId, file));
    const root = normalize(join(config.UPLOAD_DIR, 'branding'));
    if (!fullPath.startsWith(root + '/')) {
      return reply.status(404).send({ success: false, error: 'Bulunamadı' });
    }

    try {
      await stat(fullPath);
    } catch {
      return reply.status(404).send({ success: false, error: 'Bulunamadı' });
    }

    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    const types: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
    };
    const mime = types[ext];
    if (!mime) {
      // Allowlist dışı uzantı diske hiç yazılmamalı; yine de servis etme.
      return reply.status(404).send({ success: false, error: 'Bulunamadı' });
    }

    reply
      .header('Content-Type', mime)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'public, max-age=604800');

    return reply.send(createReadStream(fullPath));
  });
};
