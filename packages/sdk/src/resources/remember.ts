import type { HttpClient } from '../client';
import type { RememberInput, RememberResult, SearchInput, SearchResult, MemoriesResult, DeleteMemoryResult } from '../types';

export class RememberResource {
  constructor(private readonly http: HttpClient) {}

  store(input: RememberInput): Promise<RememberResult> {
    return this.http.post<RememberResult>('/v1/remember', {
      ...input,
      source: input.source ?? 'sdk',
    });
  }

  list(options: { category?: string; limit?: number } = {}): Promise<MemoriesResult> {
    const params = new URLSearchParams();
    if (options.category) params.set('category', options.category);
    if (options.limit)    params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.http.get<MemoriesResult>(`/v1/memories${qs ? `?${qs}` : ''}`);
  }

  delete(memoryId: string): Promise<DeleteMemoryResult> {
    return this.http.delete<DeleteMemoryResult>(`/v1/memory/${encodeURIComponent(memoryId)}`);
  }

  search(input: SearchInput): Promise<SearchResult> {
    return this.http.post<SearchResult>('/v1/search', input);
  }
}
