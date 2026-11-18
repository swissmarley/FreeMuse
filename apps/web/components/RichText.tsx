import { Fragment } from 'react';

/** Minimal, safe formatting: **bold**, URLs and line breaks. No HTML injection possible (React escapes text). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow">{p}</a>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
