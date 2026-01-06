import { CharacterModule } from './character.module';

describe('CharacterModule', () => {
  it('should be defined', async () => {
    // This is hard to test fully without the whole setup,
    // but just importing it and checking definition covers the class declaration.
    expect(CharacterModule).toBeDefined();
  });
});
