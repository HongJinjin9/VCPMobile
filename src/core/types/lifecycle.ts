export type LifecyclePhase = 'active' | 'inactive' | 'background';

/** Rust lifecycle owner output; native sequence and Rust epoch have separate scopes. */
export interface LifecycleSnapshotDto {
  phase: LifecyclePhase;
  nativeSequence: number | null;
  snapshot: boolean;
  transitionEpoch: number;
}

/** A delayed snapshot response must not roll back an already-delivered transition. */
export function selectLatestLifecycleSnapshot(
  current: LifecycleSnapshotDto | null,
  incoming: LifecycleSnapshotDto | null,
): LifecycleSnapshotDto | null {
  if (!incoming || (current && incoming.transitionEpoch <= current.transitionEpoch)) {
    return current;
  }
  return incoming;
}
