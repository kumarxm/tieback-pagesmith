#!/usr/bin/env node

/**
 * TieBack — Automated Translation Pipeline for Pagesmith (Astro/Markdown)
 * Optimized for DeepL stability and Astro component protection.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as deepl from 'deepl-node';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────────

const TARGET_LANGS = ['de', 'fr'];
const SOURCE_DIRS = [
  resolve(__dirname, '../src/pages'),
  resolve(__dirname, '../src/content')
];

const DEEPL_LANG_MAP = { de: 'de', fr: 'fr' };

const NO_TRANSLATE_TERMS = [
  'TieBack', 'GS1 Sunrise 2027', 'GS1 Digital Link', 'Digital Product Passport', 
  'SOC 2', 'EU DPP', 'EU ESPR', 'ESPR', 'GDPR', 'CBAM', 'EPCIS', 'GTIN', 'FMCG', 
  'NFC', 'QR', 'EAN', 'UPC', 'SKU', 'API', 'SSO', 'MFA', 'SAML', 'SCIM', 'SLA', 
  'RPO', 'RTO', 'TLS', 'JSON', 'PDF', 'CSV', 'URL', 'SMS', 'B2B', 'B2C', 'DTC', 
  'DPP', 'DPA', 'ERP', 'PIM', 'PLM', 'CMS', 'MES', 'ESG', 'AI', 'FAQ', 'SAST', 
  'DAST', 'RLS', 'OECD', 'EUIPO'
];

// ── Astro Shield Logic ─────────────────────────────────────────────────────────

/**
 * Safely splits Astro files. 
 * Improved regex to capture the exact frontmatter block.
 */
function parseAstro(content) {
  const match = content.match(/^(---\s*[\s\S]*?---\s*)\n([\s\S]*)$/);
  if (match) {
    return { frontmatter: match, body: match };
  }
  return { frontmatter: '', body: content };
}

/**
 * Masks Astro code so DeepL sees them as non-translatable HTML tags.
 * Added <script> protection to stop the FAQ page from crashing DeepL.
 */
function protectAstroExpressions(text) {
  if (typeof text !== 'string') text = String(text || '');
  const expressions = [];

  // 1. Hide <script> blocks (like your JSON-LD FAQ data)
  let protectedText = text.replace(/<script[\s\S]*?<\/script>/gi, (match) => {
    expressions.push(match);
    return `<astro-expr id="${expressions.length - 1}"></astro-expr>`;
  });

  // 2. Hide Astro { expressions }
  protectedText = protectedText.replace(/\{[\s\S]*?\}/g, (match) => {
    expressions.push(match);
    return `<astro-expr id="${expressions.length - 1}"></astro-expr>`;
  });
  
  // 3. Hide Glossary Terms
  const sorted = [...NO_TRANSLATE_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    protectedText = protectedText.replaceAll(term, `<keep>${term}</keep>`);
  }

  return { protectedText, expressions };
}

function restoreAstroExpressions(text, expressions) {
  if (typeof text !== 'string') text = String(text || '');
  let restoredText = text.replace(/<keep>(.*?)<\/keep>/g, '$1');
  
  for (let i = 0; i < expressions.length; i++) {
    const regex = new RegExp(`<astro-expr id="${i}"><\\/astro-expr>`, 'g');
    restoredText = restoredText.replace(regex, expressions[i]);
  }
  return restoredText;
}

// ── File Helpers ───────────────────────────────────────────────────────────────

function findTargetFiles(dir, fileList = [], baseDir = dir) {
  if (!existsSync(dir)) return fileList;
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory() && TARGET_LANGS.includes(file) && dir === baseDir) {
      continue;
    }

    if (stat.isDirectory()) {
      findTargetFiles(filePath, fileList, baseDir);
    } else if (file.endsWith('.md') || file.endsWith('.mdx') || file.endsWith('.astro')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

// ── Execution ──────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.error('ERROR: DEEPL_API_KEY environment variable is required.');
    process.exit(1);
  }

  const translator = new deepl.Translator(apiKey);
  
  let allFiles = [];
  for (const dir of SOURCE_DIRS) {
    allFiles = allFiles.concat(findTargetFiles(dir));
  }

  console.log(`Found ${allFiles.length} files to process.`);

  for (const file of allFiles) {
    const baseDir = SOURCE_DIRS.find(dir => file.startsWith(dir));
    const relativePath = file.replace(baseDir, ''); 
    const isAstro = file.endsWith('.astro');
    const fileContent = readFileSync(file, 'utf-8');
    const sourceStat = statSync(file);

    for (const lang of TARGET_LANGS) {
      const targetLangCode = DEEPL_LANG_MAP[lang];
      const targetPath = join(baseDir, lang, relativePath); 
      const targetDir = dirname(targetPath);

      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

      // Cache Check: skip if translation is newer than English source
      if (existsSync(targetPath)) {
        const targetStat = statSync(targetPath);
        if (targetStat.mtime > sourceStat.mtime) {
          continue;
        }
      }

      console.log(`🔄 Translating ${relativePath} to ${lang.toUpperCase()}...`);

      try {
        let finalFileContent = '';

        if (isAstro) {
          const parsed = parseAstro(fileContent);
          const { protectedText, expressions } = protectAstroExpressions(parsed.body);
          
          let translatedBody = '';
          if (protectedText.trim()) {
            const result = await translator.translateText(protectedText, 'en', targetLangCode, {
              tagHandling: 'html',
              ignoreTags: ['keep', 'astro-expr'],
            });
            translatedBody = restoreAstroExpressions(result.text, expressions);
          } else {
            translatedBody = parsed.body;
          }
          finalFileContent = `${parsed.frontmatter}\n${translatedBody}`;
        } else {
          const parsed = matter(fileContent);
          const { protectedText, expressions } = protectAstroExpressions(parsed.content);
          
          let translatedBody = '';
          if (protectedText.trim()) {
            const result = await translator.translateText(protectedText, 'en', targetLangCode, {
              tagHandling: 'html',
              ignoreTags: ['keep', 'astro-expr'],
            });
            translatedBody = restoreAstroExpressions(result.text, expressions);
          } else {
            translatedBody = parsed.content;
          }
          finalFileContent = matter.stringify(translatedBody, parsed.data);
        }

        writeFileSync(targetPath, finalFileContent, 'utf-8');
        console.log(`   ✓ Saved: ${lang}${relativePath}`);
      } catch (err) {
        console.error(`   ❌ Failed: ${relativePath} -> ${lang}:`, err.message);
      }
    }
  }
}

main().catch(console.error);
