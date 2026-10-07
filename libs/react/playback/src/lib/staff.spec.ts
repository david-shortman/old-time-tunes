import { makeKey } from './music';
import {
  displayedAccidental,
  keySignatureSharps,
  ledgerSteps,
  spell,
  TREBLE_BOTTOM_STEP,
} from './staff';

describe('staff spelling', () => {
  it('knows fiddle keys', () => {
    expect(keySignatureSharps(makeKey(2, 'major'))).toBe(2); // D
    expect(keySignatureSharps(makeKey(9, 'major'))).toBe(3); // A
    expect(keySignatureSharps(makeKey(7, 'major'))).toBe(1); // G
    expect(keySignatureSharps(makeKey(9, 'minor'))).toBe(0); // A minor
    expect(keySignatureSharps(makeKey(5, 'major'))).toBe(-1); // F
  });

  it('spells F# in D major as F sharp with no displayed accidental', () => {
    const s = spell(66, 2);
    expect(s.letter).toBe(3);
    expect(s.accidental).toBe('#');
    expect(displayedAccidental(s, 2)).toBe('');
  });

  it('shows a natural for F natural in D major and a sharp for G# in D major', () => {
    expect(displayedAccidental(spell(65, 2), 2)).toBe('n');
    expect(displayedAccidental(spell(68, 2), 2)).toBe('#');
  });

  it('uses flats in flat keys', () => {
    const s = spell(70, -1); // Bb in F major
    expect(s.letter).toBe(6);
    expect(s.accidental).toBe('b');
    expect(displayedAccidental(s, -1)).toBe('');
  });

  it('places middle C one ledger line below the treble staff and G3 below that', () => {
    expect(spell(60, 0).step).toBe(TREBLE_BOTTOM_STEP - 2);
    expect(ledgerSteps(spell(60, 0).step)).toEqual([TREBLE_BOTTOM_STEP - 2]);
    expect(ledgerSteps(spell(55, 0).step).length).toBe(2); // G3: ledger lines at C4 and A3
    expect(ledgerSteps(spell(64, 0).step)).toEqual([]); // E4 on the line
    expect(ledgerSteps(spell(81, 0).step)).toEqual([TREBLE_BOTTOM_STEP + 10]); // A5: one ledger above
  });
});
