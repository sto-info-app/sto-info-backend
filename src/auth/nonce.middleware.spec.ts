import { NonceMiddleware } from './nonce.middleware';

describe('NonceMiddleware', () => {
  it('should be defined', () => {
    expect(new NonceMiddleware()).toBeDefined();
  });
});
