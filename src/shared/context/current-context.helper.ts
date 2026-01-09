import { ClsServiceManager } from 'nestjs-cls';

/**
 * Helper class for accessing request-scoped context data using CLS (Continuation Local Storage)
 *
 * Provides static accessors for retrieving and setting context data such as user UUID and IP address
 * that is automatically isolated per request.
 *
 * @example
 * ```typescript
 * // Set context in middleware
 * CurrentContextHelper.userUuid = 'user-123';
 * CurrentContextHelper.ip = '192.168.1.1';
 *
 * // Access context anywhere in request lifecycle
 * const userId = CurrentContextHelper.userUuid;
 * const clientIp = CurrentContextHelper.ip;
 * ```
 */
export class CurrentContextHelper {
  /**
   * Gets the CLS service instance
   *
   * @returns The CLS service or undefined if not available
   * @private
   */
  private static get cls() {
    return ClsServiceManager.getClsService();
  }

  /**
   * Gets the active CLS service instance if CLS context is active
   *
   * @returns The CLS service if active, null otherwise
   * @private
   */
  private static get activeCls() {
    const cls = this.cls;
    if (!cls) return null;

    // cls.isActive() is provided by nestjs-cls
    if (
      typeof (cls as any).isActive === 'function' &&
      !(cls as any).isActive()
    ) {
      return null;
    }
    return cls;
  }

  /**
   * Gets the current user UUID from request context
   *
   * @returns The user UUID if available, null otherwise
   *
   * @example
   * ```typescript
   * const userId = CurrentContextHelper.userUuid;
   * console.log(`Current user: ${userId}`);
   * ```
   */
  static get userUuid(): string | null {
    const cls = this.activeCls;
    return cls?.get('userUuid') ?? null;
  }

  /**
   * Sets the user UUID in request context
   *
   * @param userUuid - The user UUID to store in context
   *
   * @example
   * ```typescript
   * CurrentContextHelper.userUuid = 'user-123';
   * ```
   */
  static set userUuid(userUuid: string | null) {
    const cls = this.activeCls;
    if (!cls) return;
    cls.set('userUuid', userUuid);
  }

  /**
   * Gets the client IP address from request context
   *
   * @returns The client IP address if available, null otherwise
   *
   * @example
   * ```typescript
   * const clientIp = CurrentContextHelper.ip;
   * console.log(`Request from: ${clientIp}`);
   * ```
   */
  static get ip(): string | null {
    const cls = this.activeCls;
    return cls?.get('ip') ?? null;
  }

  /**
   * Sets the client IP address in request context
   *
   * @param ip - The IP address to store in context
   *
   * @example
   * ```typescript
   * CurrentContextHelper.ip = '192.168.1.1';
   * ```
   */
  static set ip(ip: string | null) {
    const cls = this.activeCls;
    if (!cls) return;
    cls.set('ip', ip);
  }
}
