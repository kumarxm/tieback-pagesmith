// @ts-check
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import remarkGfm from 'remark-gfm';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  site: process.env.SITE_URL || 'https://example.com',
  integrations: [
    // MDX support for blog posts, docs, and content
    mdx(),
    // Generate sitemap.xml
    sitemap(),
  ],
  markdown: {
    syntaxHighlight: 'shiki',
    shikiConfig: {
      theme: 'github-dark',
    },
    remarkPlugins: [remarkGfm],
  },
  build: {
    inlineStylesheets: 'always',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
