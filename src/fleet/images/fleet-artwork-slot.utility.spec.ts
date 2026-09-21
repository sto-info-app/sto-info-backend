import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';

import { FLEET_IMAGE_SPECS } from '../constants/fleet-image.constants';
import {
  FLEET_ARTWORK_COLUMNS,
  FLEET_ARTWORK_SLOTS,
  FLEET_ARTWORK_SPECS,
} from './fleet-artwork-slot.utility';

describe('Fleet artwork slots', () => {
  it('writes each slot to its own pair of columns', () => {
    expect(FLEET_ARTWORK_COLUMNS[FileAssetSlot.BANNER]).toEqual({
      id: 'bannerImageId',
      alt: 'bannerImageAlt',
    });
    expect(FLEET_ARTWORK_COLUMNS[FileAssetSlot.EMBLEM]).toEqual({
      id: 'emblemImageId',
      alt: 'emblemImageAlt',
    });
  });

  /**
   * A publisher handed a slot no scope has — a misrouted placement — must
   * find nothing rather than a column pair to write. Writing to
   * `undefined` would put a column called that on the row.
   */
  it('has no columns for a slot no scope has', () => {
    expect(FLEET_ARTWORK_COLUMNS[FileAssetSlot.PORTRAIT]).toBeUndefined();
    expect(FLEET_ARTWORK_SPECS[FileAssetSlot.PORTRAIT]).toBeUndefined();
  });

  it('holds each slot to the shape FC-012 wrote for it', () => {
    expect(FLEET_ARTWORK_SPECS[FileAssetSlot.BANNER]).toBe(
      FLEET_IMAGE_SPECS.BANNER,
    );
    expect(FLEET_ARTWORK_SPECS[FileAssetSlot.EMBLEM]).toBe(
      FLEET_IMAGE_SPECS.EMBLEM,
    );
  });

  /**
   * The three tables have to agree about which slots exist. A slot with a
   * specification and no columns is a picture that passes validation and
   * then lands nowhere.
   */
  it('names the same slots in all three places', () => {
    expect([...FLEET_ARTWORK_SLOTS].sort()).toEqual(
      Object.keys(FLEET_ARTWORK_COLUMNS).sort(),
    );
    expect(Object.keys(FLEET_ARTWORK_SPECS).sort()).toEqual(
      Object.keys(FLEET_ARTWORK_COLUMNS).sort(),
    );
  });
});
