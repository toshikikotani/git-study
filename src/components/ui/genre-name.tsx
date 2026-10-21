import { Fragment } from 'react';

/**
 * 狭い場所(記録するのカテゴリのマスなど)のカテゴリ名。「・」のあとでだけ折り返す(親に break-keep を
 * 付ける)。「カフェ・飲／料」「保険・税／金・手数料」のように、言葉の途中で折れていた(ADR-131)。
 */
export function GenreName({ name }: { name: string }) {
  const parts = name.split('・');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? (
            <>
              ・<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}
