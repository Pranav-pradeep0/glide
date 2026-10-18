import { describe, expect, it } from '@jest/globals';
import { findSkips, skipIndexAt } from '../src/utils/skipChapters';

// "Skip intro" / "Skip recap" come from chapter names alone. Chapter lists below are shaped
// like real releases: an anime episode, a TV rip, and films that must offer nothing.

const anime = [
  { title: 'Avant', start: 0 },
  { title: 'Opening', start: 95 },
  { title: 'Part A', start: 185 },
  { title: 'Part B', start: 760 },
  { title: 'Ending', start: 1310 },
  { title: 'Preview', start: 1400 },
];

describe('findSkips', () => {
  it('offers the anime opening, from its start to the next chapter', () => {
    expect(findSkips(anime, 1420)).toEqual([{ kind: 'intro', start: 95, end: 185 }]);
  });

  it('takes the short names releases use', () => {
    const op = [{ title: 'OP', start: 0 }, { title: 'Episode', start: 89 }];
    expect(findSkips(op, 1400)).toEqual([{ kind: 'intro', start: 0, end: 89 }]);
  });

  it('offers a TV recap and intro separately', () => {
    const tv = [
      { title: 'Previously On', start: 0 },
      { title: 'Intro', start: 62 },
      { title: 'Chapter 3', start: 120 },
      { title: 'Chapter 4', start: 900 },
    ];
    expect(findSkips(tv, 2600)).toEqual([
      { kind: 'recap', start: 0, end: 62 },
      { kind: 'intro', start: 62, end: 120 },
    ]);
  });

  it('leaves a film whose first chapter is a long "Opening" alone', () => {
    const film = [{ title: 'Opening', start: 0 }, { title: 'The Heist', start: 540 }, { title: 'Escape', start: 3600 }];
    expect(findSkips(film, 7200)).toEqual([]);
  });

  it('ignores names that only contain the letters', () => {
    const film = [{ title: 'Operation', start: 0 }, { title: 'Topaz', start: 60 }, { title: 'End', start: 120 }];
    expect(findSkips(film, 7200)).toEqual([]);
  });

  it('ignores an intro-like chapter late in the video, and the last chapter', () => {
    const late = [{ title: 'Chapter 1', start: 0 }, { title: 'Intro', start: 3000 }, { title: 'Chapter 3', start: 3060 }];
    expect(findSkips(late, 5000)).toEqual([]);
    expect(findSkips([{ title: 'Chapter 1', start: 0 }, { title: 'Intro', start: 30 }], 100)).toEqual([]);
  });
});

describe('skipIndexAt', () => {
  const skips = findSkips(anime, 1420);
  it('is the range playing, up to but not at its end', () => {
    expect(skipIndexAt(skips, 94)).toBe(-1);
    expect(skipIndexAt(skips, 95)).toBe(0);
    expect(skipIndexAt(skips, 184.9)).toBe(0);
    expect(skipIndexAt(skips, 185)).toBe(-1);
  });
});
