/* Analyser - Visual Studio solution (.sln / .slnx) viewer
   ============================================================================
   A .sln is a small line-based text manifest that ties a set of projects
   together. It opens with a format-version line and a "# Visual Studio <year>"
   comment, then a Project(...) = "Name", "Path", "{GUID}" line per project, and
   Global / GlobalSection blocks listing the build configurations. We parse those
   into a readable summary. Common with Unity/MonoDevelop (Assembly-CSharp).

   .slnx is the newer XML solution format (Visual Studio 2022 17.10+ / the
   `dotnet sln` tooling) - a far terser <Solution> tree of <Project Path="…">,
   <Folder> and a <Configurations> block of <BuildType>/<Platform> elements. We
   parse it with DOMParser and present the same readable summary. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';

// A few well-known project-type GUIDs -> friendly language/kind.
const PROJECT_TYPES = {
  'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC': 'C#',
  '9A19103F-16F7-4668-BE54-9A1E7A4F7556': 'C# (.NET SDK)',
  'F184B08F-C81C-45F6-A57F-5ABD9991F28F': 'Visual Basic',
  '778DAE3C-4631-46EA-AA77-85C1314464D9': 'VB (.NET SDK)',
  '8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942': 'C++',
  '2150E333-8FDC-42A3-9474-1A3956D46DE8': 'Solution folder',
  'E24C65DC-7377-472B-9ABA-BC803B73C61A': 'Website',
  '888888A0-9F3D-457C-B088-3A5042F75D52': 'Python',
  '9092AA53-FB77-4645-B42D-1CCCA6BD08BD': 'Node.js',
};

// Project kind inferred from the project file's extension (used by .slnx, whose
// <Project> elements usually carry only a Path, leaving the type implicit).
const EXT_TYPES = {
  csproj: 'C#', vbproj: 'Visual Basic', fsproj: 'F#', vcxproj: 'C++',
  pyproj: 'Python', njsproj: 'Node.js', shproj: 'Shared', sqlproj: 'SQL',
  wapproj: 'Packaging', vcproj: 'C++', dcproj: 'Docker Compose',
};

// Derive a friendly project name + kind from a .slnx project path / Type attr.
function slnxProjectKind(path, typeAttr) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (typeAttr) {
    const guid = typeAttr.replace(/[{}]/g, '').toUpperCase();
    if (PROJECT_TYPES[guid]) return PROJECT_TYPES[guid];
    if (!/^[0-9A-F-]{30,}$/.test(guid)) return typeAttr; // a friendly type moniker
  }
  return EXT_TYPES[ext] || 'Project';
}

function parseSlnx(text) {
  let doc;
  try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (_) { return null; }
  if (!doc || doc.querySelector('parsererror')) return null;
  const sol = doc.querySelector('Solution');
  if (!sol) return null;

  const projects = [];
  for (const p of doc.querySelectorAll('Project')) {
    const path = p.getAttribute('Path') || '';
    if (!path) continue;
    const base = path.split(/[\\/]/).pop() || path;
    const name = base.replace(/\.[^.]+$/, '');
    projects.push({ type: slnxProjectKind(path, p.getAttribute('Type')), name, path });
  }

  const folders = doc.querySelectorAll('Folder').length;
  const buildTypes = [...doc.querySelectorAll('Configurations > BuildType')].map((b) => b.getAttribute('Name')).filter(Boolean);
  const platforms = [...doc.querySelectorAll('Configurations > Platform')].map((b) => b.getAttribute('Name')).filter(Boolean);
  // .slnx expresses configs as the cross product of build types and platforms.
  const solutionConfigs = [];
  for (const bt of buildTypes.length ? buildTypes : ['']) {
    for (const pf of platforms.length ? platforms : ['']) {
      const label = [bt, pf].filter(Boolean).join('|');
      if (label) solutionConfigs.push(label);
    }
  }

  return { slnx: true, version: '', vs: '', vsVersion: '', minVersion: '', projects, folders, solutionConfigs };
}

function parseSln(text) {
  const verLine = text.match(/Format Version\s+([\d.]+)/i);
  const vsComment = text.match(/#\s*Visual Studio\s+(.+)/i);
  const vsVersion = text.match(/^VisualStudioVersion\s*=\s*(.+)$/m);
  const minVersion = text.match(/^MinimumVisualStudioVersion\s*=\s*(.+)$/m);

  const projects = [];
  const re = /Project\("\{([0-9A-Fa-f-]+)\}"\)\s*=\s*"([^"]*)",\s*"([^"]*)",\s*"\{([0-9A-Fa-f-]+)\}"/g;
  let m;
  while ((m = re.exec(text))) {
    const typeGuid = m[1].toUpperCase();
    projects.push({ type: PROJECT_TYPES[typeGuid] || 'Project', name: m[2], path: m[3], guid: m[4] });
  }

  const configs = [...text.matchAll(/^\s*(.+?)\s*=\s*(?:Debug|Release)[^\n|]*\|[^\n=]+$/gm)]
    .map((x) => x[1].trim())
    .filter((c) => /\|/.test(c));
  const solutionConfigs = [...new Set(
    (text.match(/GlobalSection\(SolutionConfigurationPlatforms\)[\s\S]*?EndGlobalSection/) || [''])[0]
      .split('\n').map((l) => l.trim()).filter((l) => /\|/.test(l) && l.includes('=')).map((l) => l.split('=')[0].trim())
  )];

  return { version: verLine ? verLine[1] : '', vs: vsComment ? vsComment[1].trim() : '', vsVersion: vsVersion ? vsVersion[1].trim() : '', minVersion: minVersion ? minVersion[1].trim() : '', projects, solutionConfigs };
}

export async function renderVsSolution(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let text;
  try { text = await file.slice(0, 8 * 1024 * 1024).text(); } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }

  // .slnx is XML (<Solution>…), .sln is the classic text manifest. Pick the
  // parser by extension, but fall back across them if the content disagrees.
  const isSlnx = /\.slnx$/i.test(file.name) || /<Solution[\s>]/.test(text.slice(0, 4096));
  let data = isSlnx ? parseSlnx(text) : null;
  if (!data && /Microsoft Visual Studio Solution File/i.test(text)) data = parseSln(text);
  if (!data) {
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }

  resultsEl.innerHTML = '';

  const meta = el('div', { class: 'anr-card' });
  meta.appendChild(el('h3', {}, 'Visual Studio solution'));
  const tbl = el('table', { class: 'anr-readout' });
  if (data.slnx) {
    tbl.appendChild(rowHelp('Format', 'Visual Studio solution (.slnx)',
      'The newer XML solution format (Visual Studio 2022 17.10+ and the dotnet sln tooling) - a terser <Solution> tree of projects, folders and build configurations that replaces the classic text .sln.'));
  } else {
    tbl.appendChild(rowHelp('Format', 'Visual Studio solution (.sln)',
      'A text manifest that groups one or more projects and their build configurations. Opened by Visual Studio, Rider and MonoDevelop; Unity generates one named after the project.'));
  }
  if (data.version) tbl.appendChild(row('Format version', data.version));
  if (data.vs) tbl.appendChild(row('Visual Studio', data.vs));
  if (data.vsVersion) tbl.appendChild(row('VS version', data.vsVersion));
  tbl.appendChild(row('Projects', String(data.projects.length)));
  if (data.folders) tbl.appendChild(row('Solution folders', String(data.folders)));
  if (data.solutionConfigs.length) tbl.appendChild(row('Configurations', data.solutionConfigs.join(', ')));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  meta.appendChild(tbl);
  resultsEl.appendChild(meta);

  if (data.projects.length) {
    const card = el('div', { class: 'anr-card' });
    card.appendChild(el('h3', {}, 'Projects (' + data.projects.length + ')'));
    const t = el('table', { class: 'anr-readout' });
    for (const p of data.projects) {
      const cell = el('div', {});
      cell.appendChild(el('div', {}, p.path || p.name));
      cell.appendChild(el('span', { class: 'anr-hint', style: 'font-size:11px;' }, p.type));
      const tr = el('tr', {}, [el('td', {}, p.name), el('td', {}, cell)]);
      t.appendChild(tr);
    }
    card.appendChild(t);
    resultsEl.appendChild(card);
  }

  resultsEl.appendChild(integrityCard(file));
}
