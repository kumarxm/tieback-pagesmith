#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as deepl from 'deepl-node';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_LANGS = ['de', 'fr'];
const SOURCE_DIRS = [resolve(__dirname, '../src/pages'), resolve(__dirname, '../src/content')];
const DEEPL_LANG_MAP = { de: 'de', fr: 'fr' };
const NO_TRANSLATE_TERMS = ['TieBack', 'GS1', 'DPP', 'ESPR', 'GDPR', 'CBAM', 'EPCIS', 'GTIN', 'B2B', 'AI', 'FAQ'];

function parseAstro(content) {
  const match = content.match(/^(---\s*[\s\S]*?---\s*)\n([\s\S]*)$/);
  return match ? { frontmatter: match, body: match } : { frontmatter: '', body: content };
}

function protectAstro(text) {
  const exprs = [];
  let protectedText = String(text || '').replace(/<script[\s\S]*?<\/script>/gi, m => { exprs.push(m); return `<astro-expr id="${exprs.length-1}"></astro-expr>`; });
  protectedText = protectedText.replace(/\{[\s\S]*?\}/g, m => { exprs.push(m); return `<astro-expr id="${exprs.length-1}"></astro-expr>`; });
  NO_TRANSLATE_TERMS.forEach(t => { protectedText = protectedText.replaceAll(t, `<keep>${t}</keep>`); });
  return { protectedText, exprs };
}

function restoreAstro(text, exprs) {
  let r = text.replace(/<keep>(.*?)<\/keep>/g, '$1');
  exprs.forEach((e, i) => { r = r.replace(new RegExp(`<astro-expr id="${i}"><\\/astro-expr>`, 'g'), e); });
  return r;
}

// ── Chunking Logic for High-Complexity Pages (FAQ/Slugs) ──
async function safeTranslate(translator, text, targetLang) {
  if (text.length < 4000) {
    const res = await translator.translateText(text, 'en', targetLang, { tagHandling: 'html', ignoreTags: ['keep', 'astro-expr'] });
    return res.text;
  }
  // Split long pages by double-newline (paragraphs) to avoid 500 errors
  const chunks = text.split('\n\n');
  const translatedChunks = [];
  for (const chunk of chunks) {
    if (chunk.trim()) {
      const res = await translator.translateText(chunk, 'en', targetLang, { tagHandling: 'html', ignoreTags: ['keep', 'astro-expr'] });
      translatedChunks.push(res.text);
    } else {
      translatedChunks.push('');
    }
  }
  return translatedChunks.join('\n\n');
}

async function main() {
  const translator = new deepl.Translator(process.env.DEEPL_API_KEY);
  const allFiles = [];
  SOURCE_DIRS.forEach(d => {
    const walk = (dir) => {
      if (!existsSync(dir)) return;
      readdirSync(dir).forEach(f => {
        const p = join(dir, f);
        if (statSync(p).isDirectory() && !TARGET_LANGS.includes(f)) walk(p);
        else if (f.endsWith('.md') || f.endsWith('.mdx') || f.endsWith('.astro')) allFiles.push(p);
      });
    };
    walk(d);
  });

  console.log(`Processing ${allFiles.length} files...`);

  for (const file of allFiles) {
    const baseDir = SOURCE_DIRS.find(d => file.startsWith(d));
    const rel = file.replace(baseDir, '');
    const content = readFileSync(file, 'utf-8');
    for (const lang of TARGET_LANGS) {
      const targetPath = join(baseDir, lang, rel);
      if (existsSync(targetPath) && statSync(targetPath).mtime > statSync(file).mtime) continue;
      
      console.log(`🔄 Translating ${rel} to ${lang.toUpperCase()}...`);
      try {
        let final = '';
        if (file.endsWith('.astro')) {
          const { frontmatter, body } = parseAstro(content);
          const { protectedText, exprs } = protectAstro(body);
          const translatedBody = await safeTranslate(translator, protectedText, DEEPL_LANG_MAP[lang]);
          final = `${frontmatter}\n${restoreAstro(translatedBody, exprs)}`;
        } else {
          const p = matter(content);
          const { protectedText, exprs } = protectAstro(p.content);
          const translatedBody = await safeTranslate(translator, protectedText, DEEPL_LANG_MAP[lang]);
          final = matter.stringify(restoreAstro(translatedBody, exprs), p.data);
        }
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, final, 'utf-8');
        console.log(`   ✓ Saved: ${lang}${rel}`);
      } catch (e) { console.error(`   ❌ Failed ${rel}: ${e.message}`); }
    }
  }
}
main().catch(console.error);
