import { useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query';

export interface Author {
  id: number;
  username: string;
  displayName: string;
  avatarEmoji: string;
}
export interface Post {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  color: string;
  elo: number;
  wins: number;
  losses: number;
  createdAt: number;
  author: Author;
  cat: { id: number; name: string; emoji: string } | null;
  tags: string[];
  reactions: Record<string, number>;
  myReaction: string | null;
}
export interface Me {
  id: number;
  username: string;
  displayName: string;
  bio: string;
  avatarEmoji: string;
  streak: number;
  unread: number;
}
export interface Comment {
  id: number;
  body: string;
  createdAt: number;
  userId: number;
  username: string;
  displayName: string;
  avatarEmoji: string;
}
export interface CollectionSummary {
  id: number;
  name: string;
  isPrivate: number;
  count: number;
  cover: string | null;
}
export interface Achievement {
  code: string;
  emoji: string;
  title: string;
  description: string;
  unlocked?: boolean;
}
export interface Profile {
  id: number;
  username: string;
  displayName: string;
  bio: string;
  avatarEmoji: string;
  streak: number;
  createdAt: number;
  isFollowing: boolean;
  stats: { posts: number; reactionsReceived: number; followers: number; following: number; xp: number; level: number };
  achievements: Achievement[];
  cats: { id: number; name: string; emoji: string; breed: string }[];
  collections: CollectionSummary[];
}
export interface Cat {
  id: number;
  name: string;
  breed: string;
  bio: string;
  traits: string[];
  emoji: string;
  owner: { username: string; displayName: string; avatarEmoji: string };
  isMine: boolean;
  karma: number;
  posts: number;
  wins: number;
  bestElo: number;
  reactions: number;
  supers: number;
}

export const REACTIONS: { kind: string; emoji: string; label: string }[] = [
  { kind: 'love', emoji: '😻', label: 'Люблю' },
  { kind: 'fire', emoji: '🔥', label: 'Огонь' },
  { kind: 'cute', emoji: '🥹', label: 'Милота' },
  { kind: 'lol', emoji: '😹', label: 'Ржака' },
  { kind: 'king', emoji: '👑', label: 'Король' },
  { kind: 'fish', emoji: '🐟', label: 'Рыбку ему' },
];

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: string, url: string, body?: object | FormData): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'purrfect' };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${url}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Что-то пошло не так');
  return data as T;
}

export function useMe() {
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: Me | null }>('GET', '/auth/me'),
    refetchInterval: 30_000,
  });
  return { me: query.data?.user ?? null, isLoading: query.isLoading };
}

export interface FeedParams {
  sort?: 'new' | 'hot' | 'following';
  tag?: string;
  q?: string;
  username?: string;
  catId?: number;
}

export function useFeed(params: FeedParams) {
  return useInfiniteQuery({
    queryKey: ['posts', params],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ offset: String(pageParam) });
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v));
      return api<{ posts: Post[]; nextOffset: number | null }>('GET', `/posts?${search}`);
    },
    getNextPageParam: (last) => last.nextOffset,
  });
}

/** Puts a fresh post into every cached list, so a reaction doesn't refetch the whole feed. */
export function patchPost(qc: QueryClient, post: Post) {
  qc.setQueryData(['post', post.id], { post });
  qc.setQueriesData<InfiniteData<{ posts: Post[]; nextOffset: number | null }>>({ queryKey: ['posts'] }, (data) =>
    data && {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        posts: page.posts.map((p) => (p.id === post.id ? post : p)),
      })),
    },
  );
}
