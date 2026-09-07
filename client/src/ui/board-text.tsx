const GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/* A board or a holding rendered as text, for tables and dense panels where five
   card faces would be too much furniture. Same suit colours as the card. */
export function BoardText({ cards }: { cards: string[] }) {
  if (cards.length === 0) return <span className="muted">No board</span>;
  return (
    <span className="ctext">
      {cards.map((c, i) => (
        <span key={`${c}-${i}`} data-suit={c[1]}>
          {c[0] === 'T' ? '10' : c[0]}
          <span aria-hidden="true">{GLYPH[c[1]] ?? c[1]}</span>
        </span>
      ))}
    </span>
  );
}
