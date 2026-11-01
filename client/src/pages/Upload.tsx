import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useMe, type Post, type Profile } from '../api';
import { pawConfetti, purr } from '../fun';
import { Loading, NeedLogin } from '../ui';

const STICKERS = ['👑', '🕶️', '🎀', '🎩', '🔥', '✨', '💖', '⭐', '🐟', '🍣', '🥛', '🧶', '💅', '🤡', '💿', '🦋'];
const MAX_SIDE = 1600;

interface Sticker {
  id: number;
  emoji: string;
  x: number; // centre, as a fraction of the image width
  y: number; // centre, as a fraction of the image height
  size: number; // as a fraction of the image width
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, width: number, y: number) {
  if (!text) return;
  const line = text.toUpperCase();
  let size = width * 0.09;
  const font = (s: number) => `800 ${s}px "Unbounded Variable", sans-serif`;
  ctx.font = font(size);
  const measured = ctx.measureText(line).width;
  if (measured > width * 0.94) size *= (width * 0.94) / measured;
  ctx.font = font(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  ctx.strokeText(line, width / 2, y);
  ctx.fillText(line, width / 2, y);
}

/** Flattens the photo, stickers and captions into one image on a canvas. */
async function exportImage(url: string, stickers: Sticker[], top: string, bottom: string): Promise<Blob> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of stickers) {
    ctx.font = `${s.size * canvas.width}px sans-serif`;
    ctx.fillText(s.emoji, s.x * canvas.width, s.y * canvas.height);
  }
  drawCaption(ctx, top, canvas.width, canvas.height * 0.09);
  drawCaption(ctx, bottom, canvas.width, canvas.height * 0.91);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не получилось собрать картинку'))), 'image/webp', 0.92);
  });
}

function StickerEditor({ url, stickers, setStickers, top, bottom }: {
  url: string;
  stickers: Sticker[];
  setStickers: (update: (s: Sticker[]) => Sticker[]) => void;
  top: string;
  bottom: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const nextId = useRef(1);

  const move = (e: PointerEvent, id: number) => {
    const rect = box.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setStickers((all) => all.map((s) => (s.id === id ? { ...s, x, y } : s)));
  };
  const current = stickers.find((s) => s.id === selected);

  return (
    <div className="editor">
      <div className="palette" role="group" aria-label="Стикеры">
        {STICKERS.map((emoji) => (
          <motion.button
            type="button"
            key={emoji}
            whileTap={{ scale: 0.7 }}
            whileHover={{ scale: 1.2, rotate: 8 }}
            aria-label={`Добавить стикер ${emoji}`}
            onClick={() => {
              const id = nextId.current++;
              setStickers((all) => [...all, { id, emoji, x: 0.5, y: 0.4, size: 0.22 }]);
              setSelected(id);
            }}
          >
            {emoji}
          </motion.button>
        ))}
      </div>
      <div className="editor-canvas" ref={box} onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
        <img src={url} alt="Твой котик" draggable={false} onPointerDown={() => setSelected(null)} />
        {top && <div className="caption caption-top">{top}</div>}
        {bottom && <div className="caption caption-bottom">{bottom}</div>}
        {stickers.map((s) => (
          <div
            key={s.id}
            className={`placed ${s.id === selected ? 'selected' : ''}`}
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, fontSize: `${s.size * 100}cqw` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setSelected(s.id);
            }}
            onPointerMove={(e) => e.buttons && e.currentTarget.hasPointerCapture(e.pointerId) && move(e, s.id)}
          >
            <span>{s.emoji}</span>
          </div>
        ))}
      </div>
      <AnimatePresence>
        {current && (
          <motion.div className="sticker-tools" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <label>
              Размер
              <input
                type="range"
                min={0.08}
                max={0.7}
                step={0.01}
                value={current.size}
                onChange={(e) => setStickers((all) => all.map((s) => (s.id === current.id ? { ...s, size: Number(e.target.value) } : s)))}
              />
            </label>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setStickers((all) => all.filter((s) => s.id !== current.id));
                setSelected(null);
              }}
            >
              🗑 Убрать
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Upload() {
  const { me, isLoading } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [top, setTop] = useState('');
  const [bottom, setBottom] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [catId, setCatId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const profile = useQuery({
    queryKey: ['profile', me?.username],
    queryFn: () => api<{ user: Profile }>('GET', `/users/${me!.username}`),
    enabled: Boolean(me),
  });

  const publish = useMutation({
    mutationFn: async () => {
      const blob = await exportImage(url!, stickers, top, bottom);
      const form = new FormData();
      // The server reads fields in order and needs the meta before the file.
      form.append('meta', JSON.stringify({
        title,
        description,
        catId: catId ? Number(catId) : null,
        tags: tags.split(/[\s,]+/).filter(Boolean),
      }));
      form.append('image', blob, 'cat.webp');
      return api<{ post: Post }>('POST', '/posts', form);
    },
    onSuccess: ({ post }) => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      pawConfetti(window.innerWidth / 2, window.innerHeight / 2);
      purr(1.4);
      navigate(`/p/${post.id}`);
    },
  });

  const pickFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProblem('Нужна картинка: JPEG, PNG, WebP или GIF');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setProblem('Файл слишком большой: максимум 25 МБ');
      return;
    }
    setProblem('');
    setStickers([]);
    setUrl(URL.createObjectURL(file));
  };

  if (isLoading) return <Loading />;
  if (!me) return <NeedLogin text="Войди, чтобы делиться котиками." />;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    publish.mutate();
  };

  if (!url) {
    return (
      <div className="narrow">
        <h1 className="page-title">Новый котик</h1>
        <label
          className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <motion.span animate={{ rotate: [-6, 6, -6] }} transition={{ repeat: Infinity, duration: 2 }}>📸</motion.span>
          <b>Перетащи фото сюда</b>
          <small>или нажми, чтобы выбрать файл</small>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => pickFile(e.target.files?.[0])} />
        </label>
        {problem && <p className="form-error" role="alert">{problem}</p>}
      </div>
    );
  }

  return (
    <form className="upload-layout" onSubmit={submit}>
      <StickerEditor url={url} stickers={stickers} setStickers={setStickers} top={top} bottom={bottom} />
      <div className="form">
        <h1 className="page-title">Укрась котика</h1>
        <label>Подпись сверху<input value={top} onChange={(e) => setTop(e.target.value)} maxLength={40} placeholder="КОГДА СКАЗАЛИ НЕЛЬЗЯ" /></label>
        <label>Подпись снизу<input value={bottom} onChange={(e) => setBottom(e.target.value)} maxLength={40} placeholder="НО Я ВСЁ РАВНО" /></label>
        <label>Заголовок<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required /></label>
        <label>Описание<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} /></label>
        <label>Теги через пробел<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="рыжий мем лапки" /></label>
        <label>
          Какой это котик?
          <select value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">Без паспорта</option>
            {profile.data?.user.cats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
        </label>
        <small><Link to="/cats/new">+ Завести паспорт котика</Link></small>
        <div className="post-actions">
          <button className="btn btn-pink" disabled={publish.isPending}>{publish.isPending ? 'Публикую…' : '🚀 Опубликовать'}</button>
          <button type="button" className="btn" onClick={() => setUrl(null)}>Другое фото</button>
        </div>
      </div>
    </form>
  );
}
