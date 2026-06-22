type RuntimeRequest =
  | { type: 'HINTO_GET_STATE' }
  | { type: 'HINTO_HINT' }
  | { type: 'HINTO_STEP' }
  | { type: 'HINTO_ADVANCE' }
  | { type: 'HINTO_AUTO_START' }
  | { type: 'HINTO_AUTO_STOP' }

declare const chrome: {
  action: {
    onClicked: {
      addListener: (callback: (tab?: HintoTab) => void) => void
    }
  }
  runtime: {
    getURL: (path: string) => string
    onMessage: {
      addListener: (
        callback: (
          message: RuntimeRequest,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ) => void
    }
    lastError?: { message?: string }
  }
  tabs: {
    query: (queryInfo: { active?: boolean; currentWindow?: boolean; url?: string }, callback: (tabs: HintoTab[]) => void) => void
    sendMessage: (tabId: number, message: RuntimeRequest, callback: (response: unknown) => void) => void
  }
  windows: {
    create: (options: { url: string; type: 'popup'; width: number; height: number; focused: boolean }) => void
  }
}

type HintoTab = {
  active?: boolean
  id?: number
  lastAccessed?: number
  url?: string
}

let targetTabId: number | undefined

function errorResponse(title: string, status: string, error?: string): unknown {
  return {
    ok: false,
    kind: 'unknown' as const,
    title,
    url: '',
    status,
    confidence: 0,
    error,
  }
}

function isMarugotoTab(tab?: HintoTab) {
  return Boolean(tab?.id && tab.url?.startsWith('https://a2.marugotoweb.jp/'))
}

function openControlWindow(tab?: HintoTab) {
  if (isMarugotoTab(tab)) targetTabId = tab?.id
  chrome.windows.create({
    url: chrome.runtime.getURL('index.html'),
    type: 'popup',
    width: 340,
    height: 540,
    focused: true,
  })
}

chrome.action.onClicked.addListener(openControlWindow)

function queryMarugotoTab(callback: (tabId?: number) => void, excludeTabId?: number) {
  chrome.tabs.query({ url: 'https://a2.marugotoweb.jp/*' }, (tabs) => {
    const tab = tabs
      .filter((item) => item.id && item.id !== excludeTabId)
      .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
    targetTabId = tab?.id
    callback(targetTabId)
  })
}

function resolveTargetTab(callback: (tabId?: number) => void) {
  if (targetTabId) {
    callback(targetTabId)
    return
  }

  queryMarugotoTab(callback)
}

function sendToTab(tabId: number, message: RuntimeRequest, sendResponse: (response: unknown) => void, retried = false) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (!chrome.runtime.lastError) {
      sendResponse(response)
      return
    }

    const error = chrome.runtime.lastError.message
    targetTabId = undefined
    if (!retried) {
      queryMarugotoTab((fallbackTabId) => {
        if (fallbackTabId) {
          sendToTab(fallbackTabId, message, sendResponse, true)
          return
        }

        sendResponse(errorResponse('Unsupported tab', 'The active tab is not running the Hinto content script.', error))
      }, tabId)
      return
    }

    sendResponse(errorResponse('Unsupported tab', 'The active tab is not running the Hinto content script.', error))
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  resolveTargetTab((tabId) => {
    if (!tabId) {
      sendResponse(errorResponse('No active tab', 'Select a Marugoto exercise tab first.'))
      return
    }

    sendToTab(tabId, message, sendResponse)
  })

  return true
})
