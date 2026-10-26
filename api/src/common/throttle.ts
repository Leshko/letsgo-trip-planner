import { HttpException, HttpStatus } from '@nestjs/common';

/** Tiny fixed-window limiter for guessable-code endpoints. Per process; plenty for one family. */
export class Throttle {
  private readonly hits = new Map<string, { n: number; windowStart: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string): void {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || now - cur.windowStart > this.windowMs) {
      this.hits.set(key, { n: 1, windowStart: now });
      if (this.hits.size > 10_000) this.hits.clear();
      return;
    }
    cur.n += 1;
    if (cur.n > this.max)
      throw new HttpException(
        'Too many attempts, try again in a minute',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}
