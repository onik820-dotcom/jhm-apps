/**
 * The accessibility pass, as a check that can be re-run.
 *
 * Two halves. The first is colour contrast, computed from the tokens in
 * globals.css against the composited glass surface — arithmetic, so it either
 * passes or it does not. The second is a scan of the JSX for the mistakes that
 * actually happen: an icon button with no name, an input with no label, a
 * positive tabindex, a div pretending to be a button.
 *
 * It is not a substitute for a screen reader. It is the floor.
 *
 *   npx tsx scripts/check-a11y.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
let failures = 0;
let warnings = 0;

function fail(what: string, detail: string) {
  failures += 1;
  console.log(` FAIL  ${what}\n        ${detail}`);
}
function warn(what: string, detail: string) {
  warnings += 1;
  console.log(` warn  ${what}\n        ${detail}`);
}
function ok(what: string, detail: string) {
  console.log(`  ok   ${what}\n        ${detail}`);
}

// ---------------------------------------------------------------------------
// Colour contrast
// ---------------------------------------------------------------------------
function channels(h: string): [number, number, number] {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}
function linear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(rgb: [number, number, number]): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(channels(a)), luminance(channels(b))].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

function tokensFrom(css: string, blockStart: string): Record<string, string> {
  const from = css.indexOf(blockStart);
  if (from < 0) return {};
  const end = css.indexOf('}', from);
  const block = css.slice(from, end);
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = line.match(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/);
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

function contrastPass() {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

  // The glass is 72% white over a slate/blue gradient, and 72% slate over a
  // near-black one. These are the composited results text actually sits on.
  const LIGHT = '#fafcfe';
  const DARK = '#10192b';

  const base = tokensFrom(css, ':root {');
  const accent = base['--color-accent'] ?? '#1e40af';
  const light = {
    ...tokensFrom(css, ':root {'),
    '--color-ok': base['--color-ok'] ?? '#15803d',
    '--color-watch': base['--color-watch'] ?? '#b45309',
    '--color-breach': base['--color-breach'] ?? '#b91c1c',
  };
  const dark = tokensFrom(css, ":root[data-theme='dark'] {");

  const interesting = (name: string) =>
    name.startsWith('--text-') || name.startsWith('--color-ok') ||
    name.startsWith('--color-watch') || name.startsWith('--color-breach') ||
    name === '--color-accent';

  let worstLight = Infinity;
  let worstDark = Infinity;

  for (const [name, colour] of Object.entries(light)) {
    if (!interesting(name)) continue;
    const r = contrast(colour, LIGHT);
    worstLight = Math.min(worstLight, r);
    if (r < 4.5) fail(`light mode ${name}`, `${colour} is ${r.toFixed(2)}:1 on the glass, below AA`);
  }
  for (const [name, colour] of Object.entries(dark)) {
    if (!interesting(name)) continue;
    const r = contrast(colour, DARK);
    worstDark = Math.min(worstDark, r);
    if (r < 4.5) fail(`dark mode ${name}`, `${colour} is ${r.toFixed(2)}:1 on the glass, below AA`);
  }

  const white = contrast('#ffffff', accent);
  if (white < 4.5) fail('white on the accent button', `${white.toFixed(2)}:1`);

  if (worstLight >= 4.5 && worstDark >= 4.5 && white >= 4.5) {
    ok(
      'every text token meets WCAG AA at normal size',
      `worst light ${worstLight.toFixed(2)}:1, worst dark ${worstDark.toFixed(2)}:1, ` +
        `white on accent ${white.toFixed(2)}:1`,
    );
  }
}

// ---------------------------------------------------------------------------
// The JSX scan
// ---------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Every <button …> … </button>, with its attributes and its children. */
function buttons(source: string): Array<{ attrs: string; body: string; index: number }> {
  const found: Array<{ attrs: string; body: string; index: number }> = [];

  // The obvious regex for a tag is /<button\b([^>]*)>/ and it is wrong here.
  // Nearly every button in this app carries an inline handler:
  //
  //     <button type="button" onClick={() => setOpen(true)} aria-label="…">
  //
  // and `[^>]*` stops dead at the `>` inside `=>`. The attributes come back
  // truncated, so an aria-label written after the handler is invisible and the
  // body starts mid-attribute — which reads as text, so the button is taken
  // for a labelled one and never checked. A false pass, which is the worst
  // kind of bug in a checker.
  //
  // So the tag is walked instead, tracking quotes and brace depth.
  let i = 0;
  while ((i = source.indexOf('<button', i)) !== -1) {
    const start = i;
    let j = i + '<button'.length;
    let depth = 0;
    let quote: string | null = null;

    while (j < source.length) {
      const ch = source[j]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      } else if (ch === '>' && depth === 0) {
        break;
      }
      j += 1;
    }

    const attrs = source.slice(start + '<button'.length, j);
    const close = source.indexOf('</button>', j);
    const body = close === -1 ? '' : source.slice(j + 1, close);
    found.push({ attrs, body, index: start });
    i = close === -1 ? j : close + 1;
  }

  return found;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * Components that wrap their children in a real <label>.
 *
 * Found by reading every file once: a function component whose body contains
 * an opening <label> and a {children} inside it. An input handed to one of
 * these is implicitly labelled in the DOM even though the call site shows no
 * <label> at all.
 */
function labellingWrappers(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const re = /function\s+([A-Z][A-Za-z0-9_]*)\s*\(([\s\S]*?)\n}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const name = m[1]!;
      const body = m[2] ?? '';
      const label = body.indexOf('<label');
      if (label < 0) continue;
      const close = body.indexOf('</label>', label);
      const between = close < 0 ? body.slice(label) : body.slice(label, close);
      if (/\{\s*children\s*\}/.test(between)) found.add(name);
    }
  }
  return found;
}

/**
 * The text of a braced JSX attribute, e.g. the `\`row-${id}\`` in
 * `id={\`row-${id}\`}`.
 *
 * Brace-balanced rather than a regex, because a template literal carries its
 * own `}` in every `${…}` and a lazy `[^}]*` stops at the first one. Reading
 * `id={\`row-${id}\`}` as `\`row-${id\`` is how a checker decides a labelled
 * input is unlabelled.
 */
function bracedAttr(attrs: string, name: string): string | null {
  const start = attrs.indexOf(`${name}={`);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + name.length + 1; i < attrs.length; i += 1) {
    if (attrs[i] === '{') depth += 1;
    else if (attrs[i] === '}') {
      depth -= 1;
      if (depth === 0) return attrs.slice(start + name.length + 2, i);
    }
  }
  return null;
}

/** Is the position inside an as-yet-unclosed <Wrapper> that renders a label? */
function insideLabellingWrapper(before: string, wrappers: Set<string>): boolean {
  for (const name of wrappers) {
    const opened = (before.match(new RegExp(`<${name}\\b`, 'g')) ?? []).length;
    const closed = (before.match(new RegExp(`</${name}>`, 'g')) ?? []).length;
    if (opened > closed) return true;
  }
  return false;
}

function jsxScan() {
  const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];
  const wrappers = labellingWrappers(files);

  const namelessButtons: string[] = [];
  const unlabelledInputs: string[] = [];
  const positiveTabIndex: string[] = [];
  const clickableDivs: string[] = [];
  let buttonCount = 0;
  let iconOnly = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const where = relative(ROOT, file).replace(/\\/g, '/');

    for (const b of buttons(source)) {
      buttonCount += 1;

      // A button spreading props could be handed children or an aria-label by
      // its caller, and there is no way to know from here. The shared Button
      // primitive is one of these; the callers are what get checked.
      if (/\{\s*\.\.\./.test(b.attrs)) continue;
      // Self-closing: its children come from somewhere else entirely.
      if (b.body === '') continue;

      // What is left after the markup comes off? Two rules make this right:
      //
      //   A self-closing element is an icon or an image — it contributes no
      //   text, so the whole thing goes.
      //
      //   Every other tag is stripped but its *content is kept*. Removing
      //   `<span>…</span>` wholesale takes the label with it, and a button
      //   reading `<span>{t('auth.signOut')}</span>` gets reported as nameless
      //   when it is nothing of the kind.
      //
      // Anything remaining — literal text or an interpolation like
      // `{periodLabels[key]}` — is a name.
      const remaining = b.body
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
        .replace(/<[A-Za-z][\w.]*\b[^>]*\/>/g, ' ')
        .replace(/<\/?[A-Za-z][\w.]*\b[^>]*>/g, ' ')
        .trim();

      const named = /aria-label|aria-labelledby|title=/.test(b.attrs);
      if (!remaining) {
        iconOnly += 1;
        if (!named) namelessButtons.push(`${where}:${lineOf(source, b.index)}`);
      }
    }

    // An input is labelled if it carries its own name, sits inside a <label>,
    // or is passed as a child to a wrapper component that renders one.
    //
    // That last case is the whole reason this needs care. The forms here use a
    // <Field label="…"><input /></Field> pattern, and the input is textually
    // outside any <label> at the call site even though it is inside one in the
    // DOM. A checker that does not understand composition reports twenty-odd
    // false failures, and a checker that cries wolf is a checker people stop
    // reading — which is worse than not having one.
    const inputRe = /<(input|textarea|select)\b([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = inputRe.exec(source))) {
      const attrs = m[2] ?? '';
      if (/type=["']hidden["']/.test(attrs)) continue;
      // display:none takes it out of the accessibility tree entirely — the
      // visible control that triggers it is the one that needs a name.
      if (/className=["'][^"']*\bhidden\b/.test(attrs)) continue;
      if (/aria-label|aria-labelledby/.test(attrs)) continue;

      // An explicit <label htmlFor="x"> for this input's id. Checked as a
      // pair rather than accepting a bare id: an id with no label pointing at
      // it names nothing, and that is exactly the bug worth catching.
      const id = attrs.match(/\bid=["']([^"']+)["']/)?.[1];
      if (id && new RegExp(`htmlFor=["']${id}["']`).test(source)) continue;

      // The same thing built from a value: id={`reason-${row.id}`} is paired
      // with htmlFor={`reason-${row.id}`}. One id per row, and the browser
      // associates them exactly as it does a pair of plain strings.
      const expression = bracedAttr(attrs, 'id');
      if (expression && source.includes(`htmlFor={${expression}}`)) continue;

      const before = source.slice(0, m.index);
      const openLabels = (before.match(/<label\b/g) ?? []).length;
      const closeLabels = (before.match(/<\/label>/g) ?? []).length;
      if (openLabels > closeLabels) continue;

      if (insideLabellingWrapper(before, wrappers)) continue;

      unlabelledInputs.push(`${where}:${lineOf(source, m.index)}`);
    }

    for (const match of source.matchAll(/tabIndex=\{([1-9]\d*)\}/g)) {
      positiveTabIndex.push(`${where}:${lineOf(source, match.index)}`);
    }
    for (const match of source.matchAll(/<div\b[^>]*\bonClick=/g)) {
      const tag = match[0];
      if (/role=/.test(tag)) continue;
      clickableDivs.push(`${where}:${lineOf(source, match.index)}`);
    }
  }

  if (namelessButtons.length) {
    fail(
      'icon-only buttons with no accessible name',
      namelessButtons.slice(0, 8).join(', ') +
        (namelessButtons.length > 8 ? ` and ${namelessButtons.length - 8} more` : ''),
    );
  } else {
    ok(
      'every icon-only button has a name',
      `${iconOnly} of ${buttonCount} buttons are icon-only, and all carry aria-label or title`,
    );
  }

  if (unlabelledInputs.length) {
    fail(
      'form controls with no label',
      unlabelledInputs.slice(0, 8).join(', ') +
        (unlabelledInputs.length > 8 ? ` and ${unlabelledInputs.length - 8} more` : ''),
    );
  } else {
    ok(
      'every form control is labelled',
      `each carries aria-label, sits inside a <label>, or is a child of ` +
        `${[...wrappers].join(', ') || 'none'} — which render one`,
    );
  }

  if (positiveTabIndex.length) {
    warn('positive tabIndex', positiveTabIndex.join(', ') + ' — it overrides document order');
  } else {
    ok('no positive tabIndex anywhere', 'focus follows the document, which is what it should do');
  }

  if (clickableDivs.length) {
    warn(
      'a div with onClick and no role',
      clickableDivs.join(', ') + ' — not reachable by keyboard',
    );
  } else {
    ok('nothing clickable is a bare div', 'every control is a real button or link');
  }
}

// ---------------------------------------------------------------------------
// The things this app needs specifically
// ---------------------------------------------------------------------------
function stationChecks() {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

  const tap = css.match(/\.tap-target\s*\{([^}]*)\}/);
  const minSize = tap?.[1]?.match(/min-height:\s*(\d+)px/);
  const px = minSize ? Number(minSize[1]) : 0;
  if (px >= 44) {
    ok('touch targets are big enough', `.tap-target is ${px}px, at or above the 44px guideline`);
  } else {
    fail('touch targets', `.tap-target is ${px || 'unset'}px; a gloved thumb needs 44px`);
  }

  if (/:focus-visible\s*\{/.test(css)) {
    ok('focus is visible', 'a :focus-visible outline is defined');
  } else {
    fail('focus is visible', 'no :focus-visible rule — keyboard users cannot see where they are');
  }

  if (/prefers-reduced-motion/.test(css)) {
    ok('reduced motion is honoured', 'a prefers-reduced-motion block is present');
  } else {
    warn(
      'reduced motion',
      'no prefers-reduced-motion block; the skeleton sweep animates regardless',
    );
  }

  // Bangla is the default language of the station, so the document has to say
  // so — a screen reader picks its voice from it.
  const layout = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8');
  if (/<html[^>]*lang="bn"/.test(layout)) {
    ok('the document declares Bangla', 'a screen reader picks the right voice');
  } else {
    fail('the document language', 'the <html> tag should declare lang="bn"');
  }
}

console.log('— colour —');
contrastPass();
console.log('\n— markup —');
jsxScan();
console.log('\n— this station —');
stationChecks();

console.log(
  `\n${failures === 0 ? 'Accessibility pass clean' : `${failures} failed`}${
    warnings ? `, ${warnings} to look at` : ''
  }.`,
);
process.exit(failures > 0 ? 1 : 0);
