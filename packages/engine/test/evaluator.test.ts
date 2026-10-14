import { describe, expect, it } from 'vitest';
import { evaluateHand, type Card } from '../src';

const ev = (cards: string) => evaluateHand(cards.split(' ') as Card[]);

describe('evaluateHand', () => {
  it.each([
    ['As Kd 9h 7c 2s', 'highCard'],
    ['As Ad 9h 7c 2s', 'pair'],
    ['As Ad 9h 9c 2s', 'twoPair'],
    ['As Ad Ah 7c 2s', 'threeOfAKind'],
    ['5s 6d 7h 8c 9s', 'straight'],
    ['As 2d 3h 4c 5s', 'straight'],
    ['As Ks 9s 7s 2s', 'flush'],
    ['As Ad Ah 7c 7s', 'fullHouse'],
    ['As Ad Ah Ac 2s', 'fourOfAKind'],
    ['5s 6s 7s 8s 9s', 'straightFlush'],
    ['Ts Js Qs Ks As', 'straightFlush'],
  ])('%s → %s', (cards, category) => {
    expect(ev(cards).category).toBe(category);
  });

  it('ordena las categorías correctamente', () => {
    const ladder = [
      'As Kd 9h 7c 2s',
      'As Ad 9h 7c 2s',
      'As Ad 9h 9c 2s',
      'As Ad Ah 7c 2s',
      '5s 6d 7h 8c 9s',
      'As Ks 9s 7s 2s',
      'As Ad Ah 7c 7s',
      'As Ad Ah Ac 2s',
      '5s 6s 7s 8s 9s',
    ].map((h) => ev(h).score);
    expect([...ladder].sort((a, b) => a - b)).toEqual(ladder);
  });

  it('la rueda (A-5) es la escalera más baja', () => {
    expect(ev('As 2d 3h 4c 5s').score).toBeLessThan(ev('2s 3d 4h 5c 6s').score);
  });

  it('desempata por kickers', () => {
    expect(ev('As Ad Kh 7c 2s').score).toBeGreaterThan(ev('As Ad Qh 7c 2s').score);
    expect(ev('Ks Kd 2h 2c As').score).toBeGreaterThan(ev('Ks Kd 2h 2c Qs').score);
    expect(ev('Qs Qd 2h 2c As').score).toBeGreaterThan(ev('Js Jd 9h 9c As').score);
  });

  it('manos equivalentes empatan', () => {
    expect(ev('As Kd 9h 7c 2s').score).toBe(ev('Ac Kh 9d 7s 2c').score);
  });

  it('elige la mejor combinación de 7 cartas', () => {
    const best = ev('2s 7s 9s Js Qs Td 8h');
    expect(best.category).toBe('flush');
    expect(ev('As Ad Kh Kc Qs Qd 2h').score).toBe(ev('As Ad Kh Kc Qs').score);
  });

  it('evalúa manos incompletas (preflop)', () => {
    expect(ev('As Ad').category).toBe('pair');
    expect(ev('As Kd').category).toBe('highCard');
  });
});
