;(function () {
  /*
   * NodeGet StatusShow local runtime patch layer.
   *
   * Keep this file as a small DOM adapter over the upstream app:
   * - identify upstream DOM and add stable nodeget-* classes
   * - translate residual UI copy where source edits are not worth it
   * - preserve accepted ordering/filter/detail interactions for Abyssal deployments
   *
   * Avoid broad new observers or visual decisions here unless CSS cannot carry
   * them; prefer stable constants/selectors over repeated magic strings.
   */
  const CONFIG_URL = 'config.json'
  const NODEGET_CUSTOM_PATCH_TEST_MODE = !!window.__NODEGET_CUSTOM_PATCH_TEST_HOOK__
  const VIEW_KEY = 'nodeget.view'

  let configPromise
  let themeManifestPromise
  let domFlushQueued = false
  let themeEnhanceDirty = false
  let flagSwapDirty = false
  let detailDrawerDirty = false
  let segmentedBarsDirty = false
  let detailDrawerPendingTimer = 0
  let lastDetailSessionMeta = null
  let segmentedMetricCache = null
  let segmentedMetricCacheDirty = true

  const DESKTOP_DRAWER_QUERY = '(min-width: 768px)'
  const ARCHIVE_GRID_SELECTOR = 'main .grid'
  const ARCHIVE_CARD_SELECTOR = 'main .grid > a[href^="#"]'
  const DETAIL_ROOT_SELECTOR = 'div.fixed.inset-0.z-50.bg-background.overflow-y-auto, .nodeget-detail-drawer-root'
  const THEME_MANIFEST_URL = 'nodeget-theme.json'
  const FOOTER_THEME_NOTE_ID = 'nodeget-abyssal-footer-theme-note'
  const FOOTER_VERSION_ID = 'nodeget-abyssal-footer-version'
  const FOOTER_THEME_NOTE_TEXT = 'ABYSSAL THEME BY CLAVULIN'
  const FOOTER_POWERED_LINK_CLASS = 'nodeget-archive-footer-powered'
  const FOOTER_VERSION_CLASS = 'nodeget-archive-footer-version'
  const FOOTER_THEME_NOTE_LINK_CLASS = 'hover:text-primary transition-colors'
  const FOOTER_THEME_NOTE_LINKS = [
    ['CLAVULIN', 'https://github.com/clavulin/nodeget-theme-abyssal'],
  ]
  const LATENCY_WINDOW_MS = 24 * 60 * 60 * 1000
  const LATENCY_BUCKET_MS = 5 * 60 * 1000
  const LATENCY_REFRESH_FLOOR_MS = 60 * 1000
  const LATENCY_INCREMENTAL_OVERLAP_MS = 2 * 60 * 1000
  const LATENCY_QUERY_TIMEOUT_MS = 18 * 1000
  const LATENCY_QUERY_LIMIT_DEFAULT = 20000

  // Cap the rows a 24h latency task_query may request so the result set stays
  // bounded. A deployment with stricter backend query limits can lower this via
  // window.NODEGET_LATENCY_QUERY_LIMIT; read lazily so the theme stays agnostic
  // to any specific backend topology.
  function latencyQueryLimit() {
    const override = window.NODEGET_LATENCY_QUERY_LIMIT
    return typeof override === 'number' && isFinite(override) && override > 0
      ? Math.floor(override)
      : LATENCY_QUERY_LIMIT_DEFAULT
  }

  if (!NODEGET_CUSTOM_PATCH_TEST_MODE) {
    sanitizeUnsupportedMapView()
    installAbyssalArchiveTheme()
    installLatencyTaskProxy()
    loadConfig().then(applySiteTitle).catch(function () {})
  }

  function sanitizeUnsupportedMapView() {
    try {
      if (window.localStorage && window.localStorage.getItem(VIEW_KEY) === 'map') {
        window.localStorage.setItem(VIEW_KEY, 'cards')
      }
    } catch (_) {}
  }

  function installAbyssalArchiveTheme() {
    const root = document.documentElement
    if (root) {
      root.classList.add('dark', 'nodeget-abyssal-theme')
      root.style.colorScheme = 'dark'
      root.dataset.nodegetTheme = 'abyssal-archive'
    }

    const existingThemeColor = document.querySelector('meta[name="theme-color"]')
    const themeColor = existingThemeColor || document.createElement('meta')
    themeColor.setAttribute('name', 'theme-color')
    themeColor.setAttribute('content', '#041c1c')
    if (!existingThemeColor && document.head) document.head.appendChild(themeColor)

    if (document.body) document.body.classList.add('nodeget-abyssal-theme-body')
  }

  function scheduleDomFlush() {
    if (domFlushQueued) return
    domFlushQueued = true
    window.requestAnimationFrame(flushQueuedDomWork)
  }

  function collectDomContext() {
    const main = document.querySelector('main')
    const header = document.querySelector('header')
    const footer = document.querySelector('footer')
    const tables = main ? Array.from(main.querySelectorAll('table')) : []
    const tableBodies = main ? Array.from(main.querySelectorAll('tbody')) : []
    const archiveGrids = Array.from(document.querySelectorAll(ARCHIVE_GRID_SELECTOR))
    const archiveCards = Array.from(document.querySelectorAll(ARCHIVE_CARD_SELECTOR))
    const tableRows = tableBodies.reduce(function (rows, body) {
      return rows.concat(
        Array.from(body.children || []).filter(function (child) {
          return child.tagName === 'TR'
        })
      )
    }, [])
    const detailRoots = Array.from(document.querySelectorAll(DETAIL_ROOT_SELECTOR)).filter(isDetailRoot)
    return {
      main: main,
      header: header,
      footer: footer,
      archiveGrids: archiveGrids,
      archiveCards: archiveCards,
      tables: tables,
      tableBodies: tableBodies,
      tableRows: tableRows,
      detailRoots: detailRoots,
    }
  }

  function flushQueuedDomWork() {
    domFlushQueued = false
    const runTheme = themeEnhanceDirty
    const runFlag = flagSwapDirty
    const runDetail = detailDrawerDirty
    const runBars = segmentedBarsDirty

    themeEnhanceDirty = false
    flagSwapDirty = false
    detailDrawerDirty = false
    segmentedBarsDirty = false

    const needsDomContext = runTheme || runFlag || runDetail
    const ctx = needsDomContext ? collectDomContext() : null
    if (runTheme) enhanceThemeSurface(ctx)
    if (runFlag) replaceSystemIconsWithFlags(ctx)
    if (runDetail) enhanceDetailDrawer(ctx)
    if (runBars && !runTheme && !runDetail) syncSegmentedMetricBars()
  }

  function queueThemeEnhancements() {
    themeEnhanceDirty = true
    scheduleDomFlush()
  }

  function enhanceThemeSurface(ctx) {
    if (!document.body) return
    document.body.classList.add('nodeget-abyssal-theme-body')

    const main = (ctx && ctx.main) || document.querySelector('main')
    if (main) main.classList.add('nodeget-archive-main')
    enhanceArchiveHeader(ctx)
    translateAppShellEnglish(ctx)
    enhanceArchiveFooter(ctx)

    const archiveGrids = ctx && ctx.archiveGrids ? ctx.archiveGrids : Array.from(document.querySelectorAll(ARCHIVE_GRID_SELECTOR))
    archiveGrids.forEach(function (grid) {
      grid.classList.add('nodeget-archive-grid')
    })

    const archiveCards = ctx && ctx.archiveCards ? ctx.archiveCards : Array.from(document.querySelectorAll(ARCHIVE_CARD_SELECTOR))
    archiveCards.forEach(function (card, index) {
      card.classList.add('nodeget-archive-card')
      annotateArchiveCardRegions(card)
      const archiveIndex = String(index + 1).padStart(2, '0')
      if (card.dataset.nodegetArchiveIndex !== archiveIndex) {
        card.dataset.nodegetArchiveIndex = archiveIndex
      }
      const titleEl = card.querySelector('span.font-semibold')
      const nodeName = titleEl && (titleEl.getAttribute('title') || titleEl.textContent)
      if (nodeName) {
        card.dataset.nodegetNodeName = String(nodeName).trim().replace(/\s+/g, ' ').slice(0, 42)
      }
      translateCardPreviewEnglish(card)
    })
    enhanceArchiveTables(ctx)
    syncSegmentedMetricBars()

    Array.from(document.querySelectorAll('main h1, main h2, main h3')).forEach(function (heading) {
      heading.classList.add('nodeget-archive-heading')
    })
    Array.from(document.querySelectorAll('main table, main > .flex.flex-wrap, [role="tablist"]')).forEach(translateGlobalEnglish)
  }

  function annotateArchiveCardRegions(card) {
    if (!card) return
    const body = card.firstElementChild
    if (!body) return
    const sections = Array.from(body.children || [])
    if (sections[0]) sections[0].classList.add('nodeget-card-header')
    if (sections[1]) sections[1].classList.add('nodeget-card-meta-row')
    if (sections[2]) sections[2].classList.add('nodeget-card-metric-grid')
    if (sections[3]) sections[3].classList.add('nodeget-card-footer-row')
  }

  function enhanceArchiveTables(ctx) {
    const tables = ctx && ctx.tables ? ctx.tables : Array.from(document.querySelectorAll('main table'))
    tables.forEach(function (table) {
      table.classList.add('nodeget-archive-table')
      translateGlobalEnglish(table)

      Array.from(table.querySelectorAll('thead th')).forEach(function (heading, index) {
        heading.classList.add('nodeget-archive-table-heading')
        if (!index && !String(heading.textContent || '').trim()) heading.textContent = 'IDX'
      })

      Array.from(table.querySelectorAll('tbody tr')).forEach(function (row, index) {
        const rowIndex = String(index + 1).padStart(2, '0')
        row.classList.add('nodeget-archive-table-row')
        if (row.dataset.nodegetRowIndex !== rowIndex) row.dataset.nodegetRowIndex = rowIndex

        const firstCell = row.children && row.children[0]
        if (firstCell) {
          firstCell.classList.add('nodeget-archive-table-index')
          if (firstCell.dataset.nodegetRowIndex !== rowIndex) firstCell.dataset.nodegetRowIndex = rowIndex
        }

        Array.from(row.querySelectorAll('[role="progressbar"]')).forEach(function (bar) {
          bar.classList.add('nodeget-archive-table-meter')
        })
      })
    })
  }

  function enhanceArchiveHeader(ctx) {
    const header = (ctx && ctx.header) || document.querySelector('header')
    if (!header) return
    header.classList.add('nodeget-archive-command-strip')
    annotateArchiveTopbarActions(header)
    installAbyssalBrandIcon(header)
    hideDisabledHeaderControls(header)
    Array.from(header.querySelectorAll('input[type="search"]')).forEach(function (input) {
      if (!input.dataset.nodegetArchivePlaceholder) {
        input.dataset.nodegetArchivePlaceholder = '1'
        input.setAttribute('placeholder', 'SEARCH NODE...')
      }
    })
  }

  function annotateArchiveTopbarActions(header) {
    if (!header) return
    const shell = header.firstElementChild
    const actions = shell && shell.lastElementChild
    if (actions) actions.classList.add('nodeget-topbar-actions')
  }

  function hideDisabledHeaderControls(header) {
    sanitizeUnsupportedMapView()

    const viewWrap = Array.from(header.querySelectorAll('.relative.inline-grid')).find(function (wrap) {
      const text = String(wrap.textContent || '')
      return /CARDS|TABLE|卡片|表格/i.test(text)
    })

    if (viewWrap) {
      viewWrap.classList.add('nodeget-view-toggle-no-map')
      viewWrap.style.gridTemplateColumns = 'repeat(2, 1fr)'
      const buttons = Array.from(viewWrap.querySelectorAll('button'))
      let mapWasActive = false
      let fallbackViewButton = null
      buttons.forEach(function (button) {
        const text = String(button.textContent || '')
        if (/MAP|地图/i.test(text)) {
          mapWasActive = mapWasActive || button.getAttribute('aria-pressed') === 'true'
          button.classList.add('nodeget-map-view-hidden')
          button.setAttribute('aria-hidden', 'true')
          button.setAttribute('tabindex', '-1')
          button.setAttribute('disabled', 'true')
        } else {
          if (!fallbackViewButton && /CARDS|卡片/i.test(text)) fallbackViewButton = button
          button.classList.remove('nodeget-map-view-hidden')
          button.removeAttribute('aria-hidden')
          button.removeAttribute('tabindex')
          button.removeAttribute('disabled')
        }
      })
      if (mapWasActive && fallbackViewButton && typeof fallbackViewButton.click === 'function') {
        sanitizeUnsupportedMapView()
        window.setTimeout(function () {
          fallbackViewButton.click()
        }, 0)
      }
    }

    Array.from(header.querySelectorAll('button')).forEach(function (button) {
      if (button.closest('.relative.inline-grid')) return
      const text = String(button.textContent || '').trim()
      const isSortControl =
        button.hasAttribute('aria-expanded') ||
        /^(DEFAULT|NAME|REGION|CPU|MEM|DISK|NET|UPTIME|默认|名称|地区|区域|内存|磁盘|在线时长)/i.test(text)
      if (!isSortControl) return
      button.classList.add('nodeget-sort-control-hidden')
      button.setAttribute('aria-hidden', 'true')
      button.setAttribute('tabindex', '-1')
      button.setAttribute('disabled', 'true')
    })
  }

  function installAbyssalBrandIcon(header) {
    const brand = header.querySelector('a[href="./"]')
    if (!brand) return

    const existingLogo = brand.querySelector('img')
    if (existingLogo) {
      existingLogo.classList.add('nodeget-abyssal-original-logo')
      existingLogo.setAttribute('aria-hidden', 'true')
    }

    let icon = brand.querySelector('.nodeget-abyssal-brand-icon')
    if (!icon) {
      icon = document.createElement('span')
      icon.className = 'nodeget-abyssal-brand-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = [
        '<svg viewBox="0 0 32 32" role="img" focusable="false" xmlns="http://www.w3.org/2000/svg">',
        '<path class="nodeget-abyssal-ring" d="M7.6 20.4C5.7 18.9 4.5 16.6 4.5 14c0-5.1 5.4-8.9 11.5-8.9S27.5 8.9 27.5 14c0 2.6-1.2 4.9-3.1 6.4"/>',
        '<path class="nodeget-abyssal-ring nodeget-abyssal-ring-inner" d="M10.1 18.5C9 17.4 8.4 15.9 8.4 14.2c0-3.5 3.4-6.1 7.6-6.1s7.6 2.6 7.6 6.1c0 1.7-.6 3.2-1.7 4.3"/>',
        '<path class="nodeget-abyssal-mast" d="M16 3.6v21.8M12.3 10.6 16 3.6l3.7 7M11.1 22.3 16 25.4l4.9-3.1"/>',
        '<path class="nodeget-abyssal-beam" d="M16 7.5 9.2 20.5M16 7.5l6.8 13M6.1 25.9c2.2-1 4.4-1 6.6 0s4.4 1 6.6 0 4.4-1 6.6 0"/>',
        '<circle class="nodeget-abyssal-core" cx="16" cy="14.2" r="2.4"/>',
        '<circle class="nodeget-abyssal-spark" cx="16" cy="14.2" r="0.82"/>',
        '</svg>',
      ].join('')
      brand.insertBefore(icon, brand.firstChild)
    }
  }

  function enhanceArchiveFooter(ctx) {
    const footer = (ctx && ctx.footer) || document.querySelector('footer')
    if (!footer) return
    footer.classList.add('nodeget-archive-footer')
    hideFooterReleaseControls(footer)

    const footerBar = footer.firstElementChild || footer
    footerBar.classList.add('nodeget-archive-footer-bar')
    syncFooterPoweredVersion(footerBar)

    let note = document.getElementById(FOOTER_THEME_NOTE_ID)
    if (!note) {
      note = document.createElement('span')
      note.id = FOOTER_THEME_NOTE_ID
    }

    note.className = 'nodeget-archive-footer-theme-note'
    renderFooterThemeNote(note)
    if (note.parentElement !== footerBar) footerBar.appendChild(note)
  }

  function hideFooterReleaseControls(footer) {
    Array.from(footer.querySelectorAll('a')).forEach(function (link) {
      const href = String(link.getAttribute('href') || '')
      const text = String(link.textContent || '')
      const isThemeDownload = /(^|\/)download\.html(?:[?#].*)?$/i.test(href) || /提取当前主题|extract current theme/i.test(text)
      const isUpdateLink = /升级到|update to|upgrade to/i.test(text)
      if (!isThemeDownload && !isUpdateLink) return
      link.classList.add('nodeget-footer-release-control-hidden')
      link.setAttribute('aria-hidden', 'true')
      link.setAttribute('tabindex', '-1')
    })
  }

  function renderFooterThemeNote(note) {
    if (!note || footerThemeNoteIsCurrent(note)) return

    note.textContent = ''
    note.appendChild(document.createTextNode('ABYSSAL THEME BY '))
    note.appendChild(createFooterThemeNoteLink(FOOTER_THEME_NOTE_LINKS[0]))
  }

  function footerThemeNoteIsCurrent(note) {
    if (note.textContent !== FOOTER_THEME_NOTE_TEXT || note.childNodes.length !== 2) return false
    const links = note.querySelectorAll ? note.querySelectorAll('a') : []
    if (links.length !== FOOTER_THEME_NOTE_LINKS.length) return false
    return FOOTER_THEME_NOTE_LINKS.every((linkConfig, index) => {
      const link = links[index]
      return (
        link &&
        link.textContent === linkConfig[0] &&
        link.getAttribute('href') === linkConfig[1] &&
        link.target === '_blank' &&
        link.rel === 'noreferrer' &&
        link.className === FOOTER_THEME_NOTE_LINK_CLASS
      )
    })
  }

  function createFooterThemeNoteLink(linkConfig) {
    const link = document.createElement('a')
    link.setAttribute('href', linkConfig[1])
    link.target = '_blank'
    link.rel = 'noreferrer'
    link.className = FOOTER_THEME_NOTE_LINK_CLASS
    link.textContent = linkConfig[0]
    return link
  }

  function translateAppShellEnglish(ctx) {
    translateGlobalEnglish((ctx && ctx.header) || document.querySelector('header'))
    translateGlobalEnglish((ctx && ctx.footer) || document.querySelector('footer'))
    const main = (ctx && ctx.main) || document.querySelector('main')
    if (!main) {
      translateGlobalEnglish(document.getElementById('root'))
      return
    }
    Array.from(
      document.querySelectorAll(
        '#root > .min-h-screen, body > .min-h-screen, body > [role="alert"], main > [role="alert"], main > .min-h-screen, main > .py-24, main > .py-20, main [role="alert"], main [class*="py-"]',
      ),
    ).forEach(translateGlobalEnglish)
  }


  // Keep specific rules before generic catch-all rules. GENERIC_TRANSLATIONS must stay last
  // because broad rules may rewrite partial words/units before a specific rule can match.
  const SHELL_TRANSLATIONS = [
    [/近\s*1\s*天/g, 'LAST 1 D'],
    [/近\s*1\s*小时/g, 'LAST 1 D'],
    [/连接后端中…?/g, 'Loading'],
    [/加载中…?/g, 'Loading'],
  ]

  const METRIC_TRANSLATIONS = [
    [/CPU\s*占用/g, 'CPU USAGE'],
    [/内存\s*占用/g, 'MEM USAGE'],
    [/MEM\s*占用/g, 'MEM USAGE'],
    [/磁盘\s*占用/g, 'DISK USAGE'],
    [/DISK\s*占用/g, 'DISK USAGE'],
    [/下行\s*速度/g, 'DOWN SPEED'],
    [/DOWN\s*速度/g, 'DOWN SPEED'],
    [/上行\s*速度/g, 'UP SPEED'],
    [/UP\s*速度/g, 'UP SPEED'],
    [/在线\s*时长/g, 'UPTIME'],
    [/ONLINE\s*时长/g, 'UPTIME'],
  ]

  const DETAIL_TRANSLATIONS = [
    [/加载\s*config\.json\s*失败/g, 'Failed to load config.json'],
    [/(\d+)\s*个后端错误/g, '$1 backend errors'],
    [/暂无\s*([A-Za-z_]+)\s*数据/g, 'No $1 data'],
    [/未设置/g, 'Unset'],
    [/已过期\s*(\d+)\s*天/g, 'Expired $1D'],
    [/费用/g, 'BILLING'],
    [/月费/g, 'MONTHLY'],
    [/到期/g, 'EXPIRES'],
    [/剩余价值/g, 'REMAINING VALUE'],
    [/剩余/g, 'REMAINING'],
    [/后端错误/g, 'backend error'],
    [/暂无节点/g, 'No nodes'],
    [/你没设置/g, 'Untitled'],
    [/无法连接/g, 'Unable to connect'],
    [/连接/g, 'Connect'],
    [/超时/g, 'timeout'],
    [/未知/g, 'Unknown'],
  ]

  const PROBE_TRANSLATIONS = [
    [/暂无 ping 数据/gi, 'N/A PING DATA'],
    [/\bping-/gi, ''],
    [/内CORE/g, 'KERNEL'],
    [/内核/g, 'KERNEL'],
    [/网络与负载/g, 'NETWORK / LOAD'],
    [/NETWORK与LOAD/g, 'NETWORK / LOAD'],
    [/操作系统/g, 'OS'],
    [/CPU 型号/g, 'CPU MODEL'],
    [/数据更新/g, 'DATA UPDATED'],
    [/TCP \/ UDP/g, 'TCP / UDP'],
    [/累计接收/g, 'RX TOTAL'],
    [/累计发送/g, 'TX TOTAL'],
    [/磁盘读/g, 'DISK READ'],
    [/磁盘写/g, 'DISK WRITE'],
    [/进程数/g, 'PROCESSES'],
    [/运行时长/g, 'UPTIME'],
    [/平均延迟/g, 'AVG LATENCY'],
    [/丢包率/g, 'LOSS'],
    [/广州联通/g, 'GUANGZHOU UNICOM'],
    [/广州电信/g, 'GUANGZHOU TELECOM'],
    [/广州移动/g, 'GUANGZHOU MOBILE'],
    [/广东联通/g, 'GUANGDONG UNICOM'],
    [/广东电信/g, 'GUANGDONG TELECOM'],
    [/广东移动/g, 'GUANGDONG MOBILE'],
    [/上海联通/g, 'SHANGHAI UNICOM'],
    [/上海电信/g, 'SHANGHAI TELECOM'],
    [/上海移动/g, 'SHANGHAI MOBILE'],
    [/北京联通/g, 'BEIJING UNICOM'],
    [/北京电信/g, 'BEIJING TELECOM'],
    [/北京移动/g, 'BEIJING MOBILE'],
  ]

  const GENERIC_TRANSLATIONS = [
    [/物理/g, 'PHYSICAL'],
    [/逻辑/g, 'LOGICAL'],
    [/主机名/g, 'HOSTNAME'],
    [/来源/g, 'SOURCE'],
    [/抖动/g, 'JITTER'],
    [/资源/g, 'RESOURCE'],
    [/趋势/g, 'TREND'],
    [/下行/g, 'DOWN'],
    [/上行/g, 'UP'],
    [/近/g, 'LAST'],
    [/默认/g, 'DEFAULT'],
    [/卡片/g, 'CARDS'],
    [/表格/g, 'TABLE'],
    [/搜索/g, 'SEARCH'],
    [/全部/g, 'ALL'],
    [/返回/g, 'BACK'],
    [/关闭详情/g, 'CLOSE DETAILS'],
    [/深色模式/g, 'DARK MODE'],
    [/浅色模式/g, 'LIGHT MODE'],
    [/切换到深色/g, 'SWITCH TO DARK'],
    [/切换到浅色/g, 'SWITCH TO LIGHT'],
    [/节点/g, 'NODE'],
    [/名称/g, 'NAME'],
    [/状态/g, 'STATUS'],
    [/地区/g, 'REGION'],
    [/系统/g, 'SYSTEM'],
    [/架构/g, 'ARCH'],
    [/虚拟化/g, 'VIRT'],
    [/处理器/g, 'PROCESSOR'],
    [/上传/g, 'UPLOAD'],
    [/下载/g, 'DOWNLOAD'],
    [/网络/g, 'NETWORK'],
    [/流量/g, 'TRAFFIC'],
    [/运行时间/g, 'UPTIME'],
    [/更新时间/g, 'UPDATED'],
    [/最后更新/g, 'LAST UPDATED'],
    [/更新/g, 'UPDATED'],
    [/版本/g, 'VERSION'],
    [/详情/g, 'DETAILS'],
    [/负载/g, 'LOAD'],
    [/总计/g, 'TOTAL'],
    [/可用/g, 'AVAILABLE'],
    [/已用/g, 'USED'],
    [/暂/g, ''],
    [/与/g, ' / '],
    [/内存/g, 'MEM'],
    [/磁盘/g, 'DISK'],
    [/从未/g, 'NEVER'],
    [/暂无/g, 'N/A'],
    [/在线/g, 'ONLINE'],
    [/离线/g, 'OFFLINE'],
    [/异常/g, 'ERROR'],
    [/正常/g, 'OK'],
    [/核心|核/g, 'CORE'],
    [/天前/g, 'D AGO'],
    [/小时前/g, 'H AGO'],
    [/分钟前/g, 'MIN AGO'],
    [/秒前/g, 'SEC AGO'],
    [/天/g, 'D'],
    [/小时/g, 'H'],
    [/分钟/g, 'MIN'],
    [/秒/g, 'SEC'],
    [/前/g, 'AGO'],
  ]

  const CARD_PREVIEW_TRANSLATIONS = [
    ...SHELL_TRANSLATIONS,
    ...METRIC_TRANSLATIONS,
    ...DETAIL_TRANSLATIONS,
    ...PROBE_TRANSLATIONS,
    ...GENERIC_TRANSLATIONS,
  ]

  function translateCardText(text) {
    let output = String(text || '')
    CARD_PREVIEW_TRANSLATIONS.forEach(function (entry) {
      output = output.replace(entry[0], entry[1])
    })
    output = output.replace(/\bB\/S\b/g, 'B/s')
    output = output.replace(/(SEC|MIN|H|D)(?=TREND)/g, '$1 ')
    output = output.replace(/\s+\/\s+/g, ' / ')
    return output
  }

  function translateCardPreviewEnglish(card) {
    translateNodeEnglish(card)
  }

  function translateElementAttributesEnglish(el) {
    if (!el || !el.getAttribute) return
    ;['aria-label', 'title', 'placeholder'].forEach(function (attr) {
      const value = el.getAttribute(attr)
      if (!value || !/[\u4e00-\u9fff]|B\/S/.test(value)) return
      const next = translateCardText(value)
      if (next !== value) el.setAttribute(attr, next)
    })
  }

  function translateGlobalEnglish(root) {
    translateNodeEnglish(root, {
      skipTags: ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'],
    })
  }

  function translateNodeEnglish(root, options) {
    if (!root) return
    // Do not permanently WeakSet/cache translated text nodes here. Dynamic loading,
    // error, and detail text can be replaced in place, and permanent skip caches can
    // leave Chinese or stale translated text behind.
    const skipTags = options && Array.isArray(options.skipTags)
      ? options.skipTags.map(function (tag) {
          return String(tag || '').toUpperCase()
        })
      : null
    translateElementAttributesEnglish(root)
    Array.from(root.querySelectorAll('[aria-label], [title], [placeholder]')).forEach(translateElementAttributesEnglish)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node || !node.nodeValue || !/[\u4e00-\u9fff]|B\/S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT
        const parent = node.parentElement
        if (parent && skipTags && skipTags.indexOf(String(parent.tagName || '').toUpperCase()) !== -1) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(function (node) {
      const next = translateCardText(node.nodeValue)
      if (next !== node.nodeValue) node.nodeValue = next
    })
  }

  const SEGMENTED_BAR_PERIOD_REM = 0.16
  const SEGMENTED_BAR_BLOCK_REM = 0.11

  function snapSegmentMetric(cssPx, minCssPx) {
    const dpr = window.devicePixelRatio || 1
    return Math.max(minCssPx || 1, Math.round(cssPx * dpr) / dpr)
  }

  function markSegmentedMetricsDirty() {
    segmentedMetricCacheDirty = true
  }

  function segmentedBarMetrics() {
    if (segmentedMetricCache && !segmentedMetricCacheDirty) return segmentedMetricCache
    if (!document.documentElement) return null
    const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16
    const dpr = window.devicePixelRatio || 1
    let periodPx = snapSegmentMetric(SEGMENTED_BAR_PERIOD_REM * rootFontSize, 3)
    let blockPx = snapSegmentMetric(SEGMENTED_BAR_BLOCK_REM * rootFontSize, 2)
    const minGap = 1 / dpr
    if (blockPx + minGap > periodPx) periodPx = blockPx + minGap
    const root = document.documentElement
    const blockValue = blockPx.toFixed(3) + 'px'
    const periodValue = periodPx.toFixed(3) + 'px'
    if (root.style.getPropertyValue('--nodeget-segment-block') !== blockValue) {
      root.style.setProperty('--nodeget-segment-block', blockValue)
    }
    if (root.style.getPropertyValue('--nodeget-segment-period') !== periodValue) {
      root.style.setProperty('--nodeget-segment-period', periodValue)
    }
    segmentedMetricCache = { blockPx: blockPx, periodPx: periodPx }
    segmentedMetricCacheDirty = false
    return segmentedMetricCache
  }

  function syncSegmentedMetricBars() {
    const metrics = segmentedBarMetrics()
    if (!metrics) return
    const periodPx = metrics.periodPx
    const blockPx = metrics.blockPx
    if (!periodPx || !blockPx) return

    const updates = []
    const progressBars = Array.from(
      document.querySelectorAll('.nodeget-archive-card [role="progressbar"], .nodeget-archive-table [role="progressbar"]'),
    )
    const resourceMeters = Array.from(document.querySelectorAll('.nodeget-resource-meter'))

    progressBars.forEach(function (bar) {
      const fill = bar.firstElementChild
      if (!fill) return
      const barRect = bar.getBoundingClientRect()
      const fillRect = fill.getBoundingClientRect()
      if (!barRect.width) return

      const visibleWidth = Math.max(0, Math.min(barRect.width, fillRect.right - barRect.left))
      const blockCount = visibleWidth > 0.5 ? Math.max(1, Math.round(visibleWidth / periodPx)) : 0
      const snappedWidth = blockCount ? Math.min(barRect.width, (blockCount - 1) * periodPx + blockPx) : 0
      const nextWidth = snappedWidth.toFixed(3) + 'px'

      updates.push({ el: bar, width: nextWidth, segmented: true })
    })

    resourceMeters.forEach(function (meter) {
      const meterRect = meter.getBoundingClientRect()
      const percent = parseFloat(meter.dataset.nodegetResourcePercent || '')
      if (!meterRect.width || !Number.isFinite(percent)) return

      const meterStyle = window.getComputedStyle(meter)
      const trackWidth = Math.max(
        0,
        meterRect.width - (parseFloat(meterStyle.paddingLeft) || 0) - (parseFloat(meterStyle.paddingRight) || 0),
      )
      const visibleWidth = trackWidth * Math.max(0, Math.min(100, percent)) / 100
      const blockCount = visibleWidth > 0.5 ? Math.max(1, Math.round(visibleWidth / periodPx)) : 0
      const snappedWidth = blockCount ? Math.min(trackWidth, (blockCount - 1) * periodPx + blockPx) : 0
      const nextWidth = snappedWidth.toFixed(3) + 'px'

      updates.push({ el: meter, width: nextWidth, segmented: false })
    })

    updates.forEach(function (update) {
      if (update.el.style.getPropertyValue('--nodeget-progress-width') !== update.width) {
        update.el.style.setProperty('--nodeget-progress-width', update.width)
      }
      if (update.segmented && update.el.dataset.nodegetSegmentedProgress !== '1') {
        update.el.dataset.nodegetSegmentedProgress = '1'
      }
    })
  }

  function installLatencyTaskProxy() {
    if (window.__nodegetLatencyTaskProxyInstalled || !window.WebSocket) return
    window.__nodegetLatencyTaskProxyInstalled = true
    const NativeWebSocket = window.WebSocket
    const latencyCaches = new WeakMap()

    function PatchedWebSocket(url, protocols) {
      const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols)
      const nativeSend = ws.send.bind(ws)
      ws.send = function (data) {
        let message = null
        if (typeof data === 'string') {
          try {
            message = JSON.parse(data)
          } catch (_) {}
        }
        if (message && message.method === 'task_query') {
          if (handleLatencyTaskQuery(ws, nativeSend, message, latencyCaches)) return undefined
        }
        return nativeSend(data)
      }
      return ws
    }

    PatchedWebSocket.CONNECTING = NativeWebSocket.CONNECTING
    PatchedWebSocket.OPEN = NativeWebSocket.OPEN
    PatchedWebSocket.CLOSING = NativeWebSocket.CLOSING
    PatchedWebSocket.CLOSED = NativeWebSocket.CLOSED
    PatchedWebSocket.prototype = NativeWebSocket.prototype
    window.WebSocket = PatchedWebSocket
  }

  function handleLatencyTaskQuery(ws, nativeSend, message, latencyCaches) {
    const parsed = parseLatencyTaskQuery(message)
    if (!parsed) return false

    const now = Date.now()
    const cache = getLatencyCache(latencyCaches, ws, parsed.uuid, parsed.type)
    if (cache.rows.length && now - cache.lastQueryAt < LATENCY_REFRESH_FLOOR_MS) {
      dispatchJsonRpcResult(ws, message.id, downsampleLatencyRows(cache.rows, parsed.type, now))
      return true
    }

    if (cache.inFlight) {
      cache.inFlight
        .then(function () {
          dispatchJsonRpcResult(ws, message.id, downsampleLatencyRows(cache.rows, parsed.type, Date.now()))
        })
        .catch(function () {
          dispatchJsonRpcResult(ws, message.id, downsampleLatencyRows(cache.rows, parsed.type, Date.now()))
        })
      return true
    }

    const requestWindow = latencyRequestWindow(cache.rows, now)
    cache.lastQueryAt = now
    cache.inFlight = queryLatencyWindow(ws, nativeSend, message, parsed, requestWindow)
      .then(function (rows) {
        cache.rows = mergeLatencyRows(cache.rows, rows, Date.now())
      })
      .catch(function () {})
      .then(function () {
        cache.inFlight = null
      })

    cache.inFlight.then(function () {
      dispatchJsonRpcResult(ws, message.id, downsampleLatencyRows(cache.rows, parsed.type, Date.now()))
    })
    return true
  }

  function parseLatencyTaskQuery(message) {
    const conditions =
      message &&
      message.params &&
      message.params.task_data_query &&
      Array.isArray(message.params.task_data_query.condition)
        ? message.params.task_data_query.condition
        : null
    if (!conditions) return null

    let uuid = ''
    let type = ''
    let hasWindow = false
    conditions.forEach(function (condition) {
      if (!condition || typeof condition !== 'object') return
      if (typeof condition.uuid === 'string') uuid = condition.uuid
      if (condition.type === 'ping' || condition.type === 'tcp_ping') type = condition.type
      if (Array.isArray(condition.timestamp_from_to)) hasWindow = true
    })

    if (!uuid || !type || !hasWindow || message.id == null) return null
    return { uuid: uuid, type: type, conditions: conditions }
  }

  function getLatencyCache(latencyCaches, ws, uuid, type) {
    let socketCache = latencyCaches.get(ws)
    if (!socketCache) {
      socketCache = new Map()
      latencyCaches.set(ws, socketCache)
    }

    const key = uuid + '\n' + type
    let cache = socketCache.get(key)
    if (!cache) {
      cache = { rows: [], lastQueryAt: 0, inFlight: null }
      socketCache.set(key, cache)
    }
    return cache
  }

  function latencyRequestWindow(rows, now) {
    let latest = 0
    rows.forEach(function (row) {
      latest = Math.max(latest, normalizeLatencyTimestamp(row && row.timestamp))
    })
    const start = latest
      ? Math.max(now - LATENCY_WINDOW_MS, latest - LATENCY_INCREMENTAL_OVERLAP_MS)
      : now - LATENCY_WINDOW_MS
    return [start, now]
  }

  function queryLatencyWindow(ws, nativeSend, originalMessage, parsed, requestWindow) {
    return new Promise(function (resolve, reject) {
      const queryId = 'nodeget-latency-' + Date.now() + '-' + Math.floor(Math.random() * 1000000)
      let done = false
      const timer = window.setTimeout(function () {
        finish(null, [])
      }, LATENCY_QUERY_TIMEOUT_MS)

      function finish(event, rows) {
        if (done) return
        done = true
        window.clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        if (event && event.error) reject(new Error(event.error.message || 'task_query failed'))
        else resolve(Array.isArray(rows) ? rows : [])
      }

      function onMessage(event) {
        const data = typeof event.data === 'string' ? event.data : String(event.data || '')
        let response = null
        try {
          response = JSON.parse(data)
        } catch (_) {
          return
        }
        if (!response || String(response.id) !== queryId) return
        finish(response, response.result)
      }

      const nextConditions = parsed.conditions
        .map(function (condition) {
          if (!condition || typeof condition !== 'object') return condition
          if (Array.isArray(condition.timestamp_from_to)) return { timestamp_from_to: requestWindow }
          if (Object.prototype.hasOwnProperty.call(condition, 'limit')) return { limit: latencyQueryLimit() }
          return condition
        })
        .filter(function (condition) {
          return !(condition && typeof condition === 'object' && Object.prototype.hasOwnProperty.call(condition, 'offset'))
        })

      if (!nextConditions.some(function (condition) {
        return condition && typeof condition === 'object' && Object.prototype.hasOwnProperty.call(condition, 'limit')
      })) {
        nextConditions.push({ limit: latencyQueryLimit() })
      }

      const nextMessage = {
        jsonrpc: originalMessage.jsonrpc || '2.0',
        method: 'task_query',
        params: Object.assign({}, originalMessage.params, {
          task_data_query: Object.assign({}, originalMessage.params && originalMessage.params.task_data_query, {
            condition: nextConditions,
          }),
        }),
        id: queryId,
      }

      ws.addEventListener('message', onMessage)
      try {
        nativeSend(JSON.stringify(nextMessage))
      } catch (error) {
        finish({ error: { message: error && error.message } }, [])
      }
    })
  }

  function mergeLatencyRows(previous, incoming, now) {
    const cutoff = now - LATENCY_WINDOW_MS
    const rows = new Map()
    previous.concat(incoming || []).forEach(function (row) {
      if (!row || typeof row !== 'object') return
      if (normalizeLatencyTimestamp(row.timestamp) < cutoff) return
      rows.set(latencyRowKey(row), row)
    })
    return Array.from(rows.values()).sort(function (a, b) {
      return normalizeLatencyTimestamp(a.timestamp) - normalizeLatencyTimestamp(b.timestamp)
    })
  }

  function downsampleLatencyRows(rows, type, now) {
    const cutoff = now - LATENCY_WINDOW_MS
    const buckets = new Map()

    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return
      const timestamp = normalizeLatencyTimestamp(row.timestamp)
      if (!timestamp || timestamp < cutoff) return
      const source = row.cron_source || '未知'
      if (!source || source === '未知') return
      const bucketTs = Math.floor(timestamp / LATENCY_BUCKET_MS) * LATENCY_BUCKET_MS
      const key = bucketTs + '\n' + source
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { timestamp: bucketTs, source: source, template: row, sum: 0, count: 0, total: 0 }
        buckets.set(key, bucket)
      }
      bucket.template = row
      bucket.total += 1
      const value = row.task_event_result && row.task_event_result[type]
      if (row.success && typeof value === 'number' && Number.isFinite(value)) {
        bucket.sum += value
        bucket.count += 1
      }
    })

    return Array.from(buckets.values())
      .sort(function (a, b) {
        return a.timestamp - b.timestamp || String(a.source).localeCompare(String(b.source))
      })
      .map(function (bucket) {
        const template = bucket.template || {}
        const result = Object.assign({}, template.task_event_result || {})
        const success = bucket.count > 0
        if (success) result[type] = bucket.sum / bucket.count
        else delete result[type]
        return Object.assign({}, template, {
          timestamp: bucket.timestamp,
          cron_source: bucket.source,
          uuid: template.uuid,
          success: success,
          type: template.type,
          task_event_type: template.task_event_type,
          task_event_result: result,
        })
      })
  }

  function latencyRowKey(row) {
    if (row.task_id != null) return String(row.task_id)
    return [
      normalizeLatencyTimestamp(row.timestamp),
      row.uuid || '',
      row.cron_source || '',
      JSON.stringify(row.task_event_type || {}),
      JSON.stringify(row.task_event_result || {}),
    ].join('|')
  }

  function normalizeLatencyTimestamp(timestamp) {
    const value = Number(timestamp)
    if (!Number.isFinite(value) || value <= 0) return 0
    return value < 1000000000000 ? value * 1000 : value
  }

  function dispatchJsonRpcResult(ws, id, result) {
    window.setTimeout(function () {
      ws.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: id,
            result: result,
          }),
        }),
      )
    }, 0)
  }

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch(CONFIG_URL, { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error('config.json ' + res.status)
        return res.json()
      })
    }
    return configPromise
  }

  function loadThemeManifest() {
    if (!themeManifestPromise) {
      themeManifestPromise = fetch(THEME_MANIFEST_URL, { cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('nodeget-theme.json ' + res.status)
          return res.json()
        })
        .catch(function (error) {
          themeManifestPromise = null
          throw error
        })
    }
    return themeManifestPromise
  }

  function normalizeFooterVersion(version) {
    const value = String(version || '').trim()
    if (!value) return ''
    return /^v/i.test(value) ? value : 'v' + value
  }

  function getFooterPoweredLink(footerBar) {
    if (!footerBar || !footerBar.querySelector) return null
    return footerBar.querySelector(':scope > a:first-child') || footerBar.querySelector('a[href]')
  }

  function getExistingFooterVersionElement(footerBar) {
    if (!footerBar || !footerBar.querySelector) return null
    return (
      (document.getElementById ? document.getElementById(FOOTER_VERSION_ID) : null) ||
      Array.from(footerBar.children || []).find(function (child) {
        if (!child || child.id === FOOTER_THEME_NOTE_ID || child.tagName === 'A') return false
        if (child.id === FOOTER_VERSION_ID || (child.classList && child.classList.contains(FOOTER_VERSION_CLASS))) return true
        return /^v\d+(?:\.\d+){1,3}(?:[-+][\w.]+)?$/i.test(String(child.textContent || '').trim())
      }) ||
      null
    )
  }

  function ensureFooterVersionElement(footerBar) {
    const link = getFooterPoweredLink(footerBar)
    if (link) link.classList.add(FOOTER_POWERED_LINK_CLASS)

    let versionElement = getExistingFooterVersionElement(footerBar)
    if (!versionElement) {
      versionElement = document.createElement('span')
    }
    versionElement.id = FOOTER_VERSION_ID
    versionElement.className = FOOTER_VERSION_CLASS

    if (link && versionElement.parentElement === footerBar && versionElement.previousElementSibling === link) {
      return versionElement
    }

    if (link && link.parentElement === footerBar && footerBar.insertBefore) {
      const siblings = Array.from(footerBar.children || [])
      const linkIndex = siblings.indexOf(link)
      const nextElement = linkIndex === -1 ? null : siblings[linkIndex + 1] || null
      if (nextElement === versionElement) return versionElement
      const reference = linkIndex === -1 ? link.nextSibling : nextElement
      footerBar.insertBefore(versionElement, reference)
    } else if (versionElement.parentElement !== footerBar) {
      footerBar.appendChild(versionElement)
    }
    return versionElement
  }

  function applyFooterVersionText(versionElement, version) {
    const normalizedVersion = normalizeFooterVersion(version)
    if (!versionElement || !normalizedVersion) return false
    if (versionElement.textContent !== normalizedVersion) versionElement.textContent = normalizedVersion
    return true
  }

  function syncFooterPoweredVersion(footerBar) {
    const versionElement = ensureFooterVersionElement(footerBar)
    loadThemeManifest()
      .then(function (manifest) {
        applyFooterVersionText(versionElement, manifest && manifest.version)
      })
      .catch(function () {})
  }

  function applySiteTitle(config) {
    const siteName = config && config.site_name ? String(config.site_name).trim() : ''
    if (siteName) document.title = siteName
  }

  function queueMainFlagSwap() {
    flagSwapDirty = true
    scheduleDomFlush()
  }

  function queueDetailDrawer() {
    detailDrawerDirty = true
    scheduleDomFlush()
  }

  function queueSegmentedMetricBars() {
    segmentedBarsDirty = true
    scheduleDomFlush()
  }

  // StatusShow hard-codes flagcdn.com flag URLs upstream, so the theme always
  // recognizes those. Deployments that rewrite flag <img> sources (e.g. a
  // same-origin proxy) register extra matchers — substrings or RegExps — on
  // window.NODEGET_FLAG_MATCHERS, read lazily here so registration order between
  // scripts does not matter. The theme itself stays agnostic to any proxy route.
  function isFlagImage(img) {
    const src = img.getAttribute('src') || ''
    if (src.includes('flagcdn.com/')) return true
    const extra = window.NODEGET_FLAG_MATCHERS
    if (!Array.isArray(extra)) return false
    return extra.some(function (matcher) {
      if (typeof matcher === 'string') return matcher !== '' && src.includes(matcher)
      return !!matcher && typeof matcher.test === 'function' && matcher.test(src)
    })
  }

  function hideSystemLogo(img) {
    if (!img || isFlagImage(img)) return
    img.classList.add('nodeget-system-logo-hidden')
    img.setAttribute('aria-hidden', 'true')
  }

  function markFrontFlag(img) {
    img.classList.add('nodeget-front-flag')
    img.setAttribute('data-nodeget-front-flag', 'true')
  }

  function replaceSystemIconsWithFlags(ctx) {
    replaceCardSystemIcons(ctx)
    replaceTableSystemIcons(ctx)
  }

  function replaceCardSystemIcons(ctx) {
    const cards = ctx && ctx.archiveCards ? ctx.archiveCards : Array.from(document.querySelectorAll(ARCHIVE_CARD_SELECTOR))
    cards.forEach(function (card) {
      const header = Array.from(card.querySelectorAll('div.flex.items-center.gap-2')).find(function (item) {
        return item.querySelector('span.font-semibold')
      })
      if (!header) return

      const name = header.querySelector('span.font-semibold')
      const images = Array.from(header.querySelectorAll('img'))
      const logo = images.find(function (img) {
        return !isFlagImage(img)
      })
      const flag = images.find(isFlagImage)

      hideSystemLogo(logo)
      if (!name || !flag) return
      markFrontFlag(flag)
      if (flag.nextElementSibling !== name) header.insertBefore(flag, name)
    })
  }

  function replaceTableSystemIcons(ctx) {
    const tables = ctx && ctx.tables ? ctx.tables : Array.from(document.querySelectorAll('main table'))
    tables.forEach(function (table) {
      table.classList.add('nodeget-flag-name-table')
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      rows.forEach(function (row) {
        const nameCell = row.children && row.children[1]
        const regionCell = row.children && row.children[2]
        if (!nameCell || !regionCell) return

        const nameWrap = nameCell.querySelector('div.flex.items-center')
        const name = nameWrap && nameWrap.querySelector('span.truncate')
        if (!nameWrap || !name) return

        const logo = Array.from(nameWrap.querySelectorAll('img')).find(function (img) {
          return !isFlagImage(img)
        })
        hideSystemLogo(logo)

        const regionFlag = Array.from(regionCell.querySelectorAll('img')).find(isFlagImage)
        if (!regionFlag || nameWrap.querySelector('[data-nodeget-front-flag="true"]')) return

        const flag = regionFlag.cloneNode(true)
        markFrontFlag(flag)
        nameWrap.insertBefore(flag, name)
      })
    })
  }

  function isDetailRoot(el) {
    if (!el || !el.classList) return false
    return (
      el.classList.contains('fixed') &&
      el.classList.contains('inset-0') &&
      el.classList.contains('z-50') &&
      el.classList.contains('bg-background') &&
      el.classList.contains('overflow-y-auto') &&
      !!el.querySelector('button[aria-label="返回"], button[aria-label="关闭详情"], button[aria-label="BACK"], button[aria-label="CLOSE DETAILS"]')
    )
  }

  function findDetailRoots() {
    return Array.from(document.querySelectorAll(DETAIL_ROOT_SELECTOR)).filter(isDetailRoot)
  }

  function closeDetailFromPatch() {
    try {
      if (!window.location.hash) return
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    } catch (_) {
      window.location.hash = ''
    }
  }

  function isDesktopDrawer() {
    return !window.matchMedia || window.matchMedia(DESKTOP_DRAWER_QUERY).matches
  }

  function armDetailDrawerPending() {
    if (!isDesktopDrawer() || !document.documentElement) return
    document.documentElement.classList.add('nodeget-detail-drawer-pending')
    if (detailDrawerPendingTimer) window.clearTimeout(detailDrawerPendingTimer)
    detailDrawerPendingTimer = window.setTimeout(disarmDetailDrawerPending, 900)
  }

  function disarmDetailDrawerPending() {
    if (detailDrawerPendingTimer) {
      window.clearTimeout(detailDrawerPendingTimer)
      detailDrawerPendingTimer = 0
    }
    if (document.documentElement) {
      document.documentElement.classList.remove('nodeget-detail-drawer-pending')
    }
  }

  function syncDetailDrawerOpenState(isOpen) {
    if (!document.documentElement) return
    document.documentElement.classList.toggle('nodeget-detail-drawer-open', !!isOpen)
  }

  function rememberDetailSessionFromClick(target) {
    if (!target || !target.closest) return
    const card = target.closest(ARCHIVE_CARD_SELECTOR)
    if (card && card.dataset) {
      lastDetailSessionMeta = {
        index: card.dataset.nodegetArchiveIndex || '',
        name: card.dataset.nodegetNodeName || '',
      }
      return
    }
    const row = target.closest('main tbody tr.cursor-pointer, main tbody tr.nodeget-archive-table-row')
    if (row && row.dataset) {
      const nameCell = row.children && row.children[1]
      lastDetailSessionMeta = {
        index: row.dataset.nodegetRowIndex || '',
        name: nameCell ? String(nameCell.textContent || '').trim().replace(/^\S+\s+/, '').slice(0, 42) : '',
      }
    }
  }

  function isLikelyDetailOpenClick(target) {
    if (!target || !target.closest) return false
    if (target.closest(ARCHIVE_CARD_SELECTOR)) return true
    if (target.closest('main tbody tr.cursor-pointer')) return true
    return false
  }

  function setDetailHeaderHeight(root, header) {
    if (!root || !header) return
    const nextHeight = Math.ceil(header.offsetHeight || 64) + 'px'
    if (root.style.getPropertyValue('--nodeget-detail-head-h') !== nextHeight) {
      root.style.setProperty('--nodeget-detail-head-h', nextHeight)
    }
  }

  function patchDetailCloseButton(button) {
    if (!button) return
    if (button.getAttribute('aria-label') !== 'CLOSE DETAILS') button.setAttribute('aria-label', 'CLOSE DETAILS')
    if (button.getAttribute('title') !== 'CLOSE DETAILS') button.setAttribute('title', 'CLOSE DETAILS')
    button.classList.add('nodeget-detail-drawer-close')
    if (button.dataset.nodegetDrawerCloseIcon === '1') return
    button.dataset.nodegetDrawerCloseIcon = '1'
    button.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
  }

  function forceOpaqueDetailHeader(header) {
    if (!header || !header.style) return
    const isLight = document.documentElement && !document.documentElement.classList.contains('dark')
    const color = isLight ? '#fffef9' : '#020f0f'
    header.style.setProperty('background', color, 'important')
    header.style.setProperty('background-color', color, 'important')
    header.style.setProperty('background-image', 'none', 'important')
    header.style.setProperty('opacity', '1', 'important')
    header.style.setProperty('backdrop-filter', 'none', 'important')
    header.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
  }

  function patchDetailHeaderIdentity(header) {
    if (!header) return
    forceOpaqueDetailHeader(header)
    const title = header.querySelector('span.font-semibold, [class*="font-semibold"]')
    const images = Array.from(header.querySelectorAll('img'))
    const systemLogo = images.find(function (img) {
      return !isFlagImage(img)
    })
    const flag = images.find(isFlagImage)

    hideSystemLogo(systemLogo)
    if (flag) {
      markFrontFlag(flag)
      flag.classList.add('nodeget-detail-header-flag')
      if (title && flag.nextElementSibling !== title) title.parentElement.insertBefore(flag, title)
    }
    if (title) title.classList.add('nodeget-detail-node-title')

    Array.from(header.querySelectorAll(':scope .ml-auto, :scope [class*="ml-auto"]')).forEach(function (wrap) {
      const text = String(wrap.textContent || '').trim()
      if (!text) return
      const badgeLikeChildren = Array.from(wrap.children || []).filter(function (child) {
        const className = String(child.className || '')
        return /rounded|border|bg-secondary|text-xs|font-medium/.test(className)
      })
      if (badgeLikeChildren.length || /\b[A-Z]{2}\b|qemu|kvm|hyper-v|lxc|docker/i.test(text)) {
        wrap.classList.add('nodeget-detail-runtime-tags')
        wrap.setAttribute('aria-hidden', 'true')
      }
    })
  }

  function detailPaneLabel(el) {
    const firstLine = String((el && (el.innerText || el.textContent)) || '')
      .split('\n')
      .map(function (line) {
        return line.trim()
      })
      .filter(Boolean)[0]
    return (
      translateCardText(firstLine || 'PANE')
        .replace(/[^A-Z0-9 %/·.-]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 36) || 'PANE'
    )
  }

  function detailSessionMeta() {
    const hash = window.location.hash || ''
    const escapedHash = window.CSS && CSS.escape ? CSS.escape(hash) : hash.replace(/"/g, '\\"')
    const card = hash ? document.querySelector('main .grid > a[href="' + escapedHash + '"]') : null
    const index = (card && card.dataset ? card.dataset.nodegetArchiveIndex : '') || (lastDetailSessionMeta && lastDetailSessionMeta.index) || ''
    const name = (card && card.dataset ? card.dataset.nodegetNodeName : '') || (lastDetailSessionMeta && lastDetailSessionMeta.name) || ''
    return {
      index: index ? String(index).padStart(2, '0') : 'DETAIL',
      name: name || '',
    }
  }

  function decorateDetailTable(table) {
    if (!table) return
    table.classList.add('nodeget-detail-dossier-table')
    Array.from(table.querySelectorAll('tbody tr')).forEach(function (row, index) {
      const rowIndex = String(index + 1).padStart(2, '0')
      if (row.dataset.nodegetDetailRowIndex !== rowIndex) row.dataset.nodegetDetailRowIndex = rowIndex
      const firstCell = row.querySelector('td, th')
      if (firstCell) {
        firstCell.classList.add('nodeget-detail-table-index-cell')
        if (firstCell.dataset.nodegetDetailRowIndex !== rowIndex) firstCell.dataset.nodegetDetailRowIndex = rowIndex
      }
    })
  }

  function decorateDetailRecordRows(pane) {
    if (!pane) return
    const title = pane.firstElementChild
    if (title && !title.matches('.flex.justify-between')) title.classList.add('nodeget-detail-record-title')
    Array.from(pane.querySelectorAll('.flex.justify-between')).forEach(function (row, index) {
      const rowIndex = String(index + 1).padStart(2, '0')
      row.classList.add('nodeget-detail-record-row')
      if (row.dataset.nodegetDetailRowIndex !== rowIndex) row.dataset.nodegetDetailRowIndex = rowIndex
      const cells = Array.from(row.children || [])
      if (cells[0]) cells[0].classList.add('nodeget-detail-record-key')
      if (cells[cells.length - 1]) cells[cells.length - 1].classList.add('nodeget-detail-record-value')
    })
  }

  function decorateDetailTui(root, body) {
    if (!root || !body) return
    root.classList.add('nodeget-detail-tui-root')
    root.classList.add('nodeget-detail-dossier-root')
    body.classList.add('nodeget-detail-tui-screen')
    body.classList.add('nodeget-detail-dossier-screen')
    const meta = detailSessionMeta()
    const nextSession = meta.index === 'DETAIL' ? '●  ●  ●   SESSION / DETAIL' : '●  ●  ●   SESSION #' + meta.index + ' / DETAIL'
    if (root.dataset.nodegetDetailSession !== nextSession) root.dataset.nodegetDetailSession = nextSession
    if (meta.name && root.dataset.nodegetDetailNode !== meta.name) root.dataset.nodegetDetailNode = meta.name
    const detailHeader = root.querySelector(':scope > .nodeget-detail-drawer-header, :scope > .sticky')
    if (detailHeader) {
      if (detailHeader.dataset.nodegetDetailSession !== nextSession) detailHeader.dataset.nodegetDetailSession = nextSession
      if (meta.name && detailHeader.dataset.nodegetDetailNode !== meta.name) detailHeader.dataset.nodegetDetailNode = meta.name
    }
    const topLevelPanes = []
    Array.from(body.children).forEach(function (child) {
      if (child.classList && child.classList.contains('card-soft')) topLevelPanes.push(child)
      if (child.matches && child.matches('.grid')) {
        const nestedPanes = Array.from(child.children || []).filter(function (nested) {
          return nested.classList && nested.classList.contains('card-soft')
        })
        nestedPanes.forEach(function (nested) {
          topLevelPanes.push(nested)
        })
        if (
          nestedPanes.length > 0 &&
          nestedPanes.every(function (nested) {
            return /SYSTEM|NETWORK|LOAD/i.test(detailPaneLabel(nested))
          })
        ) {
          child.classList.add('nodeget-detail-record-grid')
        }
      }
    })
    topLevelPanes.forEach(function (pane, index) {
      pane.classList.add('nodeget-tui-pane')
      pane.classList.add('nodeget-detail-dossier-pane')
      const paneIndex = String(index + 1).padStart(2, '0')
      if (pane.dataset.nodegetPaneIndex !== paneIndex) pane.dataset.nodegetPaneIndex = paneIndex
      const label = detailPaneLabel(pane)
      if (pane.dataset.nodegetPaneLabel !== label) pane.dataset.nodegetPaneLabel = label
      pane.classList.toggle('nodeget-detail-resource-pane', label === 'RESOURCE')
      pane.classList.toggle('nodeget-detail-telemetry-pane', /TREND|TELEMETRY|SAMPLE/i.test(label))
      pane.classList.toggle('nodeget-detail-probe-pane', /PING|TCP/i.test(label))
      pane.classList.toggle('nodeget-detail-record-pane', /SYSTEM|NETWORK|LOAD/i.test(label))
      pane.classList.toggle('nodeget-detail-neofetch-pane', /^(SYSTEM|NETWORK\s*\/\s*LOAD)$/i.test(label))
      if (/SYSTEM|NETWORK|LOAD/i.test(label)) decorateDetailRecordRows(pane)
      Array.from(pane.querySelectorAll('table')).forEach(decorateDetailTable)
      if (/PING|TCP/i.test(label)) {
        Array.from(pane.querySelectorAll('.mt-3')).forEach(function (summary) {
          if (!/SOURCE/i.test(summary.innerText || summary.textContent || '')) return
          summary.classList.add('nodeget-detail-probe-summary')
          const header = summary.firstElementChild
          if (header) header.classList.add('nodeget-detail-probe-summary-head')
          const rowWrap = header && header.nextElementSibling
          Array.from((rowWrap && rowWrap.children) || []).forEach(function (row, rowIndex) {
            const nextIndex = String(rowIndex + 1).padStart(2, '0')
            row.classList.add('nodeget-detail-probe-summary-row')
            if (row.dataset.nodegetDetailRowIndex !== nextIndex) row.dataset.nodegetDetailRowIndex = nextIndex
          })
        })
      }
    })
    Array.from(body.querySelectorAll('.rounded-md[class*="bg-card"], .rounded-md.border')).forEach(function (pane) {
      if (!pane.classList.contains('nodeget-tui-pane')) pane.classList.add('nodeget-tui-subpane')
    })
    Array.from(body.querySelectorAll('.nodeget-tui-pane[data-nodeget-pane-label="RESOURCE"] > .flex > div')).forEach(function (meter) {
      const graphic = meter.firstElementChild
      const label = graphic && graphic.nextElementSibling
      const sub = label && label.nextElementSibling
      const percent = graphic ? graphic.querySelector('.absolute') : null
      if (!graphic || !percent || !label) return

      meter.classList.add('nodeget-resource-meter')
      graphic.classList.add('nodeget-resource-meter-graphic')
      percent.classList.add('nodeget-resource-meter-value')
      label.classList.add('nodeget-resource-meter-label')
      if (sub) sub.classList.add('nodeget-resource-meter-sub')

      const numericPercent = parseFloat(String(percent.textContent || '').replace(/[^\d.-]+/g, ''))
      if (Number.isFinite(numericPercent)) {
        const nextPercent = String(Math.max(0, Math.min(100, numericPercent)))
        if (meter.dataset.nodegetResourcePercent !== nextPercent) meter.dataset.nodegetResourcePercent = nextPercent
      }
    })
  }

  function enhanceDetailDrawer(ctx) {
    if (!document.body) return
    const roots = ctx && ctx.detailRoots ? ctx.detailRoots : findDetailRoots()
    syncDetailDrawerOpenState(roots.length > 0)
    roots.forEach(function (root) {
      const header = root.querySelector(':scope > .sticky')
      const body = header ? header.nextElementSibling : null
      if (!header || !body) return

      root.classList.add('nodeget-detail-drawer-root')
      header.classList.add('nodeget-detail-drawer-header')
      body.classList.add('nodeget-detail-drawer-body')
      setDetailHeaderHeight(root, header)
      patchDetailCloseButton(header.querySelector('button[aria-label="返回"], button[aria-label="关闭详情"]'))
      patchDetailCloseButton(header.querySelector('button[aria-label="BACK"], button[aria-label="CLOSE DETAILS"]'))
      patchDetailHeaderIdentity(header)
      translateGlobalEnglish(root)
      decorateDetailTui(root, body)
      setDetailHeaderHeight(root, header)
      disarmDetailDrawerPending()

      if (root.dataset.nodegetDrawerClickClose !== '1') {
        root.dataset.nodegetDrawerClickClose = '1'
        root.addEventListener('click', function (event) {
          if (event.target === root) closeDetailFromPatch()
        })
      }
    })
    syncSegmentedMetricBars()
  }

  function queueFullDomRefresh() {
    queueThemeEnhancements()
    queueMainFlagSwap()
    queueDetailDrawer()
  }

  function hasNodegetClass(el) {
    if (!el || !el.classList) return false
    return Array.from(el.classList).some(function (className) {
      return String(className || '').indexOf('nodeget-') === 0
    })
  }

  function nonNodegetClassTokens(value) {
    return String(value || '')
      .split(/\s+/)
      .filter(function (className) {
        return className && className.indexOf('nodeget-') !== 0
      })
      .sort()
  }

  function classMutationIsOnlyNodeget(target, oldValue) {
    if (!target || !target.classList) return false
    const previous = nonNodegetClassTokens(oldValue)
    const current = nonNodegetClassTokens(Array.from(target.classList).join(' '))
    if (previous.length !== current.length) return false
    return previous.every(function (className, index) {
      return className === current[index]
    })
  }

  function isNodegetPatchTarget(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement)
    if (!el || !el.closest) return false
    return !!el.closest(
      '.nodeget-detail-drawer-close, .nodeget-abyssal-brand-icon, .nodeget-archive-footer-powered, .nodeget-archive-footer-version, .nodeget-archive-footer-theme-note',
    )
  }

  function matchesNodegetPatchSubtree(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement)
    if (!el) return false
    return hasNodegetClass(el) || isNodegetPatchTarget(el)
  }

  function childListMutationIsPatchOwned(mutation) {
    if (isNodegetPatchTarget(mutation.target)) return true
    const nodes = Array.from(mutation.addedNodes || []).concat(Array.from(mutation.removedNodes || []))
    return nodes.length > 0 && nodes.every(matchesNodegetPatchSubtree)
  }

  function characterMutationIsPatchOwned(target) {
    return isNodegetPatchTarget(target)
  }

  function isProgressMutationTarget(target) {
    if (!target || target.nodeType !== 1 || !target.closest) return false
    return !!target.closest('[role="progressbar"], .nodeget-resource-meter')
  }

  function scheduleForMutations(mutations) {
    let needsFullRefresh = false
    let needsSegmentedBars = false

    Array.from(mutations || []).forEach(function (mutation) {
      if (needsFullRefresh) return

      if (mutation.type === 'childList') {
        if (!childListMutationIsPatchOwned(mutation)) needsFullRefresh = true
        return
      }

      if (mutation.type === 'characterData') {
        if (!characterMutationIsPatchOwned(mutation.target)) needsFullRefresh = true
        return
      }

      if (mutation.type !== 'attributes') return

      const target = mutation.target
      const attr = mutation.attributeName || ''
      if (!target || target.nodeType !== 1) return

      if (attr === 'class' && classMutationIsOnlyNodeget(target, mutation.oldValue || '')) return
      if ((attr === 'style' || attr === 'aria-valuenow' || attr === 'data-state') && isProgressMutationTarget(target)) {
        needsSegmentedBars = true
        return
      }
      if ((attr === 'style' || attr === 'aria-valuenow' || attr === 'data-state') && hasNodegetClass(target)) return

      needsFullRefresh = true
    })

    if (window.location.hash) {
      if (needsFullRefresh || needsSegmentedBars) queueDetailDrawer()
      return
    }

    if (needsFullRefresh) {
      queueFullDomRefresh()
    } else if (needsSegmentedBars) {
      queueSegmentedMetricBars()
    }
  }

  if (NODEGET_CUSTOM_PATCH_TEST_MODE) {
    window.__NODEGET_CUSTOM_PATCH_TEST_API__ = {
      translateCardText,
      sanitizeUnsupportedMapView,
      parseLatencyTaskQuery,
      latencyRequestWindow,
      mergeLatencyRows,
      downsampleLatencyRows,
      normalizeLatencyTimestamp,
      normalizeFooterVersion,
      ensureFooterVersionElement,
      applyFooterVersionText,
      renderFooterThemeNote,
    }
    return
  }

  document.addEventListener('click', function (event) {
    if (isLikelyDetailOpenClick(event.target)) {
      rememberDetailSessionFromClick(event.target)
      armDetailDrawerPending()
    }
  })

  window.addEventListener('hashchange', function () {
    if (window.location.hash) {
      armDetailDrawerPending()
      queueDetailDrawer()
      return
    }
    disarmDetailDrawerPending()
    syncDetailDrawerOpenState(false)
    queueFullDomRefresh()
  })

  window.addEventListener('resize', function () {
    markSegmentedMetricsDirty()
    queueThemeEnhancements()
    queueDetailDrawer()
  })

  function startPlugin() {
    if (window.location.hash) armDetailDrawerPending()
    const observer = new MutationObserver(function (mutations) {
      scheduleForMutations(mutations)
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class', 'aria-valuenow', 'data-state'],
      attributeOldValue: true,
      childList: true,
      subtree: true,
      characterData: true,
    })
    queueFullDomRefresh()
  }

  if (document.body) {
    startPlugin()
  } else {
    document.addEventListener('DOMContentLoaded', startPlugin, { once: true })
  }
})()
