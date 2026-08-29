import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { StorytimeCommentsController } from './storytime-comments.controller';
import { StorytimeReactionsController } from './storytime-reactions.controller';

/**
 * Guards the pairing that the reads on this folder's two controllers depend on.
 *
 * `OptionalJwtAuthGuard` lets an anonymous caller through and leaves `req.user`
 * unset. A route under it therefore has to ask for its reader with
 * `@OptionalUserId`, which answers null; `@UserId` throws a 400 the moment
 * nobody is signed in. Both decorators read the same property and neither the
 * guard nor the compiler notices the wrong one, so the mistake reaches the
 * browser intact — reading a Story's reactions signed out failed exactly this
 * way.
 *
 * The controllers' own specs call these methods directly and pass a reader in,
 * which is what let it through: only the decorator can be wrong, and calling
 * the method never runs it. This reaches for the decorator itself.
 */
describe('reads that must serve a signed-out reader', () => {
  /** A request that got past the optional guard with nobody signed in. */
  const anonymous = {
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;

  /**
   * Reads the parameter factories a route was built with.
   *
   * @param controller - The controller class.
   * @param method - The route handler's name.
   * @returns One factory per custom parameter decorator on that route.
   */
  const parameterFactories = (
    controller: object,
    method: string,
  ): ((data: unknown, context: ExecutionContext) => unknown)[] => {
    const metadata: Record<string, { factory?: unknown }> =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {};

    return Object.values(metadata)
      .map(argument => argument.factory)
      .filter(
        (factory): factory is (d: unknown, c: ExecutionContext) => unknown =>
          typeof factory === 'function',
      );
  };

  it.each([
    ['reactions', StorytimeReactionsController, 'findOne'],
    ['comments', StorytimeCommentsController, 'findFor'],
  ])(
    'resolves the reader on the %s read rather than rejecting them',
    (_name, controller, method) => {
      const factories = parameterFactories(controller, method);

      expect(factories).toHaveLength(1);
      expect(factories[0](undefined, anonymous)).toBeNull();
    },
  );
});
