import type { RefKind } from '../entities/notification.entity';

/** Where a notification or feed line takes you inside the app. */
export function refUrl(kind: RefKind, id: string | null): string {
  switch (kind) {
    case 'idea':
      return id ? `/trip/idea/${id}` : '/trip/ideas/do';
    case 'photo':
      return id ? `/trip/photos?photo=${id}` : '/trip/photos';
    case 'itinerary':
      return '/trip/plan';
    case 'lodging':
      return '/trip/stay';
    case 'post':
      return '/trip/wall';
    default:
      return '/trip';
  }
}
