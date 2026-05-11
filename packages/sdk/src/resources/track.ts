import type { HttpClient } from '../client';
import type { TrackInput, TrackResult } from '../types';

export class TrackResource {
  constructor(private readonly http: HttpClient) {}

  log(input: TrackInput): Promise<TrackResult> {
    return this.http.post<TrackResult>('/v1/track', {
      ...input,
      source: input.source ?? 'sdk',
    });
  }
}
