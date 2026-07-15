// Haupt-App-Controller für die SPA-Shell.
// Lädt Showcases via iframes, verwaltet Navigation und API-Toggle.

import hljs from 'highlight.js/lib/core';
import glsl from 'highlight.js/lib/languages/glsl';
import typescript from 'highlight.js/lib/languages/typescript';
import { marked } from 'marked';
import { registry } from './registry';

hljs.registerLanguage('glsl', glsl);
hljs.registerLanguage('typescript', typescript);

// Minimale WGSL-Sprachdefinition (highlight.js hat kein natives WGSL)
hljs.registerLanguage('wgsl', () => ({
  keywords: {
    keyword: 'fn let var const struct if else for loop switch case default return break continue discard enable requires',
    built_in: 'vec2 vec3 vec4 mat2x2 mat3x3 mat4x4 mat2x4 mat4x2 f32 i32 u32 bool array atomic binding_array texture_2d texture_depth_2d sampler normalize dot cross length sqrt sin cos tan atan2 abs min max clamp mix pow exp log floor ceil round inverseSqrt select',
    literal: 'true false',
  },
  contains: [
    hljs.COMMENT('//', '$'),
    hljs.COMMENT('/\\*', '\\*/'),
    hljs.C_NUMBER_MODE,
    { className: 'meta',  begin: '@[a-zA-Z_][a-zA-Z0-9_]*' },    // @vertex @fragment @compute @group etc.
    { className: 'title', begin: '(?<=fn )\\w+' },                  // function names
    { className: 'type',  begin: '\\bvar<[^>]+>' },                 // var<uniform> etc.
  ],
}));

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface CodeFile {
  name: string;
  path: string;
  language: 'glsl' | 'wgsl' | 'typescript' | 'markdown';
  content: string;
}

export interface ShowcaseEntry {
  id: string;
  num: string;
  title: string;
  category: 'rendering' | 'performance' | 'compute' | 'overview';
  tags: string[];
  webgl?: string;
  webgpu?: string;
  // Markdown-Datei unter /showcases/{id}/description.md
  descriptionFile?: string;
  // Pfad-Präfixe für import.meta.glob
  shaderBase?: string;
  fileOrder?: {
    webgl?:  string[];
    webgpu?: string[];
  };
}

// ---------------------------------------------------------------------------
// Alle Shader-Quellen + Markdown-Beschreibungen zur BUILD-ZEIT bündeln
// ---------------------------------------------------------------------------
const shaderSources = import.meta.glob<string>(
  '/showcases/**/shaders/**/*.{glsl,wgsl}',
  { as: 'raw', eager: true },
);

// main.ts-Quellen für den Code-Viewer
const mainTsSources = import.meta.glob<string>(
  '/showcases/**/main.ts',
  { as: 'raw', eager: true },
);

const descriptionFiles = import.meta.glob<string>(
  '/showcases/*/description.md',
  { as: 'raw', eager: true },
);

// Globale README.md (Projekt-Root)
const globalReadme = import.meta.glob<string>(
  '/README.md',
  { as: 'raw', eager: true },
);

type Api = 'webgl' | 'webgpu';

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

let currentId: string | null = null;
let currentApi: Api = 'webgl';
let currentFiles: CodeFile[] = [];
let selectedFileIndex = 0;

// Gibt die Dateiliste für ein Showcase zurück.
// Erste Datei ist immer README.md (aus description.md oder globalReadme).
function getFiles(entry: ShowcaseEntry, api: Api): CodeFile[] {
  const files: CodeFile[] = [];

  // README.md prepend
  if (entry.id === '00-readme') {
    const content = globalReadme['/README.md'] ?? '# README\n\nKein Inhalt gefunden.';
    files.push({ name: 'README.md', path: '/README.md', language: 'markdown', content });
    return files;
  }

  const descPath = `/showcases/${entry.id}/description.md`;
  const descContent = descriptionFiles[descPath];
  if (descContent) {
    files.push({ name: 'README.md', path: descPath, language: 'markdown', content: descContent });
  }

  // Shader + main.ts
  if (!entry.shaderBase || !entry.fileOrder) return files;
  const names = api === 'webgl' ? entry.fileOrder.webgl : entry.fileOrder.webgpu;
  if (!names || names.length === 0) return files;
  const subdir = api === 'webgl' ? 'gl' : 'gpu';

  const htmlUrl = api === 'webgl' ? entry.webgl : entry.webgpu;
  const mainTsPath = htmlUrl
    ? htmlUrl.replace('./', '/').replace('/index.html', '/main.ts')
    : '';

  for (const name of names) {
    let path: string;
    let content: string;
    if (name === 'main.ts') {
      path    = mainTsPath;
      content = mainTsSources[path] ?? `// Datei nicht gefunden: ${path}`;
    } else {
      path    = `${entry.shaderBase}/${subdir}/${name}`;
      content = shaderSources[path] ?? `// Datei nicht gefunden: ${path}`;
    }
    const ext = name.split('.').pop() ?? 'glsl';
    const language: CodeFile['language'] =
      ext === 'wgsl' ? 'wgsl' : ext === 'ts' ? 'typescript' : 'glsl';
    files.push({ name, path, language, content });
  }
  return files;
}

// ---------------------------------------------------------------------------
// DOM-Referenzen
// ---------------------------------------------------------------------------

const frame       = document.getElementById('showcase-frame') as HTMLIFrameElement;
const sidebarList = document.getElementById('sidebar-list')!;
const titleEl     = document.getElementById('showcase-title')!;
const tagsEl      = document.getElementById('showcase-tags')!;
const codeBlock   = document.getElementById('code-block') as HTMLElement;
const fileListEl  = document.getElementById('file-list')!;
const btnWebGL    = document.getElementById('btn-webgl')  as HTMLButtonElement;
const btnWebGPU   = document.getElementById('btn-webgpu') as HTMLButtonElement;
const emptyState  = document.getElementById('empty-state')!;
const headerArea  = document.getElementById('showcase-header')!;
const apiWarning  = document.getElementById('api-warning')!;
const infoPanel   = document.getElementById('info-panel')!;
const codeView    = document.getElementById('code-view')!;

// ---------------------------------------------------------------------------
// Sidebar aufbauen
// ---------------------------------------------------------------------------

function buildSidebar(): void {
  // "00 README" als eigenstaendigen Top-Level-Eintrag
  const readmeEntry = registry.find(e => e.id === '00-readme');
  if (readmeEntry) {
    const btn = document.createElement('button');
    btn.className = 'sidebar-item sidebar-readme';
    btn.dataset.id = readmeEntry.id;
    btn.innerHTML = `
      <span class="sidebar-num">${readmeEntry.num}</span>
      <span class="sidebar-title">${readmeEntry.title}</span>`;
    btn.addEventListener('click', () => navigate(readmeEntry.id));
    sidebarList.appendChild(btn);
  }

  const groups: { title: string; items: ShowcaseEntry[] }[] = [
    { title: 'Rendering',    items: registry.filter(e => e.category === 'rendering') },
    { title: 'Performance',  items: registry.filter(e => e.category === 'performance') },
    { title: 'Compute',      items: registry.filter(e => e.category === 'compute') },
  ];

  for (const group of groups) {
    const section = document.createElement('div');
    section.className = 'sidebar-section';
    section.innerHTML = `<div class="sidebar-group-label">${group.title}</div>`;

    for (const entry of group.items) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.dataset.id = entry.id;

      btn.innerHTML = `
        <span class="sidebar-num">${entry.num}</span>
        <span class="sidebar-title">${entry.title}</span>`;

      btn.addEventListener('click', () => navigate(entry.id));
      section.appendChild(btn);
    }
    sidebarList.appendChild(section);
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function navigate(id: string): void {
  const entry = registry.find(e => e.id === id);
  if (!entry) return;

  currentId = id;

  // Sidebar aktiv setzen
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  document.querySelector<HTMLButtonElement>(`.sidebar-item[data-id="${id}"]`)?.classList.add('active');

  // Header
  titleEl.textContent = `${entry.num} · ${entry.title}`;
  tagsEl.innerHTML = '';

  // Leerzustand verstecken
  emptyState.style.display = 'none';
  headerArea.style.display = 'flex';
  infoPanel.style.display  = 'flex';

  // iframe: nur anzeigen wenn ein Showcase-URL existiert
  const hasFrame = !!(entry.webgl || entry.webgpu);
  frame.style.display    = hasFrame ? 'block' : 'none';
  infoPanel.style.flex   = hasFrame ? '' : '1';  // bei reiner README voll expandieren
  (document.getElementById('code-split') as HTMLElement).style.height = hasFrame ? '' : '100%';

  // Auto-Switch zu WebGPU falls Showcase kein WebGL hat
  if (!entry.webgl && entry.webgpu && currentApi === 'webgl') {
    currentApi = 'webgpu';
    btnWebGL.classList.remove('active');
    btnWebGPU.classList.add('active');
    document.documentElement.dataset.api = 'webgpu';
  }

  // API-Buttons: für reine Doku-Einträge beide ausblenden
  const isDocOnly = !entry.webgl && !entry.webgpu;
  btnWebGL.disabled  = isDocOnly || !entry.webgl;
  btnWebGPU.disabled = isDocOnly || !entry.webgpu;
  btnWebGL.style.opacity  = (isDocOnly || !entry.webgl)  ? '0.35' : '';
  btnWebGPU.style.opacity = (isDocOnly || !entry.webgpu) ? '0.35' : '';

  // Showcase laden
  loadFrame(entry);

  // Dateien laden (README.md + Shader)
  currentFiles      = getFiles(entry, currentApi);
  selectedFileIndex = 0;
  renderFileList(currentFiles);
  if (currentFiles.length > 0) selectFile(0);
  else {
    fileListEl.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:.78rem">Keine Dateien vorhanden.</div>';
    codeBlock.textContent = '';
  }

  // API-Warnung (falls man manuell auf eine nicht verfuegbare API umschaltet)
  if (!isDocOnly && ((currentApi === 'webgpu' && !entry.webgpu) || (currentApi === 'webgl' && !entry.webgl))) {
    apiWarning.textContent = `Kein ${currentApi === 'webgpu' ? 'WebGPU' : 'WebGL'}-Showcase für dieses Beispiel vorhanden.`;
    apiWarning.style.display = 'block';
  } else {
    apiWarning.style.display = 'none';
  }
}

function loadFrame(entry: ShowcaseEntry): void {
  const url = currentApi === 'webgpu' && entry.webgpu ? entry.webgpu : entry.webgl;
  if (url) { frame.src = url; } else { frame.src = 'about:blank'; }
}

// ---------------------------------------------------------------------------
// File-List rendern + Datei auswählen
// ---------------------------------------------------------------------------

function renderFileList(files: CodeFile[]): void {
  fileListEl.innerHTML = '';
  if (files.length === 0) {
    fileListEl.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:.75rem">Keine Dateien</div>';
    return;
  }
  // Abschnittsbeschriftung: README separat, dann Shader-Typ
  const hasMarkdown = files.some(f => f.language === 'markdown');
  const hasShaders  = files.some(f => f.language !== 'markdown');
  if (hasMarkdown) {
    const lbl = document.createElement('div');
    lbl.className = 'file-section-label'; lbl.textContent = 'Dokumentation';
    fileListEl.appendChild(lbl);
  }
  files.forEach((file, i) => {
    // Trennlabel vor erstem Shader nach README
    if (i > 0 && file.language !== 'markdown' && files[i-1].language === 'markdown' && hasShaders) {
      const lbl = document.createElement('div');
      lbl.className = 'file-section-label';
      lbl.textContent = currentApi === 'webgl' ? 'GLSL Shader' : 'WGSL Shader';
      fileListEl.appendChild(lbl);
    }
    const btn = document.createElement('button');
    btn.className = 'file-item' + (i === selectedFileIndex ? ' active' : '');
    const extClass = file.language === 'markdown' ? 'file-ext-md' : `file-ext-${file.language}`;
    btn.innerHTML = `<span class="${extClass}">&#9670;</span>${file.name}`;
    btn.title = file.path;
    btn.addEventListener('click', () => selectFile(i));
    fileListEl.appendChild(btn);
  });
}

function selectFile(index: number): void {
  selectedFileIndex = index;
  const file = currentFiles[index];
  if (!file) return;
  fileListEl.querySelectorAll('.file-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });

  if (file.language === 'markdown') {
    // Markdown: gerendertes HTML im code-view anzeigen
    const pre = codeView.querySelector('pre')!;
    pre.style.display = 'none';
    let mdDiv = codeView.querySelector<HTMLDivElement>('.md-view');
    if (!mdDiv) {
      mdDiv = document.createElement('div');
      mdDiv.className = 'md-view';
      codeView.appendChild(mdDiv);
    }
    mdDiv.style.display = 'block';
    mdDiv.innerHTML = marked.parse(file.content) as string;
  } else {
    // Code: Syntax-Highlighting
    const pre = codeView.querySelector('pre')!;
    pre.style.display = '';
    const mdDiv = codeView.querySelector<HTMLDivElement>('.md-view');
    if (mdDiv) mdDiv.style.display = 'none';
    const lang = file.language === 'wgsl' ? 'wgsl' : file.language === 'typescript' ? 'typescript' : 'glsl';
    try {
      codeBlock.innerHTML = hljs.highlight(file.content, { language: lang }).value;
    } catch {
      codeBlock.textContent = file.content;
    }
  }
}

// ---------------------------------------------------------------------------
// API-Toggle
// ---------------------------------------------------------------------------

function setApi(api: Api): void {
  currentApi = api;
  btnWebGL.classList.toggle('active', api === 'webgl');
  btnWebGPU.classList.toggle('active', api === 'webgpu');
  if (!currentId) {
    btnWebGL.disabled  = false; btnWebGL.style.opacity  = '';
    btnWebGPU.disabled = false; btnWebGPU.style.opacity = '';
  }
  document.documentElement.dataset.api = api;
  if (currentId) navigate(currentId);
}

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

buildSidebar();

btnWebGL.addEventListener('click', () => setApi('webgl'));
btnWebGPU.addEventListener('click', () => setApi('webgpu'));

// URL-Hash-Routing
const hash = location.hash.replace('#', '');
if (hash && registry.find(e => e.id === hash)) {
  navigate(hash);
} else {
  // Standard: globale README anzeigen
  navigate('00-readme');
}

// Hash beim Navigieren setzen
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('.sidebar-item');
  if (btn?.dataset.id) {
    location.hash = btn.dataset.id;
  }
});
