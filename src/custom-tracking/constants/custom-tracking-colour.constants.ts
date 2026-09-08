/**
 * One of the site's own colours, offered by name.
 */
export interface CustomTrackingPaletteColour {
  /** The stable identifier stored against a value. */
  readonly token: string;
  /** What the colour is called where a user picks one. */
  readonly label: string;
  /**
   * The CSS custom property the colour is rendered through.
   *
   * A name rather than a colour, deliberately. The two applications cannot
   * import from one another, so any colour written here would be a copy of the
   * stylesheet that nothing could keep honest; a custom property name is
   * resolved by the browser against the one palette that actually exists.
   */
  readonly cssVariable: string;
}

/**
 * The colours a colour Field offers by name.
 *
 * The site's established LCARS palette, so a user tinting a Field picks the
 * same yellow the rest of the interface uses rather than one that is nearly
 * it. A value recorded against a token is rendered through that colour's
 * custom property, so adjusting the palette adjusts every value already
 * recorded against it — which is the reason for storing a name at all.
 *
 * Structural colours are deliberately absent. Borders, card surfaces and the
 * page background exist to hold the interface together, and offering them as
 * content colours would let a user make their own content invisible.
 *
 * No colour appears here at all, only its name and the custom property it is
 * published under. The stylesheet remains the single place any LCARS colour is
 * written down, and this list is the set of them a user may choose from.
 */
const PALETTE_NAMES: readonly (readonly [string, string])[] = [
  ['sunflower', 'Sunflower'],
  ['gold', 'Gold'],
  ['orange', 'Orange'],
  ['tangerine', 'Tangerine'],
  ['cardinal', 'Cardinal'],
  ['red', 'Red'],
  ['green', 'Green'],
  ['cool', 'Cool blue'],
  ['bluey', 'Bluey'],
  ['perano', 'Perano'],
  ['sky', 'Sky'],
  ['violet', 'Violet'],
  ['white', 'Space white'],
  ['grey-light', 'Light grey'],
];

export const CUSTOM_TRACKING_PALETTE: readonly CustomTrackingPaletteColour[] =
  PALETTE_NAMES.map(([name, label]) => ({
    token: 'LCARS_' + name.toUpperCase().replaceAll('-', '_'),
    label,
    cssVariable: '--lcars-' + name,
  }));

/**
 * The palette tokens, for validating a stored value.
 */
export const CUSTOM_TRACKING_PALETTE_TOKENS: ReadonlySet<string> = new Set(
  CUSTOM_TRACKING_PALETTE.map(colour => colour.token),
);

/**
 * A colour written as `#RGB` or `#RRGGBB`.
 *
 * The short form is accepted because the palette itself is written that way in
 * the stylesheet and a user copying a colour out of it should not be told it
 * is malformed. It is expanded before storage so two spellings of the same
 * colour do not both exist.
 */
export const CUSTOM_TRACKING_HEX_COLOUR_PATTERN =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The largest value any red, green or blue component may take. */
export const CUSTOM_TRACKING_MAX_COLOUR_COMPONENT = 255;
