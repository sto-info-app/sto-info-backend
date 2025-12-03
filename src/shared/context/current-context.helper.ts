import { ClsServiceManager } from 'nestjs-cls';

export class CurrentContextHelper {
  private static get cls() {
    return ClsServiceManager.getClsService();
  }

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

  static get userUuid(): string | null {
    const cls = this.activeCls;
    return cls?.get('userUuid') ?? null;
  }

  static set userUuid(userUuid: string | null) {
    const cls = this.activeCls;
    if (!cls) return;
    cls.set('userUuid', userUuid);
  }

  static get ip(): string | null {
    const cls = this.activeCls;
    return cls?.get('ip') ?? null;
  }

  static set ip(ip: string | null) {
    const cls = this.activeCls;
    if (!cls) return;
    cls.set('ip', ip);
  }
}
