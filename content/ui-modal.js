// ============================================================
// content/ui-modal.js — 导出面板：渲染 + 事件 + 导出执行
// ============================================================
// 加载顺序：第 8 个
// 依赖：utils.js / api.js / builder.js / ui-position.js / main.js (全局状态)

// 只在当前标签页生命周期内记住各个来源对话页最近一次成功导出的目标。
// 不写入 chrome.storage.local，避免长期保存来源对话 URL。
const c2nLastExportTargetBySourcePage = new Map();

function getCurrentSourcePageKey() {
  return `${location.origin}${location.pathname}`;
}

function cloneExportPosition(position) {
  if (position?.type === 'page_start') return { type: 'page_start' };
  if (position?.type === 'after_block' && position.after_block?.id) {
    return { type: 'after_block', after_block: { id: position.after_block.id } };
  }
  return { type: 'page_end' };
}

function getLastSuccessfulExportTarget(sourcePageKey = getCurrentSourcePageKey()) {
  const target = c2nLastExportTargetBySourcePage.get(sourcePageKey);
  if (!target) return null;
  return { ...target, position: cloneExportPosition(target.position) };
}

function rememberSuccessfulExportTarget(
  sourcePageKey,
  pageId,
  pageTitle,
  position
) {
  if (!sourcePageKey || !pageId) return;
  c2nLastExportTargetBySourcePage.set(sourcePageKey, {
    pageId,
    pageTitle: pageTitle || '',
    position: cloneExportPosition(position),
  });
}

/**
 * 精准插入成功后，新建的子页面就是下一次继续导出的锚点。
 * “末尾”本身会自然跟随页面增长，因此继续保留 page_end。
 */
function getPositionAfterSuccessfulExport(position, createdPageIds) {
  if (!position || position.type === 'page_end') return { type: 'page_end' };
  const firstCreatedPageId = createdPageIds.find(Boolean);
  return firstCreatedPageId
    ? { type: 'after_block', after_block: { id: firstCreatedPageId } }
    : cloneExportPosition(position);
}

/**
 * 显示导出面板
 */
function showExportModal(pairs, settings, options = {}) {
  isModalOpen = true;
  currentExportPairs = pairs;
  const modalSessionId = ++exportModalSessionId;
  const isLoading = Boolean(options.loading);
  const sourceName = pairs[0]?.sourceName || getCurrentPlatformConfig().name;
  const mergedTitle = pairs[0]?.mergedTitle || getCurrentPlatformConfig().mergedTitle;
  const sourcePageKey = getCurrentSourcePageKey();
  const lastExportTarget = getLastSuccessfulExportTarget(sourcePageKey);
  const initialPageId = lastExportTarget?.pageId || settings.defaultPageId || '';
  const initialPageTitle = lastExportTarget?.pageTitle || settings.defaultPageTitle || '';
  const initialPosition = lastExportTarget?.position || { type: 'page_end' };

  const overlay = document.createElement('div');
  overlay.id = 'c2n-overlay';
  overlay.dataset.scanState = isLoading ? 'scanning' : 'ready';
  overlay.addEventListener('click', () => closeModal());

  const modal = document.createElement('div');
  modal.id = 'c2n-modal';
  modal.dataset.sourcePageKey = sourcePageKey;
  modal.innerHTML = `
    <div class="c2n-modal-header">
      <h2>📤 导出 ${sourceName} 对话到 Notion</h2>
      <button class="c2n-close-btn" id="c2n-close">&times;</button>
    </div>

    <div class="c2n-modal-body">
      <!-- 页面选择 -->
      <div class="c2n-section">
        <label class="c2n-label">选择目标页面（导出为其子页面）</label>
        <div class="c2n-search-row">
          <input type="text" id="c2n-search-input" placeholder="搜索 Notion 页面..." />
          <button id="c2n-search-btn">搜索</button>
        </div>
        <div id="c2n-page-list" class="c2n-page-list">
          ${initialPageId
      ? `<div class="c2n-page-item selected" data-id="${escapeHtml(initialPageId)}" data-title="${escapeHtml(initialPageTitle)}">
               <span class="c2n-page-icon">📄</span>
               <span>${escapeHtml(initialPageTitle || '默认页面')}</span>
               <span class="c2n-tag">${lastExportTarget ? '上次导入' : '默认'}</span>
             </div>`
      : '<div class="c2n-hint">请搜索并选择一个 Notion 页面</div>'
    }
        </div>
      </div>

      <!-- 导出模式 -->
      <div class="c2n-section">
        <label class="c2n-label">导出模式</label>
        <div class="c2n-mode-toggle">
          <button class="c2n-mode-btn active" data-mode="separate">每条对话一个页面</button>
          <button class="c2n-mode-btn" data-mode="merged">合并为一个页面</button>
        </div>
        <div id="c2n-merged-title-row" class="c2n-merged-title-row" style="display:none">
          <label class="c2n-label">合并页面标题</label>
          <input type="text" id="c2n-merged-title" placeholder="输入合并后的页面标题..." value="${escapeHtml(mergedTitle)}" />
        </div>
      </div>

      <!-- 对话选择 -->
      <div class="c2n-section">
        <label class="c2n-label" id="c2n-pair-label">
          ${isLoading ? '正在后台读取完整对话…' : `选择要导出的对话 (${pairs.length} 条)`}
        </label>
        <div class="c2n-select-actions">
          <button id="c2n-select-all" ${isLoading ? 'disabled' : ''}>全选</button>
          <button id="c2n-select-none" ${isLoading ? 'disabled' : ''}>取消全选</button>
        </div>
        <div id="c2n-pair-list" class="c2n-pair-list">
          ${isLoading
      ? '<div class="c2n-scan-state"><span class="c2n-scan-spinner"></span><span>正在读取，您可以先选择上面的导出设置</span></div>'
      : createExportPairListHtml(pairs)
    }
        </div>
      </div>
    </div>

    <div class="c2n-modal-footer">
      <div id="c2n-status" class="c2n-status"></div>
      <div class="c2n-footer-actions">
        <button id="c2n-cancel" class="c2n-btn-secondary">取消</button>
        <button id="c2n-export" class="c2n-btn-primary" ${isLoading ? 'disabled' : ''}>
          ${isLoading ? '正在读取对话…' : '导出到 Notion'}
        </button>
      </div>
    </div>
  `;

  const positionPanel = document.createElement('aside');
  positionPanel.id = 'c2n-position-panel';
  positionPanel.setAttribute('aria-label', '精准选择插入位置');
  positionPanel.innerHTML = `
    <div class="c2n-position-panel-header">
      <h2>🎯 精准选择插入位置</h2>
      <p id="c2n-position-panel-subtitle">选择目标 Notion 页面后，将在这里显示页面内容</p>
    </div>
    <div class="c2n-position-panel-body">
      <div id="c2n-position-section" class="c2n-position-toolbar">
        <div class="c2n-position-toolbar-head">
          <span>快速位置</span>
          <span id="c2n-position-toolbar-hint">选择页面后启用</span>
        </div>
        <div class="c2n-pos-quick-row">
          <button class="c2n-pos-quick-btn" data-pos="end" disabled>📌 末尾（默认）</button>
          <button class="c2n-pos-quick-btn" data-pos="start" disabled>⬆ 开头</button>
        </div>
      </div>
      <div id="c2n-position-container" class="c2n-pos-page">
        <div class="c2n-pos-empty">请选择左侧的目标 Notion 页面</div>
      </div>
    </div>
  `;

  const workspace = document.createElement('div');
  workspace.id = 'c2n-workspace';
  workspace.appendChild(modal);
  workspace.appendChild(positionPanel);

  document.body.appendChild(overlay);
  document.body.appendChild(workspace);

  // 事件绑定
  document.getElementById('c2n-close').addEventListener('click', closeModal);
  document.getElementById('c2n-cancel').addEventListener('click', closeModal);
  document.getElementById('c2n-search-btn').addEventListener('click', handleSearch);
  document.getElementById('c2n-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });
  document.getElementById('c2n-select-all').addEventListener('click', () => toggleAll(true));
  document.getElementById('c2n-select-none').addEventListener('click', () => toggleAll(false));
  document.getElementById('c2n-export').addEventListener('click', handleExport);

  // 快速位置按钮
  document.querySelectorAll('.c2n-pos-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.c2n-pos-quick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      resetPrecisePositionSelection();
    });
  });

  // 模式切换
  document.querySelectorAll('.c2n-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.c2n-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      document.getElementById('c2n-merged-title-row').style.display = mode === 'merged' ? '' : 'none';
    });
  });

  // 有上次导入目标或全局默认页面时，立刻加载 block 列表和对应位置。
  if (initialPageId) {
    selectedPageId = initialPageId;
    selectedPageTitle = initialPageTitle;
    loadPositionOptions(initialPageId, initialPosition);
  } else {
    handleSearch();
  }

  if (isLoading) {
    showStatus('正在读取…', 'info');
  }
  return modalSessionId;
}

function createExportPairListHtml(pairs) {
  return pairs.map((pair, index) => `
    <div class="c2n-pair-item">
      <input type="checkbox" value="${index}" />
      <div class="c2n-pair-content">
        <input type="text" class="c2n-pair-title" data-idx="${index}"
          value="${escapeHtml(truncate(pair.question, 100))}"
          placeholder="页面标题..." />
      </div>
    </div>
  `).join('');
}

function isExportModalSessionActive(modalSessionId) {
  return isModalOpen && exportModalSessionId === modalSessionId;
}

function updateExportModalScanProgress(modalSessionId, pairCount, cached = false) {
  if (!isExportModalSessionActive(modalSessionId)) return;
  const label = document.getElementById('c2n-pair-label');
  if (label) {
    label.textContent = cached
      ? `正在读取缓存（已识别 ${pairCount} 轮）`
      : `正在后台读取完整对话（已识别 ${pairCount} 轮）`;
  }
}

function completeExportModalScan(modalSessionId, pairs) {
  if (!isExportModalSessionActive(modalSessionId)) return;
  currentExportPairs = pairs;

  const label = document.getElementById('c2n-pair-label');
  const list = document.getElementById('c2n-pair-list');
  const selectAll = document.getElementById('c2n-select-all');
  const selectNone = document.getElementById('c2n-select-none');
  const exportBtn = document.getElementById('c2n-export');
  const overlay = document.getElementById('c2n-overlay');

  if (label) label.textContent = `选择要导出的对话 (${pairs.length} 条)`;
  if (list) list.innerHTML = createExportPairListHtml(pairs);
  if (selectAll) selectAll.disabled = false;
  if (selectNone) selectNone.disabled = false;
  if (exportBtn) {
    exportBtn.disabled = false;
    exportBtn.textContent = '导出到 Notion';
  }
  if (overlay) overlay.dataset.scanState = 'ready';
  showStatus(`✓ ${pairs.length} 轮已就绪`, 'success');
}

function failExportModalScan(modalSessionId, message) {
  if (!isExportModalSessionActive(modalSessionId)) return;
  currentExportPairs = [];

  const label = document.getElementById('c2n-pair-label');
  const list = document.getElementById('c2n-pair-list');
  const exportBtn = document.getElementById('c2n-export');
  const overlay = document.getElementById('c2n-overlay');
  if (label) label.textContent = '读取对话失败';
  if (list) list.innerHTML = `<div class="c2n-hint c2n-error">${escapeHtml(message)}</div>`;
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.textContent = '读取失败';
  }
  if (overlay) overlay.dataset.scanState = 'ready';
  showStatus(`❌ ${message}`, 'error');
}

async function handleSearch() {
  const query = document.getElementById('c2n-search-input').value;
  const listEl = document.getElementById('c2n-page-list');
  listEl.innerHTML = '<div class="c2n-hint">搜索中...</div>';

  try {
    const result = await searchNotionPages(query);
    if (result.pages.length === 0) {
      listEl.innerHTML = '<div class="c2n-hint">未找到页面。请确认已将页面共享给你的 Integration</div>';
      return;
    }

    listEl.innerHTML = result.pages.map(page => {
      const iconText = page.icon?.emoji || '📄';
      return `<div class="c2n-page-item" data-id="${page.id}" data-title="${escapeHtml(page.title)}">
        <span class="c2n-page-icon">${iconText}</span>
        <span>${escapeHtml(page.title)}</span>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.c2n-page-item').forEach(item => {
      item.addEventListener('click', () => {
        listEl.querySelectorAll('.c2n-page-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedPageId = item.dataset.id;
        selectedPageTitle = item.dataset.title;
        loadPositionOptions(selectedPageId);
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="c2n-hint c2n-error">${escapeHtml(err.message)}</div>`;
  }
}

async function handleExport() {
  const pairs = currentExportPairs;
  const pageItem = document.querySelector('#c2n-page-list .c2n-page-item.selected');
  const pageId = pageItem?.dataset.id || selectedPageId;
  const pageTitle = pageItem?.dataset.title || selectedPageTitle || '';
  if (!pageId) {
    showStatus('请先选择一个目标 Notion 页面', 'error');
    return;
  }

  const checkboxes = document.querySelectorAll('#c2n-pair-list input[type="checkbox"]:checked');
  if (checkboxes.length === 0) {
    showStatus('请至少选择一条对话', 'error');
    return;
  }

  const exportBtn = document.getElementById('c2n-export');
  exportBtn.disabled = true;
  exportBtn.textContent = '导出中...';

  const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.value));
  const isMerged = document.querySelector('.c2n-mode-btn.active')?.dataset.mode === 'merged';
  const position = getSelectedPosition();
  const sourcePageKey = document.getElementById('c2n-modal')?.dataset.sourcePageKey
    || getCurrentSourcePageKey();

  if (isMerged) {
    await handleMergedExport(
      pairs,
      pageId,
      pageTitle,
      selectedIndices,
      exportBtn,
      position,
      sourcePageKey
    );
  } else {
    await handleSeparateExport(
      pairs,
      pageId,
      pageTitle,
      selectedIndices,
      exportBtn,
      position,
      sourcePageKey
    );
  }
}

async function handleSeparateExport(
  pairs,
  pageId,
  pageTitle,
  selectedIndices,
  exportBtn,
  position,
  sourcePageKey
) {
  let success = 0;
  let failed = 0;
  const createdPageIds = [];
  const failureDetails = [];

  // 多条对话用 after_block 时，依次插入会反序（每条都接在同一 anchor 后）
  // 用反向遍历保证最终页面里顺序与勾选顺序一致
  const indicesToExport =
    position?.type === 'after_block'
      ? [...selectedIndices].reverse()
      : selectedIndices;

  for (const idx of indicesToExport) {
    const pair = pairs[idx];
    const titleInput = document.querySelector(`.c2n-pair-title[data-idx="${idx}"]`);
    const title = titleInput ? titleInput.value.trim() : truncate(pair.question, 100);
    const blocks = buildPageBlocks(pair);

    showStatus(`正在导出 (${success + failed + 1}/${indicesToExport.length}): ${truncate(title, 40)}...`, 'info');

    try {
      const result = await exportToNotion(pageId, title, blocks, position);
      createdPageIds.push(result?.pageId);
      success++;
    } catch (err) {
      console.error('[AI Chat to Notion] Export error:', err);
      failureDetails.push({
        title,
        message: err?.message || String(err || '未知错误'),
      });
      failed++;
    }

    if (indicesToExport.length > 1) {
      await sleep(350);
    }
  }

  exportBtn.disabled = false;
  exportBtn.textContent = '导出到 Notion';

  if (success > 0) {
    const rememberedPosition = getPositionAfterSuccessfulExport(position, createdPageIds);
    rememberSuccessfulExportTarget(
      sourcePageKey,
      pageId,
      pageTitle,
      rememberedPosition
    );
    await loadPositionOptions(pageId, rememberedPosition);
  }

  if (failed === 0) {
    showStatus(`✅ 全部导出成功！共 ${success} 条对话`, 'success');
    showToast(`✅ 已导出 ${success} 条对话到 Notion`);
  } else {
    const firstFailure = failureDetails[0];
    const remainingFailureCount = Math.max(0, failureDetails.length - 1);
    const detail = firstFailure
      ? `；“${truncate(firstFailure.title, 28)}”：${firstFailure.message}`
      : '';
    const remaining = remainingFailureCount > 0
      ? `（另有 ${remainingFailureCount} 条失败）`
      : '';
    showStatus(`完成：${success} 成功，${failed} 失败${detail}${remaining}`, 'error');
  }
}

async function handleMergedExport(
  pairs,
  pageId,
  pageTitle,
  selectedIndices,
  exportBtn,
  position,
  sourcePageKey
) {
  const defaultMergedTitle = pairs[0]?.mergedTitle || 'AI 对话合集';
  const mergedTitle = document.getElementById('c2n-merged-title')?.value.trim() || defaultMergedTitle;

  showStatus('正在合并导出...', 'info');

  const allBlocks = [];
  for (let i = 0; i < selectedIndices.length; i++) {
    const idx = selectedIndices[i];
    const pair = pairs[idx];

    allBlocks.push(...buildPageBlocks(pair));

    if (i < selectedIndices.length - 1) {
      allBlocks.push(createParagraphBlock(' '));
      allBlocks.push({ type: 'divider', divider: {} });
      allBlocks.push(createParagraphBlock(' '));
    }
  }

  try {
    const result = await exportToNotion(pageId, mergedTitle, allBlocks, position);
    const rememberedPosition = getPositionAfterSuccessfulExport(position, [result?.pageId]);
    rememberSuccessfulExportTarget(
      sourcePageKey,
      pageId,
      pageTitle,
      rememberedPosition
    );
    await loadPositionOptions(pageId, rememberedPosition);
    exportBtn.disabled = false;
    exportBtn.textContent = '导出到 Notion';
    showStatus(`✅ 合并导出成功！共 ${selectedIndices.length} 条对话合并为 1 个页面`, 'success');
    showToast(`✅ 已合并导出 ${selectedIndices.length} 条对话到 Notion`);
  } catch (err) {
    console.error('[AI Chat to Notion] Merged export error:', err);
    exportBtn.disabled = false;
    exportBtn.textContent = '导出到 Notion';
    showStatus(`❌ 合并导出失败：${err.message}`, 'error');
  }
}

function toggleAll(checked) {
  document.querySelectorAll('#c2n-pair-list input[type="checkbox"]')
    .forEach(cb => cb.checked = checked);
}

function closeModal() {
  document.getElementById('c2n-overlay')?.remove();
  document.getElementById('c2n-workspace')?.remove();
  destroyPositionSelector();
  isModalOpen = false;
  currentExportPairs = [];
  selectedPageId = null;
  selectedPageTitle = '';
}
