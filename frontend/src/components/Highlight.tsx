/** Shows text with the search terms marked. Plain text in, React elements out (never HTML). */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const usable = terms.filter((t) => t.length > 1);
  if (!usable.length) return <>{text}</>;
  const escaped = usable.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-warning-soft px-0.5 text-fg">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
