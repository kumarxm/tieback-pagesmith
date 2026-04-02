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

/**
 * Decodes HTML entities (like &#x27;) back into plain characters
 */
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
 * Strict splitting of Astro files to ensure frontmatter is NEVER translated.
 */
function parseAstro(content) {
  const parts = content.split('---');
  if (parts.length >= 3) {
    // parts is usually empty, parts is the frontmatter, parts[2+] is the body
    const frontmatter = `---${parts}---`;
    const body = parts.slice(2).join('---');
    return { frontmatter, body };
  }
  return { frontmatter: '', body: content };
}

function protectAstro(text) {
  const exprs = [];
  let protectedText = `<translation-root>${String(text || '')}</translation-root>`;
  
  // 1. Hide <script> and <style> blocks entirely
  protectedText = protectedText.replace(/<(script|style)[\s\S]*?<\/\1>/gi, m => { 
    exprs.push(m); 
    return `<astro-expr id="${exprs.length-1}"></astro-expr>`; 
  });
  
  // 2. Hide Astro { expressions }
  protectedText = protectedText.replace(/\{[\s\S]*?\}/g, m => { 
    exprs.push(m); 
    return `<astro-expr id="${exprs.length-1}"></astro-expr>`; 
  });
  
  // 3. Hide Glossary Terms
  const sorted = [...NO_TRANSLATE_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    protectedText = protectedText.replaceAll(term, `<keep>${term}</keep>`);
  }

  return { protectedText, exprs };
}

function restoreAstro(text, exprs) {
  // 1. Remove the root wrapper
  let r = text.replace(/<\/?translation-root>/g, '');
  
  // 2. IMPORTANT: Decode HTML entities returned by DeepL before restoring code
  r = decodeHtmlEntities(r);

  // 3. Remove glossary protection
  r = r.replace(/<keep>(.*?)<\/keep>/g, '$1');
  
  // 4. Restore expressions (using flexible regex to account for any DeepL-added spaces)
  exprs.forEach((e, i) => {
    const regex = new RegExp(`<astro-expr\\s+id=["']?${i}["']?\\s*><\\/astro-expr>`, 'gi');
    r = r.replace(regex, e);
  });
  return r;
}

async function safeTranslate(translator, text, targetLang) {
  // If the text is massive, translate in chunks
  if (text.length < 5000) {
    const res = await translator.translateText(text, 'en', targetLang, { 
        tagHandling: 'html', 
        ignoreTags: ['keep', 'astro-expr'] 
    });
    return res.text;
  }

  const chunks = text.split('\n\n');
  const translatedChunks = [];
  for (const chunk of chunks) {
    if (chunk.trim()) {
      const wrapped = `<translation-root>${chunk}</translation-root>`;
      const res = await translator.translateText(wrapped, 'en', targetLang, { 
          tagHandling: 'html', 
          ignoreTags: ['keep', 'astro-expr'] 
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
      if (existsSync(targetPath) && statSync(targetPath).mtime > statSync(file).mtime) continue;
      
      console.log(`🔄 Translating ${rel} to ${lang.toUpperCase()}...`);
      try {
        let final = '';
        if (file.endsWith('.astro')) {
          const { frontmatter, body } = parseAstro(content);
          const { protectedText, exprs } = protectAstro(body);
          const translatedBody = await safeTranslate(translator, protectedText, DEEPL_LANG_MAP[lang]);
          // Combine the UNTOUCHED frontmatter with the restored body
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
