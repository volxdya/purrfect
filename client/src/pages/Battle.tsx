import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, useMe, type Post } from '../api';
import { pawConfetti, purr } from '../fun';
import { Empty, Loading, NeedLogin, QueryError } from '../ui';

interface BattleData {
  battleId: number | null;
  posts: Post[];
}

export function Battle() {
  const { me, isLoading } = useMe();
  const qc = useQueryClient();
  const [winner, setWinner] = useState<number | null>(null);
  const [rounds, setRounds] = useState(0);
  const battle = useQuery({
    queryKey: ['battle'],
    queryFn: () => api<BattleData>('POST', '/battle/new'),
    enabled: Boolean(me),
    staleTime: Infinity,
    gcTime: 0,
  });
  const vote = useMutation({
    mutationFn: (winnerId: number) => api('POST', `/battle/${battle.data!.battleId}/vote`, { winnerId }),
    onSuccess: () => {
      setRounds((r) => r + 1);
      setTimeout(() => {
        setWinner(null);
        qc.invalidateQueries({ queryKey: ['battle'] });
      }, 800);
    },
    onError: () => setWinner(null),
  });

  if (isLoading) return <Loading />;
  if (!me) return <NeedLogin text="Войди, чтобы судить кошачьи битвы." />;
  if (battle.isLoading) return <Loading />;
  if (battle.isError) return <QueryError error={battle.error} />;
  const [a, b] = battle.data?.posts ?? [];

  if (!battle.data?.battleId || !a || !b) {
    return (
      <Empty emoji="🕊️" title="На арене мир" text="Ты уже рассудил все пары котиков.">
        <Link className="btn btn-pink" to="/top">Смотреть топ</Link>
      </Empty>
    );
  }

  const pick = (post: Post, e: MouseEvent) => {
    if (winner) return;
    setWinner(post.id);
    pawConfetti(e.clientX, e.clientY, '⚔️');
    purr();
    vote.mutate(post.id);
  };

  return (
    <div className="battle">
      <h1 className="page-title">Битва котиков</h1>
      <p className="muted">Нажми на того, кто круче. Раундов за сессию: {rounds}</p>
      <div className="arena">
        <AnimatePresence mode="popLayout">
          {[a, b].map((post, i) => (
            <motion.button
              key={`${battle.data.battleId}-${post.id}`}
              className={`fighter ${winner === post.id ? 'winner' : ''} ${winner && winner !== post.id ? 'loser' : ''}`}
              onClick={(e) => pick(post, e)}
              initial={{ x: i ? 120 : -120, opacity: 0, rotate: i ? 6 : -6 }}
              animate={{ x: 0, opacity: 1, rotate: i ? 1.5 : -1.5 }}
              exit={{ opacity: 0, scale: 0.8 }}
              whileHover={winner ? undefined : { scale: 1.03, rotate: 0 }}
              whileTap={winner ? undefined : { scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            >
              <img src={post.imageUrl} alt="" draggable={false} />
              <b>{post.title}</b>
              <small>рейтинг {post.elo} · {post.wins} побед</small>
              {winner === post.id && <motion.span className="winner-tag" initial={{ scale: 3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>WIN</motion.span>}
            </motion.button>
          ))}
        </AnimatePresence>
        <div className="vs" aria-hidden="true">VS</div>
      </div>
    </div>
  );
}
