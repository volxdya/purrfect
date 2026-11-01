import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, useMe } from './api';
import { catParty, purr, toast, toggleSound, toggleTheme, useSound, useTheme, useToasts } from './fun';
import { Battle } from './pages/Battle';
import { CatEdit, CatPage } from './pages/Cat';
import { CollectionPage } from './pages/Collection';
import { Daily } from './pages/Daily';
import { Feed } from './pages/Feed';
import { Login } from './pages/Login';
import { Match } from './pages/Match';
import { Notifications } from './pages/Notifications';
import { PostPage } from './pages/Post';
import { ProfilePage } from './pages/Profile';
import { Top } from './pages/Top';
import { Upload } from './pages/Upload';
import { Empty } from './ui';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

function useKonami(onUnlock: () => void) {
  useEffect(() => {
    let position = 0;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      position = key === KONAMI[position] ? position + 1 : key === KONAMI[0] ? 1 : 0;
      if (position === KONAMI.length) {
        position = 0;
        onUnlock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUnlock]);
}

function Search() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/');
  };
  return (
    <form className="search" role="search" onSubmit={submit}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти котика…" aria-label="Поиск котиков" maxLength={60} />
    </form>
  );
}

function Header() {
  const { me } = useMe();
  const navigate = useNavigate();
  const theme = useTheme();
  const sound = useSound();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('POST', '/auth/logout'),
    onSuccess: () => {
      qc.clear();
      navigate('/');
    },
  });
  const randomCat = useMutation({
    mutationFn: () => api<{ id: number }>('GET', '/posts/random'),
    onSuccess: ({ id }) => navigate(`/p/${id}`),
  });

  return (
    <header className="header">
      <Link to="/" className="logo" aria-label="Purrfect, на главную">
        purr<span>fect</span>
      </Link>
      <nav className="nav-main" aria-label="Разделы">
        <NavLink to="/" end>Лента</NavLink>
        <NavLink to="/match">Котомэтч</NavLink>
        <NavLink to="/battle">Битва</NavLink>
        <NavLink to="/top">Топ</NavLink>
        <NavLink to="/daily">Кот дня</NavLink>
      </nav>
      <Search />
      <div className="header-tools">
        <button className="icon-btn" onClick={() => randomCat.mutate()} title="Рандомный кот" aria-label="Рандомный кот">🎲</button>
        <button className="icon-btn" onClick={toggleSound} title="Мурчание" aria-label={sound ? 'Выключить мурчание' : 'Включить мурчание'}>{sound ? '🔊' : '🔇'}</button>
        <button className="icon-btn" onClick={toggleTheme} title="Тема" aria-label="Сменить тему">{theme === 'dark' ? '☀️' : '🌙'}</button>
        {me ? (
          <>
            <Link className="icon-btn bell" to="/notifications" aria-label={`Уведомления: ${me.unread}`}>
              🔔{me.unread > 0 && <b className="badge">{me.unread > 99 ? '99+' : me.unread}</b>}
            </Link>
            <Link className="btn btn-pink desktop-only" to="/new">+ Котик</Link>
            <Link className="icon-btn" to={`/u/${me.username}`} aria-label="Мой профиль">{me.avatarEmoji}</Link>
            <button className="icon-btn desktop-only" onClick={() => logout.mutate()} title="Выйти" aria-label="Выйти">🚪</button>
          </>
        ) : (
          <Link className="btn btn-pink" to="/login">Войти</Link>
        )}
      </div>
    </header>
  );
}

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Разделы">
      <NavLink to="/" end aria-label="Лента">🏠</NavLink>
      <NavLink to="/match" aria-label="Котомэтч">💘</NavLink>
      <NavLink to="/new" className="bottom-add" aria-label="Загрузить котика">＋</NavLink>
      <NavLink to="/battle" aria-label="Битва">⚔️</NavLink>
      <NavLink to="/daily" aria-label="Кот дня">🌟</NavLink>
    </nav>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            initial={{ y: 30, opacity: 0, rotate: -4 }}
            animate={{ y: 0, opacity: 1, rotate: -1 }}
            exit={{ y: 20, opacity: 0 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const onKonami = () => {
  catParty();
  purr(2);
  toast('🕹️ КОТОПАТИ! Секрет найден');
  api('POST', '/me/easter-egg').catch(() => {
    // Guests get the party too, just no achievement.
  });
};

export function App() {
  useKonami(onKonami);
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <Header />
      <main className="main">
        <motion.div key={location.pathname} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          <Routes location={location}>
            <Route path="/" element={<Feed />} />
            <Route path="/p/:id" element={<PostPage />} />
            <Route path="/new" element={<Upload />} />
            <Route path="/login" element={<Login />} />
            <Route path="/u/:username" element={<ProfilePage />} />
            <Route path="/cats/new" element={<CatEdit />} />
            <Route path="/cats/:id/edit" element={<CatEdit />} />
            <Route path="/cats/:id" element={<CatPage />} />
            <Route path="/c/:id" element={<CollectionPage />} />
            <Route path="/match" element={<Match />} />
            <Route path="/battle" element={<Battle />} />
            <Route path="/top" element={<Top />} />
            <Route path="/daily" element={<Daily />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="*" element={<Empty emoji="🙀" title="Тут пусто" text="Котик унёс эту страницу в коробку." />} />
          </Routes>
        </motion.div>
      </main>
      <BottomNav />
      <Toasts />
    </>
  );
}
