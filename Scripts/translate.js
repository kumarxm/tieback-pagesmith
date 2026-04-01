#!/usr/bin/env node

/**
 * TieBack — Automated Translation Pipeline for Pagesmith (Astro/Markdown)
 * Translates English .md/.mdx/.astro files using DeepL API with Astro-Shield.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as deepl from 'deepl-node';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────────

const TARGET_LANGS = ['de', 'fr'];
// Look in both pages and content directories
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

// Safely split Astro files without crashing on JavaScript frontmatter
function parseAstro(content) {
  const match = content.match(/^(---[\s\S]*?---)\n([\s\S]*)$/);
  if (match) {
    return { frontmatter: match, body: match };
  }
  return { frontmatter: '', body: content };
}

// Disguises Astro {expressions} so DeepL's HTML parser doesn't crash
function protectAstroExpressions(text) {
  const expressions = [];
  // Find anything inside { } and replace it with a safe <astro-expr> tag
  let protectedText = text.replace(/\{[\s\S]*?\}/g, (match) => {
    expressions.push(match);
    return `<astro-expr id="${expressions.length - 1}"></astro-expr>`;
  });
  
  // Protect TieBack glossary terms
  const sorted = [...NO_TRANSLATE_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    protectedText = protectedText.replaceAll(term, `<keep>${term}</keep>`);
  }

  return { protectedText, expressions };
}

// Restores the original Astro {expressions} after translation
function restoreAstroExpressions(text, expressions) {
  let restoredText = text.replace(/<keep>(.*?)<\/keep>/g, '$1');
  
  for (let i = 0; i < expressions.length; i++) {
    const regex = new RegExp(`<astro-expr id="${i}"><\\/astro-expr>`, 'g');
    restoredText = restoredText.replace(regex, expressions[i]);
  }
  return restoredText;
}

// ── File Traversal ─────────────────────────────────────────────────────────────

function findTargetFiles(dir, fileList = [], baseDir = dir) {
  if (!existsSync(dir)) return fileList;
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    // Ignore localized folders
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

// ── Main Engine ────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.error('ERROR: DEEPL_API_KEY is required.');
    process.exit(1);
  }

  const translator = new deepl.Translator(apiKey);
  
  let allFiles = [];
  for (const dir of SOURCE_DIRS) {
    allFiles = allFiles.concat(findTargetFiles(dir));
  }

  console.log(`Found ${allFiles.length} files to process.`);

  for (const file of allFiles) {
    // Determine which base directory this file belongs to so we can replicate the folder structure
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

      if (existsSync(targetPath)) {
        if (statSync(targetPath).mtime > sourceStat.mtime) {
          continue; // Up to date
        }
      }

      console.log(`🔄 Translating ${relativePath} to ${lang.toUpperCase()}...`);

      try {
        let finalFileContent = '';

        if (isAstro) {
          // Astro File Pipeline
          const parsed = parseAstro(fileContent);
          const { protectedText, expressions } = protectAstroExpressions(parsed.body);
          
          let translatedBody = '';
          if (protectedText.trim()) {
            // Use 'html' tag handling, which is much safer for Astro components than 'xml'
            const result = await translator.translateText(protectedText, 'en', targetLangCode, {
              tagHandling: 'html',
              ignoreTags: ['keep', 'astro-expr'],
            });
            translatedBody = restoreAstroExpressions(result.text, expressions);
          }
          finalFileContent = `${parsed.frontmatter}\n${translatedBody}`;
        } else {
          // Markdown File Pipeline (Safe to use gray-matter)
          const parsed = matter(fileContent);
          const { protectedText, expressions } = protectAstroExpressions(parsed.content);
          
          let translatedBody = '';
          if (protectedText.trim()) {
            const result = await translator.translateText(protectedText, 'en', targetLangCode, {
              tagHandling: 'html',
              ignoreTags: ['keep', 'astro-expr'],
            });
            translatedBody = restoreAstroExpressions(result.text, expressions);
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
  console.log('\n✅ Pipeline complete.');
}

main().catch(console.error);
