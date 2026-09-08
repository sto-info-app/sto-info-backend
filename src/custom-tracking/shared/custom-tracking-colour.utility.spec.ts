import { isRgbColour } from './custom-tracking-colour.utility';

describe('RGB colour validation', () => {
  it.each([
    'rgb(0, 128, 255)',
    'rgba(001,002,003,0.5)',
    'rgba(1, 2, 3, .125)',
    'rgba(1, 2, 3, 0)',
    'rgba(1, 2, 3, 1)',
    'rgb(\n1,\t2, 3\n)',
    'rgb(1,2,3,0.5)',
    'rgba(1,2,3)',
  ])('accepts the supported colour syntax: %s', candidate => {
    expect(isRgbColour(candidate)).toBe(true);
  });

  it.each([
    'rgb(256,0,0)',
    'rgb(-1,0,0)',
    'rgb(1.5,0,0)',
    'rgb(1 2,0,0)',
    'rgb(0000,0,0)',
    'rgb(1,2)',
    'rgb(1,2,3,)',
    'rgba(1,2,3,1.1)',
    'rgba(1,2,3,-.5)',
    'rgba(1,2,3,.1234)',
    'rgba(1,2,3,0.5,0)',
    'rgba(1,2,3,0 .5)',
    'hsl(1,2,3)',
    'rgb(1,2,3)extra',
  ])('rejects malformed or out-of-range components: %s', candidate => {
    expect(isRgbColour(candidate)).toBe(false);
  });
});
