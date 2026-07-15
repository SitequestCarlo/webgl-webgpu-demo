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
  language: 'glsl' | 'wgsl' | 'typescript';
  content: string;
}

export interface ShowcaseEntry {
  id: string;
  num: string;
  title: string;
  category: 'rendering' | 'performance';
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

type Api = 'webgl' | 'webgpu';

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

let currentId: string | null = null;
let currentApi: Api = 'webgl';
let currentFiles: CodeFile[] = [];
let selectedFileIndex = 0;

// Gibt die geordneten Shader-Dateien + optional main.ts für ein Showcase+API zurück.
function getFiles(entry: ShowcaseEntry, api: Api): CodeFile[] {
  if (!entry.shaderBase || !entry.fileOrder) return [];
  const names = api === 'webgl' ? entry.fileOrder.webgl : entry.fileOrder.webgpu;
  if (!names || names.length === 0) return [];
  const subdir = api === 'webgl' ? 'gl' : 'gpu';

  // main.ts-Pfad aus der HTML-URL ableiten:
  // './showcases/01-shading/index.html' → '/showcases/01-shading/main.ts'
  // './showcases/03-raytracer/webgl/index.html' → '/showcases/03-raytracer/webgl/main.ts'
  const htmlUrl = api === 'webgl' ? entry.webgl : entry.webgpu;
  const mainTsPath = htmlUrl
    ? htmlUrl.replace('./', '/').replace('/index.html', '/main.ts')
    : '';

  return names.map(name => {
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
    return { name, path, language, content };
  });
}

// ---------------------------------------------------------------------------
// DOM-Referenzen
// ---------------------------------------------------------------------------

const frame       = document.getElementById('showcase-frame') as HTMLIFrameElement;
const sidebarList = document.getElementById('sidebar-list')!;
const titleEl     = document.getElementById('showcase-title')!;
const tagsEl      = document.getElementById('showcase-tags')!;
const descEl      = document.getElementById('tab-description')!;
const codeBlock   = document.getElementById('code-block') as HTMLElement;
const fileListEl  = document.getElementById('file-list')!;
const btnWebGL    = document.getElementById('btn-webgl')!;
const btnWebGPU   = document.getElementById('btn-webgpu')!;
const tabBtns     = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabContents = document.querySelectorAll<HTMLElement>('.tab-pane');
const emptyState  = document.getElementById('empty-state')!;
const headerArea  = document.getElementById('showcase-header')!;
const apiWarning  = document.getElementById('api-warning')!;

// ---------------------------------------------------------------------------
// Sidebar aufbauen
// ---------------------------------------------------------------------------

function buildSidebar(): void {
  const groups: { title: string; items: ShowcaseEntry[] }[] = [
    { title: 'Rendering', items: registry.filter(e => e.category === 'rendering') },
    { title: 'Performance', items: registry.filter(e => e.category === 'performance') },
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
  frame.style.display = 'block';
  document.getElementById('info-panel')!.style.display = 'flex';

  // Showcase laden
  loadFrame(entry);

  // Beschreibung aus Markdown-Datei laden und rendern
  const mdPath = `/showcases/${entry.id}/description.md`;
  const mdSource = descriptionFiles[mdPath] ?? `*Keine Beschreibung verfügbar.*`;
  descEl.innerHTML = marked.parse(mdSource) as string;

  // Shader-Dateien aus dem Build-Zeit-Bundle laden (synchron)
  currentFiles      = getFiles(entry, currentApi);
  selectedFileIndex = 0;
  renderFileList(currentFiles);
  if (currentFiles.length > 0) selectFile(0);
  else {
    fileListEl.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:.78rem">Keine Shader-Dateien vorhanden.</div>';
    codeBlock.textContent = '';
  }

  // API-Warnung
  if (currentApi === 'webgpu' && !entry.webgpu) {
    apiWarning.textContent = 'Kein WebGPU-Showcase für dieses Beispiel vorhanden.';
    apiWarning.style.display = 'block';
  } else {
    apiWarning.style.display = 'none';
  }

  // Tab zurück auf Beschreibung
  switchTab('description');
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
  const label = document.createElement('div');
  label.className = 'file-section-label';
  label.textContent = currentApi === 'webgl' ? 'GLSL Shader' : 'WGSL Shader';
  fileListEl.appendChild(label);
  files.forEach((file, i) => {
    const btn = document.createElement('button');
    btn.className = 'file-item' + (i === selectedFileIndex ? ' active' : '');
    const extClass = `file-ext-${file.language}`;
    btn.innerHTML = `<span class="${extClass}">◆</span>${file.name}`;
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
  const lang = file.language === 'wgsl' ? 'wgsl' : file.language === 'typescript' ? 'typescript' : 'glsl';
  try {
    codeBlock.innerHTML = hljs.highlight(file.content, { language: lang }).value;
  } catch {
    codeBlock.textContent = file.content;
  }
  switchTab('code');
}

// ---------------------------------------------------------------------------
// API-Toggle
// ---------------------------------------------------------------------------

function setApi(api: Api): void {
  currentApi = api;
  btnWebGL.classList.toggle('active', api === 'webgl');
  btnWebGPU.classList.toggle('active', api === 'webgpu');
  document.documentElement.dataset.api = api;

  if (currentId) navigate(currentId);
}

// ---------------------------------------------------------------------------
// Tab-System
// ---------------------------------------------------------------------------

function switchTab(name: string): void {
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  tabContents.forEach(p => p.classList.toggle('active', p.dataset.tab === name));
}

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

buildSidebar();

btnWebGL.addEventListener('click', () => setApi('webgl'));
btnWebGPU.addEventListener('click', () => setApi('webgpu'));

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab ?? 'description'));
});

// URL-Hash-Routing
const hash = location.hash.replace('#', '');
if (hash && registry.find(e => e.id === hash)) {
  navigate(hash);
}

// Hash beim Navigieren setzen
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('.sidebar-item');
  if (btn?.dataset.id) {
    location.hash = btn.dataset.id;
  }
});
