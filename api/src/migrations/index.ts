import { Init1793238956651 } from './1793238956651-Init';
import { Accounts1793239325973 } from './1793239325973-Accounts';
import { MemberAlias1793244149316 } from './1793244149316-MemberAlias';
import { PushOrigin1793244282858 } from './1793244282858-PushOrigin';
import { LiveMap1793670239198 } from './1793670239198-LiveMap';
import { TripTimeZone1793671798725 } from './1793671798725-TripTimeZone';
import { NativePush1794015451049 } from './1794015451049-NativePush';

/** Every migration, in order. New ones are appended here. */
export const MIGRATIONS: (new () => unknown)[] = [
  Init1793238956651,
  Accounts1793239325973,
  MemberAlias1793244149316,
  PushOrigin1793244282858,
  LiveMap1793670239198,
  TripTimeZone1793671798725,
  NativePush1794015451049,
];
