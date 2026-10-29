import {
  ArgumentsHost,
  Catch,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';

/**
 * Postgres is strict about types: a malformed id in a URL is "not found",
 * and a duplicate (e.g. two taps racing) is a conflict, not a server error.
 */
@Catch(QueryFailedError)
export class DbErrorFilter extends BaseExceptionFilter {
  catch(err: QueryFailedError, host: ArgumentsHost) {
    const code = (err.driverError as { code?: string } | undefined)?.code;
    if (code === '22P02') return super.catch(new NotFoundException(), host);
    if (code === '23505')
      return super.catch(new ConflictException('Already exists'), host);
    return super.catch(err, host);
  }
}
