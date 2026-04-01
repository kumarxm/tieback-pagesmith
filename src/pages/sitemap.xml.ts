import { SITE } from '@/config/site';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  // Use import.meta.glob to dynamically gather all Astro pages
  const pages = import.meta.glob('/src/pages/**/*.astro', { eager: true });
  
  const urls = Object.keys(pages)
    .filter((path) => !path.includes('/404') && !path.includes('/api/') && !path.includes('/['))
    .map((path) => {
      let route = path.replace('/src/pages', '').replace('.astro', '');
      if (route.endsWith('/index')) {
        route = route.replace('/index', '/');
      } else if (!route.endsWith('/')) {
        route = route + '/'; // Matching trailingSlash: 'always' in config
      }
      return `${SITE.url}${route}`;
    });

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls
    .map(
      (url) => `
  <url>
    <loc>${url}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${url === SITE.url + '/' ? '1.0' : '0.8'}</priority>
  </url>`
    )
    .join('')}
</urlset>`;

  return new Response(sitemap.trim(), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
