# Contributing to IVR Preview

Thanks for your interest! Contributions are welcome — bug fixes, new helpers, new voices, UX improvements, documentation.

---

## Dev Setup

**Prerequisites:** Node.js 18+, VS Code, an AWS account with Polly access.

```bash
git clone https://github.com/YOUR_USERNAME/ivr-preview.git
cd ivr-preview
npm install
```

Open the folder in VS Code, then press **F5** to launch the Extension Development Host. Changes to `src/extension.ts` require a recompile (`Cmd+Shift+B`) and an Extension Host reload (`Ctrl+Shift+F5`).

For continuous recompilation:

```bash
npm run watch
```

---

## Project Structure

```
ivr-preview/
├── src/
│   └── extension.ts          ← All extension logic (single file)
├── .github/
│   ├── workflows/            ← CI
│   └── ISSUE_TEMPLATE/       ← Bug / feature templates
├── .vscode/
│   ├── launch.json           ← F5 debug config
│   └── tasks.json            ← Build task
├── images/                   ← Extension icon (128×128 icon.png)
├── ivr-helpers.js            ← Starter helpers (shipped with extension)
├── ivr-payload.json          ← Starter payload (shipped with extension)
├── example-script.hbs        ← Example IVR script (shipped with extension)
├── settings-example.jsonc    ← Documented settings reference
├── package.json
├── tsconfig.json
└── .vscodeignore
```

---

## Guidelines

- **Single file** — keep all extension logic in `src/extension.ts` unless there's a very strong reason to split it out. This extension is intentionally simple and self-contained.
- **No new runtime deps** without discussion. The AWS SDK and Handlebars are the only dependencies.
- **Helpers** — new built-in helpers for `ivr-helpers.js` are welcome. Focus on helpers that are useful across IVR platforms (Polly SSML, pauses, number formatting, conditionals).
- **Tests** — unit tests for the render/helpers pipeline are welcome; add them in a `test/` directory.

---

## Releasing

```bash
npm run compile
npx vsce package          # generates ivr-preview-x.x.x.vsix
npx vsce publish          # publishes to VS Code Marketplace (requires token)
```

Bump the version in `package.json` and add a `CHANGELOG.md` entry before publishing.
