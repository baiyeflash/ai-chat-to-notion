// ============================================================
// content/api.js — 与 background service worker 通信 + Notion API 入口
// ============================================================
// 加载顺序：第 2 个（无依赖）
// 内容脚本不能直接 fetch Notion API（CORS），所有请求都经 background 中转

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['notionToken', 'defaultPageId', 'defaultPageTitle'], resolve);
  });
}

async function searchNotionPages(query) {
  const { notionToken } = await getSettings();
  return sendToBackground({
    type: 'NOTION_API',
    action: 'search_pages',
    token: notionToken,
    query
  });
}

/**
 * 拉取目标页面的顶层 block 列表（用于选择插入位置）
 * 返回：{ blocks: [{id, type, preview}], hasMore }
 */
async function getNotionPageBlocks(pageId) {
  const { notionToken } = await getSettings();
  return sendToBackground({
    type: 'NOTION_API',
    action: 'get_page_blocks',
    token: notionToken,
    pageId
  });
}

/**
 * 创建子页面
 * @param {Object|null} position - Notion position 参数；不传则默认追加到末尾
 *   { type: 'page_start' } | { type: 'page_end' } | { type: 'after_block', after_block: { id } }
 */
async function exportToNotion(parentId, title, blocks, position) {
  const { notionToken } = await getSettings();
  return sendToBackground({
    type: 'NOTION_API',
    action: 'create_page',
    token: notionToken,
    parentId,
    title,
    blocks,
    position
  });
}
