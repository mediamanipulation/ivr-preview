# SSML Reference — Amazon Polly Neural Engine

A complete guide to all SSML (Speech Synthesis Markup Language) tags supported by Amazon Polly's **neural** engine, tailored for IVR and autocall scripting.

---

## Root Tag

### `<speak>`
**Required.** Every SSML document must be wrapped in `<speak>` tags.

```xml
<speak>
  Hello, welcome to our service.
</speak>
```

---

## Pauses & Structure

### `<break>`
Insert a pause in speech. Use `time` (milliseconds/seconds) or `strength` (named).

| Attribute | Values |
|-----------|--------|
| `time` | `100ms`, `500ms`, `1s`, `2s` (max 10s) |
| `strength` | `none`, `x-weak`, `weak`, `medium`, `strong`, `x-strong` |

```xml
Please hold. <break time="500ms"/> We are connecting you now.
Your balance is due. <break strength="strong"/> Please pay promptly.
```

### `<p>` — Paragraph
Groups text into a paragraph with a natural pause before and after.

```xml
<p>Welcome to our automated payment system.</p>
<p>Please have your account number ready.</p>
```

### `<s>` — Sentence
Adds a natural sentence-level pause.

```xml
<s>Your appointment is confirmed.</s>
<s>We look forward to seeing you.</s>
```

---

## Pronunciation & Interpretation

### `<say-as>`
Controls how text is spoken. The most versatile tag for IVR scripting.

| `interpret-as` | Input | Spoken As |
|----------------|-------|-----------|
| `characters` / `spell-out` | `ABC` | "A B C" |
| `cardinal` / `number` | `1234` | "one thousand two hundred thirty-four" |
| `ordinal` | `1` | "first" |
| `digits` | `1234` | "one two three four" |
| `fraction` | `3/5` | "three fifths" |
| `unit` | `100mph` | "one hundred miles per hour" |
| `date` | `03/15/2025` | "March fifteenth, twenty twenty-five" |
| `time` | `1:30pm` | "one thirty PM" |
| `telephone` | `1-800-555-0199` | spoken phone number |
| `address` | `123 Main St` | spoken street address |
| `currency` | `$42.50` | "forty-two dollars and fifty cents" |

```xml
Your account number is <say-as interpret-as="digits">4521</say-as>.
Your balance is <say-as interpret-as="currency" language="en-US">$247.50</say-as>.
Please call <say-as interpret-as="telephone">1-800-555-0199</say-as>.
Your appointment is on <say-as interpret-as="date" format="mdy">03/15/2025</say-as>.
You are caller number <say-as interpret-as="ordinal">3</say-as> in the queue.
```

**Date format options:** `mdy`, `dmy`, `ymd`, `md`, `dm`, `ym`, `my`, `d`, `m`, `y`

### `<phoneme>`
Override pronunciation using IPA or X-SAMPA phonetic alphabet.

| Attribute | Values |
|-----------|--------|
| `alphabet` | `ipa`, `x-sampa` |
| `ph` | Phonetic transcription |

```xml
Thank you for choosing <phoneme alphabet="ipa" ph="pɪˈkɑːn">pecan</phoneme> insurance.
```

### `<sub>`
Substitute spoken text for an abbreviation or symbol.

```xml
Please visit <sub alias="World Wide Web Consortium">W3C</sub> for details.
Account type: <sub alias="premium plus">PP</sub>.
```

### `<w>`
Specify word role to disambiguate pronunciation.

| `role` | Meaning |
|--------|---------|
| `amazon:VB` | Verb — "I will **read** it" |
| `amazon:VBD` | Past tense — "I **read** it yesterday" |
| `amazon:NN` | Noun — "the **record**" |
| `amazon:DT` | Default |

```xml
Please <w role="amazon:VB">read</w> the following terms.
We have updated your <w role="amazon:NN">record</w>.
```

---

## Prosody (Rate)

### `<prosody>`
Control speech rate. **Neural engine only supports `rate`** — `pitch` and `volume` are not supported.

| Attribute | Values |
|-----------|--------|
| `rate` | `x-slow`, `slow`, `medium`, `fast`, `x-fast`, or percentage (`75%`, `150%`) |

```xml
<prosody rate="slow">
  This is an important message regarding your account.
</prosody>

<prosody rate="medium">
  Thank you for calling. Goodbye.
</prosody>

<prosody rate="110%">
  Terms and conditions apply. See website for details.
</prosody>
```

---

## Language

### `<lang>`
Switch language mid-speech for multilingual IVR flows.

```xml
Thank you for calling.
<lang xml:lang="es-US">Para español, oprima el dos.</lang>
<lang xml:lang="fr-FR">Pour le français, appuyez sur le trois.</lang>
```

---

## Markers

### `<mark>`
Insert a named bookmark — useful for tracking position in the audio stream via Polly's speech marks output.

```xml
<mark name="greeting"/>
Hello, welcome to our service.
<mark name="account_info"/>
Your account balance is due.
```

---

## Not Supported on Neural Engine

The following tags work only with the **standard** engine:

| Tag | Purpose |
|-----|---------|
| `<prosody pitch="...">` | Raise/lower pitch |
| `<prosody volume="...">` | Change volume |
| `<emphasis>` | Emphasize words |
| `<amazon:effect name="whispered">` | Whispered speech |
| `<amazon:effect name="drc">` | Dynamic range compression |
| `<amazon:auto-breaths>` | Natural breathing sounds |

---

## IVR Scripting Tips

1. **Use `<break>` after questions** — give the caller time to process before pressing a key
2. **Spell account numbers** — use `<say-as interpret-as="digits">` so "4521" becomes "four five two one"
3. **Speak currency properly** — use `<say-as interpret-as="currency">` for natural dollar amounts
4. **Slow down important info** — wrap key details in `<prosody rate="slow">`
5. **Keep pauses under 3s** — longer pauses can make callers think the line dropped
6. **Test with different voices** — pronunciation varies between neural voices
