import {
  FileAssetState,
  SERVEABLE_FILE_ASSET_STATES,
} from '../enums/file-asset-state.enum';
import {
  canTransitionFileAsset,
  FILE_ASSET_TRANSITIONS,
  INITIAL_FILE_ASSET_STATE,
} from './file-asset-state.constants';

/**
 * The state machine, tested as a graph rather than as a list of moves.
 *
 * Most of these assertions are about paths that must not exist. A transition
 * table is easy to extend and the extensions are individually reasonable; what
 * this file protects is the property of the whole graph, so that adding a
 * convenient edge from `REJECTED` fails here rather than in production.
 */
describe('file asset state machine', () => {
  /** Every state, so a value added to the enum is covered without editing. */
  const allStates = Object.values(FileAssetState);

  describe('the serveable set', () => {
    it('contains exactly one state', () => {
      expect([...SERVEABLE_FILE_ASSET_STATES]).toEqual([
        FileAssetState.AVAILABLE,
      ]);
    });

    /**
     * The first acceptance criterion, stated the way it is written: a clean
     * scanner status alone is insufficient. `CLEAN` is a verdict about bytes;
     * being serveable additionally requires an allowed type, successful
     * processing and an audience, none of which a scanner knows about.
     */
    it('does not contain CLEAN', () => {
      expect(SERVEABLE_FILE_ASSET_STATES.has(FileAssetState.CLEAN)).toBe(false);
    });

    it('does not contain any state that means refused or withdrawn', () => {
      for (const state of [
        FileAssetState.REJECTED,
        FileAssetState.REVOKED,
        FileAssetState.DELETED,
        FileAssetState.RETRY_PENDING,
      ]) {
        expect(SERVEABLE_FILE_ASSET_STATES.has(state)).toBe(false);
      }
    });

    it('does not contain UNVERIFIED', () => {
      expect(SERVEABLE_FILE_ASSET_STATES.has(FileAssetState.UNVERIFIED)).toBe(
        false,
      );
    });
  });

  describe('the transition table', () => {
    it('names every state', () => {
      expect(Object.keys(FILE_ASSET_TRANSITIONS).sort()).toEqual(
        [...allStates].sort(),
      );
    });

    it('starts a new asset before its bytes exist', () => {
      expect(INITIAL_FILE_ASSET_STATE).toBe(FileAssetState.RECEIVING);
    });

    it('never lets a state move to itself', () => {
      for (const state of allStates) {
        expect(canTransitionFileAsset(state, state)).toBe(false);
      }
    });

    it('leaves DELETED with nowhere to go', () => {
      for (const state of allStates) {
        expect(canTransitionFileAsset(FileAssetState.DELETED, state)).toBe(
          false,
        );
      }
    });
  });

  describe('reaching AVAILABLE', () => {
    /**
     * Two doors and no others. `CLEAN` is the ordinary one; `UNVERIFIED` is
     * the backfill of bytes the site has been serving since before any of this
     * existed, and it closes once W10's campaigns have emptied that state.
     */
    it('is reachable only from CLEAN and UNVERIFIED', () => {
      const doors = allStates.filter(state =>
        canTransitionFileAsset(state, FileAssetState.AVAILABLE),
      );

      expect(doors.sort()).toEqual(
        [FileAssetState.CLEAN, FileAssetState.UNVERIFIED].sort(),
      );
    });

    /**
     * The fourth acceptance criterion's other half. Bytes that were refused or
     * withdrawn are never published by any sequence of writes; replacing them
     * means a new asset, which gets its own verdict rather than inheriting
     * this one.
     */
    it('is unreachable from every refused or withdrawn state', () => {
      for (const state of [
        FileAssetState.REJECTED,
        FileAssetState.REVOKED,
        FileAssetState.DELETED,
      ]) {
        expect(canTransitionFileAsset(state, FileAssetState.AVAILABLE)).toBe(
          false,
        );
      }
    });

    it('is unreachable without a verdict', () => {
      for (const state of [
        FileAssetState.RECEIVING,
        FileAssetState.QUARANTINED,
        FileAssetState.SCANNING,
        FileAssetState.RETRY_PENDING,
      ]) {
        expect(canTransitionFileAsset(state, FileAssetState.AVAILABLE)).toBe(
          false,
        );
      }
    });
  });

  describe('leaving AVAILABLE', () => {
    it('withdraws or destroys, and does nothing else', () => {
      expect(
        [...FILE_ASSET_TRANSITIONS[FileAssetState.AVAILABLE]].sort(),
      ).toEqual([FileAssetState.REVOKED, FileAssetState.DELETED].sort());
    });

    /**
     * A published asset is not put back into `SCANNING` by a rescan. Doing so
     * would take every profile picture off the site for the length of an
     * estate campaign — a fail-closed rule applied to the wrong question,
     * since the bytes have already been served and the honest response to a
     * suspicion about them is to finish looking.
     */
    it('does not return to SCANNING', () => {
      expect(
        canTransitionFileAsset(
          FileAssetState.AVAILABLE,
          FileAssetState.SCANNING,
        ),
      ).toBe(false);
    });
  });

  describe('the ordinary path', () => {
    it('runs from RECEIVING to AVAILABLE one step at a time', () => {
      const path = [
        FileAssetState.RECEIVING,
        FileAssetState.QUARANTINED,
        FileAssetState.SCANNING,
        FileAssetState.CLEAN,
        FileAssetState.AVAILABLE,
      ];

      for (let index = 0; index < path.length - 1; index += 1) {
        expect(canTransitionFileAsset(path[index], path[index + 1])).toBe(true);
      }
    });

    it('lets a transient fault be retried', () => {
      expect(
        canTransitionFileAsset(
          FileAssetState.SCANNING,
          FileAssetState.RETRY_PENDING,
        ),
      ).toBe(true);
      expect(
        canTransitionFileAsset(
          FileAssetState.RETRY_PENDING,
          FileAssetState.SCANNING,
        ),
      ).toBe(true);
    });

    it('lets every non-terminal state be refused', () => {
      for (const state of [
        FileAssetState.RECEIVING,
        FileAssetState.QUARANTINED,
        FileAssetState.SCANNING,
        FileAssetState.RETRY_PENDING,
        FileAssetState.CLEAN,
      ]) {
        expect(canTransitionFileAsset(state, FileAssetState.REJECTED)).toBe(
          true,
        );
      }
    });

    it('lets every state be destroyed', () => {
      for (const state of allStates.filter(
        candidate => candidate !== FileAssetState.DELETED,
      )) {
        expect(canTransitionFileAsset(state, FileAssetState.DELETED)).toBe(
          true,
        );
      }
    });
  });
});
