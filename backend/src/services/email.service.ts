import nodemailer from 'nodemailer';
import { decrypt, looksEncrypted } from '../utils/crypto.js';
import type { Transporter } from 'nodemailer';
import { config } from '../config/index.js';

// Global (default) transporter
let globalTransporter: Transporter | null = null;

// Per-company transporter cache: companyId → { transporter, fromAddress, expiresAt }
interface CachedTransporter {
  transporter: Transporter;
  from: string;
  expiresAt: number;
}
const companyTransporters = new Map<string, CachedTransporter>();

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getGlobalTransporter(): Transporter {
  if (!globalTransporter) {
    globalTransporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    });
  }
  return globalTransporter;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /**
   * Şifrenin biçimi çağrı yerine göre değişir:
   *  - `getCompanyTransporter`: veritabanından gelir, ŞİFRELİ (eski kayıtlar düz metin).
   *  - `testSmtpConnection`:    admin formundan gelir, DÜZ METİN (henüz kaydedilmemiş).
   */
  pass: string;
  fromName: string;
  fromEmail: string;
}

/**
 * `CompanySmtp.pass` alanını kullanılabilir düz metne çevirir.
 *
 * Şifreleme bu alana sonradan eklendi: veritabanında hem yeni (şifreli) hem eski
 * (düz metin) kayıtlar bulunabilir. Formatına göre ayrılır — eski kayıtlar
 * olduğu gibi kullanılır ki e-posta gönderimi bozulmasın.
 *
 * Eski kayıtları toplu şifrelemek için: npm run db:encrypt-smtp
 */
function resolveSmtpPass(pass: string, companyId: string): string {
  if (!looksEncrypted(pass)) {
    console.warn(
      `[email] Şirket ${companyId} SMTP şifresi veritabanında DÜZ METİN. ` +
        'Şifrelemek için: npm run db:encrypt-smtp',
    );
    return pass;
  }
  return decrypt(pass);
}

/**
 * Get or create a transporter for a specific company SMTP config.
 * Caches transporters for CACHE_TTL to avoid recreating connections.
 */
function getCompanyTransporter(companyId: string, smtp: SmtpConfig): { transporter: Transporter; from: string } {
  const cached = companyTransporters.get(companyId);
  if (cached && cached.expiresAt > Date.now()) {
    return { transporter: cached.transporter, from: cached.from };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: resolveSmtpPass(smtp.pass, companyId),
    },
  });

  const from = `${smtp.fromName} <${smtp.fromEmail}>`;

  companyTransporters.set(companyId, {
    transporter,
    from,
    expiresAt: Date.now() + CACHE_TTL,
  });

  return { transporter, from };
}

/**
 * Invalidate cached transporter when SMTP settings change
 */
export function invalidateCompanyTransporter(companyId: string): void {
  companyTransporters.delete(companyId);
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send email using global SMTP config
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  const transport = getGlobalTransporter();
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });
}

/**
 * Send email using company-specific SMTP config, fallback to global
 */
export async function sendEmailForCompany(
  options: EmailOptions,
  companyId: string | null,
  companySmtp: SmtpConfig | null,
): Promise<void> {
  if (companyId && companySmtp) {
    const { transporter, from } = getCompanyTransporter(companyId, companySmtp);
    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  } else {
    // Fallback to global SMTP
    await sendEmail(options);
  }
}

/**
 * Render a template string by replacing {{variable}} placeholders
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
  }
  return result;
}

/**
 * Test an SMTP connection (used from admin UI)
 *
 * `smtp.pass` burada DÜZ METİN beklenir — admin formundan gelir, henüz
 * veritabanına yazılmamıştır. Çözme yapılmaz.
 */
export async function testSmtpConnection(smtp: SmtpConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    await transporter.verify();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
