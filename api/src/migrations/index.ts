import { Init1793238956651 } from './1793238956651-Init';
import { Accounts1793239325973 } from './1793239325973-Accounts';
import { MemberAlias1793244149316 } from './1793244149316-MemberAlias';
import { PushOrigin1793244282858 } from './1793244282858-PushOrigin';
import { LiveMap1793670239198 } from './1793670239198-LiveMap';
import { TripTimeZone1793671798725 } from './1793671798725-TripTimeZone';
import { NativePush1794015451049 } from './1794015451049-NativePush';
import { Polls1794940115124 } from './1794940115124-Polls';
import { TripKind1794960364361 } from './1794960364361-TripKind';
import { UserProfile1794962118332 } from './1794962118332-UserProfile';
import { SelfieGame1795095536011 } from './1795095536011-SelfieGame';

/** Every migration, in order. New ones are appended here. */
export const MIGRATIONS: (new () => unknown)[] = [
  Init1793238956651,
  Accounts1793239325973,
  MemberAlias1793244149316,
  PushOrigin1793244282858,
  LiveMap1793670239198,
  TripTimeZone1793671798725,
  NativePush1794015451049,
  Polls1794940115124,
  TripKind1794960364361,
  UserProfile1794962118332,
  SelfieGame1795095536011,
];
