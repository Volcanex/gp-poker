import { SHOOTOUT_MIN_TABLE, SHOOTOUT_TABLE_SEATS } from '@opentable/protocol';

/* The draw: how a field becomes tables, and how a round's results become the
   next round's field. Pure arithmetic over seed numbers, no database and no
   users, because every one of these rules is a claim that is either right or
   wrong for a given field size and is worth being able to say so in a unit
   test rather than by playing a tournament.

   A seed here is a 1-based number. Who holds it is the caller's business. */

/* ---------------------------------------------------------------- brackets */

// The smallest power of two that holds the field. A field that is not one gets
// byes, and standard seeding is what puts them on the top seeds.
export function bracketSize(field: number): number {
  let size = 1;
  while (size < field) size *= 2;
  return size;
}

export function bracketRounds(field: number): number {
  return Math.log2(bracketSize(field));
}

/* Standard bracket seeding, as one list of slots. Built by doubling: a bracket
   of 2n is the bracket of n with each seed s paired against 2n+1-s in the slot
   beside it, which is the recursion that makes 1 meet the bottom seed, 2 meet
   the second bottom, and the two of them meet only in the final.

   For eight slots it reads 1, 8, 4, 5, 2, 7, 3, 6: pairs (1,8) (4,5) (2,7)
   (3,6), and the top half cannot meet the second seed before the final. */
export function bracketSlots(size: number): number[] {
  let slots = [1];
  while (slots.length < size) {
    const n = slots.length * 2;
    const next: number[] = [];
    for (const s of slots) {
      next.push(s, n + 1 - s);
    }
    slots = next;
  }
  return slots;
}

/* Round one of a bracket, as a list of seat lists. A slot holding a seed above
   the field is a bye, which leaves its match with one seat: the caller
   advances that seat without dealing, which is exactly what a bye is.

   Byes land on the top seeds for free, because the slot beside seed 1 is the
   bottom slot of the bracket and the bottom slots are the ones the field does
   not reach. */
export function bracketFirstRound(field: number): number[][] {
  const size = bracketSize(field);
  const slots = bracketSlots(size).map((seed) => (seed <= field ? seed : null));
  const tables: number[][] = [];
  for (let i = 0; i < slots.length; i += 2) {
    const pair = [slots[i], slots[i + 1]].filter((s): s is number => s !== null);
    tables.push(pair);
  }
  return tables;
}

/* ---------------------------------------------------------------- shootouts */

/* How many tables a shootout field sits at, and how many seats each takes.
   Six to a table at most, balanced so no table is short by more than one, and
   never below three: two players at a six-max table is heads-up by another
   name, and a shootout round should not quietly change game.

   Balance falls out of the division. With T tables the smallest table holds
   floor(N/T), and since T is the ceiling of N/6 that is at least three for
   every field of seven or more. A field of six or fewer is one table, which is
   the final. */
export function shootoutTables(field: number): number[] {
  if (field <= 0) return [];
  const tables = Math.max(1, Math.ceil(field / SHOOTOUT_TABLE_SEATS));
  const base = Math.floor(field / tables);
  const spare = field % tables;
  const sizes: number[] = [];
  for (let i = 0; i < tables; i++) sizes.push(base + (i < spare ? 1 : 0));
  // A one-table field can be smaller than the floor (a final of four or five
  // seats is a real final); a multi-table round cannot, and the arithmetic
  // above already says so. Asserted rather than corrected: a size below the
  // floor here would mean the division changed under us.
  if (sizes.length > 1 && sizes[sizes.length - 1] < SHOOTOUT_MIN_TABLE) {
    throw new Error(`a shootout round of ${field} balanced to a table of ${sizes[sizes.length - 1]}`);
  }
  return sizes;
}

/* Snake seeding across the tables: seed 1 to table 0, seed 2 to table 1, and
   at the end of the row back the other way, so no table collects the strong
   seeds. A table that has already taken its share is skipped, which is what
   keeps an uneven round balanced without a second pass. */
export function snakeSeats<T>(seeds: T[], sizes: number[]): T[][] {
  const tables: T[][] = sizes.map(() => []);
  const capacity = sizes.reduce((sum, n) => sum + n, 0);
  const placing = Math.min(seeds.length, capacity);
  let direction = 1;
  let table = 0;
  for (let placed = 0; placed < placing; ) {
    if (tables[table].length < sizes[table]) {
      tables[table].push(seeds[placed]);
      placed += 1;
    }
    // The row turns around at its own end rather than stepping past it, so
    // the last table of one pass is the first of the next, which is what
    // stops the ends of the row collecting the strong seeds.
    const next = table + direction;
    if (next < 0 || next >= sizes.length) direction = -direction;
    else table = next;
  }
  return tables;
}

/* How many of each table go through, given how many tables this round has.
   One table is the final and nothing advances out of it. Two tables send three
   each, which is a six-handed final; anything more sends two, because three
   from three tables is nine and nine does not fit at a final table.

   Written as the brief states it (3T <= 6) rather than as `T <= 2`, because
   the rule is about the size of the final table and not about the number two. */
export function advanceCount(tables: number): number {
  if (tables <= 1) return 0;
  return tables * 3 <= SHOOTOUT_TABLE_SEATS ? 3 : 2;
}

/* ------------------------------------------------------------------ places

   Everybody who did not reach the final is placed by the round they went out
   in, tied within a round. The place is one past however many players were
   still in after that round: four survivors and the round's casualties are all
   fifth, which is how a bracket has always been read. */
export function placeForRound(survivorsAfterRound: number): number {
  return survivorsAfterRound + 1;
}
