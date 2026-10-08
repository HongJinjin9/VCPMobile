import { describe, expect, it } from 'vitest';
import { selectLatestLifecycleSnapshot, type LifecycleSnapshotDto } from '../../../core/types/lifecycle';

describe('lifecycle event and snapshot ordering', () => {
  it('does not roll back a live background event when an older snapshot finishes later', () => {
    const active: LifecycleSnapshotDto = {
      phase: 'active', nativeSequence: 0, snapshot: true, transitionEpoch: 1,
    };
    const background: LifecycleSnapshotDto = {
      phase: 'background', nativeSequence: 1, snapshot: false, transitionEpoch: 2,
    };
    let current = selectLatestLifecycleSnapshot(null, active);
    current = selectLatestLifecycleSnapshot(current, background);
    expect(selectLatestLifecycleSnapshot(current, active)).toBe(background);
    expect(selectLatestLifecycleSnapshot(current, { ...background, snapshot: true })).toBe(background);
    expect(selectLatestLifecycleSnapshot(current, null)).toBe(background);
  });

  it('retains inactive separately and orders host development events without a native sequence', () => {
    const inactive: LifecycleSnapshotDto = {
      phase: 'inactive', nativeSequence: 8, snapshot: false, transitionEpoch: 3,
    };
    expect(selectLatestLifecycleSnapshot(null, inactive)?.phase).toBe('inactive');
    const host: LifecycleSnapshotDto = {
      phase: 'active', nativeSequence: null, snapshot: false, transitionEpoch: 4,
    };
    expect(selectLatestLifecycleSnapshot(inactive, host)).toBe(host);
  });
});
