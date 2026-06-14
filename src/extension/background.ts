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

function resolveTargetTab(callback: (tabId?: number) => void) {
  if (targetTabId) {
    callback(targetTabId)
    return
  }

  chrome.tabs.query({ url: 'https://a2.marugotoweb.jp/*' }, (tabs) => {
    const tab = tabs
      .filter((item) => item.id)
      .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
    targetTabId = tab?.id
    callback(targetTabId)
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  resolveTargetTab((tabId) => {
    if (!tabId) {
      sendResponse({
        ok: false,
        kind: 'unknown',
        title: 'No active tab',
        url: '',
        status: 'Select a Marugoto exercise tab first.',
        confidence: 0,
      })
      return
    }

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        targetTabId = undefined
        sendResponse({
          ok: false,
          kind: 'unknown',
          title: 'Unsupported tab',
          url: '',
          status: 'The active tab is not running the Hinto content script.',
          confidence: 0,
          error: chrome.runtime.lastError.message,
        })
        return
      }

      sendResponse(response)
    })
  })

  return true
})
