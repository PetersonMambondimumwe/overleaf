/*
 * Overleaf AI writing assistant.
 *
 * Loaded on the editor page (see app/views/project/ide-react.pug) when
 * settings.ai.enabled is true. The Anthropic key stays on the server: this
 * script only talks to /project/:id/ai/assist.
 */
;(function () {
  'use strict'

  var meta = document.querySelector('meta[name="ol-ai-assist"]')
  if (!meta || meta.content !== 'enabled') return
  if (!/^\/project\/[0-9a-f]{24}/.test(window.location.pathname)) return

  var projectId = window.location.pathname.split('/')[2]
  var csrfMeta = document.querySelector('meta[name="ol-csrfToken"]')
  var csrfToken = (csrfMeta ? csrfMeta.content : '') || window.csrfToken || ''

  var ACTIONS = [
    { id: 'grammar', label: 'Fix grammar', hint: 'Spelling, grammar & punctuation' },
    { id: 'clarity', label: 'Improve clarity', hint: 'Clearer sentences, same meaning' },
    { id: 'formal', label: 'Academic tone', hint: 'Formal journal style' },
    { id: 'shorten', label: 'Shorten', hint: 'About 30% shorter' },
    { id: 'active', label: 'Active voice', hint: 'Convert passive to active voice' },
    { id: 'summarise', label: 'Summarise', hint: 'Two to four sentences' },
  ]

  var savedRange = null
  var savedText = ''
  var lastResult = ''
  var busy = false
  var panelOpen = false

  var fab = null
  var panel = null
  var statusEl = null
  var resultEl = null
  var replaceBtn = null
  var copyBtn = null
  var actionButtons = []

  function injectStyles() {
    if (document.getElementById('ol-ai-assist-styles')) return
    var style = document.createElement('style')
    style.id = 'ol-ai-assist-styles'
    style.textContent = [
      '.ol-ai-fab{position:fixed;right:24px;bottom:24px;z-index:1200;display:inline-flex;align-items:center;gap:8px;background:#116033;color:#fff;border:0;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(17,96,51,.28);cursor:pointer;font-family:inherit;transition:transform .12s,background .12s}',
      '.ol-ai-fab:hover{background:#0d4c29;transform:translateY(-1px)}',
      '.ol-ai-fab:active{transform:translateY(0)}',
      '.ol-ai-fab[hidden]{display:none}',
      '.ol-ai-panel{position:fixed;right:24px;bottom:76px;z-index:1201;width:370px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);display:flex;flex-direction:column;background:#fff;border:1px solid #dde5df;border-radius:14px;box-shadow:0 20px 60px rgba(15,61,38,.18);font-family:inherit;overflow:hidden}',
      '.ol-ai-panel[hidden]{display:none}',
      '.ol-ai-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eef2ef;background:linear-gradient(180deg,#f7fbf8,#fff)}',
      '.ol-ai-title{font-size:14px;font-weight:700;color:#123b24;margin:0}',
      '.ol-ai-sub{font-size:11px;color:#6b7c71;margin:2px 0 0}',
      '.ol-ai-close{border:0;background:transparent;font-size:18px;line-height:1;color:#6b7c71;cursor:pointer;padding:4px 6px;border-radius:6px}',
      '.ol-ai-close:hover{background:#eef2ef;color:#123b24}',
      '.ol-ai-body{padding:12px 16px;overflow:auto}',
      '.ol-ai-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.ol-ai-action{display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid #dbe5de;background:#fff;border-radius:10px;padding:9px 10px;cursor:pointer;text-align:left;font-family:inherit;transition:border-color .12s,background .12s}',
      '.ol-ai-action:hover{border-color:#116033;background:#f4faf6}',
      '.ol-ai-action[disabled]{opacity:.55;cursor:default}',
      '.ol-ai-action strong{font-size:12px;color:#123b24;font-weight:600}',
      '.ol-ai-action span{font-size:10.5px;color:#6b7c71;line-height:1.3}',
      '.ol-ai-status{font-size:12px;color:#6b7c71;margin:12px 0 0;line-height:1.45;min-height:16px}',
      '.ol-ai-status[data-kind="error"]{color:#8a2c22}',
      '.ol-ai-status[data-kind="ok"]{color:#116033}',
      '.ol-ai-result{margin:12px 0 0;padding:10px 12px;background:#f6faf7;border:1px solid #dbe5de;border-radius:10px;font-size:12.5px;line-height:1.55;color:#1b222c;white-space:pre-wrap;max-height:230px;overflow:auto}',
      '.ol-ai-result[hidden]{display:none}',
      '.ol-ai-foot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eef2ef;background:#fbfdfb}',
      '.ol-ai-btn{border-radius:8px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid transparent}',
      '.ol-ai-primary{background:#116033;color:#fff;flex:1}',
      '.ol-ai-primary:hover{background:#0d4c29}',
      '.ol-ai-ghost{background:#fff;color:#123b24;border-color:#dbe5de}',
      '.ol-ai-ghost:hover{background:#f4faf6}',
      '.ol-ai-btn[disabled]{opacity:.55;cursor:default}',
      '.ol-ai-btn[hidden]{display:none}',
      '.ol-ai-toast{position:fixed;right:24px;bottom:140px;z-index:1202;background:#123b24;color:#fff;font-size:12.5px;padding:9px 14px;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:inherit}',
      '.ol-ai-toast[hidden]{display:none}',
      '@media (max-width:640px){.ol-ai-panel{right:12px;left:12px;width:auto;bottom:72px}.ol-ai-fab{right:12px;bottom:12px}}',
    ].join('\n')
    document.head.appendChild(style)
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag)
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') node.textContent = attrs[key]
        else if (key === 'className') node.className = attrs[key]
        else node.setAttribute(key, attrs[key])
      })
    }
    ;(children || []).forEach(function (child) {
      node.appendChild(child)
    })
    return node
  }

  // Keep focus (and the text selection) in CodeMirror while the user clicks
  // our controls; otherwise the browser collapses the selection on mousedown.
  function keepFocus(node) {
    node.addEventListener('mousedown', function (event) {
      event.preventDefault()
    })
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || ''
    if (kind) statusEl.setAttribute('data-kind', kind)
    else statusEl.removeAttribute('data-kind')
  }

  function toast(text) {
    var t = document.createElement('div')
    t.className = 'ol-ai-toast'
    t.textContent = text
    document.body.appendChild(t)
    setTimeout(function () {
      t.parentNode && t.parentNode.removeChild(t)
    }, 2600)
  }

  function selectionInsideEditor() {
    var cm = document.querySelector('.cm-content')
    var sel = window.getSelection()
    if (!cm || !sel || sel.rangeCount === 0) return null
    var range = sel.getRangeAt(0)
    var container = range.commonAncestorContainer
    var elem = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement
    if (!elem || !cm.contains(elem)) return null
    return sel
  }

  function captureSelection() {
    var sel = selectionInsideEditor()
    if (!sel || sel.isCollapsed) return null
    var text = sel.toString()
    if (!text.trim()) return null
    savedRange = sel.getRangeAt(0).cloneRange()
    savedText = text
    return text
  }

  function setBusy(value) {
    busy = value
    actionButtons.forEach(function (btn) {
      btn.disabled = value
    })
    if (value) {
      replaceBtn.hidden = true
      copyBtn.hidden = true
      resultEl.hidden = true
    }
  }

  function runAction(action) {
    if (busy) return
    var text = captureSelection() || savedText
    if (!text || !text.trim()) {
      setStatus('Select some text in the editor first, then pick an action.', 'error')
      return
    }
    setBusy(true)
    setStatus('Thinking…')
    fetch('/project/' + projectId + '/ai/assist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'csrf-token': csrfToken,
      },
      credentials: 'same-origin',
      body: JSON.stringify({ action: action, text: text, _csrf: csrfToken }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data }
        })
      })
      .then(function (res) {
        if (!res.ok) {
          var message =
            (res.data && res.data.message && res.data.message.text) ||
            'The AI request failed. Please try again.'
          setStatus(message, 'error')
          setBusy(false)
          return
        }
        lastResult = res.data.result || ''
        resultEl.textContent = lastResult
        resultEl.hidden = false
        replaceBtn.hidden = false
        copyBtn.hidden = false
        setStatus(
          'Suggestion ready — ' + lastResult.length + ' characters.',
          'ok'
        )
        setBusy(false)
      })
      .catch(function () {
        setStatus('Could not reach the AI service. Check your connection.', 'error')
        setBusy(false)
      })
  }

  function replaceSelection() {
    if (!lastResult || !savedRange) return
    var cm = document.querySelector('.cm-content')
    var sel = window.getSelection()
    try {
      if (cm) cm.focus()
      sel.removeAllRanges()
      sel.addRange(savedRange)
      var currentText = sel.toString().replace(/\r\n/g, '\n')
      var expectedText = savedText.replace(/\r\n/g, '\n')
      if (currentText !== expectedText) {
        setStatus('The selection changed. Select the text again and retry.', 'error')
        return
      }

      var ok = false
      try {
        ok = document.execCommand('insertText', false, lastResult)
      } catch (e) {
        ok = false
      }

      if (!ok && cm) {
        try {
          var inputEvent = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: lastResult,
          })
          cm.dispatchEvent(inputEvent)
          ok = true
        } catch (e) {}
      }

      if (!ok) {
        setStatus('Could not apply the suggestion. Select the text and retry.', 'error')
        return
      }
      savedRange = null
      savedText = ''
      setStatus('Applied. Undo with Ctrl/Cmd+Z if needed.', 'ok')
      replaceBtn.hidden = true
      copyBtn.hidden = true
      resultEl.hidden = true
      setTimeout(closePanel, 600)
    } catch (e) {
      setStatus('Could not apply the suggestion. Select the text and retry.', 'error')
    }
  }

  function copyResult() {
    if (!lastResult) return
    var done = function () {
      toast('Copied to clipboard')
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastResult).then(done, done)
    } else {
      var area = document.createElement('textarea')
      area.value = lastResult
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
      } catch (e) {}
      document.body.removeChild(area)
      done()
    }
  }

  function openPanel() {
    panelOpen = true
    panel.hidden = false
    fab.hidden = true
    var text = captureSelection() || savedText
    if (text && text.trim()) {
      setStatus(
        text.length + ' characters selected. Pick an action to improve them.'
      )
    } else {
      setStatus('Select text in the editor, then pick an action.')
    }
  }

  function closePanel() {
    panelOpen = false
    panel.hidden = true
    fab.hidden = false
  }

  function buildUi() {
    injectStyles()

    fab = el(
      'button',
      {
        className: 'ol-ai-fab',
        type: 'button',
        title: 'AI writing assistant (Alt+A)',
        'aria-label': 'Open AI writing assistant',
      },
      [document.createTextNode('✦ AI Assist')]
    )

    var actions = el('div', { className: 'ol-ai-actions' })
    ACTIONS.forEach(function (action) {
      var btn = el(
        'button',
        { className: 'ol-ai-action', type: 'button', 'data-action': action.id },
        [
          el('strong', { text: action.label }),
          el('span', { text: action.hint }),
        ]
      )
      keepFocus(btn)
      btn.addEventListener('click', function () {
        runAction(action.id)
      })
      actionButtons.push(btn)
      actions.appendChild(btn)
    })

    statusEl = el('p', { className: 'ol-ai-status' })
    resultEl = el('div', { className: 'ol-ai-result' })
    resultEl.hidden = true

    replaceBtn = el('button', {
      className: 'ol-ai-btn ol-ai-primary',
      type: 'button',
      text: 'Replace selection',
    })
    replaceBtn.hidden = true
    keepFocus(replaceBtn)
    replaceBtn.addEventListener('click', replaceSelection)

    copyBtn = el('button', {
      className: 'ol-ai-btn ol-ai-ghost',
      type: 'button',
      text: 'Copy',
    })
    copyBtn.hidden = true
    keepFocus(copyBtn)
    copyBtn.addEventListener('click', copyResult)

    var closeBtn = el('button', {
      className: 'ol-ai-close',
      type: 'button',
      'aria-label': 'Close',
      text: '×',
    })
    keepFocus(closeBtn)
    closeBtn.addEventListener('click', closePanel)

    panel = el('div', { className: 'ol-ai-panel', role: 'dialog', 'aria-label': 'AI writing assistant' }, [
      el('div', { className: 'ol-ai-head' }, [
        el('div', {}, [
          el('h2', { className: 'ol-ai-title', text: 'AI Assist' }),
          el('p', { className: 'ol-ai-sub', text: 'Claude · runs on this server' }),
        ]),
        closeBtn,
      ]),
      el('div', { className: 'ol-ai-body' }, [actions, statusEl, resultEl]),
      el('div', { className: 'ol-ai-foot' }, [replaceBtn, copyBtn]),
    ])
    panel.hidden = true

    keepFocus(fab)
    fab.addEventListener('click', function () {
      if (panelOpen) closePanel()
      else openPanel()
    })
    document.body.appendChild(fab)
    document.body.appendChild(panel)

    document.addEventListener('keydown', function (event) {
      if (event.altKey && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault()
        if (panelOpen) closePanel()
        else openPanel()
      }
      if (event.key === 'Escape' && panelOpen) closePanel()
    })

    // Listen for selection changes inside the editor so active text and range are always primed
    document.addEventListener('selectionchange', function () {
      var sel = selectionInsideEditor()
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        savedRange = sel.getRangeAt(0).cloneRange()
        savedText = sel.toString()
        if (panelOpen && !busy) {
          setStatus(
            savedText.length + ' characters selected. Pick an action to improve them.'
          )
        }
      }
    })

    window.addEventListener('hashchange', function () {
      if (panelOpen) closePanel()
    })
  }

  function start() {
    var cm = document.querySelector('.cm-content')
    if (!cm) {
      var observer = new MutationObserver(function () {
        if (document.querySelector('.cm-content')) {
          observer.disconnect()
          start()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      return
    }
    if (cm.getAttribute('contenteditable') === 'false') return
    if (document.querySelector('.ol-ai-fab')) return
    buildUi()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
