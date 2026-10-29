import { CopyStatus, canMoveCopy } from './enums';

describe('CopyStatus state machine (LLD 5.1)', () => {
  it('allows the documented transitions', () => {
    expect(canMoveCopy(CopyStatus.AVAILABLE, CopyStatus.HELD)).toBe(true);
    expect(canMoveCopy(CopyStatus.AVAILABLE, CopyStatus.CHECKED_OUT)).toBe(true);
    expect(canMoveCopy(CopyStatus.AVAILABLE, CopyStatus.DAMAGED)).toBe(true);
    expect(canMoveCopy(CopyStatus.HELD, CopyStatus.AVAILABLE)).toBe(true);
    expect(canMoveCopy(CopyStatus.HELD, CopyStatus.CHECKED_OUT)).toBe(true);
    expect(canMoveCopy(CopyStatus.HELD, CopyStatus.HELD)).toBe(true);
    expect(canMoveCopy(CopyStatus.CHECKED_OUT, CopyStatus.AVAILABLE)).toBe(true);
    expect(canMoveCopy(CopyStatus.CHECKED_OUT, CopyStatus.HELD)).toBe(true);
    expect(canMoveCopy(CopyStatus.CHECKED_OUT, CopyStatus.LOST)).toBe(true);
    expect(canMoveCopy(CopyStatus.LOST, CopyStatus.AVAILABLE)).toBe(true);
    expect(canMoveCopy(CopyStatus.DAMAGED, CopyStatus.AVAILABLE)).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canMoveCopy(CopyStatus.AVAILABLE, CopyStatus.LOST)).toBe(false);
    expect(canMoveCopy(CopyStatus.HELD, CopyStatus.LOST)).toBe(false);
    expect(canMoveCopy(CopyStatus.CHECKED_OUT, CopyStatus.DAMAGED)).toBe(false);
    expect(canMoveCopy(CopyStatus.LOST, CopyStatus.HELD)).toBe(false);
    expect(canMoveCopy(CopyStatus.DAMAGED, CopyStatus.CHECKED_OUT)).toBe(false);
  });
});
