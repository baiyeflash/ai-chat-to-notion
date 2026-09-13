// ============================================================
// popup.js — 扩展弹窗设置页面逻辑
// ============================================================

const tokenInput = document.getElementById('token');
const pageIdInput = document.getElementById('pageId');
const pageTitleInput = document.getElementById('pageTitle');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const messageEl = document.getElementById('message');

// ---------- 加载已保存的设置 ----------
chrome.storage.local.get(['notionToken', 'defaultPageId', 'defaultPageTitle'], (data) => {
  if (data.notionToken) tokenInput.value = data.notionToken;
  if (data.defaultPageId) pageIdInput.value = data.defaultPageId;
  if (data.defaultPageTitle) pageTitleInput.value = data.defaultPageTitle;
});

// ---------- 保存设置 ----------
saveBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  const pageId = cleanPageId(pageIdInput.value.trim());

  if (!token) {
    showMessage('请填写 Notion Token', 'error');
    return;
  }

  chrome.storage.local.set({
    notionToken: token,
    defaultPageId: pageId,
    defaultPageTitle: pageTitleInput.value || ''
  }, () => {
    showMessage('✅ 设置已保存', 'success');
  });
});

// ---------- 测试连接 ----------
testBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showMessage('请先填写 Token', 'error');
    return;
  }

  showMessage('正在测试连接...', 'info');
  testBtn.disabled = true;

  try {
    // 通过 background.js 调用 Notion search API
    const response = await chrome.runtime.sendMessage({
      type: 'NOTION_API',
      action: 'search_pages',
      token: token,
      query: ''
    });

    if (response.error) {
      showMessage(`❌ 连接失败：${response.error}`, 'error');
    } else {
      const count = response.pages?.length || 0;
      showMessage(`✅ 连接成功！找到 ${count} 个可访问的页面`, 'success');
    }
  } catch (err) {
    showMessage(`❌ 连接失败：${err.message}`, 'error');
  } finally {
    testBtn.disabled = false;
  }
});

// ---------- 工具 ----------

/**
 * 从 Notion URL 或各种格式中提取页面 ID
 * 支持：
 * - 纯 ID：abc123def456...
 * - 带横线的 UUID：abc123-def456-...
 * - 完整 URL：https://www.notion.so/Page-Title-abc123def456...
 */
function cleanPageId(input) {
  if (!input) return '';

  // 如果是 URL，提取最后的 32 位 hex
  const urlMatch = input.match(/([a-f0-9]{32})(?:\?|$|#)/i);
  if (urlMatch) return urlMatch[1];

  // 如果带横线的 UUID 格式
  const uuidMatch = input.match(
    /([a-f0-9]{8})-?([a-f0-9]{4})-?([a-f0-9]{4})-?([a-f0-9]{4})-?([a-f0-9]{12})/i
  );
  if (uuidMatch) return uuidMatch.slice(1).join('');

  // 如果已经是 32 位 hex
  const hexMatch = input.match(/^[a-f0-9]{32}$/i);
  if (hexMatch) return input;

  return input; // 原样返回
}

function showMessage(text, type = 'info') {
  messageEl.textContent = text;
  messageEl.className = `message message-${type}`;
}
