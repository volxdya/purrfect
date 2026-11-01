import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { api, useMe, type Post } from '../api';
import { pawConfetti, purr } from '../fun';
import { Empty, Loading, QueryError, ReactionBar } from '../ui';

const HOROSCOPES = [
  'Сегодня звёзды советуют уронить что-нибудь со стола. Лучше стеклянное.',
  'Луна в миске. День благоприятен для требования еды в 5 утра.',
  'Марс в коробке. Не вылезай из неё без веской причины.',
  'Неожиданная встреча с пылесосом. Будь готов к манёврам.',
  'Сегодня ты особенно красив. Впрочем, как и всегда.',
  'Хороший день, чтобы сесть на клавиатуру во время созвона.',
  'Сатурн рекомендует спать 18 часов, остальное время отдыхать.',
  'Кожаный что-то скрывает в холодильнике. Выясни что.',
  'Твоя тень сегодня ведёт себя подозрительно. Атакуй первым.',
  'Вселенная приготовила для тебя солнечное пятно на полу.',
  'Финансовый успех: под диваном найдётся потерянная резинка.',
  'Звёзды говорят: «мяу». Толкование оставляем на твоё усмотрение.',
];

function hash(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function Daily() {
  const { me } = useMe();
  const { data, error, isLoading } = useQuery({
    queryKey: ['daily'],
    queryFn: () => api<{ date: string; post: Post | null }>('GET', '/daily'),
  });
  // The reaction bar patches ['post', id], so read the same cache entry to stay in sync.
  const postId = data?.post?.id;
  const live = useQuery({
    queryKey: ['post', postId],
    queryFn: () => api<{ post: Post }>('GET', `/posts/${postId}`),
    enabled: postId !== undefined,
  });

  if (isLoading) return <Loading />;
  if (!data) return <QueryError error={error} />;
  const post = live.data?.post ?? data.post;
  if (!post) return <Empty emoji="📦" title="Котиков пока нет" text="Загрузи первого, и он сразу станет котом дня." />;

  const horoscope = HOROSCOPES[hash(`${data.date}:${me?.id ?? 0}`) % HOROSCOPES.length];

  return (
    <div className="daily">
      <motion.div
        className="daily-card"
        initial={{ scale: 0.8, rotate: -6, opacity: 0 }}
        animate={{ scale: 1, rotate: -1.5, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 160, damping: 14 }}
        onAnimationComplete={() => pawConfetti(window.innerWidth / 2, 220, '🌟')}
      >
        <div className="daily-badge">🌟 КОТ ДНЯ</div>
        <Link to={`/p/${post.id}`} onClick={() => purr()}>
          <img src={post.imageUrl} alt={post.title} />
        </Link>
        <h1>{post.title}</h1>
        <p className="muted">
          от <Link to={`/u/${post.author.username}`}>{post.author.displayName}</Link>
          {post.cat && <> · <Link to={`/cats/${post.cat.id}`}>{post.cat.emoji} {post.cat.name}</Link></>}
        </p>
        <ReactionBar post={post} />
      </motion.div>
      <aside className="side-stack">
        {me && me.streak > 0 && (
          <div className="panel streak">
            <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} aria-hidden="true">🔥</motion.span>
            <div><b>{me.streak} дн. подряд</b><small>Заходи каждый день, чтобы не потерять серию</small></div>
          </div>
        )}
        <div className="panel horoscope">
          <h2>🔮 Кото-гороскоп</h2>
          <p>{horoscope}</p>
          <small>Обновляется каждый день. Точность: мяу из 10.</small>
        </div>
      </aside>
    </div>
  );
}
