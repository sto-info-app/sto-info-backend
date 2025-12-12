import { validateOrReject } from 'class-validator';
import { CurrentContextHelper } from 'src/shared/context/current-context.helper';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';

import { AuditEntity } from '../entities/audit.entity';
import { AuditLoginAttemptEntity } from '../entities/audit-login-attempt.entity';

// Define the type alias
type AuditEventType = InsertEvent<any> | UpdateEvent<any> | RemoveEvent<any>;

/**
 * Audit subscriber class.
 * This class listens for entity events and creates an audit log for each event.
 * @class AuditSubscriber
 * @implements {EntitySubscriberInterface}
 * @export AuditSubscriber
 */
@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface {
  listenTo() {
    return Object;
  }

  /**
   * After insert event.
   * @param event - The event object containing entity information.
   */
  async afterInsert(event: InsertEvent<any>) {
    await this.createAudit(event, 'INSERT');
  }

  /**
   * After update event.
   * @param event - The event object containing entity information.
   */
  async afterUpdate(event: UpdateEvent<any>) {
    const oldEntity = this.getEntityData(event, 'old');
    await this.createAudit(event, 'UPDATE', oldEntity);
  }

  /**
   * After remove event.
   * @param event - The event object containing entity information.
   */
  async afterRemove(event: RemoveEvent<any>) {
    await this.createAudit(event, 'REMOVE');
  }

  /**
   * Create an audit log for the event.
   * @param event - The event object containing entity information.
   * @param action - The action to log.
   * @param oldEntity - The old entity data before the update.
   */
  private async createAudit(
    event: AuditEventType,
    action: string,
    oldEntity?: any,
  ) {
    // Exclude the specific entities from being audited
    const excludedEntitiesFromAuditing = [
      AuditEntity,
      AuditLoginAttemptEntity,
      UserRefreshTokenEntity,
    ];
    if (
      excludedEntitiesFromAuditing.some(
        entity => event.metadata.target === entity,
      )
    ) {
      return;
    }

    const auditRepository = event.manager.getRepository(AuditEntity);
    const audit = new AuditEntity();
    audit.entity = event.metadata.name;
    audit.action = action;
    audit.entityId = this.getEntityId(event);

    if (action === 'UPDATE') {
      audit.oldValue = oldEntity ? { ...oldEntity } : null;
    } else {
      audit.oldValue = this.getEntityData(event, 'old');
    }

    audit.newValue = this.getEntityData(event, 'new');
    audit.userId = CurrentContextHelper.userUuid;
    audit.ipAddress = CurrentContextHelper.ip;

    await validateOrReject(audit);
    await auditRepository.save(audit);
  }

  /**
   * Get the entity ID from the event.
   * @param event - The event object containing entity information.
   * @returns The entity ID as a string, or null if not available.
   */
  private getEntityId(event: AuditEventType): string | null {
    const primaryColumn = event.metadata.primaryColumns[0];
    const entityId = primaryColumn.getEntityValue(event.entity)
      ? primaryColumn.getEntityValue(event.entity).toString()
      : null;
    return entityId;
  }

  /**
   * Get the event entity data from the event.
   * @param event - The event object containing entity information.
   * @param type - The type of data to retrieve ('old' or 'new').
   * @returns The entity data as an object, or null if not available.
   */
  private getEntityData(event: AuditEventType, type: 'old' | 'new'): any {
    if (type === 'old') {
      if ('databaseEntity' in event) {
        return event.databaseEntity ? { ...event.databaseEntity } : null;
      }
      return null;
    } else {
      return event.entity ? { ...event.entity } : null;
    }
  }
}
