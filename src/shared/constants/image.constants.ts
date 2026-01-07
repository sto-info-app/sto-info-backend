export const CLOUDFLARE_IMAGES_DEFAULT_ROOT_URL = 'https://imagedelivery.net';
export const CLOUDFLARE_IMAGES_ROOT_URL = `${process.env.CLOUDFLARE_CDN_ROOT_URL}/cdn-cgi/imagedelivery/${process.env.CLOUDFLARE_IMAGES_HASH}`;
export const CLOUDFLARE_R2_CDN_ROOT_URL = process.env.CLOUDFLARE_CDN_ROOT_URL;
