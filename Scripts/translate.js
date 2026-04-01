name: Translate i18n

on:
  workflow_dispatch:
  push:
    paths:
      - 'src/i18n/en.json'

jobs:
  translate:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install deepl-node
        run: npm install deepl-node

      - name: Run translation script
        env:
          DEEPL_API_KEY: ${{ secrets.DEEPL_API_KEY }}
        run: node scripts/translate.js

      - name: Commit and Push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          
          # 1. Stash EVERYTHING (staged, unstaged, untracked) to create a 100% clean workspace
          git stash push --include-untracked -m "garbage"
          
          # 2. Pull the absolute latest code safely without rebasing
          git pull origin main
          
          # 3. Pull the translated JSON files back out of the stash
          git checkout stash@{0} -- src/i18n/*.json
          
          # 4. Clear the stash
          git stash drop
          
          # 5. Commit and Push only the translated files
          git add src/i18n/*.json
          if ! git diff --cached --quiet; then
            git commit -m "chore(i18n): update translations [automated]"
            git push origin main
          fi
