import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, patchPost, REACTIONS, useMe, type CollectionSummary, type Post } from './api';
import { pawConfetti, purr, toast } from './fun';

export const CAT_EMOJIS = ['🐱', '😺', '😸', '😻', '😼', '🙀', '😹', '🐈', '🐈‍⬛', '🦁', '🐯', '👑', '🌸', '💿', '🎮', '🍣'];

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="Загрузка">
      <span>🐾</span><span>🐾</span><span>🐾</span>
    </div>
  );
}

export function Empty({ emoji, title, text, children }: { emoji: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

export function QueryError({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 404) return <Empty emoji="🙀" title="Не нашли" text={error.message} />;
  return (
    <Empty emoji="😿" title="Что-то сломалось" text={error instanceof Error ? error.message : undefined}>
      <button className="btn" onClick={() => window.location.reload()}>Обновить</button>
    </Empty>
  );
}

export function NeedLogin({ text }: { text: string }) {
  return (
    <Empty emoji="🔐" title="Нужен аккаунт" text={text}>
      <Link className="btn btn-pink" to="/login">Войти</Link>
    </Empty>
  );
}

export const totalReactions = (post: Post) => Object.values(post.reactions).reduce((a, b) => a + b, 0);

function useReact(post: Post) {
  const qc = useQueryClient();
  const { me } = useMe();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (kind: string | null) =>
      kind
        ? api<{ post: Post }>('PUT', `/posts/${post.id}/reaction`, { kind })
        : api<{ post: Post }>('DELETE', `/posts/${post.id}/reaction`),
    onSuccess: ({ post: updated }) => {
      patchPost(qc, updated);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (kind: string | null) => {
    if (!me) {
      navigate('/login');
      return false;
    }
    mutation.mutate(kind);
    return true;
  };
}

export function ReactionBar({ post }: { post: Post }) {
  const react = useReact(post);
  return (
    <div className="reactions" role="group" aria-label="Реакции">
      {REACTIONS.map((r) => {
        const active = post.myReaction === r.kind;
        return (
          <motion.button
            key={r.kind}
            whileTap={{ scale: 0.75, rotate: -12 }}
            whileHover={{ y: -3, rotate: 3 }}
            className={`reaction ${active ? 'active' : ''}`}
            aria-pressed={active}
            title={r.label}
            aria-label={r.label}
            onClick={(e) => {
              if (react(active ? null : r.kind) && !active) {
                pawConfetti(e.clientX, e.clientY, r.emoji);
                purr();
              }
            }}
          >
            <span>{r.emoji}</span>
            <b>{post.reactions[r.kind] ?? 0}</b>
          </motion.button>
        );
      })}
    </div>
  );
}

const TILTS = [-1.2, 0.8, -0.5, 1.1, 0.4, -0.9];

export function PostCard({ post }: { post: Post }) {
  const react = useReact(post);
  const navigate = useNavigate();
  const clickTimer = useRef<number>(undefined);
  const total = totalReactions(post);
  const top = REACTIONS.filter((r) => post.reactions[r.kind]).sort((a, b) => post.reactions[b.kind]! - post.reactions[a.kind]!).slice(0, 3);
  const love = (e: MouseEvent) => {
    if (react(post.myReaction ? null : 'love') && !post.myReaction) {
      pawConfetti(e.clientX, e.clientY, '😻');
      purr();
    }
  };

  // A single click opens the post, a double click loves it, like in the apps people know.
  const onImageClick = (e: MouseEvent) => {
    e.preventDefault();
    if (e.detail === 1) clickTimer.current = window.setTimeout(() => navigate(`/p/${post.id}`), 230);
    if (e.detail === 2) {
      window.clearTimeout(clickTimer.current);
      if (!post.myReaction) love(e);
    }
  };

  return (
    <motion.article
      className="card"
      initial={{ opacity: 0, y: 24, scale: 0.94, rotate: TILTS[post.id % TILTS.length] }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: TILTS[post.id % TILTS.length] }}
      whileHover={{ y: -6, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
    >
      <Link to={`/p/${post.id}`} className="card-image" onClick={onImageClick} style={{ aspectRatio: `${post.width} / ${post.height}`, background: post.color }}>
        <img src={post.thumbUrl} alt={post.title} loading="lazy" width={post.width} height={post.height} />
      </Link>
      {post.cat && <Link className="sticker card-sticker" to={`/cats/${post.cat.id}`}>{post.cat.emoji} {post.cat.name}</Link>}
      <div className="card-body">
        <h3><Link to={`/p/${post.id}`}>{post.title}</Link></h3>
        <div className="card-meta">
          <Link className="author" to={`/u/${post.author.username}`}>
            <span aria-hidden="true">{post.author.avatarEmoji}</span> {post.author.displayName}
          </Link>
          <motion.button
            className={`card-react ${post.myReaction ? 'active' : ''}`}
            whileTap={{ scale: 0.7 }}
            onClick={love}
            aria-pressed={Boolean(post.myReaction)}
            aria-label={`Реакций: ${total}. ${post.myReaction ? 'Убрать реакцию' : 'Поставить реакцию'}`}
          >
            {top.length ? top.map((r) => r.emoji).join('') : '🤍'} <b>{total}</b>
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
}

/** Places each card in the currently shortest column, so the page order stays stable as more load. */
export function Masonry({ posts }: { posts: Post[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);

  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => setColumns(Math.max(2, Math.min(6, Math.floor(el.clientWidth / 250))));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const buckets: Post[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  for (const post of posts) {
    const shortest = heights.indexOf(Math.min(...heights));
    buckets[shortest]!.push(post);
    heights[shortest]! += post.height / post.width + 0.35;
  }

  return (
    <div className="masonry" ref={ref}>
      {buckets.map((column, i) => (
        <div className="masonry-col" key={i}>
          {column.map((post) => <PostCard key={post.id} post={post} />)}
        </div>
      ))}
    </div>
  );
}

export function InfiniteTrigger({ onVisible, active }: { onVisible: () => void; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) onVisible();
    }, { rootMargin: '500px' });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [active, onVisible]);
  return <div ref={ref} aria-hidden="true" />;
}

export function SaveButton({ post }: { post: Post }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const { data } = useQuery({
    queryKey: ['my-collections'],
    queryFn: () => api<{ collections: CollectionSummary[] }>('GET', '/me/collections'),
    enabled: open && Boolean(me),
  });
  const save = useMutation({
    mutationFn: (id: number) => api('POST', `/collections/${id}/posts`, { postId: post.id }),
    onSuccess: () => {
      toast('📌 Сохранено в коллекцию');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['my-collections'] });
    },
  });
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('POST', '/collections', { name }),
    onSuccess: ({ id }) => {
      setName('');
      save.mutate(id);
    },
  });

  return (
    <div className="save-wrap">
      <button className="btn btn-lime" aria-expanded={open} onClick={() => (me ? setOpen(!open) : navigate('/login'))}>📌 Сохранить</button>
      <AnimatePresence>
        {open && (
          <motion.div className="save-menu" initial={{ opacity: 0, y: -8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
            {data?.collections.map((c) => (
              <button key={c.id} onClick={() => save.mutate(c.id)}>
                {c.isPrivate ? '🔒' : '📁'} {c.name} <small>{c.count}</small>
              </button>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новая коллекция" aria-label="Название новой коллекции" maxLength={50} />
              <button className="btn btn-small" type="submit">OK</button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
