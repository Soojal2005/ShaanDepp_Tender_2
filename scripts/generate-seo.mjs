/**
 * Writes public/sitemap.xml and public/robots.txt from the website's service
 * catalogue, so every service page is listed and the portal is not.
 * Run automatically by `npm run build`. Set SITE_URL for another domain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allPaths } from '../src/content/services.js';

const site = (process.env.SITE_URL || 'https://procure-brain.com').replace(/\/+$/, '');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
fs.mkdirSync(root, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const urls = allPaths().map((p) => `  <url><loc>${site}${p}</loc><lastmod>${today}</lastmod><priority>${p === '/' ? '1.0' : p.split('/').length <= 3 ? '0.8' : '0.6'}</priority></url>`);
fs.writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /api/\nDisallow: /login\nDisallow: /forgot-password\nDisallow: /reset-password\n\nSitemap: ${site}/sitemap.xml\n`);
console.log(`SEO files written for ${site}: ${urls.length} URLs`);
