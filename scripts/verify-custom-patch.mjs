import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const customJsPath = resolve(__dirname, '../public/custom.js')
const customCssPath = resolve(__dirname, '../public/custom.css')
const customJs = readFileSync(customJsPath, 'utf8')
const customCss = readFileSync(customCssPath, 'utf8')

function noop() {}

class NoopMutationObserver {
  observe() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

class MessageEvent {
  constructor(type, init = {}) {
    this.type = type
    Object.assign(this, init)
  }
}

class HashChangeEvent {
  constructor(type, init = {}) {
    this.type = type
    Object.assign(this, init)
  }
}

function createElement() {
  return {
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    appendChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
  }
}

const document = {
  documentElement: createElement(),
  body: createElement(),
  head: createElement(),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement,
  createTreeWalker: () => ({ nextNode: () => null }),
  addEventListener: noop,
  removeEventListener: noop,
}

const window = {
  __NODEGET_CUSTOM_PATCH_TEST_HOOK__: true,
  devicePixelRatio: 1,
  location: { hash: '' },
  document,
  NodeFilter: { SHOW_TEXT: 4 },
  MessageEvent,
  HashChangeEvent,
  MutationObserver: NoopMutationObserver,
  setTimeout,
  clearTimeout,
  requestAnimationFrame(callback) {
    if (typeof callback === 'function') callback()
    return 0
  },
  cancelAnimationFrame: noop,
  addEventListener: noop,
  removeEventListener: noop,
  fetch() {
    throw new Error('fetch should not be invoked in custom patch test mode')
  },
}

const sandbox = {
  console,
  window,
  document,
  NodeFilter: window.NodeFilter,
  MessageEvent,
  HashChangeEvent,
  MutationObserver: NoopMutationObserver,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: noop,
  fetch: window.fetch,
}

function test(name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (error) {
    error.message = `not ok - ${name}: ${error.message}`
    throw error
  }
}

vm.runInNewContext(customJs, sandbox, { filename: customJsPath })

test('custom patch test API exposure', () => {
  assert.ok(window.__NODEGET_CUSTOM_PATCH_TEST_API__)
  for (const name of [
    'translateCardText',
    'parseLatencyTaskQuery',
    'latencyRequestWindow',
    'mergeLatencyRows',
    'downsampleLatencyRows',
    'normalizeLatencyTimestamp',
    'compareLatencyTargets',
    'normalizeFooterVersion',
    'ensureFooterVersionElement',
    'applyFooterVersionText',
    'renderFooterThemeNote',
    'sanitizeUnsupportedMapView',
    'providerFromName',
    'deriveProviderListFromNames',
    'providerFilterButtonHtml',
  ]) {
    assert.equal(typeof window.__NODEGET_CUSTOM_PATCH_TEST_API__[name], 'function')
  }
})

const api = window.__NODEGET_CUSTOM_PATCH_TEST_API__
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function latencyTaskQuery({ id = 1, uuid = 'agent-1', type = 'ping', timestampWindow = [0, 1] } = {}) {
  return {
    jsonrpc: '2.0',
    method: 'task_query',
    id,
    params: {
      task_data_query: {
        condition: [{ uuid }, { type }, { timestamp_from_to: timestampWindow }, { limit: 1000 }],
      },
    },
  }
}

function row(overrides = {}) {
  return {
    task_id: 'task-1',
    uuid: 'agent-1',
    timestamp: 1_700_000_000_000,
    cron_source: 'source-a',
    success: true,
    type: 'ping',
    task_event_type: { ping: true },
    task_event_result: { ping: 10, tcp_ping: 20 },
    ...overrides,
  }
}

function assertWindow(actual, expected) {
  assert.equal(actual.length, expected.length)
  assert.equal(actual[0], expected[0])
  assert.equal(actual[1], expected[1])
}

const translationCases = [
  ['loading backend text', '连接后端中…', 'Loading'],
  ['loading text', '加载中…', 'Loading'],
  ['last hour period', '近 1 小时', 'LAST 1 D'],
  ['last day period', '近 1 天', 'LAST 1 D'],
  ['cpu usage metric', 'CPU 占用', 'CPU USAGE'],
  ['memory usage metric', '内存 占用', 'MEM USAGE'],
  ['disk usage metric', '磁盘 占用', 'DISK USAGE'],
  ['download speed metric', '下行 速度', 'DOWN SPEED'],
  ['upload speed metric', '上行 速度', 'UP SPEED'],
  ['tcp ping empty data', '暂无 tcp_ping 数据', 'No tcp_ping data'],
  ['ping empty data current behavior', '暂无 ping 数据', 'No ping data'],
  ['probe latency and loss labels', 'ping-广州联通 平均延迟 丢包率', 'GUANGZHOU UNICOM AVG LATENCY LOSS'],
  ['network load heading', '网络与负载', 'NETWORK / LOAD'],
  ['system detail labels', '操作系统 CPU 型号 数据更新', 'OS CPU MODEL DATA UPDATED'],
  ['close details action', '关闭详情', 'CLOSE DETAILS'],
  ['light mode toggle current behavior', '切换到浅色模式', '切换到LIGHT MODE'],
  ['days ago relative time', '1 天前', '1 D AGO'],
  ['minutes ago relative time', '10 分钟前', '10 MIN AGO'],
]

for (const [name, input, expected] of translationCases) {
  test(`translation snapshot - ${name}`, () => {
    assert.equal(api.translateCardText(input), expected)
  })
}

test('SORT menu marker remains absent', () => {
  assert.equal((customJs.match(/aria-haspopup="menu"/g) || []).length, 0, 'SORT menu CSS/JS marker should remain absent if SORT is long-term hidden')
})

test('provider filter derives stable public provider labels from node names', () => {
  assert.equal(api.providerFromName('Akile: HK 01'), 'Akile')
  assert.equal(api.providerFromName('Bandwagon\uff1a LA 02'), 'Bandwagon')
  assert.deepEqual(
    Array.from(api.deriveProviderListFromNames(['Akile HK 01', 'Bandwagon LA 02', 'akile SG 02', 'Oracle Tokyo', '', 'ALL Nodes'])),
    ['Akile', 'Bandwagon', 'Oracle'],
  )
})

test('provider filter button markup escapes labels and tracks active state', () => {
  const html = api.providerFilterButtonHtml('Foo & "Bar"', true, 3)

  assert.ok(html.includes('class="nodeget-provider-chip is-active"'))
  assert.ok(html.includes('data-nodeget-provider-filter="Foo &amp; &quot;Bar&quot;"'))
  assert.ok(html.includes('data-nodeget-provider-index="03"'))
  assert.ok(html.includes('aria-pressed="true"'))
  assert.ok(html.endsWith('Foo &amp; &quot;Bar&quot;</button>'))
})

test('critical custom.js patch-layer markers remain present', () => {
  const requiredJsMarkers = [
    'new MutationObserver',
    'classMutationIsOnlyNodeget',
    'childListMutationIsPatchOwned',
    'characterMutationIsPatchOwned',
    'nodeget-detail-drawer-pending',
    'detailDrawerPendingTimer',
    'window.history.replaceState',
    "VIEW_KEY = 'nodeget.view'",
    'sanitizeUnsupportedMapView',
    "localStorage.getItem(VIEW_KEY) === 'map'",
    "localStorage.setItem(VIEW_KEY, 'cards')",
    '返回',
    '关闭详情',
    'BACK',
    'CLOSE DETAILS',
    'installLatencyTaskProxy',
    'handleLatencyTaskQuery',
    'cache.inFlight',
    'LATENCY_QUERY_TIMEOUT_MS',
    'downsampleLatencyRows',
    'hideFooterReleaseControls',
    'nodeget-footer-release-control-hidden',
    'download\\.html',
    '提取当前主题',
    '升级到',
    // Extension seam: deployments that rewrite flag <img> sources register
    // matchers here so the theme stays agnostic to any specific proxy route.
    'NODEGET_FLAG_MATCHERS',
    // Extension seam: deployments with stricter backend query limits override
    // the latency row cap here, so the private value stays out of the theme.
    'NODEGET_LATENCY_QUERY_LIMIT',
    'nodeget-provider-filter',
    'providerFilterButtonHtml',
  ]

  for (const marker of requiredJsMarkers) {
    assert.ok(customJs.includes(marker), `custom.js should keep marker: ${marker}`)
  }
})

test('private server-order code stays out while provider filter stays public', () => {
  for (const marker of [
    'server-order.json',
    'enable_server_order',
    'loadServerOrder',
    'nodeget-server_list_all_agent_uuid',
    'providerChipHtml',
    // Deployment-specific proxy routes must not be hard-coded here; the theme
    // matches flags via the NODEGET_FLAG_MATCHERS seam, so this literal route
    // must never leak back into custom.js.
    '/flag/',
  ]) {
    assert.equal(customJs.includes(marker), false, `custom.js must not contain private marker: ${marker}`)
  }

  for (const marker of [
    'nodeget-provider-filter',
    'nodeget-provider-chip',
    'nodeget-provider-hidden',
    'nodeget-hidden-tag-filter',
  ]) {
    assert.ok(customJs.includes(marker) || customCss.includes(marker), `provider filter marker should be public: ${marker}`)
  }
})

test('critical custom.css patch-layer markers remain present', () => {
  const requiredCssMarkers = [
    'nodeget-detail-drawer-open',
    'nodeget-detail-drawer-pending',
    'Light-mode detail dividers',
    'Detail latency chart tooltips',
    'nodeget-map-view-hidden',
    'nodeget-footer-release-control-hidden',
    'overflow-x: auto',
    'z-index: 120',
  ]

  for (const marker of requiredCssMarkers) {
    assert.ok(customCss.includes(marker), `custom.css should keep marker: ${marker}`)
  }
})

test('unsupported MAP view localStorage state is reset to cards', () => {
  const store = new Map([['nodeget.view', 'map']])
  const originalLocalStorage = window.localStorage
  window.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
  }

  try {
    api.sanitizeUnsupportedMapView()
    assert.equal(store.get('nodeget.view'), 'cards')
  } finally {
    window.localStorage = originalLocalStorage
  }
})

test('non-MAP view localStorage state is preserved', () => {
  const store = new Map([['nodeget.view', 'table']])
  const originalLocalStorage = window.localStorage
  window.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
  }

  try {
    api.sanitizeUnsupportedMapView()
    assert.equal(store.get('nodeget.view'), 'table')
  } finally {
    window.localStorage = originalLocalStorage
  }
})

test('latency timing constants', () => {
  assert.match(customJs, /LATENCY_WINDOW_MS\s*=\s*24 \* 60 \* 60 \* 1000/)
  assert.match(customJs, /LATENCY_BUCKET_MS\s*=\s*5 \* 60 \* 1000/)
  assert.match(customJs, /LATENCY_REFRESH_FLOOR_MS\s*=\s*60 \* 1000/)
  // Public default must stay generic; a stricter per-deployment cap belongs in
  // window.NODEGET_LATENCY_QUERY_LIMIT, not hard-coded into the theme.
  assert.match(customJs, /LATENCY_QUERY_LIMIT_DEFAULT\s*=\s*20000/)
})

test('latency parser accepts ping task_query with uuid, id, and timestamp window', () => {
  const parsed = api.parseLatencyTaskQuery(latencyTaskQuery({
    id: 'query-1',
    uuid: 'agent-uuid',
    type: 'ping',
    timestampWindow: [1_700_000_000_000, 1_700_001_000_000],
  }))

  assert.equal(parsed.uuid, 'agent-uuid')
  assert.equal(parsed.type, 'ping')
})

test('latency parser rejects missing id', () => {
  const message = latencyTaskQuery()
  delete message.id

  assert.equal(api.parseLatencyTaskQuery(message), null)
})

test('latency parser rejects non-latency task_query type', () => {
  assert.equal(api.parseLatencyTaskQuery(latencyTaskQuery({ type: 'http' })), null)
})

test('latency request window uses last 24 hours for empty cache', () => {
  const now = 1_700_100_000_000

  assertWindow(api.latencyRequestWindow([], now), [now - DAY, now])
})

test('latency request window overlaps from latest cached row', () => {
  const now = 1_700_100_000_000
  const latest = now - HOUR

  assertWindow(api.latencyRequestWindow([row({ timestamp: latest })], now), [latest - 2 * MIN, now])
})

test('latency request window ignores old rows beyond 24 hours', () => {
  const now = 1_700_100_000_000

  assertWindow(api.latencyRequestWindow([row({ timestamp: now - DAY - HOUR })], now), [now - DAY, now])
})

test('mergeLatencyRows drops old rows and incoming task_id replacements win', () => {
  const now = 1_700_100_000_000
  const old = row({ task_id: 'old', timestamp: now - DAY - MIN })
  const previous = row({ task_id: 'shared', timestamp: now - HOUR, task_event_result: { ping: 10 } })
  const incoming = row({ task_id: 'shared', timestamp: now - MIN, task_event_result: { ping: 30 } })

  const merged = api.mergeLatencyRows([old, previous], [incoming], now)

  assert.equal(merged.length, 1)
  assert.equal(merged[0].task_id, 'shared')
  assert.equal(merged[0].task_event_result.ping, 30)
})

test('downsampleLatencyRows groups by 5-minute bucket and source', () => {
  const now = 1_700_100_000_000
  const bucketStart = Math.floor((now - HOUR) / (5 * MIN)) * (5 * MIN)

  const downsampled = api.downsampleLatencyRows(
    [
      row({ task_id: 'a', timestamp: bucketStart + MIN, cron_source: 'source-a', task_event_result: { ping: 10 } }),
      row({ task_id: 'b', timestamp: bucketStart + 2 * MIN, cron_source: 'source-a', task_event_result: { ping: 20 } }),
      row({ task_id: 'c', timestamp: bucketStart + 3 * MIN, cron_source: 'source-b', task_event_result: { ping: 40 } }),
    ],
    'ping',
    now,
  )

  assert.equal(downsampled.length, 2)
  assert.equal(downsampled[0].timestamp, bucketStart)
  assert.equal(downsampled[0].cron_source, 'source-a')
  assert.equal(downsampled[0].task_event_result.ping, 15)
  assert.equal(downsampled[1].timestamp, bucketStart)
  assert.equal(downsampled[1].cron_source, 'source-b')
  assert.equal(downsampled[1].task_event_result.ping, 40)
})

test('downsampleLatencyRows orders known probe sources for legends', () => {
  const now = 1_700_100_000_000
  const bucketStart = Math.floor((now - HOUR) / (5 * MIN)) * (5 * MIN)

  const downsampled = api.downsampleLatencyRows(
    [
      row({ task_id: 'gd-mobile', timestamp: bucketStart + MIN, cron_source: 'ping-广东移动', task_event_result: { ping: 90 } }),
      row({ task_id: 'bj-telecom', timestamp: bucketStart + MIN, cron_source: '北京电信', task_event_result: { ping: 10 } }),
      row({ task_id: 'sh-unicom', timestamp: bucketStart + MIN, cron_source: 'tcping-上海联通', task_event_result: { ping: 50 } }),
      row({ task_id: 'bj-mobile', timestamp: bucketStart + MIN, cron_source: '北京移动', task_event_result: { ping: 30 } }),
      row({ task_id: 'unknown', timestamp: bucketStart + MIN, cron_source: 'ZZZ', task_event_result: { ping: 100 } }),
    ],
    'ping',
    now,
  )

  assert.deepEqual(
    Array.from(downsampled, (item) => item.cron_source),
    ['北京电信', '北京移动', 'tcping-上海联通', 'ping-广东移动', 'ZZZ'],
  )
})

test('downsampleLatencyRows ignores unknown source rows', () => {
  const now = 1_700_100_000_000

  const downsampled = api.downsampleLatencyRows(
    [
      row({ task_id: 'unknown', timestamp: now - HOUR, cron_source: '未知', task_event_result: { ping: 10 } }),
      row({ task_id: 'missing-source', timestamp: now - HOUR, cron_source: undefined, task_event_result: { ping: 20 } }),
    ],
    'ping',
    now,
  )

  assert.equal(downsampled.length, 0)
})

function testElement(className = '', textContent = '') {
  const element = {
    className,
    _textContent: textContent,
    dataset: {},
    children: [],
    childNodes: [],
    parentElement: null,
    nodeType: 1,
    tagName: '',
    href: '',
    target: '',
    rel: '',
    attributes: {},
    classList: {
      add(...names) {
        const classes = new Set(String(element.className || '').split(/\s+/).filter(Boolean))
        for (const name of names) classes.add(name)
        element.className = Array.from(classes).join(' ')
      },
      contains(name) {
        return String(element.className || '').split(/\s+/).includes(name)
      },
    },
    get textContent() {
      if (element.childNodes.length > 0) return element.childNodes.map((child) => child.textContent || '').join('')
      return element._textContent
    },
    set textContent(value) {
      element._textContent = String(value)
      element.children = []
      element.childNodes = []
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value)
      element[name] = String(value)
    },
    getAttribute(name) {
      return Object.hasOwn(element.attributes, name) ? element.attributes[name] : element[name] || null
    },
    appendChild(child) {
      if (child.parentElement) {
        const oldIndex = child.parentElement.children.indexOf(child)
        if (oldIndex !== -1) child.parentElement.children.splice(oldIndex, 1)
        const oldNodeIndex = child.parentElement.childNodes.indexOf(child)
        if (oldNodeIndex !== -1) child.parentElement.childNodes.splice(oldNodeIndex, 1)
      }
      child.parentElement = element
      element.childNodes.push(child)
      if (child.nodeType !== 3) element.children.push(child)
      return child
    },
    insertBefore(child, reference) {
      if (child.parentElement) {
        const oldIndex = child.parentElement.children.indexOf(child)
        if (oldIndex !== -1) child.parentElement.children.splice(oldIndex, 1)
        const oldNodeIndex = child.parentElement.childNodes.indexOf(child)
        if (oldNodeIndex !== -1) child.parentElement.childNodes.splice(oldNodeIndex, 1)
      }
      child.parentElement = element
      const index = element.children.indexOf(reference)
      if (index === -1) {
        element.childNodes.push(child)
        if (child.nodeType !== 3) element.children.push(child)
      } else {
        const nodeIndex = element.childNodes.indexOf(reference)
        element.childNodes.splice(nodeIndex === -1 ? element.childNodes.length : nodeIndex, 0, child)
        if (child.nodeType !== 3) element.children.splice(index, 0, child)
      }
      return child
    },
    querySelector(selector) {
      return element.querySelectorAll(selector)[0] || null
    },
    querySelectorAll(selector) {
      const selectors = String(selector)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
      const results = []
      const visit = (node) => {
        for (const child of node.children || []) {
          if (selectors.some((part) => matchesSelector(child, part))) results.push(child)
          visit(child)
        }
      }
      visit(element)
      return results
    },
  }
  return element
}

function matchesSelector(element, selector) {
  if (selector === ':scope > a:first-child') {
    return String(element.tagName || '').toLowerCase() === 'a' && element.parentElement && element.parentElement.children[0] === element
  }
  if (selector === 'a' || selector === 'a[href]') return String(element.tagName || '').toLowerCase() === 'a'
  if (!selector.startsWith('.')) return false
  const required = selector
    .slice(1)
    .split('.')
    .filter(Boolean)
  return required.every((name) => element.classList.contains(name))
}

test('footer version restores the original separate version span idempotently', () => {
  const originalCreateElement = document.createElement
  const originalGetElementById = document.getElementById
  document.createElement = (tagName = '') => {
    const element = testElement()
    element.tagName = String(tagName).toUpperCase()
    return element
  }
  document.getElementById = () => null

  try {
    const footerBar = testElement('nodeget-archive-footer-bar')
    const powered = testElement('', 'Powered by NodeGet')
    powered.tagName = 'A'
    powered.setAttribute('href', 'https://github.com/NodeSeekDev/NodeGet-StatusShow')
    const hiddenDownload = testElement('', '提取当前主题')
    hiddenDownload.tagName = 'A'
    hiddenDownload.setAttribute('href', 'download.html')

    footerBar.appendChild(powered)
    footerBar.appendChild(hiddenDownload)

    const version = api.ensureFooterVersionElement(footerBar)
    api.ensureFooterVersionElement(footerBar)

    assert.equal(version.id, 'nodeget-abyssal-footer-version')
    assert.equal(version.tagName, 'SPAN')
    assert.equal(version.className, 'nodeget-archive-footer-version')
    assert.equal(powered.classList.contains('nodeget-archive-footer-powered'), true)
    assert.equal(footerBar.children[0], powered)
    assert.equal(footerBar.children[1], version)
    assert.equal(footerBar.children[2], hiddenDownload)
    assert.equal(footerBar.children.filter((child) => child.id === 'nodeget-abyssal-footer-version').length, 1)

    assert.equal(api.normalizeFooterVersion('1.4.3'), 'v1.4.3')
    assert.equal(api.normalizeFooterVersion('v1.4.3'), 'v1.4.3')
    assert.equal(api.normalizeFooterVersion(''), '')
    assert.equal(api.applyFooterVersionText(version, '1.4.3'), true)
    assert.equal(version.textContent, 'v1.4.3')
    assert.equal(api.applyFooterVersionText(version, ''), false)
    assert.equal(version.textContent, 'v1.4.3')
  } finally {
    document.createElement = originalCreateElement
    document.getElementById = originalGetElementById
  }
})

test('footer theme note renders attribution links idempotently', () => {
  const originalCreateElement = document.createElement
  const originalCreateTextNode = document.createTextNode
  document.createElement = (tagName = '') => {
    const element = testElement()
    element.tagName = String(tagName).toUpperCase()
    return element
  }
  document.createTextNode = (text = '') => ({
    nodeType: 3,
    textContent: String(text),
    parentElement: null,
  })

  try {
    const note = testElement('nodeget-archive-footer-theme-note')

    api.renderFooterThemeNote(note)
    api.renderFooterThemeNote(note)

    assert.equal(note.textContent, 'ABYSSAL THEME BY CLAVULIN')
    assert.equal(note.childNodes.length, 2)

    const links = note.querySelectorAll('a')
    assert.equal(links.length, 1)
    assert.equal(links[0].textContent, 'CLAVULIN')
    assert.equal(links[0].href, 'https://github.com/clavulin/nodeget-theme-abyssal')
    assert.equal(links[0].target, '_blank')
    assert.equal(links[0].rel, 'noreferrer')
    assert.equal(links[0].className, 'hover:text-primary transition-colors')
  } finally {
    document.createElement = originalCreateElement
    document.createTextNode = originalCreateTextNode
  }
})

test('detail drawer CSS marker', () => {
  assert.match(customCss, /nodeget-detail-drawer-open/)
})

test('light-mode detail divider CSS marker', () => {
  assert.match(customCss, /Light-mode detail dividers/)
})

test('detail latency chart tooltip CSS marker', () => {
  assert.match(customCss, /Detail latency chart tooltips/)
})

test('veil backgrounds use image-set() with AVIF/WebP and PNG fallback', () => {
  // Modern declaration: AVIF + WebP via image-set(), e.g. veil-top.
  assert.match(
    customCss,
    /image-set\(url\("\.\/assets\/veil-top\.avif"\) type\("image\/avif"\), url\("\.\/assets\/veil-top\.webp"\) type\("image\/webp"\), url\("\.\/assets\/veil-top\.png"\)\)/,
  )
  // Legacy PNG fallback declaration must remain so pre-image-set() browsers still render.
  assert.match(customCss, /Legacy PNG-only fallback/)
  // The veil PNG references must still exist (used by the fallback block AND as the
  // final entry inside each image-set()).
  for (const variant of [
    'veil-top',
    'veil-mid',
    'veil-deep',
    'veil-top-r90',
    'veil-top-r180',
    'veil-mid-r180',
    'veil-mid-flipx',
    'veil-deep-r180',
    'veil-deep-flipx',
  ]) {
    assert.ok(customCss.includes(`url("./assets/${variant}.png")`), `custom.css should reference ${variant}.png`)
  }
})

test('background asset variants exist on disk for image-set fallbacks', () => {
  const assetsDir = resolve(__dirname, '../public/assets')
  const required = [
    'specks.avif', 'specks.webp', 'specks.png',
    'veil-top.avif', 'veil-top.webp', 'veil-top.png',
    'veil-mid.avif', 'veil-mid.webp', 'veil-mid.png',
    'veil-deep.avif', 'veil-deep.webp', 'veil-deep.png',
    'veil-top-r90.avif', 'veil-top-r90.webp', 'veil-top-r90.png',
    'veil-top-r180.avif', 'veil-top-r180.webp', 'veil-top-r180.png',
    'veil-mid-r180.avif', 'veil-mid-r180.webp', 'veil-mid-r180.png',
    'veil-mid-flipx.avif', 'veil-mid-flipx.webp', 'veil-mid-flipx.png',
    'veil-deep-r180.avif', 'veil-deep-r180.webp', 'veil-deep-r180.png',
    'veil-deep-flipx.avif', 'veil-deep-flipx.webp', 'veil-deep-flipx.png',
  ]
  for (const name of required) {
    const path = resolve(assetsDir, name)
    assert.ok(existsSync(path), `expected asset variant present: public/assets/${name}`)
  }
})
