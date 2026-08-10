import { getAccessToken } from '../modules/auth/auth.service';
import { User } from '../models/user.model';
import { decrypt } from '../utils/crypto';
import { GmailProvider } from './gmail.provider';
import { GraphProvider } from './graph.provider';
import { ImapProvider, type ImapCredentials } from './imap.provider';
import type { MailProvider } from './provider.types';

export * from './provider.types';
export { GmailProvider, GraphProvider, ImapProvider };
export type { ImapCredentials };

/** Builds the right provider for a user and hands it a fresh access token. */
export async function providerFor(userId: string): Promise<MailProvider> {
  const user = await User.findById(userId).select('+imapPassword');
  if (!user) throw new Error('User not found');

  // IMAP authenticates per connection with a stored password, so it never
  // goes through the OAuth token path.
  if (user.provider === 'imap') {
    if (!user.imap || !user.imapPassword) {
      throw new Error('IMAP mailbox is not configured — reconnect the account');
    }
    return new ImapProvider({
      host: user.imap.host,
      port: user.imap.port,
      secure: user.imap.secure,
      smtpHost: user.imap.smtpHost,
      smtpPort: user.imap.smtpPort,
      smtpSecure: user.imap.smtpSecure,
      user: user.email,
      password: decrypt(user.imapPassword),
      folder: user.imap.folder,
      sentFolder: user.imap.sentFolder,
      fromName: user.name,
    });
  }

  const token = await getAccessToken(userId);
  return user.provider === 'google' ? new GmailProvider(token) : new GraphProvider(token);
}
