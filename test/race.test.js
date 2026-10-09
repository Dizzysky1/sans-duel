import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideResult } from '../src/race.js';

const p = (status, hits, time) => ({ status, hits, time });

test('first to beat sans wins', () => {
  assert.equal(decideResult(p('won', 24, 300000), p('alive', 15, 300000)), 'me');
  assert.equal(decideResult(p('alive', 20, 1), p('won', 24, 2)), 'them');
  assert.equal(decideResult(p('won', 24, 250000), p('won', 24, 260000)), 'me');
  assert.equal(decideResult(p('won', 24, 270000), p('won', 24, 260000)), 'them');
});

test('dying hands the win to whoever gets past you', () => {
  assert.equal(decideResult(p('dead', 10, 100), p('alive', 10, 100)), null);
  assert.equal(decideResult(p('dead', 10, 100), p('alive', 11, 100)), 'them');
  assert.equal(decideResult(p('alive', 4, 100), p('dead', 3, 100)), 'me');
});

test('both dead: furthest, then longest alive', () => {
  assert.equal(decideResult(p('dead', 12, 10), p('dead', 9, 99)), 'me');
  assert.equal(decideResult(p('dead', 9, 10), p('dead', 9, 20)), 'them');
  assert.equal(decideResult(p('alive', 3, 1), p('alive', 9, 1)), null);
});

test('both clients agree (symmetry)', () => {
  const cases = [[p('dead', 5, 10), p('dead', 5, 11)], [p('won', 24, 5), p('won', 24, 6)], [p('dead', 2, 1), p('alive', 3, 1)]];
  for (const [a, b] of cases) {
    const x = decideResult(a, b), y = decideResult(b, a);
    assert.equal(x === 'me' ? 'a' : 'b', y === 'them' ? 'a' : 'b');
  }
});
