# Vorbia

Built with [Astro](https://astro.build) and managed by [Pagesmith](https://pagesmith.ai).

## Project Structure

```
src/
  pages/        # Page routes (.astro files)
  components/   # Reusable components
  layouts/      # Page layouts
  content/      # Blog posts and articles (MDX/MD)
public/         # Static assets (images, fonts)
astro.config.mjs
```

## Development

```bash
npm install
npm run dev
```

## Astro Configuration

This site uses `output: 'static'` by default, meaning all pages are pre-rendered at build time. To make a specific page server-rendered, add this to the page's frontmatter:

```astro
---
export const prerender = false;
---
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com) for styling. Global styles and custom CSS variables are defined in `src/styles/global.css`, which is imported in the base layout. Use Tailwind utility classes in your components and pages.

## CMS Anchors

Astro files contain `data-ps="..."` attributes on HTML elements. These are used by Pagesmith's visual content editor. You can safely ignore them when editing code — they are automatically regenerated when you pull changes back into Pagesmith.

## Syncing with Pagesmith

- **Export** pushes your Pagesmith project to this repository
- **Pull** imports changes from this repository back into Pagesmith
- Pull validates your code with AI before applying and auto-fixes build errors
- Lock files and `.env` files are excluded from sync
