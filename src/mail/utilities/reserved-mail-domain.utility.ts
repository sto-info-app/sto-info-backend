/**
 * The second-level names reserved for documentation and testing by RFC 2606.
 * Nobody can register them, so no mailbox exists at them or under them.
 */
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

/**
 * The top-level names RFC 2606 and RFC 6761 reserve for testing, examples
 * and the local machine. None is delegated in the public DNS, so no mail can
 * be delivered anywhere beneath them.
 */
const RESERVED_TOP_LEVEL = new Set(['example', 'invalid', 'test', 'localhost']);

/**
 * Reports whether an email address is at a domain where no mailbox can exist
 * (FC-044).
 *
 * Test and demonstration accounts use these domains, and every sign-in sends
 * an email: sent, it would bounce, or go to SendGrid after SES refused it,
 * and either harms the sender's standing for real mail.
 *
 * @param address - The recipient's address.
 * @returns The domain when it is reserved, otherwise null.
 */
export function reservedMailDomain(address: string): string | null {
  const at = address.lastIndexOf('@');

  if (at === -1) {
    return null;
  }

  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  const topLevel = domain.slice(domain.lastIndexOf('.') + 1);

  if (RESERVED_TOP_LEVEL.has(topLevel)) {
    return domain;
  }

  return RESERVED_DOMAINS.some(
    reserved => domain === reserved || domain.endsWith(`.${reserved}`),
  )
    ? domain
    : null;
}
