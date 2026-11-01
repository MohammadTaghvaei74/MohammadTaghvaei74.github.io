const assert = require('assert');
const {
  THEME_PREFERENCE_KEY,
  THEMES,
  normalizeTheme,
  getStoredTheme,
  resolveTheme,
  applyTheme,
  createBootstrapScript,
  mountThemePreference,
} = require('../market/theme-preference.js');

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

function createFakeDocument() {
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.listeners = {};
      this.className = '';
      this.textContent = '';
      this.checked = false;
      this.type = '';
      this.name = '';
      this.value = '';
    }
    append(...nodes) { this.children.push(...nodes); return this; }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    dispatch(name) { if (this.listeners[name]) this.listeners[name]({ target: this }); }
    querySelectorAll(selector) {
      const result = [];
      const visit = (node) => {
        if (selector === 'input[type="radio"]' && node.tagName === 'INPUT' && node.type === 'radio') result.push(node);
        for (const child of node.children || []) visit(child);
      };
      visit(this);
      return result;
    }
  }
  const document = {
    documentElement: new Element('html'),
    createElement: (tagName) => new Element(tagName),
  };
  return document;
}

function storageWith(value, { throwOnRead = false, throwOnWrite = false } = {}) {
  return {
    getItem() {
      if (throwOnRead) throw new Error('blocked');
      return value;
    },
    setItem(key, next) {
      if (throwOnWrite) throw new Error('blocked');
      this.value = [key, next];
    },
  };
}

test('exposes the stable preference contract', () => {
  assert.strictEqual(THEME_PREFERENCE_KEY, 'sorena-theme');
  assert.deepStrictEqual(THEMES, ['light', 'dark', 'system']);
});

test('normalizes invalid persisted values to system', () => {
  assert.strictEqual(normalizeTheme('dark'), 'dark');
  assert.strictEqual(normalizeTheme('light'), 'light');
  assert.strictEqual(normalizeTheme('system'), 'system');
  assert.strictEqual(normalizeTheme('sepia'), 'system');
  assert.strictEqual(normalizeTheme(null), 'system');
});

test('reads localStorage safely and ignores invalid values', () => {
  assert.strictEqual(getStoredTheme(storageWith('dark')), 'dark');
  assert.strictEqual(getStoredTheme(storageWith('sepia')), 'system');
  assert.strictEqual(getStoredTheme(storageWith(null)), 'system');
  assert.strictEqual(getStoredTheme(storageWith(null, { throwOnRead: true })), 'system');
});

test('resolves system to the media preference', () => {
  assert.strictEqual(resolveTheme('system', { matches: true }), 'dark');
  assert.strictEqual(resolveTheme('system', { matches: false }), 'light');
  assert.strictEqual(resolveTheme('dark', { matches: false }), 'dark');
});

test('applies resolved theme without throwing on a restricted storage', () => {
  const document = createFakeDocument();
  const media = { matches: true };
  const result = applyTheme(document, 'system', media);
  assert.strictEqual(result, 'dark');
  assert.strictEqual(document.documentElement.dataset.theme, 'dark');
  assert.strictEqual(document.documentElement.dataset.themePreference, 'system');
  assert.strictEqual(document.documentElement.style.colorScheme, 'dark');
});

test('bootstrap script is self-contained and runs before paint', () => {
  const script = createBootstrapScript();
  assert.match(script, /localStorage/);
  assert.match(script, /prefers-color-scheme/);
  assert.match(script, /dataset\.theme/);
  assert.ok(script.length < 900, `bootstrap should stay tiny (${script.length} chars)`);
});

test('mounts an accessible light/dark/system radio group and persists changes', () => {
  const document = createFakeDocument();
  const container = document.createElement('div');
  const storage = storageWith('light');
  const controller = mountThemePreference(container, { document, storage, mediaQuery: { matches: false } });
  const radios = container.querySelectorAll('input[type="radio"]');
  assert.strictEqual(radios.length, 3);
  assert.deepStrictEqual(radios.map((radio) => radio.value), THEMES);
  assert.strictEqual(radios.filter((radio) => radio.checked).length, 1);
  const dark = radios.find((radio) => radio.value === 'dark');
  dark.checked = true;
  dark.dispatch('change');
  assert.strictEqual(storage.value[0], THEME_PREFERENCE_KEY);
  assert.strictEqual(storage.value[1], 'dark');
  assert.strictEqual(document.documentElement.dataset.theme, 'dark');
  assert.strictEqual(controller.getPreference(), 'dark');
  controller.destroy();
});

test('updates a system preference when the operating system theme changes', () => {
  const document = createFakeDocument();
  const container = document.createElement('div');
  const mediaQuery = {
    matches: false,
    addEventListener(name, listener) { this.listener = listener; },
    removeEventListener() {},
  };
  const controller = mountThemePreference(container, { document, storage: storageWith('system'), mediaQuery });
  assert.strictEqual(document.documentElement.dataset.theme, 'light');
  mediaQuery.matches = true;
  mediaQuery.listener({ matches: true });
  assert.strictEqual(document.documentElement.dataset.theme, 'dark');
  assert.strictEqual(controller.getResolvedTheme(), 'dark');
});

test('mounting remains usable when storage writes are blocked', () => {
  const document = createFakeDocument();
  const container = document.createElement('div');
  const radioStorage = storageWith(null, { throwOnWrite: true });
  const controller = mountThemePreference(container, { document, storage: radioStorage, mediaQuery: { matches: false } });
  const dark = container.querySelectorAll('input[type="radio"]').find((radio) => radio.value === 'dark');
  dark.checked = true;
  assert.doesNotThrow(() => dark.dispatch('change'));
  assert.strictEqual(controller.getPreference(), 'dark');
});

test('bootstrap still follows OS when localStorage access is blocked', () => {
  const document = createFakeDocument();
  const context = { document, matchMedia: () => ({ matches: true }) };
  Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError'); } });
  require('vm').runInNewContext(createBootstrapScript(), context);
  assert.strictEqual(document.documentElement.dataset.theme, 'dark');
  assert.strictEqual(document.documentElement.dataset.themePreference, 'system');
});

test('bootstrap honors explicit preference when matchMedia is unavailable', () => {
  const document = createFakeDocument();
  require('vm').runInNewContext(createBootstrapScript(), { document, localStorage: storageWith('dark') });
  assert.strictEqual(document.documentElement.dataset.theme, 'dark');
});

if (process.exitCode) process.exit(process.exitCode);
else process.stdout.write('theme preference tests passed\n');

// Optional isolated Chromium integration; no HTML/source edits or market data mocks.
if (process.argv.includes('--browser')) {
  const { spawnSync } = require('child_process');
  const result = spawnSync('python', ['-c', String.raw`
import functools, http.server, json, os, re, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path.cwd()
bootstrap = os.environ['THEME_BOOTSTRAP']
fixture = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><script>''' + bootstrap + '''</script>
<script>window.prepaintTheme=document.documentElement.dataset.theme</script>
<link rel="stylesheet" href="/market/styles.css"><link rel="stylesheet" href="/market/design-system.css">
<link rel="stylesheet" href="/market/theme-preference.css"></head><body>
<div id="control"></div><main class="panel"><h1>Theme accessibility test</h1>
<p data-tone="positive">Positive</p><p data-tone="negative">Negative</p><p data-tone="warning">Warning</p>
<svg role="img" aria-label="Style test, no market data"><text class="chart-label" x="10" y="20">Axis label</text></svg></main>
<script src="/market/theme-preference.js"></script><script>
window.control=SorenaThemePreference.mountThemePreference(document.querySelector('#control'));
</script></body></html>'''
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == '/theme-fixture':
            body = fixture.encode()
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        else: super().do_GET()
server = http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(Handler,directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
def rgb(value): return [float(x)/255 for x in re.findall(r'[\d.]+',value)[:3]]
def luminance(value):
    v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in rgb(value)]
    return sum(a*b for a,b in zip(v,[.2126,.7152,.0722]))
def contrast(a,b):
    values=sorted([luminance(a),luminance(b)])
    return (values[1]+.05)/(values[0]+.05)
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        context=browser.new_context(color_scheme='light', reduced_motion='reduce', viewport={'width':390,'height':844})
        page=context.new_page(); errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/market/theme-preference.js')
        page.evaluate("localStorage.setItem('sorena-theme','dark')")
        page.goto(base+'/theme-fixture')
        assert page.evaluate('window.prepaintTheme')=='dark','bootstrap must set theme before stylesheet'
        assert page.get_by_role('group',name='Theme').count()==1
        assert page.get_by_role('radio').count()==3
        assert page.get_by_role('radio',name='Dark',exact=True).is_checked()
        page.get_by_role('radio',name='Light',exact=True).focus()
        page.keyboard.press('Space')
        assert page.evaluate('document.documentElement.dataset.theme')=='light'
        page.keyboard.press('ArrowRight')
        assert page.get_by_role('radio',name='Dark',exact=True).is_checked(),'native arrow navigation'
        assert page.evaluate("localStorage.getItem('sorena-theme')")=='dark'
        page.reload()
        assert page.get_by_role('radio',name='Dark',exact=True).is_checked(),'persistence across reload'
        page.get_by_role('radio',name='System',exact=True).check()
        assert page.evaluate('document.documentElement.dataset.theme')=='light'
        page.emulate_media(color_scheme='dark')
        page.wait_for_function("document.documentElement.dataset.theme==='dark'")
        page.get_by_role('radio',name='Light',exact=True).check()
        page.emulate_media(color_scheme='light'); page.emulate_media(color_scheme='dark')
        assert page.evaluate('document.documentElement.dataset.theme')=='light','explicit preference stays fixed'
        checks=[]
        for theme in ['light','dark']:
            page.get_by_role('radio',name=theme.title(),exact=True).check()
            state=page.evaluate('''() => {
              const cs=e=>getComputedStyle(e), root=document.documentElement;
              return {theme:root.dataset.theme,surface:cs(document.querySelector('main')).backgroundColor,
                ink:cs(document.querySelector('main')).color,
                semantic:[...document.querySelectorAll('[data-tone]')].map(e=>({tone:e.dataset.tone,color:cs(e).color})),
                targets:[...document.querySelectorAll('.theme-preference__option')].map(e=>e.getBoundingClientRect().height),
                motion:cs(document.querySelector('.theme-preference__option')).transitionDuration};
            }''')
            assert min(state['targets'])>=44,state
            assert contrast(state['ink'],state['surface'])>=4.5,state
            for semantic in state['semantic']:
                semantic['contrast']=round(contrast(semantic['color'],state['surface']),2)
                assert semantic['contrast']>=4.5,(theme,semantic)
            assert float(state['motion'].replace('s',''))<=.001,state
            checks.append(state)
        blocked=context.new_page()
        blocked.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})")
        blocked.emulate_media(color_scheme='dark')
        blocked.goto(base+'/theme-fixture')
        assert blocked.evaluate('window.prepaintTheme')=='dark'
        blocked.get_by_role('radio',name='Light',exact=True).check()
        assert blocked.evaluate('document.documentElement.dataset.theme')=='light'
        assert not errors,errors
        print(json.dumps({'browser':'Chrome headless','checks':checks,'blockedStorage':'pass','keyboard':'pass','prepaint':'pass','errors':errors}))
        browser.close()
finally:
    server.shutdown(); server.server_close()
`], { cwd: require('path').resolve(__dirname, '..'), env: { ...process.env, THEME_BOOTSTRAP: createBootstrapScript() }, encoding: 'utf8', timeout: 120000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

module.exports = { createFakeDocument };
