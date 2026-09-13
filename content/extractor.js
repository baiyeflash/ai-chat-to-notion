// ============================================================
// content/extractor.js — 从 Claude / ChatGPT DOM 提取对话对
// ============================================================
// 加载顺序：第 3 个（无依赖）
//
// 两个平台都只读取当前网页已加载的 DOM，不调用 Claude / OpenAI API。
// 网页 DOM 不是稳定 API，因此选择器按平台集中维护，并保留语义化兜底。

const PLATFORM_CONFIG = {
  claude: {
    id: 'claude',
    name: 'Claude',
    assistantHeading: 'Claude Response',
    mergedTitle: 'Claude 对话合集',
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    assistantHeading: 'ChatGPT Response',
    mergedTitle: 'ChatGPT 对话合集',
  },
};

const SELECTORS = {
  claude: {
    userMessage: '[data-testid="user-message"]',
    responseClass: 'font-claude-response',
  },
  chatgpt: {
    roleMessage: '[data-message-author-role="user"], [data-message-author-role="assistant"]',
    turn: '[data-testid^="conversation-turn-"]',
    userContent: '[data-message-content], .whitespace-pre-wrap, [class*="whitespace-pre-wrap"], .markdown, .prose, [class*="markdown"]',
    assistantContent: '[data-message-content], .markdown, .prose, [class*="markdown"]',
  },
};

/** 根据域名判断当前平台；hostname 参数便于无浏览器依赖的验证。 */
function detectCurrentPlatform(hostname = location.hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com') {
    return 'chatgpt';
  }
  return 'claude';
}

function getCurrentPlatformConfig() {
  return PLATFORM_CONFIG[detectCurrentPlatform()];
}

/** 从当前页面提取所有 Q&A pairs。 */
async function extractConversationPairs() {
  const platform = detectCurrentPlatform();
  const pairs = platform === 'chatgpt'
    ? await scanChatGPTConversationPairs()
    : extractClaudeConversationPairs();

  console.log(`[AI Chat to Notion] ${PLATFORM_CONFIG[platform].name}：找到 ${pairs.length} 轮对话`);
  return pairs;
}

/** Claude：通过 user-message 与相邻的 font-claude-response 配对。 */
function extractClaudeConversationPairs(root = document) {
  const pairs = [];
  const userEls = root.querySelectorAll(SELECTORS.claude.userMessage);

  userEls.forEach((userEl) => {
    const responseEl = findClaudeResponseFor(userEl, root);
    pairs.push(createPair(
      'claude',
      userEl,
      responseEl,
      cleanMessageText(userEl),
      cleanMessageText(responseEl)
    ));
  });

  if (userEls.length === 0) {
    console.warn('[AI Chat to Notion] Claude：未找到 user-message 元素');
  }
  return pairs;
}

/** ChatGPT：从当前静态 DOM 提取，主要用于小会话和回归测试。 */
function extractChatGPTConversationPairs(root = document) {
  return buildChatGPTPairsFromSnapshots(collectChatGPTRoleSnapshots(root));
}

function hashChatGPTSnapshotValue(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getChatGPTContentSignature(contentRoot, messageId, text) {
  const semanticShape = [...contentRoot.querySelectorAll(
    'pre, code, table, img, [role="math"], strong, b, em, i, del, s, a, blockquote, ul, ol, li, h1, h2, h3'
  )].map(element => [
    element.tagName,
    element.getAttribute('role') || '',
    element.getAttribute('href') || '',
    element.getAttribute('data-math-source') || '',
    element.tagName === 'CODE' ? element.className : '',
  ].join(':')).join('|');

  return `${messageId}:${hashChatGPTSnapshotValue(`${text}\n${semanticShape}`)}`;
}

/** 克隆当前视口里已经渲染的 ChatGPT 消息；内容未变化时复用已有克隆。 */
function collectChatGPTRoleSnapshots(root = document, knownSnapshots = null) {
  const roleEls = [...root.querySelectorAll(SELECTORS.chatgpt.roleMessage)]
    .filter(el => !el.parentElement?.closest('[data-message-author-role]'))
    .filter(isChatGPTMessageVisible);

  return roleEls.map((roleEl, domIndex) => {
    const role = roleEl.getAttribute('data-message-author-role');
    const contentRoot = findChatGPTContentRoot(roleEl, role);
    const turn = roleEl.closest(SELECTORS.chatgpt.turn) || roleEl;
    const turnId = turn.getAttribute?.('data-testid') || '';
    const turnIndexMatch = turnId.match(/conversation-turn-(\d+)/);
    const turnIndex = turnIndexMatch ? Number(turnIndexMatch[1]) : null;
    const liveText = cleanMessageText(contentRoot);
    const provisionalText = liveText || describeUnsupportedMedia(turn);
    const messageId = roleEl.getAttribute('data-message-id')
      || turn.getAttribute?.('data-message-id')
      || '';
    const textFingerprint = provisionalText.slice(0, 160);
    const key = turnId ? `${turnId}:${role}` : (messageId || `unknown-turn:${role}:${textFingerprint}`);
    const contentSignature = getChatGPTContentSignature(
      contentRoot,
      messageId,
      provisionalText
    );
    const known = knownSnapshots?.get(key);

    if (known?.contentSignature === contentSignature) {
      return { ...known, domIndex };
    }

    const safeContent = cloneChatGPTContent(contentRoot);
    const extractedText = cleanMessageText(safeContent);
    const text = extractedText || describeUnsupportedMedia(turn);
    const exportContent = extractedText ? safeContent : null;

    return {
      // 同一个 conversation-turn 切换回答分支时应覆盖旧分支，不能把两个分支同时导出。
      key,
      messageId,
      role,
      turnIndex,
      domIndex,
      captureSequence: domIndex,
      text,
      html: exportContent,
      contentSignature,
    };
  });
}

/** 把多个虚拟化视口的消息去重、按 turn 排序，再按 user 边界组成 Q&A。 */
function buildChatGPTPairsFromSnapshots(snapshots) {
  const orderedSnapshots = getOrderedUniqueChatGPTSnapshots(snapshots);
  const pairs = [];
  let questionParts = [];
  let answerParts = [];

  const finishPendingPair = () => {
    if (questionParts.length === 0) return;
    pairs.push(createPair(
      'chatgpt',
      combineChatGPTSnapshotContent(questionParts, false),
      combineChatGPTSnapshotContent(answerParts, true),
      questionParts.map(part => part.text).filter(Boolean).join('\n\n'),
      answerParts.map(part => part.text).filter(Boolean).join('\n\n')
    ));
    questionParts = [];
    answerParts = [];
  };

  for (const snapshot of orderedSnapshots) {
    if (snapshot.role === 'user') {
      // ChatGPT 会把一次带多个附件/补充文字的输入拆成连续 user 节点。
      // 只有已经出现 assistant 后，下一条 user 才代表新的一轮。
      if (questionParts.length > 0 && answerParts.length > 0) finishPendingPair();
      questionParts.push(snapshot);
    } else if (snapshot.role === 'assistant' && questionParts.length > 0) {
      answerParts.push(snapshot);
    }
  }

  finishPendingPair();

  if (orderedSnapshots.length === 0) {
    console.warn('[AI Chat to Notion] ChatGPT：未找到 data-message-author-role 元素');
  }
  return pairs;
}

function getOrderedUniqueChatGPTSnapshots(snapshots) {
  const uniqueSnapshots = new Map();
  for (const snapshot of snapshots) {
    const existing = uniqueSnapshots.get(snapshot.key);
    if (!existing || (!existing.text && snapshot.text)) {
      uniqueSnapshots.set(snapshot.key, snapshot);
    }
  }

  return [...uniqueSnapshots.values()].sort(compareChatGPTSnapshots);
}

function getChatGPTPairingStats(snapshots) {
  const orderedSnapshots = getOrderedUniqueChatGPTSnapshots(snapshots);
  let pairCount = 0;
  let completePairCount = 0;
  let hasQuestion = false;
  let hasAnswer = false;

  const finishPair = () => {
    if (!hasQuestion) return;
    pairCount++;
    if (hasAnswer) completePairCount++;
    hasQuestion = false;
    hasAnswer = false;
  };

  for (const snapshot of orderedSnapshots) {
    if (snapshot.role === 'user') {
      if (hasQuestion && hasAnswer) finishPair();
      hasQuestion = true;
    } else if (snapshot.role === 'assistant' && hasQuestion) {
      hasAnswer = true;
    }
  }
  finishPair();

  return {
    messageCount: orderedSnapshots.length,
    pairCount,
    completePairCount,
    incompletePairCount: pairCount - completePairCount,
  };
}

function compareChatGPTSnapshots(a, b) {
  const aHasTurn = Number.isFinite(a.turnIndex);
  const bHasTurn = Number.isFinite(b.turnIndex);
  if (aHasTurn && bHasTurn && a.turnIndex !== b.turnIndex) {
    return a.turnIndex - b.turnIndex;
  }
  if (aHasTurn !== bHasTurn) return aHasTurn ? -1 : 1;

  const sequenceDiff = (a.captureSequence ?? 0) - (b.captureSequence ?? 0);
  if (sequenceDiff !== 0) return sequenceDiff;
  return (a.domIndex ?? 0) - (b.domIndex ?? 0);
}

function combineChatGPTSnapshotContent(parts, addDividers) {
  const elements = parts.map(part => {
    if (part.html) return part.html;
    if (!part.text) return null;
    const paragraph = document.createElement('p');
    paragraph.textContent = part.text;
    return paragraph;
  }).filter(Boolean);
  return combineChatGPTContent(elements, addDividers);
}

function combineChatGPTContent(elements, addDividers = true) {
  if (elements.length === 0) return null;
  if (elements.length === 1) return elements[0];

  const wrapper = document.createElement('div');
  elements.forEach((element, index) => {
    if (addDividers && index > 0) wrapper.appendChild(document.createElement('hr'));
    wrapper.appendChild(element);
  });
  return wrapper;
}

/** 排除切换回答分支时仍留在 DOM 中、但已被隐藏的旧消息。 */
function isChatGPTMessageVisible(roleEl) {
  if (roleEl.closest('[hidden], [aria-hidden="true"]')) return false;

  let current = roleEl;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function findChatGPTContentRoot(roleEl, role) {
  const selector = role === 'assistant'
    ? SELECTORS.chatgpt.assistantContent
    : SELECTORS.chatgpt.userContent;
  return roleEl.matches(selector) ? roleEl : (roleEl.querySelector(selector) || roleEl);
}

/** 克隆消息内容并移除复制、反馈、分支切换等网页操作按钮。 */
function cloneChatGPTContent(contentRoot) {
  const clone = contentRoot.cloneNode(true);
  clone.querySelectorAll([
    'button',
    'textarea',
    '[role="button"]',
    '[data-testid*="copy"]',
    '[data-testid*="feedback"]',
    '[data-testid*="branch"]',
    '[aria-label*="Copy"]',
    '[aria-label*="复制"]',
  ].join(',')).forEach(el => el.remove());

  // ChatGPT Writing Block 用 contenteditable 的 ProseMirror 节点承载整篇正文。
  // 这里仅去掉编辑能力，不能删除节点，否则标题、段落和代码块都会一起丢失。
  clone.querySelectorAll('[contenteditable]').forEach(el => {
    el.removeAttribute('contenteditable');
    el.removeAttribute('aria-disabled');
  });
  return clone;
}

function describeUnsupportedMedia(turn) {
  if (turn?.querySelector('img, [data-testid*="file"], [data-testid*="attachment"]')) {
    return '(包含图片或附件，当前版本未导出媒体内容)';
  }
  return '';
}

function createPair(platform, questionHtml, answerHtml, question, answer) {
  const config = PLATFORM_CONFIG[platform];
  return {
    platform,
    sourceName: config.name,
    assistantHeading: config.assistantHeading,
    mergedTitle: config.mergedTitle,
    question,
    questionHtml,
    answer,
    answerHtml,
  };
}

function cleanMessageText(element) {
  if (!element) return '';
  return String(element.innerText || element.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 给定用户消息元素，找到相邻的 Claude 回复容器。 */
function findClaudeResponseFor(userEl, root = document) {
  let el = userEl;
  for (let depth = 0; depth < 8; depth++) {
    if (!el.parentElement || el.parentElement === document.body) break;
    el = el.parentElement;

    const nextSib = el.nextElementSibling;
    if (nextSib) {
      const responseEl = nextSib.classList?.toString().includes(SELECTORS.claude.responseClass)
        ? nextSib
        : nextSib.querySelector(`[class*="${SELECTORS.claude.responseClass}"]`);
      if (responseEl) return responseEl;
    }
  }

  const allResponses = [...root.querySelectorAll(`[class*="${SELECTORS.claude.responseClass}"]`)];
  const topLevelResponses = allResponses.filter(responseEl => {
    let parent = responseEl.parentElement;
    while (parent && parent !== document.body) {
      if (parent.className?.toString().includes(SELECTORS.claude.responseClass)) return false;
      parent = parent.parentElement;
    }
    return true;
  });

  return topLevelResponses.find(responseEl =>
    userEl.compareDocumentPosition(responseEl) & Node.DOCUMENT_POSITION_FOLLOWING
  ) || null;
}

function extractTextContent(element) {
  return cleanMessageText(element);
}
