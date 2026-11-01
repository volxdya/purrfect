import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useFeed, useMe, type FeedParams } from '../api';
import { Empty, InfiniteTrigger, Loading, Masonry, NeedLogin, QueryError } from '../ui';

const TICKER = ['МЯУ', '🐾', 'КОТ ДНЯ УЖЕ ВЫБРАН', '✨', 'ДАБЛ-КЛИК = ЛЮБОВЬ', '😻', 'ГДЕ-ТО ПРЯЧЕТСЯ СЕКРЕТНЫЙ КОД', '🕹️', 'ЛАПКИ ВВЕРХ', '⚡'];

const SORTS: { id: NonNullable<FeedParams['sort']>; label: string }[] = [
  { id: 'new', label: '✨ Свежие' },
  { id: 'hot', label: '🔥 Горячие' },
  { id: 'following', label: '💌 Подписки' },
];

export function PostGrid({ params }: { params: FeedParams }) {
  const feed = useFeed(params);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (feed.isLoading) return <Loading />;
  if (!feed.data) return <QueryError error={feed.error} />

  // Offset paging can repeat a post when new ones arrive mid-scroll, so de-duplicate.
  const seen = new Set<number>();
  const posts = feed.data.pages.flatMap((p) => p.posts).filter((p) => !seen.has(p.id) && Boolean(seen.add(p.id)));

  if (!posts.length) {
    return (
      <Empty emoji="📦" title="Пока пусто" text="Тут только коробка. Котика в ней нет.">
        <Link className="btn btn-pink" to="/new">Загрузить котика</Link>
      </Empty>
    );
  }
  return (
    <>
      <Masonry posts={posts} />
      <InfiniteTrigger active={Boolean(hasNextPage)} onVisible={loadMore} />
      {isFetchingNextPage && <Loading />}
    </>
  );
}

export function Feed() {
  const [search, setSearch] = useSearchParams();
  const { me, isLoading } = useMe();
  const q = search.get('q') ?? undefined;
  const tag = search.get('tag') ?? undefined;
  const sort = (SORTS.find((s) => s.id === search.get('sort'))?.id ?? 'new') as NonNullable<FeedParams['sort']>;
  const tags = useQuery({
    queryKey: ['trending'],
    queryFn: () => api<{ tags: { tag: string; count: number }[] }>('GET', '/tags/trending'),
  });

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearch(next);
  };

  return (
    <>
      {!q && !tag && (
        <section className="hero">
          <h1>Самые красивые <mark>котики</mark> интернета</h1>
          <div className="ticker" aria-hidden="true">
            <div>{[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => <span key={i}>{t}</span>)}</div>
          </div>
        </section>
      )}
      {q && <h1 className="page-title">Ищем: «{q}»</h1>}
      {tag && <h1 className="page-title">#{tag}</h1>}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {SORTS.map((s) => (
            <button key={s.id} role="tab" aria-selected={sort === s.id} className={sort === s.id ? 'active' : ''} onClick={() => update({ sort: s.id === 'new' ? null : s.id })}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="chips">
          {tag && <button className="chip chip-on" onClick={() => update({ tag: null })}>#{tag} ✕</button>}
          {tags.data?.tags.filter((t) => t.tag !== tag).map((t) => (
            <button key={t.tag} className="chip" onClick={() => update({ tag: t.tag })}>#{t.tag}</button>
          ))}
        </div>
      </div>

      {sort === 'following' && !me && !isLoading ? (
        <NeedLogin text="Войди, чтобы видеть котиков от тех, на кого подписан." />
      ) : (
        <PostGrid params={{ sort, q, tag }} />
      )}
    </>
  );
}
