/**
 * The version of the Storytime publishing terms a creator agrees to.
 *
 * The Content Policy, the Terms of Use and the Fan Content & Intellectual
 * Property Notice are accepted together — a creator cannot meaningfully agree
 * to one and not the others, because each defers to the other two — so they
 * share one version rather than carrying three that would have to be kept in
 * step by hand.
 *
 * Raising this is what makes every creator agree again. The Terms reserve that
 * right for changes which materially affect a creator's obligations, so a
 * typographical fix must not raise it and a new prohibition must.
 *
 * Stored on the Story alongside the acceptance date, so the record says which
 * wording was agreed rather than merely that something once was.
 */
export const STORYTIME_POLICY_VERSION = '1.0';

/**
 * The version recorded against acceptances made before versioning existed.
 *
 * Those acceptances were given against the placeholder wording that shipped
 * ahead of the real documents. Treating them as a version below the current
 * one is deliberate: it means anybody who agreed to the placeholder is asked
 * again for the real thing, rather than being held to terms they never read.
 */
export const STORYTIME_PRE_VERSIONED_POLICY = '0';
