// ============================================================
// content/ui-position.js — 右侧常驻精准选择 + 长页面窗口化渲染
// ============================================================
// 加载顺序：第 8 个（ui-modal.js 之前）
// 依赖：utils.js / api.js

const C2N_POSITION_OVERSCAN = 10;
const C2N_POSITION_SCROLL_DELAY = 16;

let c2nPositionState = null;
let c2nPositionLoadSequence = 0;

/** 将一个 block 渲染为 Notion 风格的 HTML。 */
function renderNotionBlock(block) {
  const esc = escapeHtml;
  const text = block.text || block.expression || '';

  switch (block.type) {
    case 'heading_1':
      return `<div class="c2n-nb c2n-nb-h1">${esc(text)}</div>`;
    case 'heading_2':
      return `<div class="c2n-nb c2n-nb-h2">${esc(text)}</div>`;
    case 'heading_3':
      return `<div class="c2n-nb c2n-nb-h3">${esc(text)}</div>`;
    case 'paragraph':
      if (!text) return '<div class="c2n-nb c2n-nb-p c2n-nb-empty">&nbsp;</div>';
      return `<div class="c2n-nb c2n-nb-p">${esc(text)}</div>`;
    case 'divider':
      return '<div class="c2n-nb c2n-nb-divider"><hr></div>';
    case 'child_page':
      return `<div class="c2n-nb c2n-nb-child"><span>📄</span><span class="c2n-nb-child-title">${esc(block.title || '子页面')}</span></div>`;
    case 'child_database':
      return `<div class="c2n-nb c2n-nb-child"><span>🗄️</span><span class="c2n-nb-child-title">${esc(block.title || '数据库')}</span></div>`;
    case 'bulleted_list_item':
      return `<div class="c2n-nb c2n-nb-bullet">${esc(text)}</div>`;
    case 'numbered_list_item':
      return `<div class="c2n-nb c2n-nb-numbered">${esc(text)}</div>`;
    case 'to_do': {
      const cls = block.checked ? ' checked' : '';
      const icon = block.checked ? '☑' : '☐';
      return `<div class="c2n-nb c2n-nb-todo"><span class="c2n-nb-check${cls}">${icon}</span>${esc(text)}</div>`;
    }
    case 'code': {
      const lang = block.language ? `<span class="c2n-nb-lang">${esc(block.language)}</span>` : '';
      return `<div class="c2n-nb c2n-nb-code">${lang}<pre>${esc(text || '...')}</pre></div>`;
    }
    case 'quote': {
      const children = Array.isArray(block.children) ? block.children : [];
      const childrenHtml = children.map(renderNotionBlock).join('');
      return `<div class="c2n-nb c2n-nb-quote">
        <div class="c2n-nb-quote-main">${esc(text)}</div>
        ${childrenHtml ? `<div class="c2n-nb-quote-children">${childrenHtml}</div>` : ''}
      </div>`;
    }
    case 'callout': {
      const icon = block.icon || '💡';
      return `<div class="c2n-nb c2n-nb-callout"><span class="c2n-nb-callout-icon">${icon}</span><span>${esc(text)}</span></div>`;
    }
    case 'toggle':
      return `<div class="c2n-nb c2n-nb-toggle"><span class="c2n-nb-toggle-arrow">▶</span>${esc(text)}</div>`;
    case 'image':
      return `<div class="c2n-nb c2n-nb-media">🖼️ 图片${block.caption ? ` — ${esc(block.caption)}` : ''}</div>`;
    case 'video': return '<div class="c2n-nb c2n-nb-media">🎥 视频</div>';
    case 'file': return '<div class="c2n-nb c2n-nb-media">📎 文件</div>';
    case 'pdf': return '<div class="c2n-nb c2n-nb-media">📕 PDF</div>';
    case 'bookmark': return '<div class="c2n-nb c2n-nb-media">🔖 书签</div>';
    case 'embed': return '<div class="c2n-nb c2n-nb-media">🔗 嵌入</div>';
    case 'equation':
      return `<div class="c2n-nb c2n-nb-media">∑ ${esc(block.expression || '公式')}</div>`;
    case 'table': return '<div class="c2n-nb c2n-nb-media">⊞ 表格</div>';
    case 'column_list': return '<div class="c2n-nb c2n-nb-media">⊟ 列布局</div>';
    case 'table_of_contents': return '<div class="c2n-nb c2n-nb-media">📑 目录</div>';
    case 'synced_block': return '<div class="c2n-nb c2n-nb-media">↻ 同步块</div>';
    default:
      return `<div class="c2n-nb c2n-nb-media">[${esc(block.type)}]</div>`;
  }
}

function estimatePositionItemHeight(block, containerWidth) {
  if (!block) return 18;

  const text = block.text || block.expression || '';
  const charsPerLine = Math.max(24, Math.floor((containerWidth - 40) / 7));
  const wrappedLines = Math.max(1, Math.ceil(text.length / charsPerLine));
  const typeBase = {
    heading_1: 38,
    heading_2: 32,
    heading_3: 29,
    divider: 30,
    code: 30,
    callout: 38,
    child_page: 25,
    child_database: 25,
  }[block.type] || 22;

  if (block.type === 'code') {
    const codeLines = Math.max(1, text.split('\n').length);
    return typeBase + codeLines * 17 + 18;
  }

  if (block.type === 'quote' && Array.isArray(block.children)) {
    const childHeight = block.children.reduce((total, child) => (
      total + Math.max(18, estimatePositionItemHeight(child, containerWidth) - 18)
    ), 0);
    return typeBase + Math.max(0, wrappedLines - 1) * 20 + childHeight + 18;
  }

  return typeBase + Math.max(0, wrappedLines - 1) * 20 + 18;
}

function rebuildPositionOffsets(state) {
  const offsets = new Array(state.heights.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < state.heights.length; index++) {
    offsets[index + 1] = offsets[index] + state.heights[index];
  }
  state.offsets = offsets;
  state.totalHeight = offsets[offsets.length - 1] || 0;
}

function findPositionItemAtOffset(state, offset) {
  let low = 0;
  let high = state.heights.length - 1;
  let answer = Math.max(0, high);

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (state.offsets[middle + 1] > offset) {
      answer = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return answer;
}

function isPositionSlotActive(state, type, blockId = '') {
  if (!state.selectedPosition || state.selectedPosition.type !== type) return false;
  return type === 'page_start' || state.selectedPosition.after_block?.id === blockId;
}

function renderPositionSlot(type, blockId, active) {
  const after = type === 'page_start' ? '__start__' : escapeHtml(blockId);
  return `<div class="c2n-slot${active ? ' active' : ''}" data-after="${after}" data-type="${type}">
    <div class="c2n-slot-line"><span class="c2n-slot-label">插入到此处</span></div>
  </div>`;
}

function renderPositionVirtualItem(state, itemIndex) {
  const top = state.offsets[itemIndex];
  if (itemIndex === 0) {
    const active = isPositionSlotActive(state, 'page_start');
    return `<div class="c2n-pos-virtual-item" data-item-index="0" data-index="-1" style="transform:translateY(${top}px)">
      ${renderPositionSlot('page_start', '', active)}
    </div>`;
  }

  const blockIndex = itemIndex - 1;
  const block = state.blocks[blockIndex];
  const active = isPositionSlotActive(state, 'after_block', block.id);
  return `<div class="c2n-pos-virtual-item" data-item-index="${itemIndex}" data-index="${blockIndex}" style="transform:translateY(${top}px)">
    ${renderNotionBlock(block)}
    ${renderPositionSlot('after_block', block.id, active)}
  </div>`;
}

function schedulePositionRender(state) {
  if (!state || state !== c2nPositionState || state.renderTimer) return;
  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    renderPositionWindow(state);
  }, C2N_POSITION_SCROLL_DELAY);
}

function measureRenderedPositionItems(state) {
  if (!state || state !== c2nPositionState) return;
  const oldOffsets = state.offsets;
  const firstRendered = state.renderStart;
  let changed = false;

  state.spacer.querySelectorAll('.c2n-pos-virtual-item').forEach(item => {
    const itemIndex = Number(item.dataset.itemIndex);
    const measured = Math.ceil(item.getBoundingClientRect().height);
    if (measured > 0 && Math.abs(measured - state.heights[itemIndex]) > 1) {
      state.heights[itemIndex] = measured;
      changed = true;
    }
  });

  if (!changed) return;

  const oldAnchorTop = oldOffsets[firstRendered] || 0;
  rebuildPositionOffsets(state);
  const newAnchorTop = state.offsets[firstRendered] || 0;
  state.spacer.style.height = `${state.totalHeight}px`;
  if (firstRendered > 0 && Math.abs(newAnchorTop - oldAnchorTop) > 1) {
    state.container.scrollTop += newAnchorTop - oldAnchorTop;
  }
  schedulePositionRender(state);
}

function renderPositionWindow(state) {
  if (!state || state !== c2nPositionState || !state.container.isConnected) return;

  const viewportTop = state.container.scrollTop;
  const viewportBottom = viewportTop + Math.max(1, state.container.clientHeight);
  const firstVisible = findPositionItemAtOffset(state, viewportTop);
  const lastVisible = findPositionItemAtOffset(state, viewportBottom);
  const start = Math.max(0, firstVisible - C2N_POSITION_OVERSCAN);
  const end = Math.min(state.heights.length - 1, lastVisible + C2N_POSITION_OVERSCAN);

  state.renderStart = start;
  state.renderEnd = end;
  let html = '';
  for (let itemIndex = start; itemIndex <= end; itemIndex++) {
    html += renderPositionVirtualItem(state, itemIndex);
  }
  state.spacer.innerHTML = html;
  state.spacer.style.height = `${state.totalHeight}px`;

  clearTimeout(state.measureTimer);
  state.measureTimer = setTimeout(() => measureRenderedPositionItems(state), 0);
}

function createPositionVirtualList(container, blocks, initialPosition = null) {
  destroyPositionSelector();

  const width = Math.max(320, container.clientWidth || 480);
  const heights = [18, ...blocks.map(block => estimatePositionItemHeight(block, width))];
  container.innerHTML = '<div class="c2n-pos-virtual-spacer"></div>';
  container.scrollTop = 0;

  const state = {
    blocks,
    container,
    spacer: container.firstElementChild,
    heights,
    offsets: [],
    totalHeight: 0,
    selectedPosition: initialPosition?.type === 'after_block'
      ? {
          type: 'after_block',
          after_block: { id: initialPosition.after_block.id },
        }
      : null,
    renderStart: 0,
    renderEnd: 0,
    renderTimer: null,
    measureTimer: null,
    resizeObserver: null,
  };

  rebuildPositionOffsets(state);
  state.onScroll = () => schedulePositionRender(state);
  state.onClick = event => {
    const slot = event.target.closest('.c2n-slot');
    if (!slot || !container.contains(slot)) return;

    document.querySelectorAll('.c2n-pos-quick-btn').forEach(button => {
      button.classList.remove('active');
    });
    state.selectedPosition = slot.dataset.type === 'page_start'
      ? { type: 'page_start' }
      : { type: 'after_block', after_block: { id: slot.dataset.after } };
    renderPositionWindow(state);
  };

  container.addEventListener('scroll', state.onScroll, { passive: true });
  container.addEventListener('click', state.onClick);
  if (typeof ResizeObserver !== 'undefined') {
    state.resizeObserver = new ResizeObserver(() => schedulePositionRender(state));
    state.resizeObserver.observe(container);
  }

  c2nPositionState = state;
  renderPositionWindow(state);

  if (state.selectedPosition) {
    const blockIndex = blocks.findIndex(
      block => block.id === state.selectedPosition.after_block.id
    );
    if (blockIndex >= 0) {
      const itemIndex = blockIndex + 1;
      state.container.scrollTop = Math.max(
        0,
        state.offsets[itemIndex] - Math.floor(state.container.clientHeight / 3)
      );
      renderPositionWindow(state);
    }
  }
}

/** 拉取目标页面 block，并在右侧常驻面板中创建窗口化预览。 */
async function loadPositionOptions(pageId, initialPosition = { type: 'page_end' }) {
  const section = document.getElementById('c2n-position-section');
  const container = document.getElementById('c2n-position-container');
  const subtitle = document.getElementById('c2n-position-panel-subtitle');
  const toolbarHint = document.getElementById('c2n-position-toolbar-hint');
  if (!section || !container) return;

  const loadSequence = ++c2nPositionLoadSequence;
  section.querySelectorAll('.c2n-pos-quick-btn').forEach(button => {
    button.disabled = false;
    button.classList.toggle(
      'active',
      button.dataset.pos === (initialPosition?.type === 'page_start' ? 'start' : 'end')
    );
  });
  destroyPositionSelector(false);
  container.innerHTML = '<div class="c2n-pos-loading">加载页面内容中...</div>';
  if (subtitle) subtitle.textContent = '正在读取目标页面内容…';
  if (toolbarHint) toolbarHint.textContent = '或点击下方蓝线';

  try {
    const result = await getNotionPageBlocks(pageId);
    if (loadSequence !== c2nPositionLoadSequence || !container.isConnected) return;

    const blocks = result.blocks || [];
    if (subtitle) subtitle.textContent = `已加载 ${blocks.length} 个内容块 · 仅渲染当前可见区域`;
    const preciseAnchorId = initialPosition?.type === 'after_block'
      ? initialPosition.after_block?.id
      : '';
    const precisePositionExists = preciseAnchorId
      && blocks.some(block => block.id === preciseAnchorId);

    if (initialPosition?.type === 'after_block') {
      section.querySelectorAll('.c2n-pos-quick-btn').forEach(button => {
        button.classList.toggle('active', !precisePositionExists && button.dataset.pos === 'end');
      });
      if (!precisePositionExists && toolbarHint) {
        toolbarHint.textContent = '上次位置已不存在，已改为末尾';
      }
    }
    if (blocks.length === 0) {
      container.innerHTML = '<div class="c2n-pos-empty">页面为空，可在左侧直接选择“开头”或“末尾”</div>';
      return;
    }

    createPositionVirtualList(
      container,
      blocks,
      precisePositionExists ? initialPosition : null
    );
  } catch (err) {
    if (loadSequence !== c2nPositionLoadSequence || !container.isConnected) return;
    if (subtitle) subtitle.textContent = '目标页面读取失败';
    if (toolbarHint) toolbarHint.textContent = '快速位置仍可用';
    container.innerHTML = `<div class="c2n-pos-empty c2n-error">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function resetPrecisePositionSelection() {
  if (!c2nPositionState) return;
  c2nPositionState.selectedPosition = null;
  renderPositionWindow(c2nPositionState);
}

function destroyPositionSelector(invalidateLoad = true) {
  if (invalidateLoad) c2nPositionLoadSequence++;
  const state = c2nPositionState;
  if (!state) return;

  clearTimeout(state.renderTimer);
  clearTimeout(state.measureTimer);
  state.container.removeEventListener('scroll', state.onScroll);
  state.container.removeEventListener('click', state.onClick);
  state.resizeObserver?.disconnect();
  c2nPositionState = null;
}

/** 读取当前选中的插入位置。 */
function getSelectedPosition() {
  const activeQuick = document.querySelector('.c2n-pos-quick-btn.active');
  if (activeQuick?.dataset.pos === 'start') return { type: 'page_start' };
  if (activeQuick?.dataset.pos === 'end') return null;
  return c2nPositionState?.selectedPosition || null;
}
