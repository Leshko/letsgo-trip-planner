import { Pipe, PipeTransform } from '@angular/core';
import { longDate, relativeTime, time12 } from '../core/format';

@Pipe({ name: 'ago', pure: false })
export class AgoPipe implements PipeTransform {
  transform(iso: string): string {
    return relativeTime(iso);
  }
}

@Pipe({ name: 'time12' })
export class Time12Pipe implements PipeTransform {
  transform(hhmm: string): string {
    return time12(hhmm);
  }
}

@Pipe({ name: 'longDate' })
export class LongDatePipe implements PipeTransform {
  transform(iso: string): string {
    return longDate(iso);
  }
}
