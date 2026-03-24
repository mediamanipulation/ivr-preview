import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import Handlebars from 'handlebars';
import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
  LanguageCode,
  OutputFormat,
  VoiceId,
  TextType,
} from '@aws-sdk/client-polly';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IvrConfig {
  payloadFile: string;
  helpersFile: string;
  region: string;
  voiceId: string;
  engine: string;
  languageCode: string;
  accessKeyId: string;
  secretAccessKey: string;
  ssmlAutoDetect: boolean;
  wrapInSpeakTags: boolean;
  showRenderedScript: boolean;
}

type PreviewMode = 'document' | 'selection';

// ─── Module-level panel cache (one panel at a time) ───────────────────────────

let previewPanel: vscode.WebviewPanel | undefined;
let statusBarItem: vscode.StatusBarItem;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  // Status bar: shows current voice, click to change
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'ivrPreview.pickVoice';
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Watch config changes to update status bar
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ivrPreview')) {
        updateStatusBar();
      }
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ivrPreview.previewDocument', () =>
      runPreview(context, 'document')
    ),
    vscode.commands.registerCommand('ivrPreview.previewSelection', () =>
      runPreview(context, 'selection')
    ),
    vscode.commands.registerCommand('ivrPreview.showRendered', () =>
      showRenderedOnly(context)
    ),
    vscode.commands.registerCommand('ivrPreview.pickVoice', () =>
      pickVoice()
    ),
    vscode.commands.registerCommand('ivrPreview.reloadPayload', () => {
      vscode.window.showInformationMessage('IVR Preview: Payload and helpers will be reloaded on next preview.');
    }),
    vscode.commands.registerCommand('ivrPreview.ssmlReference', () =>
      showSsmlReference(context)
    )
  );
}

export function deactivate() {
  previewPanel?.dispose();
}

// ─── Status Bar ──────────────────────────────────────────────────────────────

function updateStatusBar() {
  const cfg = getConfig();
  statusBarItem.text = `$(unmute) IVR: ${cfg.voiceId} (${cfg.engine})`;
  statusBarItem.tooltip = 'IVR Preview — Click to change voice';
}

// ─── Voice Picker ─────────────────────────────────────────────────────────────

const NEURAL_VOICES: vscode.QuickPickItem[] = [
  { label: 'Joanna', description: 'Neural · en-US · Female' },
  { label: 'Matthew', description: 'Neural · en-US · Male' },
  { label: 'Ruth', description: 'Neural · en-US · Female' },
  { label: 'Stephen', description: 'Neural · en-US · Male' },
  { label: 'Ivy', description: 'Neural · en-US · Female (child)' },
  { label: 'Kevin', description: 'Neural · en-US · Male (child)' },
  { label: 'Kendra', description: 'Neural · en-US · Female' },
  { label: 'Kimberly', description: 'Neural · en-US · Female' },
  { label: 'Salli', description: 'Neural · en-US · Female' },
  { label: 'Joey', description: 'Neural · en-US · Male' },
  { label: 'Justin', description: 'Neural · en-US · Male' },
  { label: 'Lupe', description: 'Neural · es-US · Female' },
  { label: 'Pedro', description: 'Neural · es-US · Male' },
  { label: 'Amy', description: 'Neural · en-GB · Female' },
  { label: 'Brian', description: 'Neural · en-GB · Male' },
  { label: 'Emma', description: 'Neural · en-GB · Female' },
];

async function pickVoice() {
  const cfg = getConfig();
  const pick = await vscode.window.showQuickPick(NEURAL_VOICES, {
    title: 'IVR Preview — Select Polly Voice',
    placeHolder: `Current: ${cfg.voiceId}`,
  });

  if (pick) {
    await vscode.workspace
      .getConfiguration('ivrPreview')
      .update('aws.voiceId', pick.label, vscode.ConfigurationTarget.Workspace);
    updateStatusBar();
    vscode.window.showInformationMessage(`IVR Preview: Voice set to ${pick.label}`);
  }
}

// ─── Config Helper ────────────────────────────────────────────────────────────

function getConfig(): IvrConfig {
  const c = vscode.workspace.getConfiguration('ivrPreview');
  return {
    payloadFile: c.get('payloadFile', './ivr-payload.json'),
    helpersFile: c.get('helpersFile', ''),
    region: c.get('aws.region', 'us-east-1'),
    voiceId: c.get('aws.voiceId', 'Joanna'),
    engine: c.get('aws.engine', 'neural'),
    languageCode: c.get('aws.languageCode', 'en-US'),
    accessKeyId: c.get('aws.accessKeyId', ''),
    secretAccessKey: c.get('aws.secretAccessKey', ''),
    ssmlAutoDetect: c.get('ssmlAutoDetect', true),
    wrapInSpeakTags: c.get('wrapInSpeakTags', false),
    showRenderedScript: c.get('showRenderedScript', true),
  };
}

// ─── Workspace Root ───────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// ─── Payload Loader ───────────────────────────────────────────────────────────

function loadPayload(cfg: IvrConfig, workspaceRoot: string): Record<string, unknown> {
  const payloadPath = path.resolve(workspaceRoot, cfg.payloadFile);
  try {
    const raw = fs.readFileSync(payloadPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    vscode.window.showWarningMessage(
      `IVR Preview: Could not load payload at ${payloadPath}. Using empty payload. (${(err as Error).message})`
    );
    return {};
  }
}

// ─── Helpers Loader ───────────────────────────────────────────────────────────

function loadHelpers(cfg: IvrConfig, workspaceRoot: string, hbs: typeof Handlebars): void {
  if (!cfg.helpersFile) return;

  const helpersPath = path.resolve(workspaceRoot, cfg.helpersFile);

  try {
    // Clear require cache so edits to helpers are picked up each time
    delete require.cache[require.resolve(helpersPath)];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const helpers = require(helpersPath);

    if (typeof helpers === 'function') {
      // Pattern A: module.exports = (Handlebars) => { Handlebars.registerHelper(...) }
      helpers(hbs);
    } else if (helpers && typeof helpers === 'object') {
      // Pattern B: module.exports = { helperName: fn, ... }
      for (const [name, fn] of Object.entries(helpers)) {
        if (typeof fn === 'function') {
          const original = fn as (...args: unknown[]) => unknown;
          hbs.registerHelper(name, function (this: unknown, ...args: unknown[]) {
            const result = original.apply(this, args);
            // Wrap string results in SafeString so SSML tags are not HTML-escaped
            if (typeof result === 'string') {
              return new hbs.SafeString(result);
            }
            return result;
          });
        }
      }
    } else {
      vscode.window.showWarningMessage(
        `IVR Preview: helpers file must export an object or function. Got: ${typeof helpers}`
      );
    }
  } catch (err) {
    vscode.window.showWarningMessage(
      `IVR Preview: Could not load helpers at ${helpersPath}. (${(err as Error).message})`
    );
  }
}

// ─── HBS Renderer ─────────────────────────────────────────────────────────────

function renderTemplate(
  rawText: string,
  payload: Record<string, unknown>,
  cfg: IvrConfig,
  workspaceRoot: string
): string | null {
  // Fresh Handlebars instance per render to avoid helper accumulation
  const hbs = Handlebars.create();
  loadHelpers(cfg, workspaceRoot, hbs);

  try {
    const template = hbs.compile(rawText);
    let rendered = template(payload);

    // Optionally wrap in SSML speak tags
    if (cfg.wrapInSpeakTags && !rendered.trim().startsWith('<speak>')) {
      rendered = `<speak>${rendered}</speak>`;
    }

    return rendered;
  } catch (err) {
    vscode.window.showErrorMessage(`IVR Preview: Handlebars render error — ${(err as Error).message}`);
    return null;
  }
}

// ─── Polly Synthesizer ────────────────────────────────────────────────────────

function normalizeSsml(ssml: string): string {
  // Polly supports SSML 1.0 tags. Convert paragraph tags to sentence tags.
  return ssml
    .replace(/<p>/gi, '<s>')
    .replace(/<\/p>/gi, '</s>')
    .replace(/<s>\s*<s>/gi, '<s>')
    .replace(/<\/s>\s*<\/s>/gi, '</s>');
}

async function synthesize(renderedText: string, cfg: IvrConfig): Promise<Buffer | null> {
  const pollyClientConfig: ConstructorParameters<typeof PollyClient>[0] = {
    region: cfg.region,
  };

  if (cfg.accessKeyId && cfg.secretAccessKey) {
    pollyClientConfig.credentials = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    };
  }

  const polly = new PollyClient(pollyClientConfig);

  // Detect SSML — strip BOM and whitespace
  const stripped = renderedText.replace(/^\uFEFF/, '').trim();
  const isSSML = cfg.ssmlAutoDetect && /^<speak[\s>]/i.test(stripped);
  const textToSend = isSSML ? normalizeSsml(stripped) : renderedText;

  console.log(`[IVR Preview] SSML detected: ${isSSML}, starts with: ${JSON.stringify(stripped.substring(0, 20))}`);
  console.log(`[IVR Preview] Full SSML text:\n${isSSML ? textToSend : renderedText}`);

  const command = new SynthesizeSpeechCommand({
    Text: textToSend,
    TextType: (isSSML ? 'ssml' : 'text') as TextType,
    VoiceId: cfg.voiceId as VoiceId,
    Engine: cfg.engine as Engine,
    OutputFormat: 'mp3' as OutputFormat,
    LanguageCode: cfg.languageCode as LanguageCode,
  });

  try {
    const response = await polly.send(command);

    if (!response.AudioStream) {
      throw new Error('Polly returned no audio stream.');
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.AudioStream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    const msg = (err as Error).message;
    const awsErr = err as Record<string, unknown>;
    console.error(`[IVR Preview] Polly error:`, JSON.stringify({
      message: msg,
      name: awsErr.name,
      Code: awsErr.Code,
      $metadata: awsErr.$metadata,
    }, null, 2));
    console.error(`[IVR Preview] Text sent (${textToSend.length} chars):\n${textToSend}`);

    if (msg.includes('credential') || msg.includes('security token') || msg.includes('Access')) {
      vscode.window.showErrorMessage(
        `IVR Preview: AWS credentials error. Set ivrPreview.aws.accessKeyId / secretAccessKey in settings, or configure your AWS CLI profile. (${msg})`
      );
    } else if (msg.includes('TextLengthExceededException')) {
      vscode.window.showErrorMessage(
        'IVR Preview: Text too long for a single Polly request (max 3000 chars for standard, 100k SSML bytes). Try selecting a smaller section.'
      );
    } else {
      vscode.window.showErrorMessage(`IVR Preview: Polly synthesis failed — ${msg}`);
    }
    return null;
  }
}

// ─── Show Rendered Only (no audio) ───────────────────────────────────────────

async function showRenderedOnly(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('IVR Preview: No active editor.');
    return;
  }

  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('IVR Preview: No workspace folder open.');
    return;
  }

  const cfg = getConfig();
  const rawText = editor.document.getText();
  const payload = loadPayload(cfg, workspaceRoot);
  const rendered = renderTemplate(rawText, payload, cfg, workspaceRoot);
  if (!rendered) return;

  openOrReusePanel(context, null, rendered, cfg);
}

// ─── Main Preview Runner ──────────────────────────────────────────────────────

async function runPreview(context: vscode.ExtensionContext, mode: PreviewMode) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('IVR Preview: No active editor.');
    return;
  }

  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('IVR Preview: No workspace folder open.');
    return;
  }

  // Get raw text
  let rawText: string;
  if (mode === 'selection') {
    const sel = editor.selection;
    if (sel.isEmpty) {
      vscode.window.showWarningMessage('IVR Preview: Nothing selected. Highlight text to preview a section.');
      return;
    }
    rawText = editor.document.getText(sel);
  } else {
    rawText = editor.document.getText();
  }

  const cfg = getConfig();

  // Render HBS
  const payload = loadPayload(cfg, workspaceRoot);
  const rendered = renderTemplate(rawText, payload, cfg, workspaceRoot);
  if (!rendered) return;

  // Synthesize
  let audioBuffer: Buffer | null = null as Buffer | null;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `IVR Preview: Synthesizing with Polly (${cfg.voiceId}, ${cfg.engine})…`,
      cancellable: false,
    },
    async () => {
      audioBuffer = await synthesize(rendered, cfg);
    }
  );

  if (!audioBuffer) return;

  const base64 = audioBuffer.toString('base64');
  openOrReusePanel(context, base64, rendered, cfg, mode);
}

// ─── Webview Panel ────────────────────────────────────────────────────────────

function openOrReusePanel(
  context: vscode.ExtensionContext,
  base64Audio: string | null,
  renderedText: string,
  cfg: IvrConfig,
  mode?: PreviewMode
) {
  if (previewPanel) {
    previewPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    previewPanel = vscode.window.createWebviewPanel(
      'ivrPreview',
      '🔊 IVR Preview',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    previewPanel.onDidDispose(() => {
      previewPanel = undefined;
    }, null, context.subscriptions);
  }

  previewPanel.webview.html = buildWebviewHtml(base64Audio, renderedText, cfg, mode);
}

// ─── Webview HTML ─────────────────────────────────────────────────────────────

function buildWebviewHtml(
  base64Audio: string | null,
  renderedText: string,
  cfg: IvrConfig,
  mode?: PreviewMode
): string {
  const isSSML = cfg.ssmlAutoDetect && renderedText.trim().startsWith('<speak>');
  const modeLabel = mode === 'selection' ? 'Selection' : mode === 'document' ? 'Full Document' : 'Rendered';
  const charCount = renderedText.length;
  const wordCount = renderedText.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;

  // Escape for safe HTML display
  const safeText = escapeHtml(renderedText);

  const audioSection = base64Audio
    ? `
    <div class="section-label">Playback</div>
    <div class="audio-wrap">
      <audio id="player" controls autoplay>
        <source src="data:audio/mpeg;base64,${base64Audio}" type="audio/mpeg" />
        Your browser does not support audio playback.
      </audio>
    </div>
    <div class="controls">
      <button onclick="document.getElementById('player').currentTime=0; document.getElementById('player').play()">⏮ Restart</button>
      <button onclick="adjustRate(-0.25)">🐢 Slower</button>
      <button onclick="adjustRate(0.25)">🐇 Faster</button>
      <span id="rate-display" class="rate-badge">1.0×</span>
    </div>`
    : `<div class="no-audio">📄 Rendered script only — no audio synthesized.</div>`;

  const scriptSection = cfg.showRenderedScript
    ? `
    <div class="section-label">
      Rendered Script
      <span class="copy-btn" onclick="copyScript()">📋 Copy</span>
    </div>
    <div class="transcript ${isSSML ? 'ssml' : ''}" id="script">${safeText}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IVR Preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
      line-height: 1.5;
    }

    .card {
      max-width: 680px;
      margin: 0 auto;
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 10px;
      overflow: hidden;
    }

    .card-header {
      background: var(--vscode-titleBar-activeBackground, #2d2d2d);
      padding: 14px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .card-header h2 {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-titleBar-activeForeground, #fff);
    }

    .badge-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--vscode-badge-background, #444);
      color: var(--vscode-badge-foreground, #ccc);
    }

    .badge.ssml { background: #4a3f1a; color: #f0c060; }
    .badge.neural { background: #1a3a4a; color: #60c0f0; }
    .badge.mode { background: #1a4a2a; color: #60d080; }

    .card-body {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .audio-wrap audio {
      width: 100%;
      accent-color: var(--vscode-textLink-foreground, #4ec9b0);
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .controls button {
      font-size: 12px;
      padding: 4px 10px;
      border: 1px solid var(--vscode-button-border, #555);
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground, #3a3a3a);
      color: var(--vscode-button-secondaryForeground, #ccc);
      cursor: pointer;
    }

    .controls button:hover {
      background: var(--vscode-button-secondaryHoverBackground, #4a4a4a);
    }

    .rate-badge {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-textLink-foreground, #4ec9b0);
    }

    .transcript {
      background: var(--vscode-input-background, #1e1e1e);
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 6px;
      padding: 14px;
      font-size: 13px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 360px;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    }

    .transcript.ssml {
      border-left: 3px solid #f0c060;
    }

    .meta-row {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
    }

    .meta-row span strong {
      color: var(--vscode-foreground);
    }

    .no-audio {
      text-align: center;
      color: var(--vscode-descriptionForeground, #888);
      padding: 12px;
      font-style: italic;
    }

    .copy-btn {
      cursor: pointer;
      font-size: 11px;
      color: var(--vscode-textLink-foreground, #4ec9b0);
      text-transform: none;
      letter-spacing: 0;
      font-weight: normal;
    }

    .copy-btn:hover { text-decoration: underline; }

    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--vscode-notificationCenterHeader-background, #2d2d2d);
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-panel-border, #444);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }

    .toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <h2>🔊 IVR Preview</h2>
      <div class="badge-row">
        <span class="badge mode">${modeLabel}</span>
        <span class="badge ${cfg.engine === 'neural' ? 'neural' : ''}">${cfg.voiceId}</span>
        <span class="badge">${cfg.engine}</span>
        ${isSSML ? '<span class="badge ssml">SSML</span>' : ''}
      </div>
    </div>

    <div class="card-body">
      <div class="meta-row">
        <span><strong>${charCount.toLocaleString()}</strong> chars</span>
        <span><strong>${wordCount.toLocaleString()}</strong> words</span>
        <span>Lang: <strong>${cfg.languageCode}</strong></span>
        ${base64Audio ? '<span>✅ Synthesized</span>' : '<span>📄 Script only</span>'}
      </div>

      ${audioSection}
      ${scriptSection}
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    function adjustRate(delta) {
      const audio = document.getElementById('player');
      if (!audio) return;
      audio.playbackRate = Math.min(2.0, Math.max(0.25, audio.playbackRate + delta));
      document.getElementById('rate-display').textContent = audio.playbackRate.toFixed(2) + '×';
    }

    function copyScript() {
      const text = document.getElementById('script')?.innerText || '';
      navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 1800);
    }
  </script>
</body>
</html>`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// ─── SSML Reference Panel ────────────────────────────────────────────────────

let ssmlPanel: vscode.WebviewPanel | undefined;

function showSsmlReference(context: vscode.ExtensionContext) {
  if (ssmlPanel) {
    ssmlPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  ssmlPanel = vscode.window.createWebviewPanel(
    'ivrSsmlReference',
    '📖 SSML Reference — Polly Neural',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  ssmlPanel.onDidDispose(() => { ssmlPanel = undefined; });
  ssmlPanel.webview.html = buildSsmlReferenceHtml();
}

function buildSsmlReferenceHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>SSML Reference</title>
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --accent: var(--vscode-textLink-foreground, #3794ff);
    --card-bg: var(--vscode-editorWidget-background, #252526);
    --border: var(--vscode-widget-border, #454545);
    --tag: #569cd6;
    --attr: #9cdcfe;
    --val: #ce9178;
    --comment: #6a9955;
    --badge-bg: var(--vscode-badge-background, #4d4d4d);
    --badge-fg: var(--vscode-badge-foreground, #fff);
    --warn-bg: #4e3a1a;
    --warn-border: #a68a3e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, system-ui); background: var(--bg); color: var(--fg); padding: 24px; line-height: 1.6; }

  h1 { font-size: 1.6em; margin-bottom: 4px; color: var(--accent); }
  h1 span { font-size: 0.5em; color: var(--fg); opacity: 0.6; display: block; font-weight: normal; }
  h2 { font-size: 1.2em; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); color: var(--accent); }
  h3 { font-size: 1em; margin: 16px 0 8px; }

  .section { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin: 12px 0; }
  .section h3 { margin-top: 0; }

  .tag-name { color: var(--tag); font-family: monospace; font-size: 1.05em; font-weight: bold; }
  .description { margin: 6px 0 10px; opacity: 0.85; }

  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 0.9em; }
  th, td { text-align: left; padding: 6px 10px; border: 1px solid var(--border); }
  th { background: rgba(255,255,255,0.05); font-weight: 600; }
  td code { color: var(--val); }

  pre { background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; margin: 8px 0; overflow-x: auto; font-size: 0.85em; line-height: 1.5; position: relative; }
  pre .copy-btn { position: absolute; top: 6px; right: 6px; background: var(--badge-bg); color: var(--badge-fg); border: none; border-radius: 4px; padding: 2px 8px; font-size: 0.8em; cursor: pointer; opacity: 0; transition: opacity 0.2s; }
  pre:hover .copy-btn { opacity: 1; }
  .xml-tag { color: var(--tag); }
  .xml-attr { color: var(--attr); }
  .xml-val { color: var(--val); }
  .xml-comment { color: var(--comment); font-style: italic; }
  .xml-text { color: var(--fg); }

  .badge { display: inline-block; background: var(--badge-bg); color: var(--badge-fg); padding: 2px 8px; border-radius: 10px; font-size: 0.8em; margin: 2px 2px; }
  .badge.warn { background: var(--warn-bg); border: 1px solid var(--warn-border); color: #e8c86a; }

  .warn-box { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 8px; padding: 14px 18px; margin: 16px 0; }
  .warn-box h3 { color: #e8c86a; margin: 0 0 8px; }
  .warn-box ul { padding-left: 20px; }
  .warn-box li { margin: 4px 0; opacity: 0.9; }

  .tips { background: rgba(55,148,255,0.08); border: 1px solid var(--accent); border-radius: 8px; padding: 14px 18px; margin: 20px 0; }
  .tips h3 { color: var(--accent); margin: 0 0 8px; }
  .tips ol { padding-left: 20px; }
  .tips li { margin: 6px 0; }

  .toc { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 20px; }
  .toc a { color: var(--badge-fg); background: var(--badge-bg); padding: 4px 12px; border-radius: 14px; text-decoration: none; font-size: 0.85em; transition: background 0.2s; }
  .toc a:hover { background: var(--accent); color: #fff; }

  #toast { position: fixed; bottom: 20px; right: 20px; background: var(--accent); color: #fff; padding: 8px 18px; border-radius: 6px; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
  #toast.show { opacity: 1; }

  .try-it { margin-top: 8px; }
  .try-it button { background: var(--accent); color: #fff; border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 0.85em; }
  .try-it button:hover { opacity: 0.85; }
</style>
</head>
<body>
  <h1>📖 SSML Reference <span>Amazon Polly Neural Engine — for IVR Preview</span></h1>

  <div class="toc">
    <a href="#speak">&lt;speak&gt;</a>
    <a href="#break">&lt;break&gt;</a>
    <a href="#p">&lt;p&gt;</a>
    <a href="#s">&lt;s&gt;</a>
    <a href="#say-as">&lt;say-as&gt;</a>
    <a href="#phoneme">&lt;phoneme&gt;</a>
    <a href="#sub">&lt;sub&gt;</a>
    <a href="#w">&lt;w&gt;</a>
    <a href="#prosody">&lt;prosody&gt;</a>
    <a href="#lang">&lt;lang&gt;</a>
    <a href="#mark">&lt;mark&gt;</a>
    <a href="#unsupported">Not Supported</a>
    <a href="#tips">IVR Tips</a>
  </div>

  <!-- ═══════════════ SPEAK ═══════════════ -->
  <h2 id="speak">Root Tag</h2>
  <div class="section">
    <h3><span class="tag-name">&lt;speak&gt;</span></h3>
    <p class="description"><strong>Required.</strong> Every SSML document must be wrapped in <code>&lt;speak&gt;</code> tags.</p>
    <pre><code><span class="xml-tag">&lt;speak&gt;</span>
  <span class="xml-text">Hello, welcome to our service.</span>
<span class="xml-tag">&lt;/speak&gt;</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ BREAK ═══════════════ -->
  <h2 id="break">Pauses &amp; Structure</h2>
  <div class="section">
    <h3><span class="tag-name">&lt;break&gt;</span> <span class="badge">Pause</span></h3>
    <p class="description">Insert a pause in speech. Use <code>time</code> or <code>strength</code>.</p>
    <table>
      <tr><th>Attribute</th><th>Values</th></tr>
      <tr><td><code>time</code></td><td><code>100ms</code>, <code>500ms</code>, <code>1s</code>, <code>2s</code> (max 10s)</td></tr>
      <tr><td><code>strength</code></td><td><code>none</code>, <code>x-weak</code>, <code>weak</code>, <code>medium</code>, <code>strong</code>, <code>x-strong</code></td></tr>
    </table>
    <pre><code><span class="xml-text">Please hold.</span> <span class="xml-tag">&lt;break</span> <span class="xml-attr">time</span>=<span class="xml-val">"500ms"</span><span class="xml-tag">/&gt;</span> <span class="xml-text">We are connecting you now.</span>
<span class="xml-text">Your balance is due.</span> <span class="xml-tag">&lt;break</span> <span class="xml-attr">strength</span>=<span class="xml-val">"strong"</span><span class="xml-tag">/&gt;</span> <span class="xml-text">Please pay promptly.</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ P ═══════════════ -->
  <div class="section" id="p">
    <h3><span class="tag-name">&lt;p&gt;</span> <span class="badge">Paragraph</span></h3>
    <p class="description">Groups text into a paragraph with a natural pause before and after.</p>
    <pre><code><span class="xml-tag">&lt;p&gt;</span><span class="xml-text">Welcome to our automated payment system.</span><span class="xml-tag">&lt;/p&gt;</span>
<span class="xml-tag">&lt;p&gt;</span><span class="xml-text">Please have your account number ready.</span><span class="xml-tag">&lt;/p&gt;</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ S ═══════════════ -->
  <div class="section" id="s">
    <h3><span class="tag-name">&lt;s&gt;</span> <span class="badge">Sentence</span></h3>
    <p class="description">Adds a natural sentence-level pause.</p>
    <pre><code><span class="xml-tag">&lt;s&gt;</span><span class="xml-text">Your appointment is confirmed.</span><span class="xml-tag">&lt;/s&gt;</span>
<span class="xml-tag">&lt;s&gt;</span><span class="xml-text">We look forward to seeing you.</span><span class="xml-tag">&lt;/s&gt;</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ SAY-AS ═══════════════ -->
  <h2 id="say-as">Pronunciation &amp; Interpretation</h2>
  <div class="section">
    <h3><span class="tag-name">&lt;say-as&gt;</span> <span class="badge">Most Versatile</span></h3>
    <p class="description">Controls how text is spoken. The most important tag for IVR scripting.</p>
    <table>
      <tr><th><code>interpret-as</code></th><th>Input</th><th>Spoken As</th></tr>
      <tr><td><code>characters</code> / <code>spell-out</code></td><td>ABC</td><td>"A B C"</td></tr>
      <tr><td><code>cardinal</code> / <code>number</code></td><td>1234</td><td>"one thousand two hundred thirty-four"</td></tr>
      <tr><td><code>ordinal</code></td><td>1</td><td>"first"</td></tr>
      <tr><td><code>digits</code></td><td>1234</td><td>"one two three four"</td></tr>
      <tr><td><code>fraction</code></td><td>3/5</td><td>"three fifths"</td></tr>
      <tr><td><code>unit</code></td><td>100mph</td><td>"one hundred miles per hour"</td></tr>
      <tr><td><code>date</code></td><td>03/15/2025</td><td>"March fifteenth, twenty twenty-five"</td></tr>
      <tr><td><code>time</code></td><td>1:30pm</td><td>"one thirty PM"</td></tr>
      <tr><td><code>telephone</code></td><td>1-800-555-0199</td><td>spoken phone number</td></tr>
      <tr><td><code>address</code></td><td>123 Main St</td><td>spoken street address</td></tr>
      <tr><td><code>currency</code></td><td>$42.50</td><td>"forty-two dollars and fifty cents"</td></tr>
    </table>
    <pre><code><span class="xml-comment">&lt;!-- Account number digit by digit --&gt;</span>
<span class="xml-text">Your account: </span><span class="xml-tag">&lt;say-as</span> <span class="xml-attr">interpret-as</span>=<span class="xml-val">"digits"</span><span class="xml-tag">&gt;</span><span class="xml-text">4521</span><span class="xml-tag">&lt;/say-as&gt;</span>

<span class="xml-comment">&lt;!-- Currency --&gt;</span>
<span class="xml-text">Balance: </span><span class="xml-tag">&lt;say-as</span> <span class="xml-attr">interpret-as</span>=<span class="xml-val">"currency"</span> <span class="xml-attr">language</span>=<span class="xml-val">"en-US"</span><span class="xml-tag">&gt;</span><span class="xml-text">$247.50</span><span class="xml-tag">&lt;/say-as&gt;</span>

<span class="xml-comment">&lt;!-- Phone number --&gt;</span>
<span class="xml-text">Call us: </span><span class="xml-tag">&lt;say-as</span> <span class="xml-attr">interpret-as</span>=<span class="xml-val">"telephone"</span><span class="xml-tag">&gt;</span><span class="xml-text">1-800-555-0199</span><span class="xml-tag">&lt;/say-as&gt;</span>

<span class="xml-comment">&lt;!-- Date --&gt;</span>
<span class="xml-text">Due on: </span><span class="xml-tag">&lt;say-as</span> <span class="xml-attr">interpret-as</span>=<span class="xml-val">"date"</span> <span class="xml-attr">format</span>=<span class="xml-val">"mdy"</span><span class="xml-tag">&gt;</span><span class="xml-text">03/15/2025</span><span class="xml-tag">&lt;/say-as&gt;</span>

<span class="xml-comment">&lt;!-- Ordinal --&gt;</span>
<span class="xml-text">You are caller </span><span class="xml-tag">&lt;say-as</span> <span class="xml-attr">interpret-as</span>=<span class="xml-val">"ordinal"</span><span class="xml-tag">&gt;</span><span class="xml-text">3</span><span class="xml-tag">&lt;/say-as&gt;</span><span class="xml-text"> in the queue.</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
    <p class="description" style="margin-top:10px"><strong>Date format options:</strong> <code>mdy</code>, <code>dmy</code>, <code>ymd</code>, <code>md</code>, <code>dm</code>, <code>ym</code>, <code>my</code>, <code>d</code>, <code>m</code>, <code>y</code></p>
  </div>

  <!-- ═══════════════ PHONEME ═══════════════ -->
  <div class="section" id="phoneme">
    <h3><span class="tag-name">&lt;phoneme&gt;</span> <span class="badge">Custom Pronunciation</span></h3>
    <p class="description">Override pronunciation using IPA or X-SAMPA phonetic alphabet.</p>
    <table>
      <tr><th>Attribute</th><th>Values</th></tr>
      <tr><td><code>alphabet</code></td><td><code>ipa</code>, <code>x-sampa</code></td></tr>
      <tr><td><code>ph</code></td><td>Phonetic transcription</td></tr>
    </table>
    <pre><code><span class="xml-text">Thank you for choosing </span><span class="xml-tag">&lt;phoneme</span> <span class="xml-attr">alphabet</span>=<span class="xml-val">"ipa"</span> <span class="xml-attr">ph</span>=<span class="xml-val">"pɪˈkɑːn"</span><span class="xml-tag">&gt;</span><span class="xml-text">pecan</span><span class="xml-tag">&lt;/phoneme&gt;</span><span class="xml-text"> insurance.</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ SUB ═══════════════ -->
  <div class="section" id="sub">
    <h3><span class="tag-name">&lt;sub&gt;</span> <span class="badge">Substitution</span></h3>
    <p class="description">Substitute spoken text for an abbreviation or symbol.</p>
    <pre><code><span class="xml-text">Please visit </span><span class="xml-tag">&lt;sub</span> <span class="xml-attr">alias</span>=<span class="xml-val">"World Wide Web Consortium"</span><span class="xml-tag">&gt;</span><span class="xml-text">W3C</span><span class="xml-tag">&lt;/sub&gt;</span><span class="xml-text"> for details.</span>
<span class="xml-text">Account type: </span><span class="xml-tag">&lt;sub</span> <span class="xml-attr">alias</span>=<span class="xml-val">"premium plus"</span><span class="xml-tag">&gt;</span><span class="xml-text">PP</span><span class="xml-tag">&lt;/sub&gt;</span><span class="xml-text">.</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ W ═══════════════ -->
  <div class="section" id="w">
    <h3><span class="tag-name">&lt;w&gt;</span> <span class="badge">Word Role</span></h3>
    <p class="description">Specify word role to disambiguate pronunciation of homographs.</p>
    <table>
      <tr><th><code>role</code></th><th>Meaning</th><th>Example</th></tr>
      <tr><td><code>amazon:VB</code></td><td>Verb</td><td>I will <strong>read</strong> it</td></tr>
      <tr><td><code>amazon:VBD</code></td><td>Past tense</td><td>I <strong>read</strong> it yesterday</td></tr>
      <tr><td><code>amazon:NN</code></td><td>Noun</td><td>the <strong>record</strong></td></tr>
      <tr><td><code>amazon:DT</code></td><td>Default</td><td>—</td></tr>
    </table>
    <pre><code><span class="xml-text">Please </span><span class="xml-tag">&lt;w</span> <span class="xml-attr">role</span>=<span class="xml-val">"amazon:VB"</span><span class="xml-tag">&gt;</span><span class="xml-text">read</span><span class="xml-tag">&lt;/w&gt;</span><span class="xml-text"> the following terms.</span>
<span class="xml-text">We have updated your </span><span class="xml-tag">&lt;w</span> <span class="xml-attr">role</span>=<span class="xml-val">"amazon:NN"</span><span class="xml-tag">&gt;</span><span class="xml-text">record</span><span class="xml-tag">&lt;/w&gt;</span><span class="xml-text">.</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ PROSODY ═══════════════ -->
  <h2 id="prosody">Prosody (Rate)</h2>
  <div class="section">
    <h3><span class="tag-name">&lt;prosody&gt;</span> <span class="badge">Rate Only</span> <span class="badge warn">Neural: rate only</span></h3>
    <p class="description">Control speech rate. <strong>Neural engine only supports <code>rate</code></strong> — <code>pitch</code> and <code>volume</code> are not supported.</p>
    <table>
      <tr><th>Attribute</th><th>Values</th></tr>
      <tr><td><code>rate</code></td><td><code>x-slow</code>, <code>slow</code>, <code>medium</code>, <code>fast</code>, <code>x-fast</code>, or percentage (<code>75%</code>, <code>150%</code>)</td></tr>
    </table>
    <pre><code><span class="xml-tag">&lt;prosody</span> <span class="xml-attr">rate</span>=<span class="xml-val">"slow"</span><span class="xml-tag">&gt;</span>
  <span class="xml-text">This is an important message regarding your account.</span>
<span class="xml-tag">&lt;/prosody&gt;</span>

<span class="xml-tag">&lt;prosody</span> <span class="xml-attr">rate</span>=<span class="xml-val">"110%"</span><span class="xml-tag">&gt;</span>
  <span class="xml-text">Terms and conditions apply. See website for details.</span>
<span class="xml-tag">&lt;/prosody&gt;</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ LANG ═══════════════ -->
  <h2 id="lang">Language</h2>
  <div class="section">
    <h3><span class="tag-name">&lt;lang&gt;</span> <span class="badge">Multilingual</span></h3>
    <p class="description">Switch language mid-speech for multilingual IVR flows.</p>
    <pre><code><span class="xml-text">Thank you for calling.</span>
<span class="xml-tag">&lt;lang</span> <span class="xml-attr">xml:lang</span>=<span class="xml-val">"es-US"</span><span class="xml-tag">&gt;</span><span class="xml-text">Para español, oprima el dos.</span><span class="xml-tag">&lt;/lang&gt;</span>
<span class="xml-tag">&lt;lang</span> <span class="xml-attr">xml:lang</span>=<span class="xml-val">"fr-FR"</span><span class="xml-tag">&gt;</span><span class="xml-text">Pour le français, appuyez sur le trois.</span><span class="xml-tag">&lt;/lang&gt;</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ MARK ═══════════════ -->
  <h2 id="mark">Markers</h2>
  <div class="section">
    <h3><span class="tag-name">&lt;mark&gt;</span> <span class="badge">Bookmark</span></h3>
    <p class="description">Insert a named bookmark — useful for tracking position in the audio stream via Polly's speech marks output.</p>
    <pre><code><span class="xml-tag">&lt;mark</span> <span class="xml-attr">name</span>=<span class="xml-val">"greeting"</span><span class="xml-tag">/&gt;</span>
<span class="xml-text">Hello, welcome to our service.</span>
<span class="xml-tag">&lt;mark</span> <span class="xml-attr">name</span>=<span class="xml-val">"account_info"</span><span class="xml-tag">/&gt;</span>
<span class="xml-text">Your account balance is due.</span></code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
  </div>

  <!-- ═══════════════ NOT SUPPORTED ═══════════════ -->
  <div class="warn-box" id="unsupported">
    <h3>⚠️ Not Supported on Neural Engine</h3>
    <p>These tags only work with the <strong>standard</strong> engine:</p>
    <ul>
      <li><code>&lt;prosody pitch="..."&gt;</code> — Raise/lower pitch</li>
      <li><code>&lt;prosody volume="..."&gt;</code> — Change volume</li>
      <li><code>&lt;emphasis&gt;</code> — Emphasize words</li>
      <li><code>&lt;amazon:effect name="whispered"&gt;</code> — Whispered speech</li>
      <li><code>&lt;amazon:effect name="drc"&gt;</code> — Dynamic range compression</li>
      <li><code>&lt;amazon:auto-breaths&gt;</code> — Natural breathing sounds</li>
    </ul>
  </div>

  <!-- ═══════════════ TIPS ═══════════════ -->
  <div class="tips" id="tips">
    <h3>💡 IVR Scripting Tips</h3>
    <ol>
      <li><strong>Use <code>&lt;break&gt;</code> after questions</strong> — give the caller time to process before pressing a key</li>
      <li><strong>Spell account numbers</strong> — use <code>&lt;say-as interpret-as="digits"&gt;</code> so "4521" becomes "four five two one"</li>
      <li><strong>Speak currency properly</strong> — use <code>&lt;say-as interpret-as="currency"&gt;</code> for natural dollar amounts</li>
      <li><strong>Slow down important info</strong> — wrap key details in <code>&lt;prosody rate="slow"&gt;</code></li>
      <li><strong>Keep pauses under 3s</strong> — longer pauses can make callers think the line dropped</li>
      <li><strong>Test with different voices</strong> — pronunciation varies between neural voices</li>
    </ol>
  </div>

  <div id="toast"></div>

  <script>
    function copyCode(btn) {
      const pre = btn.closest('pre');
      const code = pre.querySelector('code');
      const text = code.innerText;
      navigator.clipboard.writeText(text).then(() => {
        const toast = document.getElementById('toast');
        toast.textContent = 'Copied!';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1500);
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
