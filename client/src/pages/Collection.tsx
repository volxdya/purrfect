import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Post } from '../api';
import { Empty, Loading, Masonry, QueryError } from '../ui';

interface CollectionData {
  collection: { id: number; name: string; isPrivate: boolean; isMine: boolean; owner: { username: string; displayName: string } };
  posts: Post[];
}

export function CollectionPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ['collection', id],
    queryFn: () => api<CollectionData>('GET', `/collections/${id}`),
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/collections/${id}`),
    onSuccess: () => {
      qc.invalidateQueries();
      navigate(`/u/${data!.collection.owner.username}`);
    },
  });

  if (isLoading) return <Loading />;
  if (!data) return <QueryError error={error} />;
  const { collection, posts } = data;

  return (
    <>
      <h1 className="page-title">{collection.isPrivate ? '🔒 ' : '📁 '}{collection.name}</h1>
      <p className="muted">
        Коллекция <Link to={`/u/${collection.owner.username}`}>{collection.owner.displayName}</Link>
        {collection.isMine && (
          <> · <button className="link-btn" onClick={() => window.confirm('Удалить коллекцию? Посты останутся.') && remove.mutate()}>Удалить</button></>
        )}
      </p>
      {posts.length ? <Masonry posts={posts} /> : <Empty emoji="📦" title="Пока пусто" text="Нажми «Сохранить» на посте, и котик окажется здесь." />}
    </>
  );
}
