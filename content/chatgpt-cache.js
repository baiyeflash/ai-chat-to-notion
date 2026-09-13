// ============================================================
// content/chatgpt-cache.js — ChatGPT 当前会话的内存快照缓存
// ============================================================
// 加载顺序：extractor.js 之后。
// 只保留当前标签页、当前会话的数据；刷新、关闭标签页或切换会话即失效。

const CHATGPT_SCAN_RENDER_TIMEOUT_MS = 80;
const CHATGPT_SCAN_RESTORE_TIMEOUT_MS = 48;
const CHATGPT_SCAN_MAX_STEPS = 1000;

const chatGPTConversationCache = {
  conversationKey: '',
  snapshotsByKey: new Map(),
  complete: false,
  scanPromise: null,
  observer: null,
  routeObserver: null,
  observedRoot: null,
  captureTimer: null,
};

function getChatGPTConversationKey() {
  return `${location.origin}${location.pathname}`;
}

function ensureCurrentChatGPTConversationCache() {
  const conversationKey = getChatGPTConversationKey();
  if (chatGPTConversationCache.conversationKey !== conversationKey) {
    chatGPTConversationCache.conversationKey = conversationKey;
    chatGPTConversationCache.snapshotsByKey = new Map();
    chatGPTConversationCache.complete = false;
    chatGPTConversationCache.scanPromise = null;
    chatGPTConversationCache.observedRoot = null;
  }
  return chatGPTConversationCache;
}

function mergeChatGPTSnapshots(target, snapshots) {
  updateChatGPTSnapshotCache(target, snapshots);
  return target;
}

function removeChatGPTSnapshotsAfterTurn(target, turnIndex) {
  for (const [key, snapshot] of target) {
    if (Number.isFinite(snapshot.turnIndex) && snapshot.turnIndex > turnIndex) {
      target.delete(key);
    }
  }
}

function getHighestChatGPTTurnIndex(target) {
  let highest = -1;
  for (const snapshot of target.values()) {
    if (Number.isFinite(snapshot.turnIndex)) highest = Math.max(highest, snapshot.turnIndex);
  }
  return highest;
}

function updateChatGPTSnapshotCache(target, snapshots) {
  const previousHighestTurn = getHighestChatGPTTurnIndex(target);
  let changed = false;
  let invalidatesComplete = false;

  for (const snapshot of snapshots) {
    const existing = target.get(snapshot.key);
    const sameContent = existing
      && existing.contentSignature
      && existing.contentSignature === snapshot.contentSignature;
    if (sameContent) continue;

    const historicalTurnChanged = existing
      && Number.isFinite(snapshot.turnIndex)
      && snapshot.turnIndex < previousHighestTurn
      && (
        (existing.messageId && snapshot.messageId && existing.messageId !== snapshot.messageId)
        || existing.text !== snapshot.text
      );
    if (historicalTurnChanged) {
      removeChatGPTSnapshotsAfterTurn(target, snapshot.turnIndex);
      invalidatesComplete = true;
    } else if (
      !existing
      && (!Number.isFinite(snapshot.turnIndex) || snapshot.turnIndex <= previousHighestTurn)
    ) {
      invalidatesComplete = true;
    }

    if (!existing || snapshot.text) target.set(snapshot.key, snapshot);
    changed = true;
  }

  return { changed, invalidatesComplete };
}

/**
 * ChatGPT 会把长会话虚拟化：从顶部扫描到末尾，并把各个视口的消息合入内存缓存。
 * options 支持进度回调和关闭面板后的取消信号。
 */
async function scanChatGPTConversationPairs(root = document, options = {}) {
  const snapshotsByKey = options.snapshotsByKey || new Map();
  let captureSequence = 0;

  const capture = () => {
    const snapshots = collectChatGPTRoleSnapshots(root, snapshotsByKey).map(snapshot => ({
      ...snapshot,
      captureSequence: captureSequence++,
    }));
    mergeChatGPTSnapshots(snapshotsByKey, snapshots);
    options.onProgress?.(getChatGPTPairingStats([...snapshotsByKey.values()]));
  };

  capture();
  const scrollContainer = findChatGPTScrollContainer(root);
  if (!scrollContainer) {
    options.onVerified?.(isChatGPTSnapshotSetAnchoredAtStart(snapshotsByKey));
    return buildChatGPTPairsFromSnapshots([...snapshotsByKey.values()]);
  }

  const originalTop = scrollContainer.scrollTop;
  const originalLeft = scrollContainer.scrollLeft;
  let reachedEnd = false;
  let stalledPasses = 0;

  try {
    const initialSignature = getRenderedChatGPTSignature(root);
    setChatGPTScrollPosition(scrollContainer, 0, originalLeft);
    const initialWait = await waitForChatGPTRender(root, initialSignature, {
      isCancelled: options.isCancelled,
    });
    throwIfChatGPTScanCancelled(initialWait.cancelled);

    for (let step = 0; step < CHATGPT_SCAN_MAX_STEPS; step++) {
      throwIfChatGPTScanCancelled(options.isCancelled?.());

      capture();
      const currentTop = scrollContainer.scrollTop;
      const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      if (currentTop >= maxTop - 2) {
        reachedEnd = true;
        break;
      }

      const distance = Math.max(320, Math.floor(scrollContainer.clientHeight * 0.9));
      const nextTop = Math.min(maxTop, currentTop + distance);
      if (nextTop <= currentTop + 1) break;

      const previousSignature = getRenderedChatGPTSignature(root);
      setChatGPTScrollPosition(scrollContainer, nextTop, originalLeft);
      const renderWait = await waitForChatGPTRender(root, previousSignature, {
        isCancelled: options.isCancelled,
      });
      throwIfChatGPTScanCancelled(renderWait.cancelled);

      if (scrollContainer.scrollTop <= currentTop + 1) {
        stalledPasses++;
        if (stalledPasses >= 3) break;
      } else {
        stalledPasses = 0;
      }
    }

    capture();
    if (!reachedEnd) {
      throw new Error('ChatGPT 会话滚动扫描未到达末尾，为避免漏掉对话，本次未展示导出列表，请重试');
    }
  } finally {
    const restoreSignature = getRenderedChatGPTSignature(root);
    setChatGPTScrollPosition(scrollContainer, originalTop, originalLeft);
    await waitForChatGPTRender(root, restoreSignature, {
      timeoutMs: CHATGPT_SCAN_RESTORE_TIMEOUT_MS,
    });
  }

  options.onVerified?.(reachedEnd);
  return buildChatGPTPairsFromSnapshots([...snapshotsByKey.values()]);
}

function throwIfChatGPTScanCancelled(cancelled) {
  if (!cancelled) return;
  const error = new Error('ChatGPT 会话读取已取消');
  error.code = 'C2N_SCAN_CANCELLED';
  throw error;
}

function isChatGPTSnapshotSetAnchoredAtStart(snapshotsByKey) {
  const turnIndexes = [...snapshotsByKey.values()]
    .map(snapshot => snapshot.turnIndex)
    .filter(Number.isFinite);
  return turnIndexes.length > 0 && Math.min(...turnIndexes) <= 1;
}

function findChatGPTScrollContainer(root = document) {
  const firstRole = root.querySelector(SELECTORS.chatgpt.roleMessage);
  let current = firstRole?.parentElement || null;

  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    const canScroll = current.scrollHeight > current.clientHeight + 4;
    if (canScroll && (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
      return current;
    }
    current = current.parentElement;
  }

  if (root === document) {
    const pageScroller = document.scrollingElement;
    if (pageScroller?.scrollHeight > pageScroller?.clientHeight + 4) return pageScroller;
  }
  return null;
}

function setChatGPTScrollPosition(container, top, left) {
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top, left, behavior: 'auto' });
  } else {
    container.scrollTop = top;
    container.scrollLeft = left;
  }
}

function getRenderedChatGPTSignature(root = document) {
  return [...root.querySelectorAll(SELECTORS.chatgpt.roleMessage)]
    .filter(el => !el.parentElement?.closest('[data-message-author-role]'))
    .map(roleEl => {
      const turn = roleEl.closest(SELECTORS.chatgpt.turn);
      const contentRoot = findChatGPTContentRoot(
        roleEl,
        roleEl.getAttribute('data-message-author-role')
      );
      const text = cleanMessageText(contentRoot);
      return [
        turn?.getAttribute('data-testid') || '',
        roleEl.getAttribute('data-message-id') || '',
        hashChatGPTSnapshotValue(text),
      ].join(':');
    })
    .join('|');
}

function waitForChatGPTRender(root, previousSignature, options = {}) {
  const timeoutMs = options.timeoutMs ?? CHATGPT_SCAN_RENDER_TIMEOUT_MS;
  return new Promise(resolve => {
    let settled = false;
    let frameCount = 0;
    let mutationSeen = false;
    let timeoutId = null;

    const observer = new MutationObserver(() => {
      mutationSeen = true;
    });
    observer.observe(root === document ? document.documentElement : root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const finish = result => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (timeoutId !== null) clearTimeout(timeoutId);
      resolve(result);
    };

    const checkFrame = () => {
      if (options.isCancelled?.()) {
        finish({ cancelled: true, changed: false });
        return;
      }

      const changed = getRenderedChatGPTSignature(root) !== previousSignature;
      if (changed) {
        // 检测到虚拟列表换页后再留一帧，让同批 React DOM 更新稳定下来。
        requestAnimationFrame(() => finish({ cancelled: false, changed: true }));
        return;
      }

      frameCount++;
      // 连续两帧都没有 DOM 变化，说明当前区间复用了同一批节点，可继续向下扫描。
      // 80ms 定时器仍作为后台标签页 rAF 被节流时的兜底，避免扫描卡死。
      if (frameCount >= 2 && !mutationSeen) {
        finish({ cancelled: false, changed: false });
        return;
      }
      mutationSeen = false;
      requestAnimationFrame(checkFrame);
    };

    timeoutId = setTimeout(() => {
      const changed = getRenderedChatGPTSignature(root) !== previousSignature;
      finish({ cancelled: false, changed });
    }, timeoutMs);
    requestAnimationFrame(checkFrame);
  });
}

function captureCurrentChatGPTDOM(root = chatGPTConversationCache.observedRoot || document) {
  const cache = ensureCurrentChatGPTConversationCache();
  const result = updateChatGPTSnapshotCache(
    cache.snapshotsByKey,
    collectChatGPTRoleSnapshots(root, cache.snapshotsByKey)
  );
  // 新消息、流式回答继续增长或切换回答分支后，都必须重新确认完整范围。
  if (result.changed && !cache.scanPromise) cache.complete = false;
  return cache.snapshotsByKey.size;
}

function scheduleChatGPTDOMCapture() {
  const cache = ensureCurrentChatGPTConversationCache();
  clearTimeout(cache.captureTimer);
  cache.captureTimer = setTimeout(() => {
    cache.captureTimer = null;
    captureCurrentChatGPTDOM();
  }, 48);
}

function mutationTouchesChatGPTConversation(mutation) {
  const target = mutation.target?.nodeType === Node.ELEMENT_NODE
    ? mutation.target
    : mutation.target?.parentElement;
  if (target?.closest?.(SELECTORS.chatgpt.roleMessage)) return true;

  return [...(mutation.addedNodes || [])].some(node =>
    node.nodeType === Node.ELEMENT_NODE
      && (node.matches?.(SELECTORS.chatgpt.roleMessage)
        || node.querySelector?.(SELECTORS.chatgpt.roleMessage))
  );
}

function getChatGPTObservationRoot() {
  return findChatGPTScrollContainer(document)
    || document.querySelector('main')
    || document.body;
}

function bindChatGPTConversationObserver() {
  const cache = ensureCurrentChatGPTConversationCache();
  const observationRoot = getChatGPTObservationRoot();
  if (!observationRoot || cache.observedRoot === observationRoot) return;

  cache.observer?.disconnect();
  cache.observedRoot = observationRoot;
  cache.observer = new MutationObserver(mutations => {
    ensureCurrentChatGPTConversationCache();
    if (mutations.some(mutationTouchesChatGPTConversation)) {
      scheduleChatGPTDOMCapture();
    }
  });
  cache.observer.observe(observationRoot, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function initializeChatGPTConversationCache() {
  if (detectCurrentPlatform() !== 'chatgpt' || chatGPTConversationCache.routeObserver) return;

  captureCurrentChatGPTDOM();
  bindChatGPTConversationObserver();

  // 这里只监听结构变化，用来发现 SPA 切换会话或主滚动容器被整体替换；
  // 高频文本变化由上面的局部 observer 负责，避免观察整个页面的 characterData。
  chatGPTConversationCache.routeObserver = new MutationObserver(() => {
    const previousKey = chatGPTConversationCache.conversationKey;
    ensureCurrentChatGPTConversationCache();
    const conversationChanged = previousKey !== chatGPTConversationCache.conversationKey;
    const observationRootChanged = getChatGPTObservationRoot() !== chatGPTConversationCache.observedRoot;
    if (conversationChanged || observationRootChanged) {
      bindChatGPTConversationObserver();
      scheduleChatGPTDOMCapture();
    }
  });
  chatGPTConversationCache.routeObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

async function getCompleteChatGPTConversationPairs(options = {}) {
  const cache = ensureCurrentChatGPTConversationCache();
  captureCurrentChatGPTDOM();

  if (cache.complete) {
    options.onProgress?.({
      ...getChatGPTPairingStats([...cache.snapshotsByKey.values()]),
      cached: true,
    });
    return buildChatGPTPairsFromSnapshots([...cache.snapshotsByKey.values()]);
  }

  if (!cache.scanPromise) {
    const conversationKey = cache.conversationKey;
    let verifiedComplete = false;
    const scanPromise = scanChatGPTConversationPairs(document, {
      snapshotsByKey: cache.snapshotsByKey,
      onProgress: options.onProgress,
      onVerified: complete => { verifiedComplete = complete; },
      isCancelled: () => (
        options.isCancelled?.()
        || getChatGPTConversationKey() !== conversationKey
      ),
    }).then(pairs => {
      if (getChatGPTConversationKey() === conversationKey) {
        cache.complete = verifiedComplete;
      }
      return pairs;
    }).finally(() => {
      // 路由切换后可能已经开始了另一次扫描，旧 Promise 不能清掉新扫描的引用。
      if (cache.scanPromise === scanPromise) cache.scanPromise = null;
    });
    cache.scanPromise = scanPromise;
  }

  return cache.scanPromise;
}
