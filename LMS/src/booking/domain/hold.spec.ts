import { HoldStatus } from './enums';
import { Hold } from './hold.entity';

describe('Hold guarded transitions (LLD 12.1)', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('creates an active hold with a copy and expiry', () => {
    const hold = Hold.active(
      '11111111-1111-4111-8111-111111111111',
      'b-1',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'key',
      now,
      new Date(now.getTime() + 3_600_000),
    );
    expect(hold.status).toBe(HoldStatus.ACTIVE);
    expect(hold.copyId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  });

  it('activates a queued hold when a copy becomes free', () => {
    const hold = Hold.queued('11111111-1111-4111-8111-111111111111', 'b-1', 'key', now);
    hold.activate('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', new Date(now.getTime() + 1000));
    expect(hold.status).toBe(HoldStatus.ACTIVE);
    expect(hold.copyId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  });

  it('rejects expiring a queued hold and fulfilling a cancelled hold', () => {
    const queued = Hold.queued('11111111-1111-4111-8111-111111111111', 'b-1', 'key', now);
    expect(() => queued.expire()).toThrow();

    const active = Hold.active(
      '11111111-1111-4111-8111-111111111111',
      'b-1',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'key2',
      now,
      new Date(now.getTime() + 1000),
    );
    active.cancel();
    expect(() => active.fulfill()).toThrow();
  });
});
