import type { DB } from './db.js';

export const ACHIEVEMENTS = [
  { code: 'first_post', emoji: '📸', title: 'Первый кадр', description: 'Загрузи первого котика' },
  { code: 'ten_posts', emoji: '🎞️', title: 'Котограф', description: 'Загрузи 10 котиков' },
  { code: 'loved', emoji: '💖', title: 'Всеобщий любимец', description: 'Получи 25 реакций' },
  { code: 'superstar', emoji: '🌟', title: 'Суперзвезда', description: 'Получи 100 реакций' },
  { code: 'swiper', emoji: '🐾', title: 'Мастер свайпа', description: 'Оцени 50 котиков в котомэтче' },
  { code: 'judge', emoji: '⚖️', title: 'Верховный судья', description: 'Проведи 50 битв' },
  { code: 'cat_parent', emoji: '🏠', title: 'Кошачий родитель', description: 'Заведи 3 паспорта котиков' },
  { code: 'influencer', emoji: '📣', title: 'Котоблогер', description: 'Набери 10 подписчиков' },
  { code: 'streak_7', emoji: '🔥', title: 'Неделя мурчания', description: 'Заходи 7 дней подряд' },
  { code: 'konami', emoji: '🕹️', title: 'Секретный код', description: 'Найди пасхалку' },
] as const;

export type AchievementCode = (typeof ACHIEVEMENTS)[number]['code'];

/**
 * XP is always computed from current data, never accumulated, so toggling a
 * reaction or deleting a post can't farm it. Reactions to your own posts don't count.
 */
export const REACTIONS_RECEIVED_SQL = `(SELECT COUNT(*) FROM reactions r JOIN posts p ON p.id = r.post_id
  WHERE p.user_id = u.id AND r.user_id != u.id)`;
export const XP_SQL = `((SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) * 10 + ${REACTIONS_RECEIVED_SQL} * 2
  + (SELECT COUNT(*) FROM swipes s WHERE s.user_id = u.id)
  + (SELECT COUNT(*) FROM battles b WHERE b.user_id = u.id AND b.winner_id IS NOT NULL))`;

export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / 25)) + 1;
}

export interface UserStats {
  posts: number;
  reactionsReceived: number;
  followers: number;
  following: number;
  swipes: number;
  battles: number;
  cats: number;
  xp: number;
  level: number;
}

export function userStats(db: DB, userId: number): UserStats {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS posts,
        ${REACTIONS_RECEIVED_SQL} AS reactionsReceived,
        (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers,
        (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following,
        (SELECT COUNT(*) FROM swipes s WHERE s.user_id = u.id) AS swipes,
        (SELECT COUNT(*) FROM battles b WHERE b.user_id = u.id AND b.winner_id IS NOT NULL) AS battles,
        (SELECT COUNT(*) FROM cats c WHERE c.owner_id = u.id) AS cats,
        ${XP_SQL} AS xp
      FROM users u WHERE u.id = ?`,
    )
    .get(userId) as Omit<UserStats, 'level'>;
  return { ...row, level: levelFromXp(row.xp) };
}

export function grantAchievement(db: DB, userId: number, code: AchievementCode): void {
  const now = Date.now();
  const { changes } = db
    .prepare('INSERT OR IGNORE INTO achievements (user_id, code, created_at) VALUES (?, ?, ?)')
    .run(userId, code, now);
  if (changes) {
    db.prepare(`INSERT INTO notifications (user_id, type, meta, created_at) VALUES (?, 'achievement', ?, ?)`).run(
      userId,
      code,
      now,
    );
  }
}

export function checkAchievements(db: DB, userId: number): void {
  const s = userStats(db, userId);
  const { streak } = db.prepare('SELECT streak FROM users WHERE id = ?').get(userId) as { streak: number };
  const earned: [boolean, AchievementCode][] = [
    [s.posts >= 1, 'first_post'],
    [s.posts >= 10, 'ten_posts'],
    [s.reactionsReceived >= 25, 'loved'],
    [s.reactionsReceived >= 100, 'superstar'],
    [s.swipes >= 50, 'swiper'],
    [s.battles >= 50, 'judge'],
    [s.cats >= 3, 'cat_parent'],
    [s.followers >= 10, 'influencer'],
    [streak >= 7, 'streak_7'],
  ];
  for (const [ok, code] of earned) if (ok) grantAchievement(db, userId, code);
}
