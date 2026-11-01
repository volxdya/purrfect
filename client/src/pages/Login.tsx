import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, useMe } from '../api';
import { purr } from '../fun';

export function Login() {
  const { me } = useMe();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const submit = useMutation({
    mutationFn: () => api('POST', `/auth/${mode}`, { username, password }),
    onSuccess: async () => {
      qc.clear();
      purr();
      navigate('/');
    },
  });

  if (me) return <Navigate to="/" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  return (
    <motion.div className="auth-card" initial={{ rotate: -3, scale: 0.92 }} animate={{ rotate: -1, scale: 1 }} transition={{ type: 'spring' }}>
      <div className="auth-emoji" aria-hidden="true">{mode === 'login' ? '😼' : '😻'}</div>
      <h1>{mode === 'login' ? 'С возвращением' : 'Добро пожаловать в стаю'}</h1>
      <form className="form" onSubmit={onSubmit}>
        <label>Ник<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={24} required /></label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            maxLength={128}
            required
          />
        </label>
        {mode === 'register' && <small>Ник: латиница, цифры и _. Пароль: от 8 символов.</small>}
        <button className="btn btn-pink" disabled={submit.isPending}>{mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
      </form>
      <button className="link-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Ещё нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
      </button>
    </motion.div>
  );
}
