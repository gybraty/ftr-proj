import { Global, Injectable, Module } from "@nestjs/common";
import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ftr:ftr@localhost:5432/university" });

@Injectable()
export class Db {
  async query(sql: string, params: unknown[] = []): Promise<any[]> {
    return (await pool.query(sql, params)).rows;
  }
}

@Global()
@Module({ providers: [Db], exports: [Db] })
export class DatabaseModule {}
