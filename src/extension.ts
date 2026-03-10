import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import Handlebars from 'handlebars';
import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
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
    })
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
  const current = NEURAL_VOICES.find((v) => v.label === cfg.voiceId);

  const pick = await vscode.window.showQuickPick(NEURAL_VOICES, {
    title: 'IVR Preview — Select Polly Voice',
    placeHolder: `Current: ${cfg.voiceId}`,
    activeItems: current ? [current] : [],
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
          hbs.registerHelper(name, fn as Handlebars.HelperDelegate);
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

  // Detect SSML
  const isSSML = cfg.ssmlAutoDetect && renderedText.trim().startsWith('<speak>');

  const command = new SynthesizeSpeechCommand({
    Text: renderedText,
    TextType: (isSSML ? 'ssml' : 'text') as TextType,
    VoiceId: cfg.voiceId as VoiceId,
    Engine: cfg.engine as Engine,
    OutputFormat: 'mp3' as OutputFormat,
    LanguageCode: cfg.languageCode as Parameters<typeof SynthesizeSpeechCommand>[0]['LanguageCode'],
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
  let audioBuffer: Buffer | null = null;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
