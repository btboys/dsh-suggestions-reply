/**
 * Client half of suggestions-reply:
 * - conversation.chat.turnTail: 1-3 user-voice follow-up capsules below the
 *   latest completed answer; clicking one sends it as an ordinary message.
 * - conversation.input.dock: reusable message-template chips above the
 *   composer; clicking one fills the input box. A manager popover adds,
 *   edits, reorders and deletes templates.
 */
window.__ModuleLoader__.load({
  id: 'dsh-suggestions-reply',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useSyncExternalStore } = React

    const NS = 'suggestions-reply'
    const API = '/api/suggestions-reply'

    const zh = {
      manage: '管理模板',
      addTemplate: '添加模板',
      panelTitle: '常用消息模板',
      titleLabel: '标题',
      textLabel: '内容',
      titlePh: '如：代码审查',
      textPh: '点击模板后填入输入框的完整消息',
      add: '添加',
      save: '保存',
      cancel: '取消',
      edit: '编辑',
      del: '删除',
      up: '上移',
      down: '下移',
      close: '关闭',
      empty: '还没有模板。添加一条固定话术或高频指令，之后一键填入输入框。',
      loading: '加载中…',
      required: '标题和内容不能为空',
      modeLabel: '点击行为',
      modeFill: '填入输入框',
      modeSend: '直接发送',
      modeFillShort: '填入',
      modeSendShort: '发送',
      fillHint: '点击填入输入框',
      sendHint: '点击作为消息发送',
      busy: '发送中，暂不可填入',
    }
    const en = {
      manage: 'Manage templates',
      addTemplate: 'Add template',
      panelTitle: 'Message templates',
      titleLabel: 'Title',
      textLabel: 'Content',
      titlePh: 'e.g. Code review',
      textPh: 'The full message filled into the input box on click',
      add: 'Add',
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit',
      del: 'Delete',
      up: 'Move up',
      down: 'Move down',
      close: 'Close',
      empty: 'No templates yet. Add a fixed phrase or frequent command to fill the input box in one click.',
      loading: 'Loading…',
      required: 'Title and content are required',
      modeLabel: 'On click',
      modeFill: 'Fill input box',
      modeSend: 'Send directly',
      modeFillShort: 'Fill',
      modeSendShort: 'Send',
      fillHint: 'Click to fill the input box',
      sendHint: 'Click to send as a message',
      busy: 'Sending; filling is unavailable',
    }

    const CSS = `
.sr-capsules { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 2px; }
.sr-capsule {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 4px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.5; text-align: left;
  transition: border-color .15s ease, background .15s ease;
}
.sr-capsule:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-1));
}
.sr-capsule:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sr-capsule .sr-capsule-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
.sr-capsule svg { flex: none; color: var(--dsw-alias-brand-primary); }
.sr-dock-wrap {
  box-sizing: border-box;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance, 0px) - 4 * var(--dsh-composer-dock-inset, 8px));
  margin: 0 auto;
}
.sr-dock {
  display: flex; align-items: center; gap: 6px; padding: 0 0 6px; overflow-x: auto; scrollbar-width: thin;
  max-width: calc(var(--dsh-composer-card-max-width, 952px) - 4 * var(--dsh-composer-dock-inset, 8px));
  margin: 0 auto;
  justify-content: safe flex-end;
}
.sr-chip {
  flex: none; display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 1.5;
  transition: border-color .15s ease, color .15s ease;
}
.sr-chip:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
.sr-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sr-chip[disabled] { opacity: .5; cursor: default; }
.sr-chip .sr-chip-text { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-chip svg { flex: none; color: var(--dsw-alias-brand-primary); }
.sr-chip.sr-chip-send { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent); }
.sr-manage-btn {
  flex: none; display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 999px; cursor: pointer;
  border: 1px dashed var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5;
}
.sr-manage-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.sr-manage-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sr-panel {
  position: fixed; z-index: 1000; width: 360px; max-width: calc(100vw - 16px);
  max-height: min(440px, calc(100vh - 24px)); overflow-y: auto;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  padding: 12px; color: var(--dsw-alias-label-primary); font-size: 12px;
}
.sr-panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.sr-panel-title { font-size: 13px; font-weight: 600; }
.sr-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 6px; border: none; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary);
}
.sr-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.sr-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sr-icon-btn.sr-danger:hover { color: var(--dsw-alias-state-error-primary); }
.sr-icon-btn[disabled] { opacity: .35; cursor: default; }
.sr-form { display: flex; flex-direction: column; gap: 6px; padding: 8px; margin-bottom: 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.sr-form label { display: flex; flex-direction: column; gap: 3px; color: var(--dsw-alias-label-secondary); }
.sr-input, .sr-textarea {
  width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); font-size: 12px; font-family: inherit;
}
.sr-textarea { resize: vertical; min-height: 56px; line-height: 1.5; }
.sr-input:focus, .sr-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.sr-form-actions { display: flex; gap: 6px; justify-content: flex-end; }
.sr-form-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-secondary); }
.sr-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; overflow: hidden; }
.sr-seg-btn {
  padding: 3px 10px; border: none; cursor: pointer; font-size: 12px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary);
}
.sr-seg-btn + .sr-seg-btn { border-left: 1px solid var(--dsw-alias-border-l1); }
.sr-seg-btn.sr-seg-on { background: var(--dsw-alias-brand-primary); color: #fff; }
.sr-seg-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.sr-mode-badge {
  flex: none; margin-left: 6px; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 400;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); vertical-align: 1px;
}
.sr-mode-badge.sr-mode-send {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.sr-btn {
  padding: 4px 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-size: 12px; cursor: pointer;
}
.sr-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.sr-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sr-btn.sr-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.sr-btn[disabled] { opacity: .5; cursor: default; }
.sr-list { display: flex; flex-direction: column; gap: 4px; }
.sr-row { display: flex; align-items: center; gap: 4px; padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.sr-row-main { flex: 1; min-width: 0; }
.sr-row-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-row-text { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.sr-row-actions { display: flex; gap: 2px; flex: none; }
.sr-empty { color: var(--dsw-alias-label-secondary); line-height: 1.6; padding: 8px 2px; }
.sr-error { color: var(--dsw-alias-state-error-primary); margin: 6px 0 0; line-height: 1.5; }
`

    /* ---------------- shared RPC + template store ---------------- */

    async function rpc(method, args) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '请求失败')
      return data
    }

    const store = {
      snap: { list: [], loaded: false, error: '' },
      listeners: new Set(),
      getSnapshot() { return store.snap },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
      set(patch) {
        store.snap = { ...store.snap, ...patch }
        for (const listener of store.listeners) listener()
      },
      async refresh() {
        try {
          const data = await rpc('templates.list')
          store.set({ list: Array.isArray(data.templates) ? data.templates : [], loaded: true, error: '' })
        } catch (error) {
          store.set({ loaded: true, error: String(error?.message ?? error) })
        }
      },
    }

    /* One shared SSE subscription while any dock is mounted; every connected
       page (desktop webview, browser tabs) refreshes on any Host-side write. */
    let changeSource = null
    let changeRefs = 0
    function subscribeChanges() {
      changeRefs += 1
      if (changeSource === null && typeof EventSource !== 'undefined') {
        changeSource = new EventSource(`${API}/events`)
        changeSource.onmessage = () => { void store.refresh() }
        changeSource.onopen = () => { void store.refresh() }
      }
      return () => {
        changeRefs -= 1
        if (changeRefs <= 0) {
          changeRefs = 0
          if (changeSource !== null) {
            changeSource.close()
            changeSource = null
          }
        }
      }
    }

    /* ---------------- icons ---------------- */

    const sparkleIcon = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true },
      h('path', { d: 'M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1z' }))
    const gearIcon = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
      h('circle', { cx: 8, cy: 8, r: 2.4 }),
      h('path', { d: 'M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4' }))
    const plusIcon = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
      h('path', { d: 'M8 3v10M3 8h10' }))
    const closeIcon = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
      h('path', { d: 'M4 4l8 8M12 4l-8 8' }))
    const editIcon = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
      h('path', { d: 'M11.5 2.5l2 2L6 12l-2.6.6L4 10l7.5-7.5z' }))
    const trashIcon = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
      h('path', { d: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.7 7v4M9.3 7v4' }))
    const upIcon = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
      h('path', { d: 'M4 10l4-4 4 4' }))
    const downIcon = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
      h('path', { d: 'M4 6l4 4 4-4' }))
    const sendIcon = h('svg', { width: 11, height: 11, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
      h('path', { d: 'M8 13V3M4 7l4-4 4 4' }))

    /* ---------------- follow-up capsules (turn tail) ---------------- */

    function SuggestionsTail(props) {
      const { turn, sessionId, inputActions, useChat, useSessionStatus, useAccess, t } = props
      const turnNumber = turn?.turn
      const latestTurn = useChat((s) => {
        const order = s.timeline.turnOrder
        return order.length ? order[order.length - 1] : -1
      })
      const running = useSessionStatus((s) => s.get(sessionId)?.running)
      const allowed = useAccess('session/prompt')
      const [suggestions, setSuggestions] = useState([])

      const visible = turn?.status === 'closed' && turnNumber === latestTurn && running === false && allowed !== false

      useEffect(() => {
        if (!visible) {
          setSuggestions([])
          return undefined
        }
        const controller = new AbortController()
        const url = `${API}/suggestions?session=${encodeURIComponent(sessionId)}&turn=${encodeURIComponent(turnNumber)}`
        fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
          .then((res) => (res.ok ? res.json() : { suggestions: [] }))
          .then((data) => {
            if (!controller.signal.aborted) setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
          })
          .catch(() => {
            if (!controller.signal.aborted) setSuggestions([])
          })
        return () => controller.abort()
      }, [visible, sessionId, turnNumber])

      if (!visible || suggestions.length === 0) return null

      const send = (text) => {
        inputActions.setDraft(text)
        inputActions.submit()
      }

      return h('div', { className: 'sr-capsules', role: 'group', 'aria-label': t('sendHint') },
        suggestions.map((text, i) => h('button', {
          key: `${turnNumber}-${i}`,
          type: 'button',
          className: 'sr-capsule',
          title: `${t('sendHint')}：${text}`,
          onClick: () => send(text),
        }, sparkleIcon, h('span', { className: 'sr-capsule-text' }, text))))
    }

    /* ---------------- template manager popover ---------------- */

    function TemplateManager({ t, anchorRect, onClose }) {
      const { createPortal } = require('react-dom')
      const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const [form, setForm] = useState(null) // { id?, title, text }
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const panelRef = useRef(null)
      const titleRef = useRef(null)

      // Focus the title only when the form target changes (open / switch row),
      // never on field edits — `form` itself is replaced on every keystroke.
      const formKey = form === null ? null : (form.id ?? 'new')
      useEffect(() => {
        if (formKey !== null && titleRef.current) titleRef.current.focus()
      }, [formKey])

      const panelWidth = 360
      const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - panelWidth - 8))
      const bottom = Math.max(8, window.innerHeight - anchorRect.top + 8)

      useEffect(() => {
        void store.refresh()
      }, [])

      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        const onDown = (e) => {
          if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
        }
        const onResize = () => onClose()
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown)
        window.addEventListener('resize', onResize)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDown)
          window.removeEventListener('resize', onResize)
        }
      }, [onClose])

      const run = async (fn) => {
        setBusy(true)
        setError('')
        try {
          await fn()
          await store.refresh()
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setBusy(false)
        }
      }

      const submitForm = () => {
        if (!form) return
        const title = form.title.trim()
        const text = form.text.trim()
        if (!title || !text) {
          setError(t('required'))
          return
        }
        void run(async () => {
          if (form.id) await rpc('templates.update', { id: form.id, title, text, sendMode: form.sendMode })
          else await rpc('templates.add', { title, text, sendMode: form.sendMode })
          setForm(null)
        })
      }

      const move = (index, delta) => {
        const ids = snap.list.map((x) => x.id)
        const target = index + delta
        if (target < 0 || target >= ids.length) return
        const [id] = ids.splice(index, 1)
        ids.splice(target, 0, id)
        void run(() => rpc('templates.reorder', { ids }))
      }

      const rows = snap.list.map((item, index) => h('div', { className: 'sr-row', key: item.id },
        h('div', { className: 'sr-row-main' },
          h('div', { className: 'sr-row-title', title: item.title },
            item.title,
            h('span', { className: 'sr-mode-badge' + (item.sendMode === 'send' ? ' sr-mode-send' : '') },
              item.sendMode === 'send' ? t('modeSendShort') : t('modeFillShort'))),
          h('div', { className: 'sr-row-text', title: item.text }, item.text)),
        h('div', { className: 'sr-row-actions' },
          h('button', { type: 'button', className: 'sr-icon-btn', title: t('up'), 'aria-label': t('up'), disabled: busy || index === 0, onClick: () => move(index, -1) }, upIcon),
          h('button', { type: 'button', className: 'sr-icon-btn', title: t('down'), 'aria-label': t('down'), disabled: busy || index === snap.list.length - 1, onClick: () => move(index, 1) }, downIcon),
          h('button', { type: 'button', className: 'sr-icon-btn', title: t('edit'), 'aria-label': t('edit'), disabled: busy, onClick: () => setForm({ id: item.id, title: item.title, text: item.text, sendMode: item.sendMode === 'send' ? 'send' : 'fill' }) }, editIcon),
          h('button', {
            type: 'button', className: 'sr-icon-btn sr-danger', title: t('del'), 'aria-label': t('del'), disabled: busy,
            onClick: () => void run(() => rpc('templates.remove', { id: item.id })),
          }, trashIcon))))

      const panel = h('div', {
        className: 'sr-panel', ref: panelRef, role: 'dialog', 'aria-label': t('panelTitle'),
        style: { left, bottom },
      },
        h('div', { className: 'sr-panel-head' },
          h('span', { className: 'sr-panel-title' }, t('panelTitle')),
          h('button', { type: 'button', className: 'sr-icon-btn', title: t('close'), 'aria-label': t('close'), onClick: onClose }, closeIcon)),
        form
          ? h('div', { className: 'sr-form' },
              h('label', null, t('titleLabel'),
                h('input', {
                  className: 'sr-input', ref: titleRef, value: form.title, maxLength: 60, placeholder: t('titlePh'),
                  onChange: (e) => setForm({ ...form, title: e.target.value }),
                })),
              h('label', null, t('textLabel'),
                h('textarea', {
                  className: 'sr-textarea', value: form.text, maxLength: 4000, placeholder: t('textPh'), rows: 3,
                  onChange: (e) => setForm({ ...form, text: e.target.value }),
                })),
              h('div', { className: 'sr-form-row' },
                h('span', null, t('modeLabel')),
                h('div', { className: 'sr-seg', role: 'radiogroup', 'aria-label': t('modeLabel') },
                  ['fill', 'send'].map((m) => h('button', {
                    key: m, type: 'button', role: 'radio', 'aria-checked': form.sendMode === m,
                    className: 'sr-seg-btn' + (form.sendMode === m ? ' sr-seg-on' : ''),
                    onClick: () => setForm({ ...form, sendMode: m }),
                  }, t(m === 'fill' ? 'modeFill' : 'modeSend'))))),
              h('div', { className: 'sr-form-actions' },
                h('button', { type: 'button', className: 'sr-btn', onClick: () => { setForm(null); setError('') } }, t('cancel')),
                h('button', { type: 'button', className: 'sr-btn sr-primary', disabled: busy, onClick: submitForm }, form.id ? t('save') : t('add'))))
          : h('button', { type: 'button', className: 'sr-manage-btn', style: { marginBottom: 8 }, onClick: () => setForm({ title: '', text: '', sendMode: 'fill' }) }, plusIcon, t('addTemplate')),
        !snap.loaded
          ? h('div', { className: 'sr-empty' }, t('loading'))
          : snap.list.length === 0
            ? h('div', { className: 'sr-empty' }, t('empty'))
            : h('div', { className: 'sr-list' }, rows),
        error ? h('div', { className: 'sr-error', role: 'alert' }, error) : null)

      return createPortal(panel, document.body)
    }

    /* ---------------- template dock above the composer ---------------- */

    function TemplatesDock(props) {
      const { inputActions, useInput, t } = props
      const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const phase = useInput((s) => s.phase)
      const [open, setOpen] = useState(false)
      const [anchorRect, setAnchorRect] = useState(null)
      const manageRef = useRef(null)

      useEffect(() => {
        void store.refresh()
        const unsubscribe = subscribeChanges()
        const catchUp = () => { void store.refresh() }
        window.addEventListener('focus', catchUp)
        document.addEventListener('visibilitychange', catchUp)
        return () => {
          unsubscribe()
          window.removeEventListener('focus', catchUp)
          document.removeEventListener('visibilitychange', catchUp)
        }
      }, [])

      const openManager = useCallback(() => {
        if (manageRef.current) setAnchorRect(manageRef.current.getBoundingClientRect())
        setOpen(true)
      }, [])
      const closeManager = useCallback(() => setOpen(false), [])

      const fill = (item) => {
        inputActions.setDraft(item.text)
        if (item.sendMode === 'send') inputActions.submit()
        else inputActions.persistDraft()
      }

      const editable = phase === 'plain'
      const chips = snap.list.map((item) => {
        const send = item.sendMode === 'send'
        return h('button', {
          key: item.id,
          type: 'button',
          className: 'sr-chip' + (send ? ' sr-chip-send' : ''),
          disabled: !editable,
          title: editable ? `${t(send ? 'sendHint' : 'fillHint')}：${item.text}` : t('busy'),
          onClick: () => fill(item),
        }, send ? sendIcon : null, h('span', { className: 'sr-chip-text' }, item.title))
      })

      return h(React.Fragment, null,
        h('div', { className: 'sr-dock-wrap' },
          h('div', { className: 'sr-dock' },
            chips,
            h('button', {
              type: 'button', className: 'sr-manage-btn', ref: manageRef,
              title: t('manage'), 'aria-haspopup': 'dialog', 'aria-expanded': open,
              onClick: openManager,
            }, gearIcon, snap.list.length === 0 ? t('addTemplate') : t('manage')))),
        open && anchorRect ? h(TemplateManager, { t, anchorRect, onClose: closeManager }) : null)
    }

    /* ---------------- plugin ---------------- */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const el = document.createElement('style')
          el.setAttribute('data-suggestions-reply', '')
          el.textContent = CSS
          document.head.appendChild(el)
          return () => el.remove()
        }, 'suggestions-reply: styles')

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'suggestions-reply: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'suggestions-reply-capsules',
          order: 30,
        }, (props) => h(SuggestionsTail, { ...props, t })))

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'suggestions-reply-templates',
          order: 10,
        }, (props) => h(TemplatesDock, { ...props, t })))
      },
    }
  },
})