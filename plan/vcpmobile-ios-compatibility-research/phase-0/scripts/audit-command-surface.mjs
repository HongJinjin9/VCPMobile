/**
 * Phase 0 source inventory. Run from any directory with the workspace's Node dependencies installed.
 * Default: print a summary. --write creates the evidence file once; --check compares current inputs.
 * This is a source inventory, not a runtime reachability proof or a Rust/Kotlin compiler.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const plugin = 'src-tauri/plugins/vcp-mobile';
const output = path.join(workspace, 'plan/vcpmobile-ios-compatibility-research/phase-0/evidence/command-surface.json');
const inputs = new Map();
const normalize = value => value.replaceAll('\\', '/');
const relative = value => normalize(path.relative(workspace, value));
const read = name => {
  const text = fs.readFileSync(path.join(workspace, name), 'utf8');
  inputs.set(name, createHash('sha256').update(text).digest('hex'));
  return text;
};
const files = (dir, extensions) => fs.readdirSync(path.join(workspace, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(`${dir}/${entry.name}`, extensions)
    : extensions.some(extension => entry.name.endsWith(extension)) ? [`${dir}/${entry.name}`] : []).sort();
const unique = values => [...new Set(values)].sort();
const difference = (left, right) => unique(left.filter(value => !right.includes(value)));
const line = (text, offset) => text.slice(0, offset).split('\n').length;
const location = (file, text, offset) => ({ file, line: line(text, offset) });

// Small lexical scanner: comments and ordinary/raw string contents never become identifiers or calls.
// It deliberately keeps string tokens separate so bridge selectors must occur as call arguments.
function lex(text) {
  const result = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text.startsWith('//', i)) { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (text.startsWith('/*', i)) {
      i += 2; let depth = 1;
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) { depth++; i += 2; }
        else if (text.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    const start = i;
    const raw = /^(?:br|r)(#*)"/.exec(text.slice(i));
    if (raw) {
      const endMarker = `"${raw[1]}`;
      const end = text.indexOf(endMarker, i + raw[0].length);
      i = end < 0 ? text.length : end + endMarker.length;
      result.push({ value: text.slice(start + raw[0].length, end), kind: 'string', start, end: i });
      continue;
    }
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      i = end < 0 ? text.length : end + 3;
      result.push({ value: text.slice(start + 3, end), kind: 'string', start, end: i }); continue;
    }
    if (text[i] === '"' || (text[i] === "'" && /^'(?:\\.|[^'\r\n])'/.test(text.slice(i)))) {
      const quote = text[i++];
      while (i < text.length) { if (text[i] === '\\') { i += 2; continue; } if (text[i++] === quote) break; }
      result.push({ value: text.slice(start + 1, i - 1), kind: 'string', start, end: i }); continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z_0-9]*/.exec(text.slice(i));
    if (identifier) { i += identifier[0].length; result.push({ value: identifier[0], kind: 'id', start, end: i }); }
    else { result.push({ value: text[i], kind: 'punct', start, end: ++i }); }
  }
  return result;
}
function close(tokens, open, left = '{', right = '}') {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].kind !== 'punct') continue;
    if (tokens[i].value === left) depth++;
    else if (tokens[i].value === right && --depth === 0) return i;
  }
  throw new Error(`Unclosed ${left} at token ${open}`);
}
function rustTokens(text) {
  const tokens = lex(text);
  const ranges = [];
  for (let i = 0; i < tokens.length - 7; i++) {
    if (tokens.slice(i, i + 7).map(token => token.value).join('') !== '#[cfg(test)]') continue;
    let start = i + 7;
    while (start < tokens.length && !['{', ';'].includes(tokens[start].value)) start++;
    if (tokens[start]?.value === '{') ranges.push([i, close(tokens, start)]);
  }
  return tokens.filter((_, index) => !ranges.some(([start, end]) => index >= start && index <= end));
}
function handlerList(file) {
  const text = read(file), tokens = lex(text);
  const anchor = tokens.findIndex((token, i) => token.value === 'generate_handler' && tokens[i + 1]?.value === '!');
  if (anchor < 0) throw new Error(`Missing handler list: ${file}`);
  const end = close(tokens, anchor + 2, '[', ']');
  const entries = []; let current = [];
  for (const token of tokens.slice(anchor + 3, end)) {
    if (token.value === ',') { if (current.length) entries.push(current); current = []; }
    else current.push(token);
  }
  if (current.length) entries.push(current);
  return entries.map(entry => ({ name: entry.at(-1).value, symbol: entry.map(token => token.value).join(''), ...location(file, text, entry[0].start) }));
}
function allowedCommands(file, kind = 'allow') {
  const text = read(file);
  return unique([...text.matchAll(new RegExp(`commands\\.${kind}\\s*=\\s*\\[([^\\]]*)\\]`, 'g'))]
    .flatMap(match => [...match[1].matchAll(/"([^"\r\n]+)"/g)].map(item => item[1])));
}
const endpoints = handlerList(`${plugin}/src/lib.rs`);
const endpointNames = endpoints.map(entry => entry.name);
const appCommands = handlerList('src-tauri/src/commands.rs');
const appNames = appCommands.map(entry => entry.name);
const buildText = read(`${plugin}/build.rs`);
const buildCommands = [...buildText.match(/const COMMANDS[^=]*=\s*&\[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
const generatedPermissions = files(`${plugin}/permissions/autogenerated/commands`, ['.toml']).map(file => ({ file, allow: allowedCommands(file), deny: allowedCommands(file, 'deny') }));
const schema = JSON.parse(read(`${plugin}/permissions/schemas/schema.json`));
const reference = read(`${plugin}/permissions/autogenerated/reference.md`);
const schemaIds = [];
function schemaWalk(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.const === 'string') schemaIds.push(value.const);
  Object.values(value).forEach(schemaWalk);
}
schemaWalk(schema);
const permissionSets = {
  build: buildCommands,
  default: allowedCommands(`${plugin}/permissions/default.toml`),
  all: allowedCommands(`${plugin}/permissions/all.toml`),
  autogeneratedAllow: unique(generatedPermissions.flatMap(item => item.allow)),
  autogeneratedDeny: unique(generatedPermissions.flatMap(item => item.deny)),
  schemaAllow: unique(schemaIds.filter(value => value.startsWith('allow-') && value !== 'allow-all').map(value => value.slice(6).replaceAll('-', '_'))),
  schemaDeny: unique(schemaIds.filter(value => value.startsWith('deny-')).map(value => value.slice(5).replaceAll('-', '_'))),
  referenceAllow: unique([...reference.matchAll(/`vcp-mobile:allow-([^`]+)`/g)].map(match => match[1]).filter(name => name !== 'all').map(name => name.replaceAll('-', '_'))),
  referenceDeny: unique([...reference.matchAll(/`vcp-mobile:deny-([^`]+)`/g)].map(match => match[1].replaceAll('-', '_'))),
};
const permissionDiffs = Object.fromEntries(Object.entries(permissionSets).map(([name, commands]) => [name, {
  count: commands.length, missing: difference(endpointNames, commands), extra: difference(commands, endpointNames),
  duplicates: commands.filter((command, i) => commands.indexOf(command) !== i),
}]));
const capabilities = files('src-tauri/capabilities', ['.json']).map(file => ({ file, ...JSON.parse(read(file)) }));
const manifestFile = `${plugin}/android/src/main/AndroidManifest.xml`;
const manifest = read(manifestFile);
const androidPermissions = [...manifest.matchAll(/<uses-permission\b[^>]*\bandroid:name="([^"]+)"[^>]*\/?\s*>/g)]
  .map(match => ({ name: match[1], declaration: match[0], ...location(manifestFile, manifest, match.index) }));

// Parse TS and Vue script sections into real AST calls, then follow import edges from main.ts.
const guest = `${plugin}/guest-js/index.ts`;
const frontFiles = [...files('src', ['.ts', '.vue']).filter(file => !file.startsWith('src/tests/') && !/\.(test|spec|d)\.ts$/.test(file)), guest];
const units = new Map();
for (const file of frontFiles) {
  const original = read(file);
  let source = original;
  if (file.endsWith('.vue')) {
    const characters = original.replace(/[^\r\n]/g, ' ').split('');
    for (const match of original.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/g)) {
      const start = match.index + match[0].indexOf('>') + 1;
      for (let i = 0; i < match[1].length; i++) characters[start + i] = match[1][i];
    }
    source = characters.join('');
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) throw new Error(`Cannot parse ${file}: ${ast.parseDiagnostics.map(diagnostic => diagnostic.messageText).join('; ')}`);
  units.set(file, { original, ast, imports: new Map(), edges: new Set(), constants: new Map() });
}
function resolveModule(file, specifier) {
  if (specifier === 'tauri-plugin-vcp-mobile') return guest;
  const base = specifier.startsWith('.') ? relative(path.resolve(workspace, path.dirname(file), specifier))
    : specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : null;
  return base && [base, `${base}.ts`, `${base}.vue`, `${base}/index.ts`].find(candidate => units.has(candidate));
}
function visit(node, callback) { callback(node); ts.forEachChild(node, child => visit(child, callback)); }
for (const [file, unit] of units) {
  visit(unit.ast, node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier) || node.isTypeOnly || node.importClause?.isTypeOnly) return;
      const specifier = node.moduleSpecifier.text, target = resolveModule(file, specifier);
      if (target) unit.edges.add(target);
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
        if (!element.isTypeOnly) unit.imports.set(element.name.text, { imported: (element.propertyName ?? element.name).text, specifier, target });
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      const target = resolveModule(file, node.arguments[0].text); if (target) unit.edges.add(target);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) unit.constants.set(node.name.text, node.initializer);
  });
}
const reachable = new Set();
function mark(file) { if (reachable.has(file)) return; reachable.add(file); for (const dependency of units.get(file)?.edges ?? []) mark(dependency); }
mark('src/main.ts');
function stringValue(file, expression, seen = new Set()) {
  if (!expression) return null;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (!ts.isIdentifier(expression)) return null;
  const key = `${file}:${expression.text}`; if (seen.has(key)) return null; seen.add(key);
  const unit = units.get(file);
  if (unit.constants.has(expression.text)) return stringValue(file, unit.constants.get(expression.text), seen);
  const binding = unit.imports.get(expression.text);
  if (binding?.target) return stringValue(binding.target, units.get(binding.target).constants.get(binding.imported), seen);
  return null;
}
const frontendCalls = [], dynamicInvokes = [], wrappers = [];
for (const [file, unit] of units) visit(unit.ast, node => {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
  const binding = unit.imports.get(node.expression.text);
  if (binding?.specifier !== '@tauri-apps/api/core' || binding.imported !== 'invoke') return;
  const command = stringValue(file, node.arguments[0]);
  const entry = { command, ...location(file, unit.original, node.getStart(unit.ast)), reachableFromMain: reachable.has(file), kind: 'direct-invoke' };
  if (file === guest) {
    let parent = node.parent;
    while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
    wrappers.push({ name: parent?.name?.text ?? '<unknown>', ...entry });
  } else if (command) frontendCalls.push(entry);
  else dynamicInvokes.push({ ...entry, expression: node.arguments[0]?.getText(unit.ast) });
});
for (const [file, unit] of units) if (file !== guest) visit(unit.ast, node => {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
  const binding = unit.imports.get(node.expression.text);
  if (binding?.target !== guest) return;
  const wrapper = wrappers.find(entry => entry.name === binding.imported);
  if (wrapper) frontendCalls.push({ command: wrapper.command, ...location(file, unit.original, node.getStart(unit.ast)), reachableFromMain: reachable.has(file), kind: 'guest-wrapper-call', wrapper: wrapper.name });
});

// Rust declarations and lexical calls are separate. No cfg branch is interpreted as executable on iOS.
const rustDeclarations = [], rustCalls = [], nativeCalls = [], jniCalls = [], manualReview = [];
const rustFiles = [...files('src-tauri/src', ['.rs']), ...files(`${plugin}/src`, ['.rs'])];
for (const file of rustFiles) {
  const text = read(file), tokens = rustTokens(text), functions = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value !== 'fn' || tokens[i + 1]?.kind !== 'id') continue;
    let opening = i + 2;
    while (opening < tokens.length && !['{', ';'].includes(tokens[opening].value)) opening++;
    if (tokens[opening]?.value !== '{') continue;
    const closing = close(tokens, opening);
    const declaration = { name: tokens[i + 1].value, ...location(file, text, tokens[i].start), signature: text.slice(tokens[i].start, tokens[opening].start).replace(/\s+/g, ' ').trim() };
    rustDeclarations.push(declaration); functions.push({ start: opening, end: closing, ...declaration });
  }
  function owner(index) { return functions.filter(fn => index > fn.start && index < fn.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]?.name ?? null; }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'id') continue;
    let opening = i + 1;
    if (tokens[opening]?.value === ':' && tokens[opening + 1]?.value === ':' && tokens[opening + 2]?.value === '<') opening = close(tokens, opening + 2, '<', '>') + 1;
    if (tokens[opening]?.value !== '(' || ['fn', 'fun'].includes(tokens[i - 1]?.value)) continue;
    let start = i;
    while (tokens[start - 1]?.value === ':' && tokens[start - 2]?.value === ':' && tokens[start - 3]?.kind === 'id') start -= 3;
    const symbol = tokens.slice(start, i + 1).map(item => item.value).join('');
    if (symbol.startsWith('tauri_plugin_vcp_mobile::') || symbol === 'ForegroundLease::acquire') {
      rustCalls.push({ symbol, owner: owner(i), ...location(file, text, token.start), evidence: 'lexical-call-site; cfg and owner reachability require review' });
    }
    if (['run_mobile_plugin', 'run_mobile_plugin_async'].includes(token.value)) {
      const argument = tokens[opening + 1];
      if (argument?.kind === 'string') nativeCalls.push({ selector: argument.value, owner: owner(i), ...location(file, text, token.start), kind: token.value });
      else manualReview.push({ reason: 'non-literal native selector (macro or dynamic)', ...location(file, text, token.start) });
    }
    if (token.value === 'call_static_method' && tokens[opening + 1]?.kind === 'string' && tokens[opening + 3]?.kind === 'string') {
      jniCalls.push({ class: tokens[opening + 1].value, method: tokens[opening + 3].value, owner: owner(i), ...location(file, text, token.start) });
    }
    if (['prepare_cli_runtime_inner', 'start_cli_process_inner', 'inspect_cli_process_inner', 'cancel_cli_process_inner', 'open_cli_pty_inner', 'read_cli_pty_inner', 'write_cli_pty_inner', 'resize_cli_pty_inner', 'close_cli_pty_inner'].includes(token.value) && !file.startsWith(plugin)) {
      rustCalls.push({ symbol: token.value, owner: owner(i), ...location(file, text, token.start), evidence: 'lexical-call-site; imported symbol requires review' });
    }
  }
  // Known pty_bridge invocations are recorded at the macro expansion input, never as direct calls.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === 'pty_bridge' && tokens[i + 1]?.value === '!' && tokens[i + 4]?.value === ',' && tokens[i + 5]?.kind === 'string') {
      nativeCalls.push({ selector: tokens[i + 5].value, owner: tokens[i + 3].value, ...location(file, text, tokens[i].start), kind: 'pty_bridge-macro-input' });
    }
  }
}
const kotlinFile = `${plugin}/android/src/main/java/com/vcp/mobile/VcpMobilePlugin.kt`;
const kotlinText = read(kotlinFile), kotlinTokens = lex(kotlinText), kotlinCommands = [];
for (let i = 0; i < kotlinTokens.length; i++) {
  if (kotlinTokens[i].value !== '@' || kotlinTokens[i + 1]?.value !== 'Command') continue;
  let next = i + 2; while (next < kotlinTokens.length && kotlinTokens[next].value !== 'fun') next++;
  kotlinCommands.push({ selector: kotlinTokens[next + 1].value, ...location(kotlinFile, kotlinText, kotlinTokens[next + 1].start) });
}
const endpointDetails = endpoints.map(endpoint => {
  const module = endpoint.symbol.split('::')[0];
  const implementations = rustDeclarations.filter(entry => entry.file === `${plugin}/src/${module}.rs` && entry.name === endpoint.name);
  const relatedNative = nativeCalls.filter(entry => entry.file === `${plugin}/src/${module}.rs` && [endpoint.name, `${endpoint.name}_inner`].includes(entry.owner));
  const selectors = unique(relatedNative.map(entry => entry.selector));
  const directRust = rustCalls.filter(entry => [
    `tauri_plugin_vcp_mobile::${module}::${endpoint.name}`,
    `tauri_plugin_vcp_mobile::${module}::${endpoint.name}_inner`,
  ].includes(entry.symbol));
  const bridgeConsumers = nativeCalls.filter(entry => !entry.file.startsWith(plugin) && selectors.includes(entry.selector));
  const front = frontendCalls.filter(entry => entry.command === `plugin:vcp-mobile|${endpoint.name}`);
  return { ...endpoint, implementations, frontendCallSites: front, rustCallSites: directRust, nativeSelectorCallSites: relatedNative, directNativeConsumers: bridgeConsumers,
    usage: front.some(entry => entry.reachableFromMain) ? 'frontend-call-in-main-import-graph' : directRust.length || bridgeConsumers.length ? 'rust-call-site-only' : 'no-consumer-found-in-audited-syntax' };
});
const knownNative = kotlinCommands.map(entry => entry.selector);
const unknownNative = nativeCalls.filter(entry => !knownNative.includes(entry.selector));
const registeredNames = [...endpointNames.map(name => `plugin:vcp-mobile|${name}`), ...appNames];
const unknownFrontend = frontendCalls.filter(entry => !entry.command.startsWith('plugin:') || entry.command.startsWith('plugin:vcp-mobile|')).filter(entry => !registeredNames.includes(entry.command));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
const report = {
  schemaVersion: 1, sourceCommit: head,
  method: {
    frontend: 'TypeScript AST named invoke imports and named guest imports; literal/local-or-imported constant command arguments. Static/dynamic literal module imports from src/main.ts mark potential reachability, not runtime execution.',
    rust: 'Comment/string-aware lexical calls and function signatures; exact cfg(test) blocks excluded. No name resolution, general macro expansion, cfg evaluation or full call graph.',
    kotlin: 'Comment/string-aware @Command declarations only; bridge selector calls separately inventory Rust source and known pty_bridge macro inputs.',
    scope: 'src production TS/Vue, src-tauri/src Rust, local plugin Rust/guest/Kotlin and permission/capability source. Tests/docs/fixtures do not count as consumers.',
  },
  summary: {
    pluginEndpoints: endpoints.length, appCommands: appCommands.length, kotlinSelectors: kotlinCommands.length,
    guestWrappers: wrappers.length, uniqueGuestCommands: unique(wrappers.map(entry => entry.command)).length,
    usedGuestWrappers: unique(frontendCalls.filter(entry => entry.kind === 'guest-wrapper-call' && entry.reachableFromMain).map(entry => entry.wrapper)).length,
    frontendConsumedEndpoints: endpointDetails.filter(entry => entry.usage === 'frontend-call-in-main-import-graph').length,
    rustOnlyEndpoints: endpointDetails.filter(entry => entry.usage === 'rust-call-site-only').length,
    noConsumerFoundEndpoints: endpointDetails.filter(entry => entry.usage === 'no-consumer-found-in-audited-syntax').length,
    unknownActiveFrontendCommands: unknownFrontend.filter(entry => entry.reachableFromMain).length,
    unknownDormantFrontendCommands: unique(unknownFrontend.filter(entry => !entry.reachableFromMain).map(entry => entry.command)).length,
    unresolvedDynamicInvokes: dynamicInvokes.length,
    unmatchedNativeSelectors: unknownNative.length,
  },
  permissionDiffs, capabilities, androidPermissions, endpoints: endpointDetails,
  appCommands: appCommands.map(entry => ({ ...entry, implementations: rustDeclarations.filter(declaration => declaration.name === entry.name), frontendCallSites: frontendCalls.filter(call => call.command === entry.name) })),
  kotlinCommands: kotlinCommands.map(entry => ({ ...entry, rustBridgeCallSites: nativeCalls.filter(call => call.selector === entry.selector) })),
  guestWrappers: wrappers.map(entry => ({ ...entry, frontendCallSites: frontendCalls.filter(call => call.wrapper === entry.name) })),
  rustPluginCalls: rustCalls, nativeCalls, jniCalls, unknownFrontend, unknownNative, dynamicInvokes, manualReview,
  inputSha256: Object.fromEntries([...inputs.entries()].sort(([a], [b]) => a.localeCompare(b))),
};
if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' });
}
if (process.argv.includes('--check')) {
  const previous = JSON.parse(fs.readFileSync(output, 'utf8'));
  // The commit identifies the historical snapshot; a new commit alone does not change its inputs.
  if (JSON.stringify(previous) !== JSON.stringify({ ...report, sourceCommit: previous.sourceCommit })) throw new Error('Audit evidence differs from current source. Review the diff and update evidence with a targeted edit.');
}
console.log(JSON.stringify({ ...report.summary, permissionDiffs, sourceCommit: head, evidence: process.argv.includes('--write') ? relative(output) : undefined }, null, 2));
if (Object.values(permissionDiffs).some(value => value.missing.length || value.extra.length || value.duplicates.length) || unknownNative.length || report.summary.unknownActiveFrontendCommands) process.exitCode = 1;
