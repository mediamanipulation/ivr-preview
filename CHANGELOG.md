# Changelog

All notable changes to **IVR Preview** will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [1.0.0] — 2025-03-10

### Added
- **Play Full Document** command (`Cmd/Ctrl+Shift+Space`) — renders entire `.hbs` file through Amazon Polly and plays audio in a side panel
- **Play Selection** command (`Cmd/Ctrl+Shift+Enter`) — synthesizes only highlighted text, great for testing individual IVR branches
- **Show Rendered Script** command (`Cmd/Ctrl+Shift+R`) — previews the Handlebars-rendered text without making a Polly call
- **Change Voice** command — quick-pick from all neural Polly voices, updates the status bar live
- **Reload Payload & Helpers** command — explicit cache-bust for payload and helpers files
- Editor context menu entries for all commands
- Status bar item showing current voice and engine, click to switch
- Webview audio panel with playback speed controls (0.25× to 2.0×), copy rendered script button, SSML/voice/engine badges, char + word count
- SSML auto-detection — automatically uses `TextType: ssml` when rendered output starts with `<speak>`
- Custom Handlebars helpers file support — two export patterns supported (object or function), hot-reloaded on every preview run
- AWS credential chain support — uses `accessKeyId`/`secretAccessKey` settings if set, otherwise falls back to env vars → `~/.aws/credentials` → IAM role
- Starter `ivr-helpers.js` with IVR-focused helpers: `speakCurrency`, `spellDigits`, `speakPhone`, `speakDate`, `pause`, `ifEq`, `ifNe`, `ifGt`, `pick`, `ordinal`
- Example `ivr-payload.json` and `example-script.hbs` for quick onboarding
- `settings-example.jsonc` with all configuration options documented


-------
PS E:\vscode-extentions> node bootstrap.js

📦  Creating IVR Preview project in ./ivr-preview ...

  ✓  package.json
  ✓  tsconfig.json
  ✓  .gitignore
  ✓  .vscodeignore
  ✓  .vscode/launch.json
  ✓  .vscode/tasks.json
  ✓  .github/workflows/ci.yml
  ✓  .github/ISSUE_TEMPLATE/bug_report.md
  ✓  .github/ISSUE_TEMPLATE/feature_request.md
  ✓  .github/pull_request_template.md
  ✓  src/extension.ts
  ✓  ivr-helpers.js
  ✓  ivr-payload.json
  ✓  example-script.hbs
  ✓  settings-example.jsonc
  ✓  CHANGELOG.md
  ✓  CONTRIBUTING.md
  ✓  LICENSE
  ✓  README.md

✅  Done! Next steps:

  cd ivr-preview
  npm install
  npm run compile

Then press F5 in VS Code (with the folder open) to launch the
Extension Development Host and test it live.

To push to GitHub:
  git init && git branch -M main
  git add . && git commit -m "feat: initial release v1.0.0"
  git remote add origin https://github.com/YOUR_USERNAME/ivr-preview.git
  git push -u origin main

  (or: gh repo create ivr-preview --public --push --source=.)

PS E:\vscode-extentions>  cd ivr-preview
PS E:\vscode-extentions\ivr-preview> npm install
npm warn deprecated @types/handlebars@4.1.0: This is a stub types definition. handlebars provides its own type definitions, so you do not need this installed.

added 90 packages, and audited 91 packages in 7s

4 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
PS E:\vscode-extentions\ivr-preview> 
