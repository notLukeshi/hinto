type ExerciseKind = 'vocabulary-text' | 'vocabulary-voice' | 'kanji-read' | 'kanji-find' | 'grammar' | 'unknown'
type SolverTarget = {
  element: HTMLElement
  hintElement?: HTMLElement
  beforeElement?: HTMLElement
  action?: 'click' | 'sortable'
  label: string
  source: string
  confidence: number
  kind: ExerciseKind
  targetText?: string
}

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

type RuntimeRequest =
  | { type: 'HINTO_GET_STATE' }
  | { type: 'HINTO_HINT' }
  | { type: 'HINTO_STEP' }
  | { type: 'HINTO_ADVANCE' }
  | { type: 'HINTO_AUTO_START' }
  | { type: 'HINTO_AUTO_STOP' }

type VocabularyQuestion = {
  id: number
  categoryId: number
  ja: string
  kana: string
  roman: string
  native: string
  audio: string
}

type VocabularyChoiceSet = {
  categoryId: number
  questionId: number
  choicesIds: string
}

type KanjiQuestion = {
  id: number
  question: string
  question_highlight: string
  native: string
  answer_word: string
  answerId: number
}

type ChromeLike = {
  runtime: {
    onMessage: {
      addListener: (
        callback: (
          message: RuntimeRequest,
          sender: unknown,
          sendResponse: (response: PageState) => void,
        ) => boolean | void,
      ) => void
    }
  }
}

declare const chrome: ChromeLike

let autoRunning = false
let lastCapturedMedia = ''
let lastPageQuestionId = 0

const injectedProbe = `(() => {
  if (window.__hintoProbeInstalled) return;
  window.__hintoProbeInstalled = true;
  const publish = (url) => {
    if (!url || typeof url !== 'string') return;
    if (/\\.(mp3|m4a|ogg)(\\?|$)/i.test(url)) {
      window.__hintoLastMedia = new URL(url, location.href).href;
      document.documentElement.dataset.hintoMediaUrl = window.__hintoLastMedia;
      window.postMessage({ source: 'hinto-probe', mediaUrl: window.__hintoLastMedia }, '*');
    }
  };
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (String(name).toLowerCase() === 'src') publish(String(value));
    return originalSetAttribute.apply(this, arguments);
  };
  const mediaSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (mediaSrc && mediaSrc.configurable && mediaSrc.set && mediaSrc.get) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: mediaSrc.enumerable,
      get: function() { return mediaSrc.get.call(this); },
      set: function(value) {
        publish(String(value));
        return mediaSrc.set.call(this, value);
      }
    });
  }
  const NativeAudio = window.Audio;
  window.Audio = function(...args) {
    const audio = new NativeAudio(...args);
    if (args[0]) publish(String(args[0]));
    return audio;
  };
  window.Audio.prototype = NativeAudio.prototype;
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    publish(String(url));
    return originalOpen.apply(this, arguments);
  };
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    publish(typeof input === 'string' ? input : input && input.url);
    return originalFetch.apply(this, arguments);
  };
  const publishState = () => {
    try {
      const app = window.ChooseApp;
      const id = app && app.appModel && app.appModel.get && app.appModel.get('status.currentQuestionId');
      if (id) {
        document.documentElement.dataset.hintoQuestionId = String(id);
        window.postMessage({ source: 'hinto-probe', questionId: id }, '*');
      }
    } catch (_) {}
  };
  const scanMedia = () => {
    document.querySelectorAll('audio, video, source').forEach((node) => publish(node.src || node.getAttribute('src')));
  };
  publishState();
  scanMedia();
  window.setInterval(publishState, 300);
  window.setInterval(scanMedia, 500);
})();`

function installProbe() {
  const script = document.createElement('script')
  script.textContent = injectedProbe
  ;(document.documentElement || document.head).append(script)
  script.remove()
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'hinto-probe') return
  if (event.data.mediaUrl) lastCapturedMedia = String(event.data.mediaUrl)
  lastPageQuestionId = Number(event.data.questionId || lastPageQuestionId || 0)
})

installProbe()

function ensureStyles() {
  if (document.getElementById('hinto-style')) return
  const style = document.createElement('style')
  style.id = 'hinto-style'
  style.textContent = `
    .hinto-highlight {
      outline: 4px solid #1d6f59 !important;
      outline-offset: 5px !important;
      border-radius: 8px !important;
      box-shadow: 0 0 0 8px rgba(229, 184, 94, .35), 0 14px 32px rgba(29, 111, 89, .22) !important;
      position: relative !important;
      z-index: 2147483646 !important;
    }
    .hinto-highlight::after {
      content: "Hinto";
      position: absolute;
      top: -28px;
      right: -4px;
      padding: 4px 8px;
      border-radius: 999px;
      background: #1d6f59;
      color: #fff;
      font: 700 12px/1.1 system-ui, sans-serif;
      pointer-events: none;
    }
  `
  document.documentElement.append(style)
}

function clearHighlights() {
  document.querySelectorAll('.hinto-highlight').forEach((node) => node.classList.remove('hinto-highlight'))
}

function textOf(element: Element | null) {
  return (element?.textContent || '').replace(/\s+/g, '').trim()
}

function normalize(value: string) {
  return value.replace(/\s+/g, '').replace(/[\u3002\u3001\uff0c,]/g, '').trim()
}

function japaneseText(element: Element | null) {
  return textOf(element?.querySelector('.ja') || element)
}

function currentPageQuestionId() {
  return Number(document.documentElement.dataset.hintoQuestionId || lastPageQuestionId || 0)
}

function currentMediaUrl() {
  return document.documentElement.dataset.hintoMediaUrl || lastCapturedMedia || String((window as unknown as { __hintoLastMedia?: string }).__hintoLastMedia || '')
}

function pageKind(): ExerciseKind {
  const path = location.pathname
  if (/\/vocabulary\/text\//.test(path)) return 'vocabulary-text'
  if (/\/vocabulary\/voice\//.test(path)) return 'vocabulary-voice'
  if (/\/kanji\/read\//.test(path)) return 'kanji-read'
  if (/\/kanji\/find\//.test(path)) return 'kanji-find'
  if (/\/grammar\//.test(path)) return 'grammar'
  return 'unknown'
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, location.href), { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Could not load ${path}`)
  return response.json() as Promise<T>
}

function getQueryNumber(name: string) {
  return Number(new URLSearchParams(location.search).get(name) || 0)
}

async function solveVocabulary(kind: ExerciseKind): Promise<SolverTarget | null> {
  const category = getQueryNumber('category')
  const data = await getJson<{
    questions: VocabularyQuestion[]
    choicesset: VocabularyChoiceSet[]
  }>('../data/vocabulary.json')
  const choices = Array.from(document.querySelectorAll<HTMLElement>('li.choice_item'))
  if (!choices.length) return null

  let currentQuestion: VocabularyQuestion | undefined
  let correctId = ''
  let source = 'vocabulary.json'
  let confidence = 0.95

  const visibleChoiceIds = choices
    .map((item) => item.querySelector('img')?.getAttribute('alt') || '')
    .filter(Boolean)
    .sort()
  const visibleSet = data.choicesset.find((item) => {
    if (item.categoryId !== category) return false
    const ids = item.choicesIds
      .split(',')
      .map((value) => value.trim())
      .sort()
    return ids.length === visibleChoiceIds.length && ids.every((id, index) => id === visibleChoiceIds[index])
  })

  const questionId = currentPageQuestionId()
  if (questionId) {
    currentQuestion = data.questions.find((question) => question.categoryId === category && question.id === questionId)
    correctId = String(questionId)
    source = 'Marugoto current question'
  } else if (visibleSet) {
    currentQuestion = data.questions.find((question) => question.id === visibleSet.questionId)
    correctId = visibleSet.choicesIds.split(',')[0]
    source = 'Vocabulary answer'
  }

  if (!currentQuestion && kind === 'vocabulary-text') {
    const visibleQuestion = normalize(textOf(document.querySelector('#q_text')) || textOf(document.querySelector('#question')))
    currentQuestion = data.questions.find(
      (question) =>
        question.categoryId === category &&
        [question.ja, question.kana, question.roman, question.native].some((value) => normalize(value) && visibleQuestion.includes(normalize(value))),
    )
  } else if (!currentQuestion) {
    const media = currentMediaUrl()
    const audioId = media.match(/\/([^/]+)\.mp3(?:\?|$)/i)?.[1]
    currentQuestion = data.questions.find((question) => question.categoryId === category && question.audio === audioId)
    source = audioId ? 'Captured audio answer' : 'Waiting for Marugoto audio state'
    confidence = audioId ? 0.88 : 0.34
  }

  if (!currentQuestion) return null

  const set = data.choicesset.find((item) => item.categoryId === category && item.questionId === currentQuestion.id)
  correctId = String(correctId || set?.choicesIds.split(',')[0] || currentQuestion.id)
  const target = choices.find((item) => item.querySelector('img')?.getAttribute('alt') === correctId)
  if (!target) return null

  return {
    element: target,
    label: currentQuestion.ja || currentQuestion.kana || `Question ${currentQuestion.id}`,
    source,
    confidence,
    kind,
    targetText: textOf(document.querySelector('#question')),
  }
}

async function solveKanji(kind: ExerciseKind): Promise<SolverTarget | null> {
  const lesson = getQueryNumber('lesson')
  const type = kind === 'kanji-read' ? 'read' : 'find'
  const data = await getJson<{ questions: KanjiQuestion[] }>(`../data/${type}/lesson${lesson}.json`)
  const questionText = normalize(textOf(document.querySelector('#question')))
  const labels = Array.from(document.querySelectorAll<HTMLElement>('label.enable')).map((label) => normalize(label.textContent || ''))
  const current =
    data.questions.find((question) => {
      const q = normalize(question.question)
      const highlight = normalize(question.question_highlight)
      return q && questionText.includes(q.slice(0, Math.min(q.length, 16))) && (!highlight || questionText.includes(highlight))
    }) || data.questions.find((question) => labels.includes(normalize(question.answer_word)))

  if (!current) return null

  const target =
    document.querySelector<HTMLElement>(`label[for="select${current.answerId}"]`) ||
    Array.from(document.querySelectorAll<HTMLElement>('label.enable')).find((label) => normalize(label.textContent || '') === normalize(current.answer_word))

  if (!target) return null

  return {
    element: target,
    label: current.answer_word,
    source: `${type}/lesson${lesson}.json answerId`,
    confidence: 0.96,
    kind,
    targetText: textOf(document.querySelector('#question')),
  }
}

function solveGrammar(): SolverTarget | null {
  const answerViews = Array.from(document.querySelectorAll<HTMLElement>('._dropdownAnswerView'))
  const nextBlank = answerViews.find((view) => {
    const input = view.querySelector('._answerInput ._answerInputInner') || view.querySelector('._answerInput')
    const value = japaneseText(input)
    return !value || value === '?' || normalize(value) === '?'
  })

  if (nextBlank) {
    const correctValue = nextBlank.dataset.correctValue
    const menuId = nextBlank.dataset.menuId
    const target =
      document.querySelector<HTMLElement>(`._dropdownMenuView[data-menu-id="${menuId}"] ._dropdownItem[data-value="${correctValue}"]`) ||
      document.querySelector<HTMLElement>(`._dropdownItem[data-value="${correctValue}"]`)
    if (target) {
      return {
        element: target,
        hintElement: nextBlank.querySelector<HTMLElement>('._answerInput') || nextBlank,
        label: japaneseText(nextBlank.querySelector('._answerCorrect')) || japaneseText(target),
        source: 'Grammar dropdown answer',
        confidence: 0.96,
        kind: 'grammar',
        targetText: textOf(nextBlank),
      }
    }
  }

  const droppableViews = Array.from(document.querySelectorAll<HTMLElement>('._droppableAnswerView'))
  const nextDrop = droppableViews.find((view) => {
    const value = japaneseText(view.querySelector('._answerInput ._answerInputInner') || view.querySelector('._answerInput'))
    return !value || value === '?' || normalize(value) === '?'
  })

  if (nextDrop) {
    const correctValue = nextDrop.dataset.correctValue
    const groupId = nextDrop.dataset.draggableGroupId
    const target = document.querySelector<HTMLElement>(
      `._draggableGroupView[data-draggable-group-id="${groupId}"] ._draggableItem[data-value="${correctValue}"]`,
    )
    if (target) {
      return {
        element: target,
        beforeElement: nextDrop.querySelector<HTMLElement>('._answerInput') || nextDrop,
        hintElement: nextDrop.querySelector<HTMLElement>('._answerInput') || nextDrop,
        label: japaneseText(nextDrop.querySelector('._answerCorrect')) || japaneseText(target),
        source: 'Grammar drag answer',
        confidence: 0.96,
        kind: 'grammar',
        targetText: textOf(nextDrop),
      }
    }
  }

  const sortable = Array.from(document.querySelectorAll<HTMLElement>('._sortableAnswerView')).find((view) => {
    const current = Array.from(view.querySelectorAll<HTMLElement>('._sortableItem'))
      .map((item) => item.dataset.value)
      .join('-')
    return current !== view.dataset.correctValue
  })

  if (sortable) {
    const answer = (sortable.dataset.correctValue || '')
      .split('-')
      .map((value) => japaneseText(sortable.querySelector(`._sortableItem[data-value="${value}"]`)))
      .join(' ')
    return {
      element: sortable,
      hintElement: sortable,
      action: 'sortable',
      label: answer,
      source: 'Grammar word order',
      confidence: 0.96,
      kind: 'grammar',
      targetText: textOf(sortable),
    }
  }

  const answerButton =
    document.querySelector<HTMLElement>('#btn_result.enable, #btn_result:not(.disable), ._answerCheckButton, a[href*="answer"]')
  if (answerButton && answerButton.offsetParent !== null) {
    return {
      element: answerButton,
      label: textOf(answerButton) || 'Answers',
      source: 'Grammar check',
      confidence: 0.78,
      kind: 'grammar',
      targetText: textOf(document.querySelector('#contents, main, body')).slice(0, 180),
    }
  }

  const next = document.querySelector<HTMLElement>('#btn_next:not(.disable) a, #btn_next:not(.disable), a[href*="practice"]')
  if (next && next.offsetParent !== null) {
    return {
      element: next,
      label: textOf(next) || 'Next',
      source: 'Grammar next',
      confidence: 0.72,
      kind: 'grammar',
      targetText: 'Move to the next grammar page',
    }
  }

  return null
}

async function findTarget(): Promise<SolverTarget | null> {
  const kind = pageKind()
  if (kind === 'vocabulary-text' || kind === 'vocabulary-voice') return solveVocabulary(kind)
  if (kind === 'kanji-read' || kind === 'kanji-find') return solveKanji(kind)
  if (kind === 'grammar') return solveGrammar()
  return null
}

function toState(target: SolverTarget | null, status?: string): PageState {
  const kind = pageKind()
  return {
    ok: Boolean(target),
    kind,
    title: document.title,
    url: location.href,
    status: status || (target ? 'Answer candidate found.' : unsupportedStatus(kind)),
    confidence: target?.confidence || 0,
    answerLabel: target?.label,
    answerSource: target?.source,
    targetText: target?.targetText,
    progress: readProgress(),
    advanceLabel: readAdvanceControl()?.label,
  }
}

function readAdvanceControl(): { element: HTMLElement; label: string } | null {
  const controls = [
    document.querySelector<HTMLElement>('#btn_next:not(.disable) a'),
    document.querySelector<HTMLElement>('#btn_next:not(.disable)'),
    document.querySelector<HTMLElement>('#btn_result.enable a'),
    document.querySelector<HTMLElement>('#btn_result.enable'),
    document.querySelector<HTMLElement>('#btn_result:not(.disable) a'),
    document.querySelector<HTMLElement>('#btn_result:not(.disable)'),
    document.querySelector<HTMLElement>('._answerCheckButton'),
  ]

  const control = controls.find((item) => item && item.offsetParent !== null)
  if (!control) return null
  return { element: control, label: textOf(control) || 'Next' }
}

function readProgress() {
  if (pageKind() === 'grammar') {
    const match = location.pathname.match(/practice(\d+)\.html/)
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="practice"]'))
    const total = links.filter((link) => /Q\d+/.test(textOf(link)) && /practice\d+\.html/.test(link.href)).length
    const current = Number(match?.[1] || 0)
    if (current > 0 && total > 0) return { current, total }
  }

  const candidates = [
    document.querySelector('#question h3'),
    document.querySelector('#number p'),
    document.querySelector('.question'),
    document.querySelector('#question'),
  ]

  for (const element of candidates) {
    const match = textOf(element).match(/Q?(\d+)\/(\d+)/i)
    if (match) return { current: Number(match[1]), total: Number(match[2]) }
  }

  return undefined
}

function unsupportedStatus(kind: ExerciseKind) {
  if (kind === 'unknown') return 'This page is outside the supported Marugoto exercise set.'
  if (kind === 'vocabulary-voice') return 'Play the audio once if needed; Hinto captures the MP3 id before clicking.'
  return 'No confident answer candidate found on the current screen.'
}

async function hint(): Promise<PageState> {
  ensureStyles()
  clearHighlights()
  const target = await findTarget()
  if (target) {
    if (target.hintElement && target.element.classList.contains('_dropdownItem')) activateElement(target.hintElement)
    await delay(80)
    const elements = [target.hintElement, target.element].filter(Boolean) as HTMLElement[]
    elements.forEach((element) => element.classList.add('hinto-highlight'))
    ;(target.hintElement || target.element).scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }
  return toState(target, target ? 'Highlighted the suggested answer.' : undefined)
}

async function step(): Promise<PageState> {
  const target = await findTarget()
  if (!target) return toState(null)
  if (target.confidence < 0.65) {
    await hint()
    return toState(target, 'Low confidence: highlighted only, no automatic click.')
  }

  activateTarget(target)
  await delay(180)
  const next = document.querySelector<HTMLElement>('#btn_next:not(.disable) a, #btn_next:not(.disable)')
  if (next && next.offsetParent !== null && !['kanji-read', 'kanji-find', 'grammar'].includes(pageKind())) {
    activateElement(next)
  }
  return toState(target, `Clicked ${target.label}.`)
}

async function autoRun(): Promise<PageState> {
  autoRunning = true
  let lastState = toState(await findTarget(), 'Auto run started.')
  for (let index = 0; index < 60 && autoRunning; index += 1) {
    const target = await findTarget()
    if (!target || target.confidence < 0.65) {
      lastState = toState(target, target ? 'Auto paused on low confidence.' : 'Auto stopped: score screen or no next answer detected.')
      break
    }
    activateTarget(target)
    await delay(180)
    const next = document.querySelector<HTMLElement>('#btn_next:not(.disable) a, #btn_next:not(.disable)')
    if (next && next.offsetParent !== null && !['kanji-read', 'kanji-find', 'grammar'].includes(pageKind())) activateElement(next)
    await delay(220)
    lastState = toState(target, `Auto clicked ${target.label}.`)
  }
  autoRunning = false
  return lastState
}

async function advance(): Promise<PageState> {
  const control = readAdvanceControl()
  if (!control) return toState(await findTarget(), 'No next action available.')
  activateElement(control.element)
  await delay(180)
  return toState(await findTarget(), `Clicked ${control.label}.`)
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function activateElement(element: HTMLElement) {
  element.scrollIntoView({ block: 'center', inline: 'center' })
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    )
  }
}

function activateTarget(target: SolverTarget) {
  if (target.action === 'sortable') {
    sortGrammarItems(target.element)
    return
  }

  if (target.beforeElement) activateElement(target.beforeElement)
  activateElement(target.element)
}

function sortGrammarItems(container: HTMLElement) {
  const order = (container.dataset.correctValue || '').split('-').filter(Boolean)
  const input = container.querySelector<HTMLElement>('._answerInput') || container
  const items = new Map(
    Array.from(container.querySelectorAll<HTMLElement>('._sortableItem')).map((item) => [item.dataset.value || '', item] as const),
  )
  order.forEach((value) => {
    const item = items.get(value)
    if (item) input.append(item)
  })
  container.dispatchEvent(new Event('sortupdate', { bubbles: true, cancelable: true }))
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      if (message.type === 'HINTO_GET_STATE') sendResponse(toState(await findTarget()))
      if (message.type === 'HINTO_HINT') sendResponse(await hint())
      if (message.type === 'HINTO_STEP') sendResponse(await step())
      if (message.type === 'HINTO_ADVANCE') sendResponse(await advance())
      if (message.type === 'HINTO_AUTO_START') sendResponse(await autoRun())
      if (message.type === 'HINTO_AUTO_STOP') {
        autoRunning = false
        sendResponse(toState(await findTarget(), 'Auto run stopped by user.'))
      }
    } catch (error) {
      sendResponse({
        ok: false,
        kind: pageKind(),
        title: document.title,
        url: location.href,
        status: 'Hinto hit an error while scanning this page.',
        confidence: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })()
  return true
})
