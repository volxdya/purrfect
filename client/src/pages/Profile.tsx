import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useMe, type Profile } from '../api';
import { purr, toast } from '../fun';
import { CAT_EMOJIS, Loading, QueryError } from '../ui';
import { PostGrid } from './Feed';

function levelProgress(xp: number, level: number) {
  const floor = 25 * (level - 1) ** 2;
  const ceiling = 25 * level ** 2;
  return { percent: ((xp - floor) / (ceiling - floor)) * 100, toNext: ceiling - xp };
}

function EditProfile({ user, onDone }: { user: Profile; onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [avatarEmoji, setAvatarEmoji] = useState(user.avatarEmoji);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const save = useMutation({
    mutationFn: () => api('PATCH', '/me', { displayName, bio, avatarEmoji }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', user.username] });
      qc.invalidateQueries({ queryKey: ['me'] });
      onDone();
    },
  });
  const changePassword = useMutation({
    mutationFn: () => api('POST', '/auth/password', { current, next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      toast('🔐 Пароль изменён, другие устройства вышли из аккаунта');
    },
  });
  const logout = useMutation({
    mutationFn: () => api('POST', '/auth/logout'),
    onSuccess: () => {
      qc.clear();
      navigate('/');
    },
  });

  return (
    <div className="panel">
      <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <label>Имя<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required /></label>
        <label>О себе<textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} rows={2} /></label>
        <div className="emoji-picker" role="group" aria-label="Аватар">
          {CAT_EMOJIS.map((em) => (
            <button type="button" key={em} className={em === avatarEmoji ? 'active' : ''} aria-pressed={em === avatarEmoji} onClick={() => setAvatarEmoji(em)}>{em}</button>
          ))}
        </div>
        <button className="btn btn-pink">Сохранить</button>
      </form>
      <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); changePassword.mutate(); }}>
        <h3>Сменить пароль</h3>
        <label>Текущий пароль<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>Новый пароль<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        <button className="btn">Сменить пароль</button>
      </form>
      <button className="btn" onClick={() => logout.mutate()}>🚪 Выйти из аккаунта</button>
    </div>
  );
}

export function ProfilePage() {
  const { username = '' } = useParams();
  const { me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const key = ['profile', username];
  const { data, error, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<{ user: Profile }>('GET', `/users/${encodeURIComponent(username)}`),
  });
  const follow = useMutation({
    mutationFn: (on: boolean) => api(on ? 'PUT' : 'DELETE', `/users/${encodeURIComponent(username)}/follow`),
    onSuccess: (_d, on) => {
      if (on) purr();
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  if (isLoading) return <Loading />;
  if (!data) return <QueryError error={error} />;
  const user = data.user;
  const isMe = me?.id === user.id;
  const { percent, toNext } = levelProgress(user.stats.xp, user.stats.level);

  return (
    <>
      <section className="profile-head">
        <motion.div className="profile-avatar" whileHover={{ rotate: 10, scale: 1.08 }} aria-hidden="true">{user.avatarEmoji}</motion.div>
        <div className="profile-info">
          <h1>{user.displayName}</h1>
          <p className="muted">@{user.username}</p>
          {user.bio && <p>{user.bio}</p>}
          <div className="stats">
            <span><b>{user.stats.posts}</b> котиков</span>
            <span><b>{user.stats.followers}</b> подписчиков</span>
            <span><b>{user.stats.following}</b> подписок</span>
            <span><b>{user.stats.reactionsReceived}</b> реакций</span>
            {user.streak > 0 && <span>🔥 <b>{user.streak}</b> дн. подряд</span>}
          </div>
          <div className="level" title={`${user.stats.xp} XP`}>
            <b>Ур. {user.stats.level}</b>
            <div className="level-bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Прогресс уровня">
              <motion.div initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ type: 'spring', stiffness: 60 }} />
            </div>
            <small>ещё {toNext} XP</small>
          </div>
          {isMe ? (
            <button className="btn" onClick={() => setEditing(!editing)}>⚙️ Настройки</button>
          ) : (
            <button
              className={`btn ${user.isFollowing ? '' : 'btn-pink'}`}
              onClick={() => (me ? follow.mutate(!user.isFollowing) : navigate('/login'))}
            >
              {user.isFollowing ? 'Вы подписаны' : '+ Подписаться'}
            </button>
          )}
        </div>
      </section>

      {editing && isMe && <EditProfile user={user} onDone={() => setEditing(false)} />}

      <h2 className="section-title">Ачивки</h2>
      <div className="achievements">
        {user.achievements.map((a, i) => (
          <motion.div
            key={a.code}
            className={`achievement ${a.unlocked ? 'on' : ''}`}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.04, type: 'spring' }}
          >
            <span aria-hidden="true">{a.unlocked ? a.emoji : a.code === 'konami' ? '❓' : '🔒'}</span>
            <b>{a.code === 'konami' && !a.unlocked ? 'Секрет' : a.title}</b>
            <small>{a.code === 'konami' && !a.unlocked ? 'Попробуй угадать' : a.description}</small>
          </motion.div>
        ))}
      </div>

      {(user.cats.length > 0 || isMe) && (
        <>
          <h2 className="section-title">Котики</h2>
          <div className="chips big">
            {user.cats.map((c) => <Link key={c.id} className="sticker" to={`/cats/${c.id}`}>{c.emoji} {c.name}</Link>)}
            {isMe && <Link className="chip" to="/cats/new">+ Новый паспорт</Link>}
          </div>
        </>
      )}

      {user.collections.length > 0 && (
        <>
          <h2 className="section-title">Коллекции</h2>
          <div className="collections">
            {user.collections.map((c) => (
              <Link key={c.id} to={`/c/${c.id}`} className="collection">
                {c.cover ? <img src={`/uploads/${c.cover}`} alt="" loading="lazy" /> : <div className="collection-empty" aria-hidden="true">📦</div>}
                <b>{c.isPrivate ? '🔒 ' : ''}{c.name}</b>
                <small>{c.count} котиков</small>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">Публикации</h2>
      <PostGrid params={{ username: user.username }} />
    </>
  );
}
