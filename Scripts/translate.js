#!/usr/bin/env node

/**
 * TieBack — Automated Translation Pipeline for Pagesmith (Astro/Markdown)
 * Uses Brace-Counting & Plain-Text Placeholders for 100% Astro Compilation Safety.
 */

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

function decodeHtmlEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Bulletproof Frontmatter isolation. 
 * Extracts exactly the top block between the first two '---' markers.
 */
function parseAstro(content) {
  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3);
    if (endIdx > -1) {
      const frontmatter = content.substring(0, endIdx + 3);
      const body = content.substring(endIdx + 3);
      return { frontmatter, body };
    }
  }
  return { frontmatter: '', body: content };
}

/**
 * Uses brace-counting to safely hide Astro expressions without breaking HTML attributes.
 */
function protectAstro(text) {
  const exprs = [];
  let protectedText = String(text || '');

  // 1. Hide <script> and <style> blocks
  protectedText = protectedText.replace(/<(script|style)[\s\S]*?<\/\1>/gi, m => { 
    exprs.push(m); 
    return `___ASTROEXPR${exprs.length-1}___`; 
  });

  // 2. Brace-Counting for { expressions }
  let result = '';
  let depth = 0;
  let currentExpr = '';

  for (let i = 0; i < protectedText.length; i++) {
    const char = protectedText[i];
    if (char === '{') {
      if (depth === 0) currentExpr = '{';
      else currentExpr += '{';
      depth++;
    } else if (char === '}') {
      depth--;
      currentExpr += '}';
      if (depth === 0) {
        exprs.push(currentExpr);
        result += `___ASTROEXPR${exprs.length - 1}___`;
      } else if (depth < 0) {
        depth = 0; 
        result += '}';
      }
    } else {
      if (depth > 0) currentExpr += char;
      else result += char;
    }
  }
  protectedText = result;

  // 3. Hide Glossary Terms
  const sorted = [...NO_TRANSLATE_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    protectedText = protectedText.replaceAll(term, `<keep>${term}</keep>`);
  }

  // Wrap in a root tag to satisfy DeepL's 'text without parent' HTML rule
  return { protectedText: `<translation-root>\n${protectedText}\n</translation-root>`, exprs };
}

function restoreAstro(text, exprs) {
  // 1. Remove Root Tags & Decode HTML limits
  let r = text.replace(/<\/?translation-root>/g, '');
  r = decodeHtmlEntities(r);

  // 2. Restore Glossary terms
  r = r.replace(/<keep>(.*?)<\/keep>/g, '$1');

  // 3. Restore Astro Expressions (handles slight spacing added by DeepL)
  exprs.forEach((e, i) => {
    const regex = new RegExp(`___\\s*ASTROEXPR${i}\\s*___`, 'gi');
    r = r.replace(regex, e);
  });
  
  return r;
}

async function safeTranslate(translator, text, targetLang) {
  if (text.length < 5000) {
    const res = await translator.translateText(text, 'en', targetLang, { 
        tagHandling: 'html', 
        ignoreTags: ['keep'] // astro-expr is no longer needed here!
    });
    return res.text;
  }

  const chunks = text.split('\n\n');
  const translatedChunks = [];
  for (const chunk of chunks) {
    if (chunk.trim()) {
      const wrapped = `<translation-root>\n${chunk}\n</translation-root>`;
      const res = await translator.translateText(wrapped, 'en', targetLang, { 
          tagHandling: 'html', 
          ignoreTags: ['keep'] 
      });
      translatedChunks.push(res.text.replace(/<\/?translation-root>/g, ''));
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
      // Skip if translated file already exists and is newer than the source file
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
      } catch (e) { 
        console.error(`   ❌ Failed ${rel} to ${lang}: ${e.message}`); 
      }
    }
  }
}

main().catch(console.error);
