import { describe, expect, it } from 'vitest';
import { computePots, splitAmount } from '../src';

describe('computePots', () => {
  it('un solo bote cuando todos aportan lo mismo', () => {
    expect(
      computePots([
        { id: 'a', amount: 100, folded: false },
        { id: 'b', amount: 100, folded: false },
      ]),
    ).toEqual([{ amount: 200, eligible: ['a', 'b'] }]);
  });

  it('crea side pots con varios all-in', () => {
    expect(
      computePots([
        { id: 'a', amount: 50, folded: false },
        { id: 'b', amount: 200, folded: false },
        { id: 'c', amount: 200, folded: false },
        { id: 'd', amount: 120, folded: false },
      ]),
    ).toEqual([
      { amount: 200, eligible: ['a', 'b', 'c', 'd'] },
      { amount: 210, eligible: ['b', 'c', 'd'] },
      { amount: 160, eligible: ['b', 'c'] },
    ]);
  });

  it('las fichas de los retirados cuentan pero no pueden ganar', () => {
    expect(
      computePots([
        { id: 'a', amount: 100, folded: false },
        { id: 'b', amount: 100, folded: false },
        { id: 'c', amount: 60, folded: true },
      ]),
    ).toEqual([{ amount: 260, eligible: ['a', 'b'] }]);
  });

  it('un retirado que puso más que los all-in alimenta el último bote', () => {
    expect(
      computePots([
        { id: 'a', amount: 50, folded: false },
        { id: 'b', amount: 50, folded: false },
        { id: 'c', amount: 80, folded: true },
      ]),
    ).toEqual([{ amount: 180, eligible: ['a', 'b'] }]);
  });
});

describe('splitAmount', () => {
  it('reparte los céntimos sobrantes a los primeros', () => {
    expect(splitAmount(25, 2)).toEqual([13, 12]);
    expect(splitAmount(100, 3)).toEqual([34, 33, 33]);
    expect(splitAmount(90, 3)).toEqual([30, 30, 30]);
  });
});
