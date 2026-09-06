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
export const CUSTOM_TRACKING_PALETTE: readonly CustomTrackingPaletteColour[] = [
  {
    token: 'LCARS_SUNFLOWER',
    label: 'Sunflower',
    cssVariable: '--lcars-sunflower',
  },
  {
    token: 'LCARS_GOLD',
    label: 'Gold',
    cssVariable: '--lcars-gold',
  },
  {
    token: 'LCARS_ORANGE',
    label: 'Orange',
    cssVariable: '--lcars-orange',
  },
  {
    token: 'LCARS_TANGERINE',
    label: 'Tangerine',
    cssVariable: '--lcars-tangerine',
  },
  {
    token: 'LCARS_CARDINAL',
    label: 'Cardinal',
    cssVariable: '--lcars-cardinal',
  },
  {
    token: 'LCARS_RED',
    label: 'Red',
    cssVariable: '--lcars-red',
  },
  {
    token: 'LCARS_GREEN',
    label: 'Green',
    cssVariable: '--lcars-green',
  },
  {
    token: 'LCARS_COOL',
    label: 'Cool blue',
    cssVariable: '--lcars-cool',
  },
  {
    token: 'LCARS_BLUEY',
    label: 'Bluey',
    cssVariable: '--lcars-bluey',
  },
  {
    token: 'LCARS_PERANO',
    label: 'Perano',
    cssVariable: '--lcars-perano',
  },
  {
    token: 'LCARS_SKY',
    label: 'Sky',
    cssVariable: '--lcars-sky',
  },
  {
    token: 'LCARS_VIOLET',
    label: 'Violet',
    cssVariable: '--lcars-violet',
  },
  {
    token: 'LCARS_WHITE',
    label: 'Space white',
    cssVariable: '--lcars-white',
  },
  {
    token: 'LCARS_GREY_LIGHT',
    label: 'Light grey',
    cssVariable: '--lcars-grey-light',
  },
];

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

/**
 * A colour written as `rgba(r, g, b, a)` or `rgb(r, g, b)`.
 *
 * Offered because transparency is the one thing hexadecimal in its common form
 * cannot express, and a user tinting a panel behind text may genuinely need
 * it. The components are checked for range after matching; the pattern only
 * establishes the shape.
 */
export const CUSTOM_TRACKING_RGBA_COLOUR_PATTERN =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d{1,3})\s*)?\)$/;

/** The largest value any red, green or blue component may take. */
export const CUSTOM_TRACKING_MAX_COLOUR_COMPONENT = 255;
