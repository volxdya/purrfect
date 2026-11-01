import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useMe, type Comment, type Post } from '../api';
import { pawConfetti, timeAgo, toast } from '../fun';
import { Loading, QueryError, ReactionBar, SaveButton } from '../ui';

function Comments({ post }: { post: Post }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const key = ['comments', post.id];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<{ comments: Comment[] }>('GET', `/posts/${post.id}/comments`) });
  const add = useMutation({
    mutationFn: () => api('POST', `/posts/${post.id}/comments`, { body }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api('DELETE', `/comments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) add.mutate();
  };

  return (
    <section className="comments">
      <h2>Мяу-комментарии {data ? `· ${data.comments.length}` : ''}</h2>
      {me ? (
        <form className="comment-form" onSubmit={submit}>
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Скажи что-нибудь котику…" aria-label="Комментарий" maxLength={500} />
          <button className="btn btn-pink" disabled={add.isPending}>Мяу</button>
        </form>
      ) : (
        <p className="muted"><Link to="/login">Войди</Link>, чтобы комментировать.</p>
      )}
      <AnimatePresence initial={false}>
        {data?.comments.map((c) => (
          <motion.div key={c.id} className="comment" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}>
            <Link to={`/u/${c.username}`} className="comment-avatar" aria-label={c.displayName}>{c.avatarEmoji}</Link>
            <div>
              <div className="comment-head">
                <Link to={`/u/${c.username}`}><b>{c.displayName}</b></Link>
                <small>{timeAgo(c.createdAt)}</small>
              </div>
              <p>{c.body}</p>
            </div>
            {me && (me.id === c.userId || me.id === post.author.id) && (
              <button className="link-btn" onClick={() => remove.mutate(c.id)} aria-label="Удалить комментарий">✕</button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}

export function PostPage() {
  const id = Number(useParams().id);
  const { me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, error, isLoading } = useQuery({ queryKey: ['post', id], queryFn: () => api<{ post: Post }>('GET', `/posts/${id}`) });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/posts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      toast('Котик удалён');
      navigate('/');
    },
  });

  if (isLoading) return <Loading />;
  if (!data) return <QueryError error={error} />;
  const { post } = data;

  return (
    <div className="post-layout">
      <motion.div className="post-image" initial={{ scale: 0.96, rotate: -1 }} animate={{ scale: 1, rotate: 0 }} style={{ background: post.color }}>
        <img src={post.imageUrl} alt={post.title} width={post.width} height={post.height} onDoubleClick={(e) => pawConfetti(e.clientX, e.clientY)} />
      </motion.div>
      <div className="post-side">
        <h1>{post.title}</h1>
        {post.description && <p>{post.description}</p>}
        <div className="post-byline">
          <Link className="author" to={`/u/${post.author.username}`}>
            <span aria-hidden="true">{post.author.avatarEmoji}</span> {post.author.displayName}
          </Link>
          <small>{timeAgo(post.createdAt)}</small>
          {post.cat && <Link className="sticker" to={`/cats/${post.cat.id}`}>{post.cat.emoji} {post.cat.name}</Link>}
        </div>
        {post.tags.length > 0 && (
          <div className="chips">
            {post.tags.map((t) => <Link key={t} className="chip" to={`/?tag=${encodeURIComponent(t)}`}>#{t}</Link>)}
          </div>
        )}
        <ReactionBar post={post} />
        <div className="post-actions">
          <SaveButton post={post} />
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                toast('🔗 Ссылка скопирована');
              } catch {
                toast('Не получилось скопировать ссылку');
              }
            }}
          >
            🔗 Поделиться
          </button>
          {me?.id === post.author.id && (
            <button className="btn" onClick={() => window.confirm('Точно удалить этого котика?') && remove.mutate()}>🗑 Удалить</button>
          )}
        </div>
        <div className="battle-score">⚔️ {post.wins} побед · {post.losses} поражений · рейтинг {post.elo}</div>
        <Comments post={post} />
      </div>
    </div>
  );
}
