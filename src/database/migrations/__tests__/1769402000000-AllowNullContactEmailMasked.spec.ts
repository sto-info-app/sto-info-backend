import { QueryRunner } from 'typeorm';
import { AllowNullContactEmailMasked1769402000000 } from '../1769402000000-AllowNullContactEmailMasked';

describe('AllowNullContactEmailMasked1769402000000', () => {
  it('should run up and down queries', async () => {
    const migration = new AllowNullContactEmailMasked1769402000000();
    const queryRunner = {
      query: jest.fn(),
    } as unknown as QueryRunner;

    await migration.up(queryRunner);
    await migration.down(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ALTER TABLE "sto_info_app"."contact_request" ALTER COLUMN "emailMasked" DROP NOT NULL',
      ),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ALTER TABLE "sto_info_app"."contact_request" ALTER COLUMN "emailMasked" SET NOT NULL',
      ),
    );
  });
});
