import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Post } from '../api';
import { Empty, Loading, QueryError } from '../ui';

interface Leaderboard {
  topElo: Post[];
  topWeek: Post[];
  topUsers: { username: string; displayName: string; avatarEmoji: string; xp: number; level: number }[];
}

const MEDALS = ['🥇', '🥈', '🥉'];
const TABS = [
  { id: 'week', label: '📅 Топ недели' },
  { id: 'elo', label: '⚔️ Рейтинг' },
  { id: 'users', label: '🧑‍🚀 Хозяева' },
] as const;

export function Top() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('week');
  const { data, error, isLoading } = useQuery({ queryKey: ['leaderboard'], queryFn: () => api<Leaderboard>('GET', '/leaderboard') });

  if (isLoading) return <Loading />;
  if (!data) return <QueryError error={error} />;
  const posts = tab === 'week' ? data.topWeek : data.topElo;

  return (
    <div className="narrow">
      <h1 className="page-title">Зал кошачьей славы</h1>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'users' ? (
        <ol className="rank">
          {data.topUsers.map((u, i) => (
            <motion.li key={u.username} initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.04 }}>
              <span className="rank-pos">{MEDALS[i] ?? i + 1}</span>
              <span className="rank-avatar" aria-hidden="true">{u.avatarEmoji}</span>
              <Link to={`/u/${u.username}`}><b>{u.displayName}</b></Link>
              <span className="rank-score">ур. {u.level} · {u.xp} XP</span>
            </motion.li>
          ))}
        </ol>
      ) : posts.length ? (
        <ol className="rank">
          {posts.map((p, i) => (
            <motion.li key={p.id} initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.04 }}>
              <span className="rank-pos">{MEDALS[i] ?? i + 1}</span>
              <img src={p.thumbUrl} alt="" loading="lazy" />
              <Link to={`/p/${p.id}`}><b>{p.title}</b></Link>
              <span className="rank-score">{tab === 'elo' ? p.elo : `${p.wins} побед`}</span>
            </motion.li>
          ))}
        </ol>
      ) : (
        <Empty emoji="🥊" title="Битв ещё не было" text="Стань первым судьёй на арене.">
          <Link className="btn btn-pink" to="/battle">В битву!</Link>
        </Empty>
      )}
    </div>
  );
}
