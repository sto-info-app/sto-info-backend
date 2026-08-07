import { SearchPaginatedQueryDto } from '../../shared/dto/paginated-query.dto';

/**
 * Query parameters accepted by the friend listing.
 *
 * Every accepted parameter must be declared here — the global `ValidationPipe`
 * runs with `forbidNonWhitelisted: true`, so undeclared params are rejected.
 */
export class FriendsQueryDto extends SearchPaginatedQueryDto {
}
