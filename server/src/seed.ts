// Fills an empty database with demo content. Cats are drawn as SVG, so no third-party photos are involved.
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import sharp from 'sharp';
import { checkAchievements } from './achievements.js';
import { config } from './config.js';
import { openDb } from './db.js';
import { mkdirSync } from 'node:fs';
import { storeImage } from './images.js';
import { insertPost, REACTION_KINDS } from './routes/posts.js';

let state = 42;
const rand = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

const BACKGROUNDS = ['#ff5fa2', '#c6ff3d', '#4d7cff', '#ffd23f', '#9b5de5', '#00e0c6', '#ff8c42', '#fff3e0'];
const FURS = ['#f4a340', '#3a3a44', '#f7f1e3', '#b8b8c8', '#8d5a3b', '#e8c9a0'];
const ACCESSORIES = ['crown', 'glasses', 'bow', 'party', 'none'] as const;

function catSvg(width: number, height: number) {
  const bg = pick(BACKGROUNDS);
  const fur = pick(FURS);
  const dark = fur === '#3a3a44';
  const line = dark ? '#16161c' : '#2a2030';
  const accessory = pick(ACCESSORIES);
  const striped = rand() > 0.5;
  const eye = pick(['#3ddc97', '#ffb703', '#4cc9f0']);
  const cx = width / 2;
  const cy = height * 0.48;
  const r = width * 0.3;
  const dots = Array.from({ length: 14 }, () => {
    const x = rand() * width;
    const y = rand() * height;
    return `<path d="M${x} ${y - 14}l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#fff" opacity="${0.25 + rand() * 0.5}"/>`;
  }).join('');
  const stripes = striped
    ? [-0.35, 0, 0.35]
        .map((o) => `<rect x="${cx + o * r - r * 0.05}" y="${cy - r * 0.98}" width="${r * 0.1}" height="${r * 0.42}" rx="${r * 0.05}" fill="${line}" opacity=".55"/>`)
        .join('')
    : '';
  const earL = `M${cx - r * 0.95} ${cy - r * 0.35}L${cx - r * 0.85} ${cy - r * 1.35}L${cx - r * 0.2} ${cy - r * 0.9}Z`;
  const earR = `M${cx + r * 0.95} ${cy - r * 0.35}L${cx + r * 0.85} ${cy - r * 1.35}L${cx + r * 0.2} ${cy - r * 0.9}Z`;
  const eyes = [-1, 1]
    .map((s) => {
      const ex = cx + s * r * 0.42;
      const ey = cy - r * 0.05;
      return `<ellipse cx="${ex}" cy="${ey}" rx="${r * 0.2}" ry="${r * 0.24}" fill="${eye}" stroke="${line}" stroke-width="6"/>
        <ellipse cx="${ex}" cy="${ey}" rx="${r * 0.07}" ry="${r * 0.2}" fill="#111"/>
        <circle cx="${ex + r * 0.06}" cy="${ey - r * 0.1}" r="${r * 0.05}" fill="#fff"/>`;
    })
    .join('');
  const whiskers = [-1, 1]
    .flatMap((s) =>
      [-0.12, 0.05, 0.22].map(
        (o) => `<line x1="${cx + s * r * 0.55}" y1="${cy + r * (0.3 + o / 2)}" x2="${cx + s * r * 1.2}" y2="${cy + r * (0.3 + o)}" stroke="${line}" stroke-width="5" stroke-linecap="round"/>`,
      ),
    )
    .join('');
  const extra = {
    crown: `<path d="M${cx - r * 0.5} ${cy - r * 0.95}l${r * 0.1} ${-r * 0.55} ${r * 0.25} ${r * 0.3} ${r * 0.15} ${-r * 0.42} ${r * 0.15} ${r * 0.42} ${r * 0.25} ${-r * 0.3} ${r * 0.1} ${r * 0.55}z" fill="#ffd23f" stroke="${line}" stroke-width="6" stroke-linejoin="round"/>`,
    glasses: `<g fill="#111" stroke="#111" stroke-width="6"><rect x="${cx - r * 0.72}" y="${cy - r * 0.22}" width="${r * 0.6}" height="${r * 0.36}" rx="${r * 0.08}"/><rect x="${cx + r * 0.12}" y="${cy - r * 0.22}" width="${r * 0.6}" height="${r * 0.36}" rx="${r * 0.08}"/><line x1="${cx - r * 0.12}" y1="${cy - r * 0.1}" x2="${cx + r * 0.12}" y2="${cy - r * 0.1}"/></g>`,
    bow: `<path d="M${cx} ${cy + r * 1.08}l${-r * 0.5} ${-r * 0.25}v${r * 0.5}zM${cx} ${cy + r * 1.08}l${r * 0.5} ${-r * 0.25}v${r * 0.5}z" fill="#ff2e63" stroke="${line}" stroke-width="6" stroke-linejoin="round"/>`,
    party: `<path d="M${cx - r * 0.35} ${cy - r * 0.92}L${cx} ${cy - r * 1.7}L${cx + r * 0.35} ${cy - r * 0.92}Z" fill="#00e0c6" stroke="${line}" stroke-width="6" stroke-linejoin="round"/><circle cx="${cx}" cy="${cy - r * 1.72}" r="${r * 0.1}" fill="#ffd23f" stroke="${line}" stroke-width="5"/>`,
    none: '',
  }[accessory];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${bg}"/>${dots}
    <ellipse cx="${cx}" cy="${height + r * 0.2}" rx="${r * 1.25}" ry="${height - cy}" fill="${fur}" stroke="${line}" stroke-width="8"/>
    <path d="${earL}" fill="${fur}" stroke="${line}" stroke-width="8" stroke-linejoin="round"/>
    <path d="${earR}" fill="${fur}" stroke="${line}" stroke-width="8" stroke-linejoin="round"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${r * 1.1}" ry="${r}" fill="${fur}" stroke="${line}" stroke-width="8"/>
    ${stripes}${eyes}
    <path d="M${cx - r * 0.09} ${cy + r * 0.28}h${r * 0.18}l${-r * 0.09} ${r * 0.12}z" fill="#ff7aa8" stroke="${line}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M${cx - r * 0.2} ${cy + r * 0.5}q${r * 0.1} ${r * 0.12} ${r * 0.2} 0q${r * 0.1} ${r * 0.12} ${r * 0.2} 0" fill="none" stroke="${line}" stroke-width="5" stroke-linecap="round"/>
    ${whiskers}${extra}
  </svg>`;
}

const BOTS = [
  { username: 'murka_official', name: 'Мурка Official', emoji: '👑', bio: 'Я не сплю 18 часов в день, я медитирую' },
  { username: 'kot_v_sapogah', name: 'Кот в сапогах', emoji: '🥾', bio: 'Коллекционирую коробки' },
  { username: 'meow_lana', name: 'Мяулана', emoji: '🌸', bio: 'Эстетика, лапки, закаты' },
  { username: 'barsik2007', name: 'Барсик 2007', emoji: '💿', bio: 'Вайб нулевых и сметана' },
  { username: 'pushok_gamer', name: 'Пушок Геймер', emoji: '🎮', bio: 'Сижу на клавиатуре профессионально' },
];
const CATS = [
  ['Мурка', 'Сиамская', '👑', ['королева', 'драма']],
  ['Сапожок', 'Мейн-кун', '🥾', ['путешественник', 'смелый']],
  ['Лана', 'Рэгдолл', '🌸', ['нежная', 'модель']],
  ['Барсик', 'Дворянин', '💿', ['ест всё', 'легенда']],
  ['Пушок', 'Перс', '🎮', ['тюлень', 'геймер']],
] as const;
const TITLES = ['Когда сказали «нельзя»', 'Смотрю в душу', 'Босс этой квартиры', 'Вайб пятницы', 'Я и моя коробка', 'Министр сна',
  'Жду сметану с 7 утра', 'Лапки дня', 'Кто разбил вазу? Не я', 'Главный по дивану', 'Режим тюленя', 'Голодаю (поел 5 минут назад)',
  'Суперзвезда района', 'Охраняю холодильник', 'Селфи перед дракой', 'Сплю красиво', 'Ты чё, кожаный?', 'Кот-бухгалтер', 'Мем ходячий',
  'Принцесса дивана', 'Легенда подъезда', 'Мокрый нос, сухой закон', 'Проверка гравитации', 'Утро понедельника'];
const TAGS = ['рыжий', 'мем', 'милота', 'сонный', 'король', 'y2k', 'лапки', 'коробка', 'дерзкий', 'пушистик'];
const COMMENTS = ['ЭТО ШЕДЕВР 😭', 'лапки!!!', 'хочу такого же', 'взгляд как у моей бывшей', 'король, просто король', 'кот-президент 2028', 'я плачу', 'мурчу вместе с ним'];

const db = openDb(config.dbPath);
mkdirSync(config.uploadDir, { recursive: true });
if (db.prepare('SELECT 1 FROM posts LIMIT 1').get()) {
  console.log('В базе уже есть посты, сид пропущен.');
  process.exit(0);
}

const now = Date.now();
const ids: number[] = [];
const catIds: number[] = [];
for (const [i, bot] of BOTS.entries()) {
  // Demo accounts get a random throwaway password, so nobody can log in to them.
  const password = await hash(randomBytes(24).toString('hex'));
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, bio, avatar_emoji, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(bot.username, bot.name, password, bot.bio, bot.emoji, now);
  const userId = Number(info.lastInsertRowid);
  ids.push(userId);
  const [name, breed, emoji, traits] = CATS[i]!;
  catIds.push(
    Number(
      db
        .prepare('INSERT INTO cats (owner_id, name, breed, bio, traits, emoji, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(userId, name, breed, `Официальный паспорт котика ${name}.`, JSON.stringify(traits), emoji, now).lastInsertRowid,
    ),
  );
}

const postIds: number[] = [];
const owners: number[] = [];
for (const [i, title] of TITLES.entries()) {
  const owner = i % BOTS.length;
  const width = 800;
  const height = pick([800, 900, 1000, 1150, 1300]);
  const png = await sharp(Buffer.from(catSvg(width, height))).png().toBuffer();
  const image = await storeImage(png, config.uploadDir);
  const tags = [...new Set([pick(TAGS), pick(TAGS), pick(TAGS)])];
  postIds.push(
    insertPost(db, ids[owner]!, { title, description: '', catId: catIds[owner]!, tags }, image, now - (TITLES.length - i) * 3_600_000),
  );
  owners.push(ids[owner]!);
}

for (const [i, postId] of postIds.entries()) {
  for (const userId of ids) {
    if (userId === owners[i] || rand() < 0.35) continue;
    db.prepare('INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(postId, userId, pick(REACTION_KINDS), now);
  }
  if (rand() < 0.6) {
    const author = pick(ids);
    db.prepare('INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(postId, author, pick(COMMENTS), now);
  }
}
for (const id of ids) checkAchievements(db, id);

console.log(`Готово: ${BOTS.length} авторов, ${postIds.length} котиков.`);
db.close();
