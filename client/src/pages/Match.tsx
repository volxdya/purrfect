import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useMe, type Post } from '../api';
import { pawConfetti, purr } from '../fun';
import { Empty, Loading, NeedLogin, QueryError } from '../ui';

type Verdict = 'cat' | 'supercat';

function SwipeCard({ post, exitDir, onSwipe }: { post: Post; exitDir: number; onSwipe: (v: Verdict) => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-18, 18]);
  const superOpacity = useTransform(x, [20, 120], [0, 1]);
  const catOpacity = useTransform(x, [-120, -20], [1, 0]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 110 || info.velocity.x > 600) onSwipe('supercat');
    else if (info.offset.x < -110 || info.velocity.x < -600) onSwipe('cat');
  };

  return (
    <motion.div
      className="swipe-card"
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={onDragEnd}
      initial={{ scale: 0.9, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ x: exitDir * 600, rotate: exitDir * 30, opacity: 0, transition: { duration: 0.3 } }}
    >
      <img src={post.imageUrl} alt={post.title} draggable={false} />
      <motion.div className="swipe-label label-super" style={{ opacity: superOpacity }}>СУПЕРКОТИК</motion.div>
      <motion.div className="swipe-label label-cat" style={{ opacity: catOpacity }}>КОТИК</motion.div>
      <div className="swipe-info">
        <b>{post.title}</b>
        <small>{post.cat ? `${post.cat.emoji} ${post.cat.name} · ` : ''}{post.author.displayName}</small>
      </div>
    </motion.div>
  );
}

export function Match() {
  const { me, isLoading: meLoading } = useMe();
  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [exitDir, setExitDir] = useState(1);
  const deck = useQuery({
    queryKey: ['deck'],
    queryFn: () => api<{ posts: Post[] }>('GET', '/match/deck'),
    enabled: Boolean(me),
    staleTime: 0,
    gcTime: 0,
  });
  const swipe = useMutation({
    mutationFn: ({ id, verdict }: { id: number; verdict: Verdict }) => api('POST', `/match/${id}`, { verdict }),
  });
  const posts = deck.data?.posts ?? [];
  const current = posts[index];

  // At the end of a batch, ask for more. An empty answer means every cat has been rated.
  useEffect(() => {
    if (posts.length && !current && !swipe.isPending) {
      setIndex(0);
      qc.invalidateQueries({ queryKey: ['deck'] });
    }
  }, [posts.length, current, swipe.isPending, qc]);

  if (meLoading) return <Loading />;
  if (!me) return <NeedLogin text="Войди, чтобы играть в котомэтч." />;
  if (deck.isLoading) return <Loading />;
  if (deck.isError) return <QueryError error={deck.error} />;

  const decide = (verdict: Verdict) => {
    if (!current) return;
    setExitDir(verdict === 'supercat' ? 1 : -1);
    swipe.mutate({ id: current.id, verdict });
    if (verdict === 'supercat') {
      pawConfetti(window.innerWidth / 2, window.innerHeight / 2, '🌟');
      purr();
    }
    setIndex((i) => i + 1);
  };

  if (!posts.length) {
    return (
      <Empty emoji="🏆" title="Ты оценил всех котиков" text="Новые появятся, когда кто-нибудь их загрузит.">
        <Link className="btn btn-pink" to="/battle">В битву!</Link>
      </Empty>
    );
  }

  return (
    <div className="match">
      <h1 className="page-title">Котомэтч</h1>
      <p className="muted">Плохих котов не бывает. Свайпни вправо, если это суперкотик.</p>
      <div className="swipe-stack">
        {posts[index + 1] && <div className="swipe-next"><img src={posts[index + 1]!.thumbUrl} alt="" /></div>}
        <AnimatePresence custom={exitDir}>
          {current && <SwipeCard key={current.id} post={current} exitDir={exitDir} onSwipe={decide} />}
        </AnimatePresence>
      </div>
      <div className="match-actions">
        <motion.button whileTap={{ scale: 0.85 }} className="btn btn-big" onClick={() => decide('cat')}>😺 Котик</motion.button>
        <motion.button whileTap={{ scale: 0.85 }} className="btn btn-big btn-pink" onClick={() => decide('supercat')}>🌟 Суперкотик</motion.button>
      </div>
    </div>
  );
}
