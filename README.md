# IVR Preview — Handlebars + Amazon Polly for VS Code

> **Sound WYSIWYG for IVR/Autocall scripts.** Render your Handlebars templates with live JSON payload data and instantly hear them via Amazon Polly — directly inside VS Code.

---

## Features

| Feature | Description |
|---|---|
| **🔊 Play Full Document** | Render entire `.hbs` file → Polly → audio panel |
| **🔊 Play Selection** | Highlight any section and play just that |
| **📄 Show Rendered Script** | Preview the rendered text without synthesizing |
| **🎙️ Change Voice** | Quick-pick from neural Polly voices with status bar |
| **SSML Auto-Detect** | Automatically sends as SSML if output starts with `<speak>` |
| **Custom Helpers** | Load your project's Handlebars helpers (hot-reloaded each run) |
| **Playback Controls** | Speed up / slow down the audio directly in the panel |
| **Right-click menu** | Context menu entries in any editor |

---

## Quick Start

### 1. Install dependencies

```bash
cd ivr-preview
npm install
npm run compile
```

### 2. Set up your workspace

Create a `.vscode/settings.json` in your IVR project:

```json
{
  "ivrPreview.payloadFile": "./ivr-payload.json",
  "ivrPreview.helpersFile": "./ivr-helpers.js",
  "ivrPreview.aws.region": "us-east-1",
  "ivrPreview.aws.voiceId": "Joanna",
  "ivrPreview.aws.engine": "neural"
}
```

### 3. Configure AWS credentials

The extension uses the **standard AWS credential chain** — no keys needed in settings if you already have the AWS CLI configured:

```bash
aws configure          # sets ~/.aws/credentials
# — or —
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

Or set them directly in settings (`ivrPreview.aws.accessKeyId` / `ivrPreview.aws.secretAccessKey`).

---

## Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|---|---|---|
| Play Full Document | `Ctrl+Shift+Space` | `Cmd+Shift+Space` |
| Play Selection | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` |
| Show Rendered Script | `Ctrl+Shift+R` | `Cmd+Shift+R` |

All commands also available via:
- `Ctrl+Shift+P` → type **IVR Preview**
- Right-click in any editor

---

## Custom Helpers File

The helpers file is **hot-reloaded on every preview run** — no restart needed when you edit helpers.

### Pattern A — Export object of helpers (recommended)

```js
// ivr-helpers.js
module.exports = {
  speakCurrency(amount) {
    return `<say-as interpret-as="currency" language="en-US">$${parseFloat(amount).toFixed(2)}</say-as>`;
  },
  pause(ms) {
    return `<break time="${ms}ms"/>`;
  },
  ifEq(a, b, options) {
    return String(a) === String(b) ? options.fn(this) : options.inverse(this);
  }
};
```

### Pattern B — Register with Handlebars instance

```js
// ivr-helpers.js
module.exports = (Handlebars) => {
  Handlebars.registerHelper('speakCurrency', (amount) => { ... });
  Handlebars.registerHelper('pause', (ms) => { ... });
};
```

---

## JSON Payload File

Standard JSON. Any key becomes available as a Handlebars variable:

```json
{
  "callerName": "Sarah",
  "accountNumber": "4521",
  "balance": "247.50",
  "dueDate": "March 15th",
  "isOverdue": false,
  "isPremiumMember": true
}
```

Used in your template as `{{callerName}}`, `{{balance}}`, etc.

---

## SSML Support

If your rendered output starts with `<speak>`, it's automatically sent to Polly as SSML (`ssmlAutoDetect: true`). The preview panel shows an **SSML** badge.

Use the included `ivr-helpers.js` for Polly-native SSML tags:
- `{{speakCurrency balance}}` → `<say-as interpret-as="currency">$247.50</say-as>`
- `{{spellDigits accountNumber}}` → `<say-as interpret-as="digits">4521</say-as>`
- `{{speakPhone callbackNumber}}` → `<say-as interpret-as="telephone">...</say-as>`
- `{{pause 500}}` → `<break time="500ms"/>`

---

## Available Polly Neural Voices

| Voice | Gender | Language |
|---|---|---|
| Joanna, Ruth, Kendra, Kimberly, Salli, Ivy | F | en-US |
| Matthew, Stephen, Joey, Justin, Kevin | M | en-US |
| Lupe | F | es-US |
| Pedro | M | es-US |
| Amy, Emma | F | en-GB |
| Brian | M | en-GB |

Click the status bar item (`🔊 IVR: Joanna (neural)`) to switch voices instantly.

---

## Notes

- Polly has a **3,000 character limit** for plain text and **100,000 bytes** for SSML. For long scripts, use **Play Selection** to preview sections.
- The preview panel reuses the same side panel — synthesizing again updates it in place.
- AWS Polly charges apply per character synthesized. Neural voice pricing is ~$0.000016/char as of 2024.
