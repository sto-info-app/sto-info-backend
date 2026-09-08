import { CUSTOM_TRACKING_MAX_COLOUR_COMPONENT } from '../constants/custom-tracking-colour.constants';

/**
 * Validates comma-separated RGB components and an optional alpha value.
 *
 * Checking each component separately keeps whitespace and range validation
 * independent, instead of repeating both inside one complex expression.
 *
 * @param candidate - A trimmed RGB or RGBA colour.
 * @returns Whether its components have the supported syntax and ranges.
 */
export function isRgbColour(candidate: string): boolean {
  const match = /^rgba?\((.*)\)$/s.exec(candidate);
  if (!match) {
    return false;
  }

  const components = match[1].split(',').map(component => component.trim());
  if (components.length !== 3 && components.length !== 4) {
    return false;
  }

  const validRgb = components
    .slice(0, 3)
    .every(
      component =>
        /^\d{1,3}$/.test(component) &&
        Number(component) <= CUSTOM_TRACKING_MAX_COLOUR_COMPONENT,
    );
  const alpha = components[3];
  return (
    validRgb && (alpha === undefined || /^(?:[01]|0?\.\d{1,3})$/.test(alpha))
  );
}
