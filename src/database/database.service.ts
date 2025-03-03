import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseService {
  constructor(private readonly dataSource: DataSource) {}

  async setDatabaseTimezone(): Promise<void> {
    // Set the timezone to UTC
    await this.dataSource.query("SET TIME ZONE 'UTC'");
  }
}
