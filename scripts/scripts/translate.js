const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const deepl = require('deepl-node');

// Initialize DeepL with your secure GitHub secret
const authKey = process.env.DEEPL_API_KEY;
const translator = new deepl.Translator(authKey);

// Define where your English articles live and where translations go
const sourceDir = path.join(__dirname, '../src/pages/journal');
const targetLangs = ['de', 'fr']; // German and French

async function translateFiles() {
    const files = fs.readdirSync(sourceDir).filter(file => file.endsWith('.md') || file.endsWith('.mdx'));

    for (const file of files) {
        const filePath = path.join(sourceDir, file);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        
        // Extract the metadata (frontmatter) so DeepL doesn't break your site routing
        const parsed = matter(fileContent);
        
        for (const lang of targetLangs) {
            const outDir = path.join(__dirname, `../src/pages/${lang}/journal`);
            if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
            
            const outPath = path.join(outDir, file);
            
            // Only translate if the translated file doesn't already exist (saves you money!)
            if (!fs.existsSync(outPath)) {
                console.log(`Translating ${file} to ${lang}...`);
                
                // Send to DeepL, protecting HTML/Markdown formatting
                const result = await translator.translateText(parsed.content, 'en', lang, {
                    tag_handling: 'xml',
                    ignore_tags: ['script', 'style', 'code']
                });
                
                // Reassemble the file with the original metadata and new translated text
                const newContent = matter.stringify(result.text, parsed.data);
                fs.writeFileSync(outPath, newContent);
                console.log(`Successfully saved: ${outPath}`);
            }
        }
    }
}

translateFiles().catch(console.error);
