import { Injectable } from '@nestjs/common';
import { Connection } from 'typeorm';

@Injectable()
export class DatabaseService {
  constructor(private connection: Connection) {}

  async setDatabaseTimezone(): Promise<void> {
    // Set the timezone to UTC
    await this.connection.query("SET TIME ZONE 'UTC'");
  }
}
