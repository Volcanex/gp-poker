/* Glicko-2 (http://www.glicko.net/glicko/glicko2.pdf). Lifetime rating,
   no seasonal reset: every match is its own rating period, so updateRating
   is always called with zero or one opponent result. Internally the paper's
   Glicko-2 scale (mu, phi) is used; Rating stays in the public Glicko scale
   (~1500, ~350) at every boundary. */

export interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

export const DEFAULTS = { rating: 1500, rd: 350, volatility: 0.06, tau: 0.75 };

const SCALE = 173.7178;
const EPSILON = 0.000001;
const RD_FLOOR = 30; // ratings never fully freeze
const RD_CAP = 350;

// RD widens during inactivity as sqrt(rd^2 + c^2 * days). c is chosen so a
// settled player (rd 50) drifts back up to the 350 cap after 730 days idle.
export const RD_WIDEN_C = Math.sqrt((RD_CAP ** 2 - 50 ** 2) / 730);

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi ** 2) / Math.PI ** 2);
}

function e(mu: number, muOpp: number, phiOpp: number): number {
  return 1 / (1 + Math.exp(-g(phiOpp) * (mu - muOpp)));
}

function toMu(rating: number): number {
  return (rating - DEFAULTS.rating) / SCALE;
}

function toPhi(rd: number): number {
  return rd / SCALE;
}

function clampRd(rd: number): number {
  return Math.min(RD_CAP, Math.max(RD_FLOOR, rd));
}

export function expectedScore(a: Rating, b: Rating): number {
  return e(toMu(a.rating), toMu(b.rating), toPhi(b.rd));
}

export function isProvisional(r: Rating): boolean {
  return r.rd > 110;
}

export function widenRd(player: Rating, daysInactive: number): Rating {
  const widened = Math.sqrt(player.rd ** 2 + RD_WIDEN_C ** 2 * daysInactive);
  return { ...player, rd: clampRd(widened) };
}

export function updateRating(
  player: Rating,
  results: { rating: number; rd: number; score: 0 | 0.5 | 1 }[],
  tau = DEFAULTS.tau
): Rating {
  const mu = toMu(player.rating);
  const phi = toPhi(player.rd);

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi ** 2 + player.volatility ** 2);
    return { ...player, rd: clampRd(phiStar * SCALE) };
  }

  const opponents = results.map((res) => {
    const phiOpp = toPhi(res.rd);
    const gOpp = g(phiOpp);
    const eOpp = e(mu, toMu(res.rating), phiOpp);
    return { g: gOpp, e: eOpp, score: res.score };
  });

  const vInv = opponents.reduce((sum, o) => sum + o.g ** 2 * o.e * (1 - o.e), 0);
  const v = 1 / vInv;

  const sumGse = opponents.reduce((sum, o) => sum + o.g * (o.score - o.e), 0);
  const delta = v * sumGse;

  const a = Math.log(player.volatility ** 2);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    return (
      (ex * (delta ** 2 - phi ** 2 - v - ex)) / (2 * (phi ** 2 + v + ex) ** 2) -
      (x - a) / tau ** 2
    );
  };

  let A = a;
  let B: number;
  if (delta ** 2 > phi ** 2 + v) {
    B = Math.log(delta ** 2 - phi ** 2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  const newVolatility = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi ** 2 + newVolatility ** 2);
  const newPhi = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / v);
  const newMu = mu + newPhi ** 2 * sumGse;

  return {
    rating: SCALE * newMu + DEFAULTS.rating,
    rd: clampRd(SCALE * newPhi),
    volatility: newVolatility,
  };
}
