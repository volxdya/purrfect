import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useMe, type Cat } from '../api';
import { pawConfetti, purr } from '../fun';
import { CAT_EMOJIS, Loading, NeedLogin, QueryError } from '../ui';
import { PostGrid } from './Feed';

export function CatPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ['cat', id], queryFn: () => api<{ cat: Cat }>('GET', `/cats/${id}`) });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/cats/${id}`),
    onSuccess: () => {
      qc.invalidateQueries();
      navigate('/');
    },
  });

  if (isLoading) return <Loading />;
  if (!data) return <QueryError error={error} />;
  const { cat } = data;

  return (
    <>
      <motion.section className="passport" initial={{ rotate: -4, y: 30 }} animate={{ rotate: -1, y: 0 }} transition={{ type: 'spring' }}>
        <header><span>ПАСПОРТ КОТИКА</span><span>№ {String(cat.id).padStart(5, '0')}</span></header>
        <div className="passport-body">
          <button
            className="passport-photo"
            aria-label={`Погладить: ${cat.name}`}
            onClick={(e) => {
              pawConfetti(e.clientX, e.clientY);
              purr();
            }}
          >
            {cat.emoji}
          </button>
          <div>
            <h1>{cat.name}</h1>
            <dl>
              <dt>Порода</dt><dd>{cat.breed || 'Неизвестна науке'}</dd>
              <dt>Хозяин</dt><dd><Link to={`/u/${cat.owner.username}`}>{cat.owner.displayName}</Link></dd>
            </dl>
            {cat.bio && <p>{cat.bio}</p>}
            <div className="chips">{cat.traits.map((t) => <span key={t} className="chip">{t}</span>)}</div>
          </div>
          <div className="karma"><b>{cat.karma}</b><small>кошачьей кармы</small></div>
        </div>
        <footer>
          <span>📸 {cat.posts}</span><span>💖 {cat.reactions}</span><span>🌟 {cat.supers} суперкотик</span><span>⚔️ {cat.wins} побед</span>
          {cat.isMine && (
            <span className="passport-actions">
              <Link to={`/cats/${cat.id}/edit`}>Изменить</Link>
              <button className="link-btn" onClick={() => window.confirm('Удалить паспорт? Посты останутся.') && remove.mutate()}>Удалить</button>
            </span>
          )}
        </footer>
      </motion.section>
      <h2 className="section-title">Фото</h2>
      <PostGrid params={{ catId: cat.id }} />
    </>
  );
}

export function CatEdit() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const { me, isLoading } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [bio, setBio] = useState('');
  const [traits, setTraits] = useState('');
  const [emoji, setEmoji] = useState('🐱');

  const existing = useQuery({
    queryKey: ['cat', id],
    queryFn: () => api<{ cat: Cat }>('GET', `/cats/${id}`),
    enabled: id !== null,
  });
  useEffect(() => {
    const cat = existing.data?.cat;
    if (!cat) return;
    setName(cat.name);
    setBreed(cat.breed);
    setBio(cat.bio);
    setTraits(cat.traits.join(', '));
    setEmoji(cat.emoji);
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        breed,
        bio,
        emoji,
        traits: traits.split(',').map((t) => t.trim()).filter(Boolean),
      };
      return id ? api<{ id?: number }>('PUT', `/cats/${id}`, body) : api<{ id?: number }>('POST', '/cats', body);
    },
    onSuccess: (result) => {
      qc.invalidateQueries();
      purr();
      navigate(`/cats/${id ?? result.id}`);
    },
  });

  if (isLoading) return <Loading />;
  if (!me) return <NeedLogin text="Войди, чтобы завести паспорт котику." />;

  return (
    <div className="narrow">
      <h1 className="page-title">{id ? 'Изменить паспорт' : 'Новый паспорт котика'}</h1>
      <form className="form panel" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <label>Имя<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>
        <label>Порода<input value={breed} onChange={(e) => setBreed(e.target.value)} maxLength={40} placeholder="Дворянин благородных кровей" /></label>
        <label>О котике<textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={3} /></label>
        <label>Характер, через запятую<input value={traits} onChange={(e) => setTraits(e.target.value)} placeholder="тюлень, ест всё, драма" /></label>
        <div className="emoji-picker" role="group" aria-label="Значок котика">
          {CAT_EMOJIS.map((em) => (
            <button type="button" key={em} className={em === emoji ? 'active' : ''} aria-pressed={em === emoji} onClick={() => setEmoji(em)}>{em}</button>
          ))}
        </div>
        <button className="btn btn-pink" disabled={save.isPending}>Сохранить</button>
      </form>
    </div>
  );
}
