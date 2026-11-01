import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, useMe, type Achievement } from '../api';
import { timeAgo } from '../fun';
import { Empty, Loading, NeedLogin, QueryError } from '../ui';

interface Notification {
  id: number;
  type: 'reaction' | 'comment' | 'follow' | 'supercat' | 'achievement';
  meta: string;
  isRead: number;
  createdAt: number;
  postId: number | null;
  actorUsername: string | null;
  actorName: string | null;
  actorEmoji: string | null;
  thumb: string | null;
}

const TEXT: Record<Exclude<Notification['type'], 'achievement'>, string> = {
  reaction: 'отреагировал(а) на твоего котика',
  comment: 'прокомментировал(а) твоего котика',
  follow: 'подписал(ась) на тебя',
  supercat: 'назвал(а) твоего котика суперкотиком 🌟',
};

export function Notifications() {
  const { me, isLoading: meLoading } = useMe();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: Notification[]; achievements: Achievement[] }>('GET', '/notifications'),
    enabled: Boolean(me),
    staleTime: 0,
  });
  const { mutate: markRead } = useMutation({
    mutationFn: () => api('POST', '/notifications/read'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const hasUnread = Boolean(me?.unread);
  useEffect(() => {
    if (hasUnread && data) markRead();
  }, [hasUnread, data, markRead]);

  if (meLoading) return <Loading />;
  if (!me) return <NeedLogin text="Войди, чтобы видеть уведомления." />;
  if (isLoading) return <Loading />;
  if (!data) return <QueryError error={error} />;
  if (!data.notifications.length) return <Empty emoji="🔕" title="Пока тихо" text="Загрузи котика, и реакции не заставят себя ждать." />;

  return (
    <div className="narrow">
      <h1 className="page-title">Уведомления</h1>
      <ul className="notifications">
        {data.notifications.map((n, i) => {
          const achievement = n.type === 'achievement' ? data.achievements.find((a) => a.code === n.meta) : null;
          return (
            <motion.li
              key={n.id}
              className={n.isRead ? '' : 'unread'}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: Math.min(i, 10) * 0.03 }}
            >
              <span className="notif-emoji" aria-hidden="true">{achievement?.emoji ?? n.actorEmoji ?? '🐾'}</span>
              <div>
                {n.type === 'achievement' ? (
                  <p>Новая ачивка: <b>{achievement?.title ?? n.meta}</b></p>
                ) : (
                  <p><Link to={`/u/${n.actorUsername}`}><b>{n.actorName}</b></Link> {TEXT[n.type]}</p>
                )}
                <small>{timeAgo(n.createdAt)}</small>
              </div>
              {n.postId && n.thumb && <Link to={`/p/${n.postId}`} aria-label="Открыть пост"><img src={`/uploads/${n.thumb}`} alt="" loading="lazy" /></Link>}
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
