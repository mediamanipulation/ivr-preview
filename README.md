<div align="center">

<img src="images/icon.png" width="128" height="128" alt="IVR Preview icon" />

# IVR Preview

### Handlebars + Amazon Polly for VS Code

**Write IVR scripts. Hear them instantly. Ship with confidence.**

[![VS Code](https://img.shields.io/badge/VS_Code-^1.80.0-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![Polly](https://img.shields.io/badge/Amazon_Polly-Neural_TTS-FF9900?logo=amazonaws&logoColor=white)](https://aws.amazon.com/polly/)
[![Handlebars](https://img.shields.io/badge/Handlebars-Templates-f0772b?logo=handlebarsdotjs&logoColor=white)](https://handlebarsjs.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

---

**Sound WYSIWYG for IVR/Autocall scripts.**<br/>
Render Handlebars templates with live JSON data and hear them through Amazon Polly — without leaving your editor.

[Getting Started](#-getting-started) · [Features](#-features) · [Helpers](#-built-in-helpers) · [SSML Reference](#-ssml-support) · [Settings](#%EF%B8%8F-all-settings)

</div>

---

## How It Works

```
  ┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
  │  .hbs file   │     │  Handlebars   │     │ Amazon Polly │     │  VS Code    │
  │              │────▶│  + Payload    │────▶│  Neural TTS  │────▶│  Audio      │
  │  Your script │     │  + Helpers    │     │  Synthesis   │     │  Panel      │
  └─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
                             │
                      ┌──────┴──────┐
                      │ ivr-payload │
                      │    .json    │
                      └─────────────┘
```

> Press **`Ctrl+Shift+Space`** and your script plays. That's it.

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🔊 Live Audio Preview
Hear your full document or just a highlighted selection rendered through Polly's neural voices — no browser, no Postman, no deploy.

### 🎙️ 16 Neural Voices
Switch between US English, British English, and Spanish voices instantly from the status bar.

### 📄 Rendered Script View
See exactly what text gets sent to Polly after Handlebars rendering — without synthesizing audio.

</td>
<td width="50%">

### ⚡ Hot-Reload Everything
Helpers and payload data reload on every preview. Edit → Save → Listen. No restart.

### 📖 SSML Reference Panel
Built-in interactive documentation with every Polly SSML tag, examples, and copy buttons.

### 🎛️ Playback Controls
Speed up or slow down audio from 0.25x to 2.0x directly in the preview panel.

</td>
</tr>
</table>

---

## 🚀 Getting Started

### 1. Install & Build

```bash
git clone https://github.com/mediamanipulation/ivr-preview.git
cd ivr-preview
npm install
npm run compile
```

Press **`F5`** in VS Code to launch the Extension Development Host — or package with `vsce package`.

### 2. Configure Your Workspace

Add to your project's `.vscode/settings.json`:

```jsonc
{
  "ivrPreview.payloadFile": "./ivr-payload.json",
  "ivrPreview.helpersFile": "./ivr-helpers.js",
  "ivrPreview.aws.region": "us-east-1",
  "ivrPreview.aws.voiceId": "Matthew",
  "ivrPreview.aws.engine": "neural"
}
```

### 3. AWS Credentials

The extension uses the standard AWS credential chain — if you have the AWS CLI configured, you're already set:

```bash
aws configure                         # interactive setup → ~/.aws/credentials
```

<details>
<summary><strong>Other credential methods</strong></summary>

```bash
# Environment variables
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
```

Or set directly in VS Code settings:
- `ivrPreview.aws.accessKeyId`
- `ivrPreview.aws.secretAccessKey`

</details>

### 4. Write & Preview

```handlebars
<speak>
  Hello, {{callerName}}.
  <break time="300ms"/>

  Your balance is {{{speakCurrency balance}}}, due on {{dueDate}}.
  <break time="300ms"/>

  Call us at {{{speakPhone callbackNumber}}}.
</speak>
```

Hit **`Ctrl+Shift+Space`** — done.

---

## ⌨️ Keyboard Shortcuts

| Action | Windows / Linux | Mac |
|:---|:---:|:---:|
| **Play Full Document** | `Ctrl+Shift+Space` | `Cmd+Shift+Space` |
| **Play Selection** | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` |
| **Show Rendered Script** | `Ctrl+Shift+R` | `Cmd+Shift+R` |

> Also available via **Command Palette** (`Ctrl+Shift+P` → "IVR Preview") and **right-click context menu**.

---

## 🧩 Built-in Helpers

The bundled `ivr-helpers.js` gives you these out of the box:

| Helper | Usage | What It Does |
|:---|:---|:---|
| **`speakCurrency`** | `{{{speakCurrency balance}}}` | "two hundred forty-seven dollars and fifty cents" |
| **`speakDate`** | `{{{speakDate dueDate}}}` | Natural date pronunciation |
| **`spellDigits`** | `{{{spellDigits accountNumber}}}` | Spells digit by digit — "4, 5, 2, 1" |
| **`speakPhone`** | `{{{speakPhone callbackNumber}}}` | Natural phone number speech |
| **`pause`** | `{{{pause 500}}}` | Inserts a `<break>` pause |
| **`ifEq`** / **`ifNe`** / **`ifGt`** | `{{#ifGt missedPayments 0}}...{{/ifGt}}` | Conditional blocks |
| **`upper`** / **`lower`** / **`trim`** | `{{upper agentName}}` | String transforms |
| **`ordinal`** | `{{ordinal position}}` | "1st", "2nd", "3rd" |
| **`pick`** | `{{pick isPremium "member" "customer"}}` | Ternary-style value toggle |

> [!IMPORTANT]
> Helpers that return SSML tags **must** use triple braces `{{{ }}}` so Handlebars doesn't escape the angle brackets.

---

## ✏️ Custom Helpers

Helpers are **hot-reloaded on every preview** — edit, save, preview. String returns are auto-wrapped in `SafeString` so SSML tags pass through cleanly.

<details>
<summary><strong>Pattern A — Export object (recommended)</strong></summary>

```js
// ivr-helpers.js
module.exports = {
  speakCurrency(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    const dollars = Math.floor(num);
    const cents = Math.round((num - dollars) * 100);
    if (cents > 0) {
      return `<say-as interpret-as="cardinal">${dollars}</say-as> dollars and ` +
             `<say-as interpret-as="cardinal">${cents}</say-as> cents`;
    }
    return `<say-as interpret-as="cardinal">${dollars}</say-as> dollars`;
  },

  pause(ms) {
    return `<break time="${ms}ms"/>`;
  },

  speakPhone(phone) {
    return `<say-as interpret-as="telephone">${phone}</say-as>`;
  }
};
```

</details>

<details>
<summary><strong>Pattern B — Register with Handlebars instance</strong></summary>

```js
// ivr-helpers.js
module.exports = (Handlebars) => {
  Handlebars.registerHelper('speakCurrency', (amount) => { /* ... */ });
  Handlebars.registerHelper('pause', (ms) => { /* ... */ });
};
```

</details>

### Using Custom Helpers

Already have helpers in your IVR system? Point the extension at them — no rewrite needed.

**Step 1** — Set the path in your workspace settings:

```jsonc
{
  "ivrPreview.helpersFile": "./path/to/your-helpers.js"
}
```

**Step 2** — Make sure the file exports in one of the two patterns above. If your helpers are already a standalone module that exports an object or a registration function, it works as-is.

If your helpers are wired into a larger app (e.g. registered during startup), create a thin wrapper:

```js
// ivr-helpers.js — wrapper for custom helpers
const { speakCurrency, speakDate, routeMenu } = require('./lib/ivr/helpers');
const { formatAccount, formatSSN } = require('./lib/formatting');

module.exports = {
  speakCurrency,
  speakDate,
  routeMenu,
  formatAccount,
  formatSSN,
};
```

> [!TIP]
> The helpers file is hot-reloaded on every preview — no extension restart needed. You can iterate on helpers and hear the result immediately.

---

## 📦 JSON Payload

Standard JSON — every key becomes a Handlebars variable:

```json
{
  "callerName": "Sarah",
  "accountNumber": "4521",
  "balance": "247.50",
  "dueDate": "March 15th",
  "callbackNumber": "1-800-555-0199",
  "isOverdue": false,
  "isPremiumMember": true,
  "missedPayments": 0
}
```

Use in templates as `{{callerName}}`, `{{{speakCurrency balance}}}`, etc.

---

## 📖 SSML Support

When rendered output starts with `<speak>`, IVR Preview automatically sends it as SSML. The preview panel shows an **SSML** badge to confirm.

### Supported Tags — Neural Engine

| Tag | Purpose | Example |
|:---|:---|:---|
| `<break>` | Pause (up to 10s) | `<break time="500ms"/>` |
| `<say-as>` | Pronunciation control | `<say-as interpret-as="telephone">...` |
| `<sub>` | Spoken substitution | `<sub alias="World Wide Web">WWW</sub>` |
| `<phoneme>` | IPA / X-SAMPA pronunciation | `<phoneme alphabet="ipa" ph="pɪˈkɑːn">pecan</phoneme>` |
| `<prosody>` | Speech rate | `<prosody rate="slow">...</prosody>` |
| `<lang>` | Language switch | `<lang xml:lang="es-US">Hola</lang>` |
| `<p>` / `<s>` | Paragraph / sentence | `<s>First sentence.</s>` |
| `<w>` | Word role | `<w role="amazon:VB">read</w>` |
| `<mark>` | Position bookmark | `<mark name="section2"/>` |

> [!NOTE]
> Neural engine supports `<prosody rate>` only — **not** pitch or volume. Run **IVR Preview: SSML Reference** from the Command Palette for full interactive docs.

### `say-as` Interpret Types

| Type | Input | Spoken As |
|:---|:---|:---|
| `cardinal` | `1234` | "one thousand two hundred thirty-four" |
| `ordinal` | `3` | "third" |
| `digits` | `1234` | "one two three four" |
| `characters` | `ABC` | "A B C" |
| `telephone` | `1-800-555-0199` | natural phone number |
| `date` | `03/15/2025` | "March fifteenth, twenty twenty-five" |
| `time` | `1:30pm` | "one thirty PM" |
| `fraction` | `3/5` | "three fifths" |
| `unit` | `100mph` | "one hundred miles per hour" |
| `address` | `123 Main St` | spoken street address |

---

## 🎙️ Neural Voices

<table>
<tr>
<td>

**🇺🇸 English (US)**
| Voice | Gender |
|:---|:---:|
| Joanna | F |
| Ruth | F |
| Kendra | F |
| Kimberly | F |
| Salli | F |
| Ivy | F |
| Matthew | M |
| Stephen | M |
| Joey | M |
| Justin | M |
| Kevin | M |

</td>
<td>

**🇬🇧 English (UK)**
| Voice | Gender |
|:---|:---:|
| Amy | F |
| Emma | F |
| Brian | M |

<br/>

**🇺🇸 Spanish (US)**
| Voice | Gender |
|:---|:---:|
| Lupe | F |
| Pedro | M |

</td>
</tr>
</table>

> Switch voices anytime — click the status bar (`IVR: Matthew (neural)`) or run **IVR Preview: Change Voice** from the Command Palette.

---

## ⚙️ All Settings

| Setting | Default | Description |
|:---|:---:|:---|
| `ivrPreview.payloadFile` | `./ivr-payload.json` | Path to JSON payload (relative to workspace root) |
| `ivrPreview.helpersFile` | `""` | Path to Handlebars helpers JS file |
| `ivrPreview.aws.region` | `us-east-1` | AWS region |
| `ivrPreview.aws.voiceId` | `Joanna` | Polly voice ID |
| `ivrPreview.aws.engine` | `neural` | `neural` · `standard` · `long-form` · `generative` |
| `ivrPreview.aws.languageCode` | `en-US` | Language code (en-US, es-US, en-GB, etc.) |
| `ivrPreview.aws.accessKeyId` | `""` | AWS key (blank = credential chain) |
| `ivrPreview.aws.secretAccessKey` | `""` | AWS secret (blank = credential chain) |
| `ivrPreview.ssmlAutoDetect` | `true` | Detect SSML by `<speak>` tag |
| `ivrPreview.wrapInSpeakTags` | `false` | Auto-wrap output in `<speak>` |
| `ivrPreview.showRenderedScript` | `true` | Show rendered text in audio panel |

---

## 📋 Limits & Notes

- **3,000 character limit** per Polly request on neural voices. Use **Play Selection** to preview long scripts in sections.
- The preview panel reuses the same side panel — re-synthesizing updates it in place.
- AWS Polly charges apply per character. See [Amazon Polly Pricing](https://aws.amazon.com/polly/pricing/).

---

<div align="center">

**Built for IVR teams who are tired of deploying to hear their scripts.**

Made with ❤️ and Amazon Polly

</div>
