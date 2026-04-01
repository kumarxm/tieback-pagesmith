#!/usr/bin/env node

/**
 * TieBack — Automated Translation Pipeline for Pagesmith (Astro/Markdown)
 * Translates English .md/.mdx files in src/pages/ → de, fr using DeepL API.
 * Preserves Astro frontmatter and TieBack glossary terms.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as deepl from 'deepl-node';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────────

const TARGET_LANGS = ['de', 'fr']; // Adjusted to match your current Pagesmith rollout
const SOURCE_DIR = resolve(__dirname, '../src/pages');

// DeepL uses upper-case region codes for some targets
const DEEPL_LANG_MAP = {
  de: 'de',
  fr: 'fr',
};

// Terms that must NEVER be translated (case-sensitive)
const NO_TRANSLATE_TERMS = [
  'TieBack', 'GS1 Sunrise 2027', 'GS1 Digital Link', 'Digital Product Passport', 
  'SOC 2', 'EU DPP', 'EU ESPR', 'ESPR', 'GDPR', 'CBAM', 'EPCIS', 'GTIN', 'FMCG', 
  'NFC', 'QR', 'EAN', 'UPC', 'SKU', 'API', 'SSO', 'MFA', 'SAML', 'SCIM', 'SLA', 
  'RPO', 'RTO', 'TLS', 'JSON', 'PDF', 'CSV', 'URL', 'SMS', 'B2B', 'B2C', 'DTC', 
  'DPP', 'DPA', 'ERP', 'PIM', 'PLM', 'CMS', 'MES', 'ESG', 'AI', 'FAQ', 'SAST', 
  'DAST', 'RLS', 'OECD', 'EUIPO'
];

// Regex to match markdown variables or shortcodes if you use them
const INTERPOLATION_RE = /\{\{[\w]+\}\}/g;

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeHtml(text) {
  if (!text) return '';
  return text
    .replace(/<br\s*>/gi, '<br/>')
    .replace(/<hr\s*>/gi, '<hr/>')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;');
}

function protect(text) {
  if (!text) return '';
  let result = sanitizeHtml(text);

  const sorted = [...NO_TRANSLATE_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    result = result.replaceAll(term, `<keep>${term}</keep>`);
  }

  result = result.replace(INTERPOLATION_RE, (match) => `<keep>${match}</keep>`);
  return result;
}

function unprotect(text) {
  if (!text) return '';
  return text
    .replace(/<keep>(.*?)<\/keep>/g, '$1')
    .replace(/&amp;/g, '&');
}

/**
 * Recursively find all markdown files in a directory, 
 * explicitly ignoring localized folders to prevent infinite loops.
 */
function findMarkdownFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    // Ignore localized folders (e.g., src/pages/de, src/pages/fr)
    if (stat.isDirectory() && TARGET_LANGS.includes(file) && dir === SOURCE_DIR) {
      continue;
    }

    if (stat.isDirectory()) {
      findMarkdownFiles(filePath, fileList);
    } else if (file.endsWith('.md') || file.endsWith('.mdx') || file.endsWith('.astro')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.error('ERROR: DEEPL_API_KEY environment variable is required.');
    process.exit(1);
  }

  const translator = new deepl.Translator(apiKey);
  const englishFiles = findMarkdownFiles(SOURCE_DIR);

  console.log(`Found ${englishFiles.length} English markdown files to process.`);

  for (const file of englishFiles) {
    const relativePath = file.replace(SOURCE_DIR, ''); // e.g., /journal/my-post.md
    const fileContent = readFileSync(file, 'utf-8');
    const sourceStat = statSync(file);
    
    // Parse the markdown file to separate Frontmatter from Body Content
    const parsed = matter(fileContent);

    for (const lang of TARGET_LANGS) {
      const targetLangCode = DEEPL_LANG_MAP[lang];
      const targetPath = join(SOURCE_DIR, lang, relativePath); // e.g., src/pages/de/journal/my-post.md
      const targetDir = dirname(targetPath);

      // Create directories if they don't exist
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      // Cost saving: Check if the translated file exists and is newer than the English file
      if (existsSync(targetPath)) {
        const targetStat = statSync(targetPath);
        if (targetStat.mtime > sourceStat.mtime) {
          console.log(`⏭️  Skipping ${lang}${relativePath} (Up to date)`);
          continue;
        }
      }

      console.log(`🔄 Translating ${relativePath} to ${lang.toUpperCase()}...`);

      try {
        // 1. Translate the Body Content
        const protectedBody = protect(parsed.content);
        let translatedBody = '';
        if (protectedBody.trim()) {
          const result = await translator.translateText(protectedBody, 'en', targetLangCode, {
            tagHandling: 'xml',
            ignoreTags: ['keep'],
          });
          translatedBody = unprotect(result.text);
        }

        // 2. Translate specific SEO Frontmatter fields (Clone the data object so we don't mutate the original)
        const translatedData = { ...parsed.data };
        
        if (translatedData.title) {
          const res = await translator.translateText(protect(translatedData.title), 'en', targetLangCode, { tagHandling: 'xml', ignoreTags: ['keep'] });
          translatedData.title = unprotect(res.text);
        }
        
        if (translatedData.description) {
          const res = await translator.translateText(protect(translatedData.description), 'en', targetLangCode, { tagHandling: 'xml', ignoreTags: ['keep'] });
          translatedData.description = unprotect(res.text);
        }

        // 3. Reassemble and Save
        const newFileContent = matter.stringify(translatedBody, translatedData);
        writeFileSync(targetPath, newFileContent, 'utf-8');
        console.log(`   ✓ Saved: ${lang}${relativePath}`);

      } catch (err) {
        console.error(`   ❌ Failed to translate ${relativePath} to ${lang}:`, err.message);
      }
    }
  }

  console.log('\n✅ All Pagesmith translations complete.');
}

main().catch((err) => {
  console.error('Translation pipeline crashed:', err);
  process.exit(1);
});
