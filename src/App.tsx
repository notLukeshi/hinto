import { useEffect, useMemo, useState } from 'react'
import './App.css'

declare const chrome:
  | {
      runtime?: {
        sendMessage: (message: ExtensionRequest) => Promise<ExtensionResponse>
      }
    }
  | undefined

type ExerciseKind = 'vocabulary-text' | 'vocabulary-voice' | 'kanji-read' | 'kanji-find' | 'grammar' | 'unknown'
type Tab = 'hint' | 'auto' | 'settings'
type Theme = 'sumi' | 'matcha' | 'shoji'

type PageState = {
  ok: boolean
  kind: ExerciseKind
  title: string
  url: string
  status: string
  confidence: number
  answerLabel?: string
  answerSource?: string
  targetText?: string
  progress?: {
    current: number
    total: number
  }
  advanceLabel?: string
  step?: string
  error?: string
}

type ExtensionRequest =
  | { type: 'HINTO_GET_STATE' }
  | { type: 'HINTO_HINT' }
  | { type: 'HINTO_STEP' }
  | { type: 'HINTO_ADVANCE' }
  | { type: 'HINTO_AUTO_START' }
  | { type: 'HINTO_AUTO_STOP' }

type ExtensionResponse = PageState & { message?: string }

const fallbackState: PageState = {
  ok: false,
  kind: 'unknown',
  title: 'No page detected',
  url: '',
  status: 'Open a supported Marugoto A2 exercise tab.',
  confidence: 0,
}

const themes: Array<{ id: Theme; name: string; note: string }> = [
  { id: 'sumi', name: 'Sumi Ink', note: 'warm paper + coral ink' },
  { id: 'matcha', name: 'Matcha Zen', note: 'green header + calm contrast' },
  { id: 'shoji', name: 'Shoji Dark', note: 'night paper + gold accent' },
]

const appVersion = '0.1.1'

function kindLabel(kind: ExerciseKind) {
  const labels: Record<ExerciseKind, string> = {
    'vocabulary-text': 'Vocabulary',
    'vocabulary-voice': 'Listening',
    'kanji-read': 'Kanji read',
    'kanji-find': 'Kanji find',
    grammar: 'Grammar',
    unknown: 'No quiz',
  }
  return labels[kind]
}

function shortContext(state: PageState) {
  if (state.kind === 'unknown') return 'Waiting for Marugoto'
  const q = state.progress ? ['', String(state.progress.current), String(state.progress.total)] : undefined
  return `${kindLabel(state.kind)}${q ? ` - Q${q[1]}/${q[2]}` : ''}`
}

async function send(message: ExtensionRequest): Promise<ExtensionResponse> {
  const api = typeof chrome === 'undefined' ? undefined : chrome
  if (!api?.runtime?.sendMessage) {
    return {
      ...fallbackState,
      status: 'Load dist/ as an unpacked Chrome extension to control Marugoto.',
    }
  }

  try {
    const response = await api.runtime.sendMessage(message)
    return response ?? fallbackState
  } catch (error) {
    return {
      ...fallbackState,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('hint')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('hinto-theme') as Theme) || 'sumi')
  const [state, setState] = useState<PageState>(fallbackState)
  const [busy, setBusy] = useState(false)
  const [autoRunning, setAutoRunning] = useState(false)
  const [message, setMessage] = useState('Ready')

  const progress = useMemo(() => {
    if (state.progress) {
      const { current, total } = state.progress
      return { current, total, percent: total ? Math.round((current / total) * 100) : 0 }
    }
    const q = state.targetText?.match(/Q(\d+)\s*\/\s*(\d+)/i)
    if (!q) return { current: state.ok ? 1 : 0, total: state.ok ? 1 : 0, percent: state.ok ? 100 : 0 }
    const current = Number(q[1])
    const total = Number(q[2])
    return { current, total, percent: total ? Math.round((current / total) * 100) : 0 }
  }, [state])

  const answer = state.answerLabel || (state.ok ? 'Detected' : '—')
  const subAnswer = state.answerSource || state.status

  async function run(request: ExtensionRequest, done: string) {
    setBusy(true)
    const response = await send(request)
    setState(response)
    setMessage(response.error || response.status || done)
    setBusy(false)
  }

  async function startAuto() {
    setAutoRunning(true)
    setMessage('Auto run started.')
    const response = await send({ type: 'HINTO_AUTO_START' })
    setState(response)
    setMessage(response.error || response.status || 'Auto stopped')
    setAutoRunning(false)
  }

  async function stopAuto() {
    setMessage('Stopping auto run...')
    const response = await send({ type: 'HINTO_AUTO_STOP' })
    setState(response)
    setMessage(response.error || response.status || 'Auto stopped')
    setAutoRunning(false)
  }

  function updateTheme(next: Theme) {
    setTheme(next)
    localStorage.setItem('hinto-theme', next)
  }

  useEffect(() => {
    const firstScan = window.setTimeout(() => {
      void send({ type: 'HINTO_GET_STATE' }).then((response) => {
        setState(response)
        setMessage(response.status)
      })
    }, 0)
    const id = window.setInterval(() => {
      void send({ type: 'HINTO_GET_STATE' }).then(setState)
    }, 1000)
    return () => {
      window.clearTimeout(firstScan)
      window.clearInterval(id)
    }
  }, [])

  return (
    <main className={`hinto-window theme-${theme}`}>
      <header className="titlebar">
        <div className="title-spacer" />
        <div className="brand">
          <span className="brand-jp">&#x30D2;&#x30F3;&#x30C8;</span>
          <span className="brand-en">hinto</span>
        </div>
        <button className="close-button" type="button" aria-label="Close Hinto" onClick={() => window.close()}>
          X
        </button>
      </header>

      <nav className="tabs" aria-label="Hinto sections">
        {(['hint', 'auto', 'settings'] as const).map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'on' : ''} onClick={() => setActiveTab(tab)}>
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {activeTab === 'hint' && (
        <section className="body">
          <div className="context">
            <span className="context-mark" />
            <span>
              <b>{shortContext(state)}</b>
              <small>{state.ok ? 'detected' : 'not connected'}</small>
            </span>
          </div>

          <article className="answer-card">
            <div className="answer-label">Correct answer</div>
            <div className="answer-main">{answer}</div>
            <div className="answer-sub">{subAnswer}</div>
          </article>

          <div className="button-row">
            <button type="button" className="ghost" disabled={busy || !state.ok} onClick={() => run({ type: 'HINTO_HINT' }, 'Highlighted')}>
              Highlight
            </button>
            <button type="button" className="fill" disabled={busy || !state.ok} onClick={() => run({ type: 'HINTO_STEP' }, 'Selected')}>
              Select it
            </button>
          </div>

          <button type="button" className="ghost wide advance-button" disabled={busy || !state.advanceLabel} onClick={() => run({ type: 'HINTO_ADVANCE' }, 'Advanced')}>
            {state.advanceLabel || 'Next'}
          </button>

          <Progress current={progress.current} total={progress.total} percent={progress.percent} />
        </section>
      )}

      {activeTab === 'auto' && (
        <section className="body">
          <div className="context">
            <span className="context-mark" />
            <span>
              <b>Auto run</b>
              <small>always requires this confirmation</small>
            </span>
          </div>

          <article className="answer-card quiet">
            <div className="answer-label">Next action</div>
            <div className="answer-main">{state.ok ? 'Solve current page' : 'Waiting'}</div>
            <div className="answer-sub">Stops at score screen or low confidence.</div>
          </article>

          <div className="stack">
            <button type="button" className="fill wide" disabled={busy || autoRunning || !state.ok} onClick={startAuto}>
              {autoRunning ? 'Running...' : 'Start auto'}
            </button>
            <button type="button" className="ghost wide" disabled={!autoRunning} onClick={stopAuto}>
              Stop
            </button>
            <button type="button" className="ghost wide" disabled={busy || autoRunning || !state.advanceLabel} onClick={() => run({ type: 'HINTO_ADVANCE' }, 'Advanced')}>
              {state.advanceLabel || 'Next'}
            </button>
          </div>

          <Progress current={progress.current} total={progress.total} percent={progress.percent} />
        </section>
      )}

      {activeTab === 'settings' && (
        <section className="body">
          <div className="section-label">Design</div>
          <div className="theme-list">
            {themes.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`theme-choice ${theme === item.id ? 'selected' : ''}`}
                onClick={() => updateTheme(item.id)}
              >
                <span>{item.name}</span>
                <small>{item.note}</small>
              </button>
            ))}
          </div>

          <div className="section-label spaced">Behavior</div>
          <div className="setting-row">
            <span>Stop at score screen</span>
            <span className="check">On</span>
          </div>
          <div className="setting-row">
            <span>Low confidence guard</span>
            <span className="check">On</span>
          </div>
        </section>
      )}

      <footer className="footer">
        <span className={`live ${state.ok ? 'on' : ''}`} />
        <span>{message}</span>
        <span>v{appVersion}</span>
      </footer>
    </main>
  )
}

function Progress({ current, total, percent }: { current: number; total: number; percent: number }) {
  return (
    <div className="progress">
      <div className="progress-label">
        <span>Progress</span>
        <span>{total ? `${current} / ${total}` : '—'}</span>
      </div>
      <div className="progress-bar">
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export default App
