import { ConflictException } from '@nestjs/common';
import type { Member } from '../entities';

/**
 * Gatherings are the wall and photos only. An older copy of the app could
 * still try to add ideas or plan entries; refuse so nothing hidden piles up.
 */
export function assertTripOnly(me: Member, what: string): void {
  if (me.trip?.kind === 'gathering')
    throw new ConflictException(`Gatherings don't have ${what}.`);
}
