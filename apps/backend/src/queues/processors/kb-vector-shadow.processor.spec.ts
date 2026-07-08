import { QueryEmbeddingLruCache } from './kb-vector-shadow.processor';

describe('QueryEmbeddingLruCache (max 100, log-only shadow lane)', () => {
  it('stores and returns embeddings by key', () => {
    const cache = new QueryEmbeddingLruCache(100);
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', [0.1, 0.2]);
    expect(cache.get('a')).toEqual([0.1, 0.2]);
  });

  it('evicts the oldest entry beyond the max', () => {
    const cache = new QueryEmbeddingLruCache(2);
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.set('c', [3]); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toEqual([2]);
    expect(cache.get('c')).toEqual([3]);
  });

  it('re-inserts on read so recently-used entries survive eviction', () => {
    const cache = new QueryEmbeddingLruCache(2);
    cache.set('a', [1]);
    cache.set('b', [2]);
    // Touch 'a' -> it becomes most-recently-used.
    expect(cache.get('a')).toEqual([1]);
    cache.set('c', [3]); // should evict 'b', not 'a'
    expect(cache.get('a')).toEqual([1]);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toEqual([3]);
  });

  it('never grows beyond the configured max', () => {
    const cache = new QueryEmbeddingLruCache(100);
    for (let i = 0; i < 500; i += 1) cache.set(`k${i}`, [i]);
    // The 100 most-recent keys must be present, older ones evicted.
    expect(cache.get('k499')).toEqual([499]);
    expect(cache.get('k400')).toEqual([400]);
    expect(cache.get('k399')).toBeUndefined();
    expect(cache.get('k0')).toBeUndefined();
  });
});
