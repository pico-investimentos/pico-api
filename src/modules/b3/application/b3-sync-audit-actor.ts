import type { B3SyncTrigger } from '../domain/position-types.js'

export function b3SyncAuditActor(
  trigger: B3SyncTrigger,
  userId: string,
): { actorType: 'USER' | 'SYSTEM'; actorId: string | null } {
  return trigger === 'MANUAL'
    ? { actorType: 'USER', actorId: userId }
    : { actorType: 'SYSTEM', actorId: null }
}
