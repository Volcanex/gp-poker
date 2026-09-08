#!/usr/bin/env node
// Copy audit: finds user-facing strings that break the g-system voice rules.
//
//   node client/scripts/copy-audit.mjs            all findings, grouped by file
//   node client/scripts/copy-audit.mjs --only=em  one rule only
//   node client/scripts/copy-audit.mjs --json     machine readable
//
// Rules
//   lower  a sentence, label, heading, badge, note, placeholder or aria label
//          that opens with a lowercase letter
//   title  three or more capitalised words in a row that are not a proper noun
//   caps   an ALL CAPS word of four or more letters that is not a known acronym
//   em     an em dash anywhere in client/src or server/src, comments included
//
// It over-reports on purpose. Every finding is read by a person.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '..', '..')

const ROOTS = [join(repo, 'client', 'src'), join(repo, 'server', 'src')]

// ---------------------------------------------------------------- allow lists

const ACRONYMS = new Set([
  'HTTP', 'HTTPS', 'HTML', 'JSON', 'HTML5', 'URL', 'URI', 'UUID', 'API', 'REST',
  'WS', 'WSS', 'UTC', 'GMT', 'CSS', 'SVG', 'PNG', 'JPEG', 'WEBP', 'GIF',
  'ARIA', 'DOM', 'SQL', 'CSV', 'PDF', 'ELO', 'MTT', 'SNG', 'HUD', 'CPU', 'GPU',
  'IST', 'BST', 'PST', 'EST', 'CET', 'NLHE', 'PLO', 'VPIP', 'PFR', 'WTSD',
  'AFQ', 'BB', 'SB', 'BTN', 'UTG', 'MP', 'CO', 'HJ', 'LJ', 'EV', 'ICM',
  'RNG', 'SHA256', 'SHA', 'HMAC', 'ID', 'IDS', 'OK', 'TODO', 'FIXME', 'NOTE',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
])

// Proper nouns and product words that are legitimately capitalised in prose.
const PROPER = new Set([
  'Open', 'Table', 'Texas', "Hold'em", 'Holdem', 'Omaha', 'Claude', 'Google',
  'Discord', 'GitHub', 'Chrome', 'Safari', 'Firefox', 'Monday', 'Tuesday',
  'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January',
  'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'Bronze', 'Silver', 'Gold', 'Platinum',
  'Diamond', 'Master', 'Grandmaster',
])

// JSX attributes whose value is never prose.
const NON_COPY_ATTRS = new Set([
  'className', 'class', 'id', 'key', 'href', 'to', 'src', 'srcSet', 'type',
  'name', 'role', 'rel', 'target', 'method', 'action', 'style', 'viewBox',
  'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin',
  'xmlns', 'transform', 'points', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'x2',
  'y1', 'y2', 'width', 'height', 'preserveAspectRatio', 'clipPath', 'offset',
  'stopColor', 'gradientUnits', 'patternUnits', 'font', 'fontFamily',
  'autoComplete', 'inputMode', 'enterKeyHint', 'pattern', 'accept', 'as',
  'layoutId', 'variant', 'size', 'tone', 'align', 'side', 'dir', 'lang',
  'data-testid', 'data-state', 'data-band', 'data-theme', 'data-tone',
  'data-kind', 'data-mode', 'data-view', 'data-seat', 'data-street',
])

// JSX attributes that DO hold prose.
const COPY_ATTRS = new Set([
  'aria-label', 'aria-description', 'aria-valuetext', 'aria-placeholder',
  'title', 'placeholder', 'alt', 'label', 'legend', 'summary', 'caption',
  'hint', 'note', 'tip', 'text', 'message', 'heading', 'subtitle',
  'emptyText', 'cta', 'confirmText', 'cancelText', 'okText', 'help',
])

// Variable, property and argument names that hold prose.
const COPY_NAMES = /^(label|title|text|msg|message|name|desc|description|hint|note|tip|blurb|heading|subtitle|caption|placeholder|error|err|reason|summary|cta|body|copy|prose|line|status|why|detail|help|prompt|question|answer|explain|why|verdict|headline|sub|blurbs|labels|titles|notes|tips|hints|lines|reasons|steps|bullets|items|options|choices|answers|questions)s?$/i

// Functions whose string arguments are keys, ids or events, not copy.
const NON_COPY_CALLS = new Set([
  'getItem', 'setItem', 'removeItem', 'getAttribute', 'setAttribute',
  'removeAttribute', 'querySelector', 'querySelectorAll', 'getElementById',
  'addEventListener', 'removeEventListener', 'createElement', 'matchMedia',
  'require', 'import', 'get', 'has', 'delete', 'add', 'includes',
  'startsWith', 'endsWith', 'split', 'classList', 'toggle', 'closest',
  'matches', 'dispatchEvent', 'emit', 'on', 'off', 'once', 'send',
  'getPropertyValue', 'setProperty', 'createEvent', 'track', 'gtag',
])

// ------------------------------------------------------------------- skipping

const CARD = /^[2-9TJQKAtjqka]{1,2}[shdcSHDC]?$/
const HOLE = /^[2-9TJQKA]{2}[so]?$/
const IDENTIFIERISH = /^[a-z0-9]+([-_:./][a-z0-9]+)*$/
const CONSTANTISH = /^[A-Z0-9]+(_[A-Z0-9]+)*$/
const CSSISH = /(^|\s)(-?\d*\.?\d+(px|rem|em|vh|vw|%|ms|s|deg)|var\(--|rgba?\(|hsla?\(|#[0-9a-fA-F]{3,8}\b|calc\()/
// SVG path data. `d` is an svg attribute and a stat tile's description prop,
// so it is judged by its value rather than skipped on its name.
const PATHISH = /^[MmLlHhVvCcSsQqTtAaZz][\d\s.,-]/
const URLISH = /^(https?:|wss?:|mailto:|\/|\.\/|\.\.\/|#[a-z-]|data:)/i
const FORMATISH = /^[-+#%.\d\s:/\\|,()[\]{}<>=*&^$@!?~`'"]*$/
// A SQL verb alone is not enough: "Delete this table" is a button. A second
// SQL signal, a placeholder or a newline is what separates a query from copy.
const SQL_VERB = /^\s*(select|insert|update|delete|with|create|alter|drop|begin|commit|rollback|set|values|truncate)\b/i
const SQL_TELL = /\n|\$\d|::|\b(from|into|set|where|values|join|table|column|coalesce|order\s+by|group\s+by|limit|distinct|pg_)\b/i
const MIMEISH = /^[a-z]+\/[a-z0-9.+-]+(;|$)/
const HEADERISH = /^(public|private|no-cache|no-store|max-age|must-revalidate|immutable)\b/

function looksNonCopy(s) {
  const t = s.trim()
  if (!t) return true
  if (t.length < 2) return true
  if (URLISH.test(t)) return true
  if (PATHISH.test(t)) return true
  if (CARD.test(t) || HOLE.test(t)) return true
  if (CONSTANTISH.test(t) && !t.includes(' ')) return true
  if (CSSISH.test(t)) return true
  if (FORMATISH.test(t)) return true
  if (/^[\d.,]+\s*(bb|BB|x|%|ms|s|k|K|M)?$/.test(t)) return true
  if (SQL_VERB.test(t) && SQL_TELL.test(t.slice(6))) return true
  if (MIMEISH.test(t) || HEADERISH.test(t)) return true
  return false
}

// ------------------------------------------------------------------ the rules

// A multi-word lowercase string is always worth a look. A single lowercase
// word is a key far more often than a label, so it is only reported when it
// sits in a slot that holds prose.
function ruleLower(text, where, prose) {
  const t = text.trim()
  if (!/^[a-z]/.test(t)) return null
  if (t.includes(' ')) return 'lower'
  if (!prose) return null
  if (IDENTIFIERISH.test(t) && /[-_:./]/.test(t)) return null
  return 'lower-word'
}

function ruleTitle(text) {
  const words = text.split(/\s+/)
  let run = []
  for (const raw of words) {
    const w = raw.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '')
    if (/^[A-Z][a-z']+$/.test(w) && !PROPER.has(w)) run.push(w)
    else {
      if (run.length >= 3) return run.join(' ')
      run = []
    }
  }
  return run.length >= 3 ? run.join(' ') : null
}

function ruleCaps(text) {
  for (const m of text.matchAll(/\b[A-Z]{4,}\b/g)) {
    if (!ACRONYMS.has(m[0])) return m[0]
  }
  return null
}

// ------------------------------------------------------------------- the walk

function files(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'test') continue
      files(p, out)
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(p)
    }
  }
  return out
}

function attrName(node) {
  let n = node.parent
  while (n) {
    if (ts.isJsxAttribute(n)) return n.name.getText()
    if (ts.isJsxExpression(n) || ts.isConditionalExpression(n) ||
        ts.isBinaryExpression(n) || ts.isParenthesizedExpression(n) ||
        ts.isTemplateExpression(n) || ts.isTemplateSpan(n)) { n = n.parent; continue }
    return null
  }
  return null
}

function inNonCopyPosition(node) {
  const p = node.parent
  if (!p) return true
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true
  if (ts.isImportTypeNode(p) || ts.isLiteralTypeNode(p)) return true
  if (ts.isExternalModuleReference(p)) return true
  if (ts.isPropertyAssignment(p) && p.name === node) return true
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true
  if (ts.isComputedPropertyName(p)) return true
  if (ts.isEnumMember(p) && p.name === node) return true
  if (ts.isCallExpression(p)) {
    const fn = p.expression
    const name = ts.isPropertyAccessExpression(fn) ? fn.name.getText()
      : ts.isIdentifier(fn) ? fn.text : ''
    if (NON_COPY_CALLS.has(name)) return true
  }
  const a = attrName(node)
  if (a && (NON_COPY_ATTRS.has(a) || a.startsWith('data-') || a.startsWith('on'))) return true
  return false
}

function classify(node) {
  const a = attrName(node)
  if (a) return a
  let n = node.parent
  while (n && !ts.isJsxElement(n) && !ts.isJsxSelfClosingElement(n) &&
         !ts.isVariableDeclaration(n) && !ts.isPropertyAssignment(n) &&
         !ts.isCallExpression(n) && !ts.isReturnStatement(n)) n = n.parent
  if (!n) return 'string'
  if (ts.isJsxElement(n)) return `<${n.openingElement.tagName.getText()}>`
  if (ts.isVariableDeclaration(n)) return n.name.getText()
  if (ts.isPropertyAssignment(n)) return n.name.getText()
  if (ts.isCallExpression(n)) {
    const fn = n.expression
    return (ts.isPropertyAccessExpression(fn) ? fn.name.getText()
      : ts.isIdentifier(fn) ? fn.text : 'call') + '()'
  }
  return 'string'
}

const findings = []
let examined = 0

function record(file, sf, pos, rule, text, where, detail) {
  const { line } = sf.getLineAndCharacterOfPosition(pos)
  findings.push({
    file: relative(repo, file),
    line: line + 1,
    rule,
    where,
    text: text.length > 110 ? text.slice(0, 107) + '...' : text,
    detail: detail || '',
  })
}

for (const root of ROOTS) {
  for (const file of files(root)) {
    const src = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

    // (d) em dashes: raw text, so comments count too.
    let idx = src.indexOf('\u2014')
    while (idx !== -1) {
      const { line } = sf.getLineAndCharacterOfPosition(idx)
      const lineText = src.slice(src.lastIndexOf('\n', idx) + 1,
        src.indexOf('\n', idx) === -1 ? src.length : src.indexOf('\n', idx))
      findings.push({
        file: relative(repo, file), line: line + 1, rule: 'em',
        where: 'raw', text: lineText.trim().slice(0, 110), detail: '\u2014',
      })
      idx = src.indexOf('\u2014', idx + 1)
    }

    const visit = (node) => {
      let text = null
      if (ts.isJsxText(node)) {
        const t = node.text.replace(/\s+/g, ' ').trim()
        if (t) text = t
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (!inNonCopyPosition(node)) text = node.text
      } else if (ts.isTemplateExpression(node)) {
        if (!inNonCopyPosition(node)) {
          const head = node.head.text
          if (head.trim()) text = head
        }
      }

      if (text !== null && !looksNonCopy(text)) {
        examined += 1
        const where = ts.isJsxText(node) ? 'jsx' : classify(node)
        const prose = where === 'jsx' || COPY_ATTRS.has(where) ||
          COPY_NAMES.test(where.replace(/\(\)$/, ''))
        const lower = ruleLower(text, where, prose)
        if (lower) record(file, sf, node.getStart(sf), lower, text, where)
        const title = ruleTitle(text)
        if (title) record(file, sf, node.getStart(sf), 'title', text, where, title)
        const caps = ruleCaps(text)
        if (caps) record(file, sf, node.getStart(sf), 'caps', text, where, caps)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

// ------------------------------------------------------------------- report

const args = process.argv.slice(2)
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7)
const kept = only ? findings.filter((f) => f.rule.startsWith(only)) : findings

if (args.includes('--json')) {
  console.log(JSON.stringify(kept, null, 2))
} else {
  const byFile = new Map()
  for (const f of kept) {
    if (!byFile.has(f.file)) byFile.set(f.file, [])
    byFile.get(f.file).push(f)
  }
  for (const [file, rows] of [...byFile].sort()) {
    console.log(`\n${file}`)
    for (const r of rows.sort((a, b) => a.line - b.line)) {
      const d = r.detail ? `  [${r.detail}]` : ''
      console.log(`  ${String(r.line).padStart(4)} ${r.rule.padEnd(11)} ${r.where.padEnd(22)} ${JSON.stringify(r.text)}${d}`)
    }
  }
  const counts = {}
  for (const f of kept) counts[f.rule] = (counts[f.rule] || 0) + 1
  console.log(`\n${examined} user-facing strings examined`)
  console.log(`${kept.length} findings across ${byFile.size} files`)
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(12)} ${v}`)
}
