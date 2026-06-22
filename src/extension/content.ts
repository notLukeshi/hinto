type ExerciseKind = 'vocabulary-text' | 'vocabulary-voice' | 'kanji-read' | 'kanji-find' | 'grammar' | 'unknown'
type SolverAction = 'click' | 'sortable'
type SolverTarget = {
  element: HTMLElement
  hintElement?: HTMLElement
  beforeElement?: HTMLElement
  action?: SolverAction
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

type VocabularyChoice = {
  id: number
  topicId: number
  categoryId: number
  questionId: number
  img: string
}

type PageProbeSnapshot = {
  questionId?: number
  audio?: string
  mediaUrl?: string
  type?: string
  choices?: string[]
  updatedAt: number
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

declare global {
  interface Window {
    __hintoLastMedia?: string
  }
}

let autoRunning = false
let lastCapturedMedia = ''
let lastPageQuestionId = 0
let lastPageProbe: PageProbeSnapshot = { updatedAt: 0 }

const injectedProbe = `(() => {
  if (window.__hintoProbeInstalled) return;
  window.__hintoProbeInstalled = true;
  const toAbsoluteUrl = (url) => {
    if (!url || typeof url !== 'string') return;
    try {
      return new URL(url, location.href).href;
    } catch (_) {
      return String(url);
    }
  };
  const publishState = (extra) => {
    try {
      const app = window.ChooseApp;
      const model = app && app.appModel;
      const get = (path) => model && model.get ? model.get(path) : undefined;
      const questionId =
        Number(get('status.currentQuestionId') || (app && app.questionView && app.questionView.currentQuestionModel && app.questionView.currentQuestionModel.get && app.questionView.currentQuestionModel.get('id')) || 0);
      const currentModel = app && app.questionView && app.questionView.currentQuestionModel;
      let currentQuestion = currentModel && currentModel.toJSON ? currentModel.toJSON() : undefined;
      if (!currentQuestion && questionId) {
        const questions = get('questions');
        currentQuestion = Array.isArray(questions) ? questions.find((question) => Number(question && question.id) === questionId) : undefined;
      }
      const choiceModels = app && app.questionView && app.questionView.collections && app.questionView.collections.choice && app.questionView.collections.choice.models;
      const choices = Array.isArray(choiceModels)
        ? choiceModels.map((choice) => {
            try {
              return String(choice.get ? choice.get('id') : choice.id || '');
            } catch (_) {
              return '';
            }
          }).filter(Boolean)
        : Array.from(document.querySelectorAll('li.choice_item img')).map((img) => String(img.getAttribute('alt') || '')).filter(Boolean);
      const audio = currentQuestion && currentQuestion.audio ? String(currentQuestion.audio) : undefined;
      const payload = Object.assign({
        questionId: questionId || undefined,
        audio,
        mediaUrl: window.__hintoLastMedia || undefined,
        type: app && app.type ? String(app.type) : undefined,
        choices,
        updatedAt: Date.now()
      }, extra || {});
      if (payload.questionId) document.documentElement.dataset.hintoQuestionId = String(payload.questionId);
      if (payload.audio) document.documentElement.dataset.hintoAudioId = String(payload.audio);
      if (payload.mediaUrl) document.documentElement.dataset.hintoMediaUrl = String(payload.mediaUrl);
      document.documentElement.dataset.hintoProbe = JSON.stringify(payload);
      window.postMessage({ source: 'hinto-probe', state: payload }, '*');
    } catch (_) {}
  };
  const publishMedia = (url) => {
    const href = toAbsoluteUrl(url);
    if (!href) return;
    if (/\\.(mp3|m4a|ogg)(\\?|$)/i.test(url)) {
      window.__hintoLastMedia = href;
      document.documentElement.dataset.hintoMediaUrl = window.__hintoLastMedia;
      publishState({ mediaUrl: window.__hintoLastMedia });
    }
  };
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (String(name).toLowerCase() === 'src') publishMedia(String(value));
    return originalSetAttribute.apply(this, arguments);
  };
  const mediaSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (mediaSrc && mediaSrc.configurable && mediaSrc.set && mediaSrc.get) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: mediaSrc.enumerable,
      get: function() { return mediaSrc.get.call(this); },
      set: function(value) {
        publishMedia(String(value));
        return mediaSrc.set.call(this, value);
      }
    });
  }
  const NativeAudio = window.Audio;
  window.Audio = function(...args) {
    const audio = new NativeAudio(...args);
    if (args[0]) publishMedia(String(args[0]));
    return audio;
  };
  window.Audio.prototype = NativeAudio.prototype;
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    publishMedia(String(url));
    return originalOpen.apply(this, arguments);
  };
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    publishMedia(typeof input === 'string' ? input : input && input.url);
    return originalFetch.apply(this, arguments);
  };
  const installJPlayerHook = () => {
    try {
      const jq = window.jQuery || window.$;
      if (!jq || !jq.fn || !jq.fn.jPlayer || jq.fn.jPlayer.__hintoWrapped) return;
      const original = jq.fn.jPlayer;
      const wrapped = function(...args) {
        if (args[0] === 'setMedia' && args[1]) {
          publishMedia(args[1].mp3 || args[1].m4a || args[1].oga || args[1].wav);
        }
        return original.apply(this, args);
      };
      wrapped.__hintoWrapped = true;
      jq.fn.jPlayer = wrapped;
    } catch (_) {}
  };
  const scanMedia = () => {
    document.querySelectorAll('audio, video, source, [data-media]').forEach((node) => {
      publishMedia(node.src || node.getAttribute('src') || node.getAttribute('data-media'));
    });
  };
  const tick = () => {
    installJPlayerHook();
    scanMedia();
    publishState();
  };
  tick();
  window.setInterval(tick, 200);
})();`

function installProbe() {
  const script = document.createElement('script')
  script.textContent = injectedProbe
  ;(document.documentElement || document.head).append(script)
  script.remove()
}

function refreshProbeNow() {
  const script = document.createElement('script')
  script.textContent = `(() => {
    try {
      const app = window.ChooseApp;
      const model = app && app.appModel;
      const get = (path) => model && model.get ? model.get(path) : undefined;
      const questionId = Number(get('status.currentQuestionId') || (app && app.questionView && app.questionView.currentQuestionModel && app.questionView.currentQuestionModel.get && app.questionView.currentQuestionModel.get('id')) || 0);
      const currentModel = app && app.questionView && app.questionView.currentQuestionModel;
      let currentQuestion = currentModel && currentModel.toJSON ? currentModel.toJSON() : undefined;
      if (!currentQuestion && questionId) {
        const questions = get('questions');
        currentQuestion = Array.isArray(questions) ? questions.find((question) => Number(question && question.id) === questionId) : undefined;
      }
      const choiceModels = app && app.questionView && app.questionView.collections && app.questionView.collections.choice && app.questionView.collections.choice.models;
      const choices = Array.isArray(choiceModels)
        ? choiceModels.map((choice) => {
            try {
              return String(choice.get ? choice.get('id') : choice.id || '');
            } catch (_) {
              return '';
            }
          }).filter(Boolean)
        : Array.from(document.querySelectorAll('li.choice_item img')).map((img) => String(img.getAttribute('alt') || '')).filter(Boolean);
      const payload = {
        questionId: questionId || undefined,
        audio: currentQuestion && currentQuestion.audio ? String(currentQuestion.audio) : undefined,
        mediaUrl: window.__hintoLastMedia || undefined,
        type: app && app.type ? String(app.type) : undefined,
        choices,
        updatedAt: Date.now()
      };
      if (payload.questionId) document.documentElement.dataset.hintoQuestionId = String(payload.questionId);
      if (payload.audio) document.documentElement.dataset.hintoAudioId = String(payload.audio);
      if (payload.mediaUrl) document.documentElement.dataset.hintoMediaUrl = String(payload.mediaUrl);
      document.documentElement.dataset.hintoProbe = JSON.stringify(payload);
      window.postMessage({ source: 'hinto-probe', state: payload }, '*');
    } catch (_) {}
  })();`
  ;(document.documentElement || document.head).append(script)
  script.remove()
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'hinto-probe') return
  const state = event.data.state as PageProbeSnapshot | undefined
  if (state) {
    lastPageProbe = { ...lastPageProbe, ...state, updatedAt: Number(state.updatedAt || Date.now()) }
    if (state.mediaUrl) lastCapturedMedia = String(state.mediaUrl)
    if (state.questionId) lastPageQuestionId = Number(state.questionId)
    return
  }
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
    ._sortableItem.hinto-highlight::after {
      content: none !important;
    }
    .hinto-order-badge {
      position: absolute !important;
      top: -12px !important;
      left: -12px !important;
      min-width: 24px !important;
      height: 24px !important;
      display: inline-grid !important;
      place-items: center !important;
      border: 2px solid #fff !important;
      border-radius: 999px !important;
      background: #1d6f59 !important;
      color: #fff !important;
      font: 800 13px/1 system-ui, sans-serif !important;
      box-shadow: 0 8px 18px rgba(29, 111, 89, .32) !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
    }
  `
  document.documentElement.append(style)
}

function clearHighlights() {
  document.querySelectorAll('.hinto-highlight').forEach((node) => node.classList.remove('hinto-highlight'))
  document.querySelectorAll('.hinto-order-badge').forEach((node) => node.remove())
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

function isVisible(element: HTMLElement | null | undefined) {
  if (!element) return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden' && Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
}

function currentPageQuestionId() {
  return Number(currentProbeSnapshot().questionId || document.documentElement.dataset.hintoQuestionId || lastPageQuestionId || 0)
}

function currentMediaUrl() {
  return (
    currentProbeSnapshot().mediaUrl ||
    document.documentElement.dataset.hintoMediaUrl ||
    lastCapturedMedia ||
    String(window.__hintoLastMedia || '')
  )
}

function currentProbeSnapshot(): PageProbeSnapshot {
  const raw = document.documentElement.dataset.hintoProbe
  if (!raw) return lastPageProbe
  try {
    const parsed = JSON.parse(raw) as PageProbeSnapshot
    return { ...lastPageProbe, ...parsed, updatedAt: Number(parsed.updatedAt || lastPageProbe.updatedAt || Date.now()) }
  } catch {
    return lastPageProbe
  }
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
    choices: VocabularyChoice[]
    choicesset: VocabularyChoiceSet[]
  }>('../data/vocabulary.json')
  const choices = Array.from(document.querySelectorAll<HTMLElement>('li.choice_item')).filter((item) => isVisible(item))
  if (!choices.length) return null
  refreshProbeNow()

  const visibleChoiceIds = choices.map((item) => item.querySelector('img')?.getAttribute('alt') || '').filter(Boolean)
  const visibleChoiceIdSet = new Set(visibleChoiceIds)
  const sortedVisibleChoiceIds = [...visibleChoiceIds].sort()
  const probe = currentProbeSnapshot()
  const currentAudio = probe.audio || document.documentElement.dataset.hintoAudioId || ''

  const candidateQuestions: Array<{ question: VocabularyQuestion | undefined; source: string; confidence: number }> = []
  const addCandidate = (question: VocabularyQuestion | undefined, source: string, confidence: number) => {
    if (!question || question.categoryId !== category) return
    if (!visibleChoiceIdSet.has(String(question.id))) return
    if (candidateQuestions.some((candidate) => candidate.question?.id === question.id)) return
    candidateQuestions.push({ question, source, confidence })
  }

  const media = currentMediaUrl()
  const audioId = media.match(/\/([^/]+)\.(?:mp3|m4a|ogg)(?:\?|$)/i)?.[1]
  const addMediaCandidate = () => {
    addCandidate(
      data.questions.find((question) => question.categoryId === category && question.audio === audioId),
      audioId ? 'Captured audio answer' : 'Waiting for Marugoto audio state',
      audioId ? 0.99 : 0.34,
    )
    addCandidate(
      data.questions.find((question) => question.categoryId === category && question.audio === currentAudio),
      'Marugoto current audio',
      0.98,
    )
  }

  const addQuestionIdCandidate = () => {
    const questionId = currentPageQuestionId()
    addCandidate(
      data.questions.find((question) => question.categoryId === category && question.id === questionId),
      'Marugoto current question',
      0.96,
    )
  }

  if (kind === 'vocabulary-voice') {
    addMediaCandidate()
    addQuestionIdCandidate()
  } else {
    addQuestionIdCandidate()
  }

  const visibleSet = data.choicesset.find((item) => {
    if (item.categoryId !== category) return false
    const ids = item.choicesIds
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .sort()
    return ids.length === sortedVisibleChoiceIds.length && ids.every((id, index) => id === sortedVisibleChoiceIds[index])
  })
  addCandidate(
    data.questions.find((question) => question.categoryId === category && question.id === visibleSet?.questionId),
    'Vocabulary choice set',
    0.92,
  )

  if (kind === 'vocabulary-text') {
    const visibleQuestion = normalize(textOf(document.querySelector('#q_text')) || textOf(document.querySelector('#question')))
    const promptQuestion = data.questions.find(
      (question) =>
        question.categoryId === category &&
        [question.ja, question.kana, question.roman, question.native].some((value) => normalize(value) && visibleQuestion.includes(normalize(value))),
    )
    addCandidate(promptQuestion, 'Visible vocabulary prompt', 0.96)
    addMediaCandidate()
  }

  if (!candidateQuestions.length) return null

  const best = candidateQuestions[0]
  const currentQuestion = best.question
  if (!currentQuestion) return null

  const currentChoice = data.choices.find((choice) => choice.categoryId === category && choice.questionId === currentQuestion.id)
  const target = choices.find((item) => {
    const image = item.querySelector('img')
    const alt = image?.getAttribute('alt') || ''
    const src = image?.getAttribute('src') || ''
    return alt === String(currentQuestion.id) || Boolean(currentChoice?.img && src.includes(`/${currentChoice.img}.png`))
  })
  if (!target || !isVisible(target)) return null

  const probeChoices = probe.choices?.filter(Boolean).sort().join(',')
  const visibleChoices = sortedVisibleChoiceIds.join(',')
  if (probeChoices && probeChoices !== visibleChoices && best.source === 'Marugoto current question' && !visibleChoiceIdSet.has(String(currentQuestion.id))) {
    return null
  }

  return {
    element: target,
    label: currentQuestion.ja || currentQuestion.kana || `Question ${currentQuestion.id}`,
    source: best.source,
    confidence: best.confidence,
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

function findGrammarAnswerTarget(): SolverTarget | null {
  const answerViews = Array.from(document.querySelectorAll<HTMLElement>('._dropdownAnswerView'))
  const nextBlank = answerViews.find((view) => {
    const input = view.querySelector('._answerInput ._answerInputInner') || view.querySelector('._answerInput')
    const value = japaneseText(input)
    return !view.classList.contains('correct') && !view.classList.contains('incorrect') && (!value || value === '?' || normalize(value) === '?')
  })

  if (nextBlank) {
    const correctValue = nextBlank.dataset.correctValue
    const menuId = nextBlank.dataset.menuId
    if (correctValue) {
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
  }

  const radioViews = Array.from(document.querySelectorAll<HTMLElement>('._radioAnswerView'))
  const nextRadio = radioViews.find((view) => {
    if (view.classList.contains('correct') || view.classList.contains('incorrect')) return false
    const checked = view.querySelector<HTMLElement>('._radioAnswerItem._checked')
    return checked?.dataset.value !== view.dataset.correctValue
  })

  if (nextRadio) {
    const correctValue = nextRadio.dataset.correctValue
    if (correctValue) {
      const target = nextRadio.querySelector<HTMLElement>(`._radioAnswerItem[data-value="${correctValue}"]`)
      if (target) {
        return {
          element: target,
          label: japaneseText(target),
          source: 'Grammar radio answer',
          confidence: 0.96,
          kind: 'grammar',
          targetText: textOf(nextRadio),
        }
      }
    }
  }

  const droppableViews = Array.from(document.querySelectorAll<HTMLElement>('._droppableAnswerView'))
  const nextDrop = droppableViews.find((view) => {
    const value = japaneseText(view.querySelector('._answerInput ._answerInputInner') || view.querySelector('._answerInput'))
    return !view.classList.contains('correct') && !view.classList.contains('incorrect') && (!value || value === '?' || normalize(value) === '?')
  })

  if (nextDrop) {
    const correctValue = nextDrop.dataset.correctValue
    const groupId = nextDrop.dataset.draggableGroupId
    if (correctValue) {
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
  }

  const sortable = Array.from(document.querySelectorAll<HTMLElement>('._sortableAnswerView')).find((view) => {
    if (view.classList.contains('correct') || view.classList.contains('incorrect') || view.querySelector('._icon_correct, ._icon_incorrect')) return false
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

  return null
}

function findGrammarAdvanceTarget(): SolverTarget | null {
  const answerButton = readAnswerControl()
  if (answerButton && grammarPendingCount() === 0) {
    return {
      element: answerButton.element,
      label: answerButton.label,
      source: 'Grammar check',
      confidence: 0.78,
      kind: 'grammar',
      targetText: textOf(document.querySelector('#contents, main, body')).slice(0, 180),
    }
  }

  const next = readNextControl()
  if (next) {
    return {
      element: next.element,
      label: next.label,
      source: 'Grammar next',
      confidence: 0.72,
      kind: 'grammar',
      targetText: 'Move to the next grammar page',
    }
  }

  return null
}

function solveGrammar(): SolverTarget | null {
  return findGrammarAnswerTarget() || findGrammarAdvanceTarget()
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
  if (pageKind() === 'grammar' && grammarPendingCount() > 0) return null
  return readAnswerControl() || readNextControl()
}

const answerControlSelectors = [
  '#btn_answer:not(.disable) a',
  '#btn_answer:not(.disable)',
  '#btn_result.enable a',
  '#btn_result.enable',
  '#btn_result:not(.disable) a',
  '#btn_result:not(.disable)',
  '._answerCheckButton',
  'a[href*="answer"]',
] as const

function readAnswerControl(): { element: HTMLElement; label: string } | null {
  const control = answerControlSelectors
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .find((item) => item && isVisible(item))
  if (!control) return null
  return { element: control, label: textOf(control) || 'Answer' }
}

const nextControlSelectors = ['#btn_next:not(.disable) a', '#btn_next:not(.disable)'] as const

function readNextControl(): { element: HTMLElement; label: string } | null {
  const control = nextControlSelectors
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .find((item) => item && isVisible(item))
  if (!control) return null
  return { element: control, label: textOf(control) || 'Next' }
}

function grammarPendingCount() {
  return grammarPendingSignature().filter((entry) => entry.endsWith(':pending')).length
}

function grammarPendingSignature() {
  const dropdowns = Array.from(document.querySelectorAll<HTMLElement>('._dropdownAnswerView')).map((view, index) => {
    const input = view.querySelector('._answerInput ._answerInputInner') || view.querySelector('._answerInput')
    const value = japaneseText(input)
    const pending = !view.classList.contains('correct') && !view.classList.contains('incorrect') && (!value || value === '?' || normalize(value) === '?')
    return `dropdown:${index}:${pending ? 'pending' : normalize(value)}`
  })

  const radios = Array.from(document.querySelectorAll<HTMLElement>('._radioAnswerView')).map((view, index) => {
    const checked = view.querySelector<HTMLElement>('._radioAnswerItem._checked')?.dataset.value || ''
    const pending = !view.classList.contains('correct') && !view.classList.contains('incorrect') && checked !== view.dataset.correctValue
    return `radio:${index}:${pending ? 'pending' : checked}`
  })

  const droppables = Array.from(document.querySelectorAll<HTMLElement>('._droppableAnswerView')).map((view, index) => {
    const input = view.querySelector('._answerInput ._answerInputInner') || view.querySelector('._answerInput')
    const value = japaneseText(input)
    const pending = !view.classList.contains('correct') && !view.classList.contains('incorrect') && (!value || value === '?' || normalize(value) === '?')
    return `drop:${index}:${pending ? 'pending' : normalize(value)}`
  })

  const sortables = Array.from(document.querySelectorAll<HTMLElement>('._sortableAnswerView')).map((view, index) => {
    const current = Array.from(view.querySelectorAll<HTMLElement>('._sortableItem'))
      .map((item) => item.dataset.value)
      .join('-')
    const pending =
      !view.classList.contains('correct') &&
      !view.classList.contains('incorrect') &&
      !view.querySelector('._icon_correct, ._icon_incorrect') &&
      current !== view.dataset.correctValue
    return `sortable:${index}:${pending ? 'pending' : current}`
  })

  return [...dropdowns, ...radios, ...droppables, ...sortables]
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
    if (target.action === 'sortable') addSortableOrderBadges(target.element)
    const elements = [target.hintElement, target.element].filter(Boolean) as HTMLElement[]
    elements.forEach((element) => element.classList.add('hinto-highlight'))
    ;(target.hintElement || target.element).scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }
  return toState(target, target ? 'Highlighted the suggested answer.' : undefined)
}

function addSortableOrderBadges(container: HTMLElement) {
  const order = (container.dataset.correctValue || '').split('-').filter(Boolean)
  order.forEach((value, index) => {
    const item = container.querySelector<HTMLElement>(`._sortableItem[data-value="${value}"]`)
    if (!item) return
    item.classList.add('hinto-highlight')
    item.style.position = item.style.position || 'relative'
    const badge = document.createElement('span')
    badge.className = 'hinto-order-badge'
    badge.textContent = String(index + 1)
    badge.title = `Correct order: ${index + 1}`
    badge.setAttribute('aria-label', `Correct order: ${index + 1}`)
    item.append(badge)
  })
}

async function step(): Promise<PageState> {
  const target = await findTarget()
  if (!target) return toState(null)
  if (target.confidence < 0.65) {
    await hint()
    return toState(target, 'Low confidence: highlighted only, no automatic click.')
  }

  activateTarget(target)
  await waitForDomChange(90)
  if (pageKind() === 'vocabulary-text' || pageKind() === 'vocabulary-voice') {
    const next = readNextControl()
    if (next) {
      activateElement(next.element)
      await waitForDomChange(120)
    }
  }
  return toState(await findTarget(), `Clicked ${target.label}.`)
}

async function autoRun(): Promise<PageState> {
  autoRunning = true
  let lastState = toState(await findTarget(), 'Auto run started.')
  const deadline = Date.now() + 12_000
  for (let index = 0; index < 80 && autoRunning && Date.now() < deadline; index += 1) {
    if (pageKind() === 'grammar') {
      lastState = await autoRunGrammar()
      break
    }

    const target = await findTarget()
    if (!target || target.confidence < 0.65) {
      lastState = toState(target, target ? 'Auto paused on low confidence.' : 'Auto stopped: score screen or no next answer detected.')
      break
    }
    activateTarget(target)
    await waitForDomChange(90)
    const advance = readAdvanceControl()
    if (advance && pageKind() !== 'grammar') {
      activateElement(advance.element)
      await waitForDomChange(120)
    }
    lastState = toState(await findTarget(), `Auto clicked ${target.label}.`)
  }
  if (autoRunning && Date.now() >= deadline) lastState = toState(await findTarget(), 'Auto stopped: timed out waiting for a page transition.')
  autoRunning = false
  return lastState
}

async function autoRunGrammar(): Promise<PageState> {
  let applied = 0
  const deadline = Date.now() + 12_000
  for (let index = 0; index < 80 && autoRunning && Date.now() < deadline; index += 1) {
    const target = findGrammarAnswerTarget()
    if (!target) break

    const before = grammarPendingSignature().join('|')
    activateTarget(target)
    applied += 1
    await waitForDomChange(45)
    const after = grammarPendingSignature().join('|')
    if (before === after) {
      return toState(await findTarget(), `Auto paused: ${target.source} did not change the page.`)
    }
  }

  if (!autoRunning) return toState(await findTarget(), 'Auto run stopped by user.')
  if (Date.now() >= deadline) return toState(await findTarget(), 'Auto stopped: timed out waiting for a page transition.')
  if (grammarPendingCount() > 0) return toState(await findTarget(), `Auto paused: ${grammarPendingCount()} grammar answer(s) still pending.`)

  const answer = readAnswerControl()
  if (answer) {
    activateElement(answer.element)
    await waitForDomChange(140)
    return toState(await findTarget(), applied ? `Auto filled ${applied} answer(s) and clicked ${answer.label}.` : `Auto clicked ${answer.label}.`)
  }

  return toState(await findTarget(), applied ? `Auto filled ${applied} answer(s).` : 'Auto stopped: no grammar action available.')
}

async function advance(): Promise<PageState> {
  const control = readAdvanceControl()
  if (!control) return toState(await findTarget(), 'No next action available.')
  activateElement(control.element)
  await waitForDomChange(120)
  return toState(await findTarget(), `Clicked ${control.label}.`)
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function waitForDomChange(timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      observer.disconnect()
      resolve()
    }
    const observer = new MutationObserver(finish)
    observer.observe(document.body || document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true })
    window.setTimeout(finish, timeoutMs)
  })
}

const simulatedEventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const

function activateElement(element: HTMLElement) {
  element.scrollIntoView({ block: 'center', inline: 'center' })
  for (const type of simulatedEventTypes) {
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
