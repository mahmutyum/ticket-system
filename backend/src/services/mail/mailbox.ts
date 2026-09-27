import { MailboxProvider, type CompanyMailbox } from '@prisma/client';
import { decrypt } from '../../utils/crypto.js';
import { GmailSource, GraphSource, ImapSource, type MailSource } from './sources.js';

/** Kayıttaki sağlayıcıya göre bağlanmaya hazır mı (zorunlu alanlar dolu mu)? */
export function isMailboxConfigured(mailbox: CompanyMailbox): boolean {
  switch (mailbox.provider) {
    case MailboxProvider.imap:
      return !!(mailbox.imapHost && mailbox.imapPort && mailbox.username && mailbox.secretEnc);
    case MailboxProvider.microsoft365:
      return !!(mailbox.tenantId && mailbox.clientId && mailbox.secretEnc);
    case MailboxProvider.gmail:
      return !!(mailbox.clientId && mailbox.secretEnc && mailbox.refreshTokenEnc);
    default:
      return false;
  }
}

/** Şifreli kimlik bilgilerini çözerek sağlayıcıya uygun kaynağı üretir. */
export function createMailSource(mailbox: CompanyMailbox): MailSource {
  if (!isMailboxConfigured(mailbox)) throw new Error('Posta kutusu yapılandırması eksik');
  const secret = decrypt(mailbox.secretEnc!);
  switch (mailbox.provider) {
    case MailboxProvider.imap:
      return new ImapSource({
        host: mailbox.imapHost!,
        port: mailbox.imapPort!,
        secure: mailbox.imapSecure,
        username: mailbox.username!,
        password: secret,
      });
    case MailboxProvider.microsoft365:
      return new GraphSource({
        tenantId: mailbox.tenantId!,
        clientId: mailbox.clientId!,
        clientSecret: secret,
        address: mailbox.address,
      });
    case MailboxProvider.gmail:
      return new GmailSource({
        clientId: mailbox.clientId!,
        clientSecret: secret,
        refreshToken: decrypt(mailbox.refreshTokenEnc!),
      });
  }
}
