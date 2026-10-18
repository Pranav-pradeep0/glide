import { describe, expect, it } from '@jest/globals';
import { crossesMark, nearestMark } from '../src/utils/seekMarks';

// A drag on the seek bar ticks as it passes a bookmark or chapter start, and a slow release
// next to one lands on it.

const marks = [60, 300, 302];

describe('nearestMark', () => {
  it('snaps only within the radius', () => {
    expect(nearestMark(marks, 63, 5)).toBe(60);
    expect(nearestMark(marks, 70, 5)).toBe(-1);
  });

  it('takes the closer of two marks in range', () => {
    expect(nearestMark(marks, 301.5, 5)).toBe(302);
    expect(nearestMark(marks, 299, 5)).toBe(300);
  });

  it('snaps to nothing without marks', () => {
    expect(nearestMark([], 10, 5)).toBe(-1);
  });
});

describe('crossesMark', () => {
  it('sees a mark passed in either direction', () => {
    expect(crossesMark(marks, 50, 100)).toBe(true);
    expect(crossesMark(marks, 100, 50)).toBe(true);
    expect(crossesMark(marks, 100, 200)).toBe(false);
  });

  it('ticks once when the finger stops exactly on a mark and moves on', () => {
    expect(crossesMark(marks, 50, 60)).toBe(true);
    expect(crossesMark(marks, 60, 70)).toBe(false);
  });
});
