// ============================================================
// content/ui-button.js — 浮动 N 按钮：注入 + 拖拽 + 点击处理
// ============================================================
// 加载顺序：第 6 个
// 依赖：utils.js (showToast)、api.js (getSettings)、extractor.js (extractConversationPairs)
//      ui-modal.js (showExportModal)、main.js (isModalOpen)

/**
 * 注入可拖动的浮动按钮到 Claude / ChatGPT 页面
 * 支持拖拽移动 + 位置记忆（chrome.storage.local）
 */
function injectFloatingButton() {
  if (document.getElementById('c2n-float-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'c2n-float-btn';
  btn.dataset.extensionVersion = chrome.runtime.getManifest().version;
  btn.title = '导出到 Notion（可拖动）';
  btn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 4h16v16H4z" rx="2"/>
      <path d="M9 4v16"/>
      <path d="M15 4l-6 8 6 8"/>
    </svg>
  `;
  document.body.appendChild(btn);

  // —— 拖拽逻辑 ——
  let isDragging = false;
  let wasDragged = false;  // 区分"拖拽"和"点击"
  let startX, startY, startLeft, startTop;
  const DRAG_THRESHOLD = 5;

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    wasDragged = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = btn.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    btn.style.transition = 'none';
    btn.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!wasDragged && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
      return;
    }

    wasDragged = true;

    let newLeft = startLeft + dx;
    let newTop = startTop + dy;
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 48));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - 48));

    btn.style.left = newLeft + 'px';
    btn.style.top = newTop + 'px';
    btn.style.bottom = 'auto';
    btn.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.transition = '';
    btn.style.cursor = '';

    if (wasDragged) {
      chrome.storage.local.set({
        btnLeft: btn.style.left,
        btnTop: btn.style.top
      });
    }
  });

  btn.addEventListener('click', (e) => {
    if (wasDragged) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handleFloatButtonClick();
  });

  chrome.storage.local.get(['btnLeft', 'btnTop'], (data) => {
    if (data.btnLeft && data.btnTop) {
      btn.style.left = data.btnLeft;
      btn.style.top = data.btnTop;
      btn.style.bottom = 'auto';
      btn.style.right = 'auto';
    }
  });
}

async function handleFloatButtonClick() {
  if (isModalOpen) return;

  const settings = await getSettings();
  if (!settings.notionToken) {
    showToast('⚠️ 请先点击扩展图标，在设置中填写 Notion API Token', 'error');
    return;
  }

  if (detectCurrentPlatform() === 'chatgpt') {
    const modalSessionId = showExportModal([], settings, { loading: true });

    try {
      const pairs = await getCompleteChatGPTConversationPairs({
        isCancelled: () => !isExportModalSessionActive(modalSessionId),
        onProgress: ({ pairCount, cached }) => {
          updateExportModalScanProgress(modalSessionId, pairCount, cached);
        },
      });

      if (!isExportModalSessionActive(modalSessionId)) return;
      if (pairs.length === 0) {
        failExportModalScan(
          modalSessionId,
          '未检测到对话内容。如果页面结构有变化，可能需要更新选择器'
        );
        return;
      }
      completeExportModalScan(modalSessionId, pairs);
    } catch (err) {
      if (err.code === 'C2N_SCAN_CANCELLED') {
        if (isExportModalSessionActive(modalSessionId)) {
          failExportModalScan(modalSessionId, '读取期间会话已切换，请关闭面板后重新打开');
        }
        return;
      }
      console.error('[AI Chat to Notion] Conversation extraction error:', err);
      failExportModalScan(modalSessionId, err.message);
    }
    return;
  }

  let pairs;
  try {
    pairs = await extractConversationPairs();
  } catch (err) {
    console.error('[AI Chat to Notion] Conversation extraction error:', err);
    showToast(`⚠️ ${err.message}`, 'error');
    return;
  }
  if (pairs.length === 0) {
    showToast('⚠️ 未检测到对话内容。如果页面结构有变化，可能需要更新选择器', 'error');
    return;
  }

  showExportModal(pairs, settings);
}
