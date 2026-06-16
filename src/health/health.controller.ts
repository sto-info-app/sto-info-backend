import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  /**
   * Creates an instance of HealthController.
   *
   * @param _health - The health.
   * @param _db - The db.
   */
  constructor(
    private readonly _health: HealthCheckService,
    private readonly _db: TypeOrmHealthIndicator,
  ) {}

  /**
   * Liveness probe endpoint.
   *
   * Used by orchestration platforms (e.g. Kubernetes) to determine
   * if the application process is running.
   *
   * @returns A health check result indicating the app is up.
   */
  @Get('live')
  @HealthCheck()
  live() {
    return this._health.check([async () => ({ app: { status: 'up' } })]);
  }

  /**
   * Readiness probe endpoint.
   *
   * Checks if the application is ready to serve traffic by verifying
   * database connectivity.
   *
   * @returns A health check result for the database dependency.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this._health.check([async () => this._db.pingCheck('database')]);
  }
}
