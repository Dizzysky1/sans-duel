// Race outcome rules, shared by both clients (pure, unit-tested).
/** Who wins? 'me' | 'them' | null (undecided). Both clients compute the same thing. */
export function decideResult(me, them) {
  const won = (p) => p.status === 'won', dead = (p) => p.status === 'dead';
  if (won(me) && won(them)) return me.time <= them.time ? 'me' : 'them';
  if (won(me)) return 'me';
  if (won(them)) return 'them';
  if (dead(me) && dead(them)) {
    if (me.hits !== them.hits) return me.hits > them.hits ? 'me' : 'them';
    return me.time >= them.time ? 'me' : 'them';
  }
  if (dead(me) && them.hits > me.hits) return 'them';
  if (dead(them) && me.hits > them.hits) return 'me';
  return null;
}
