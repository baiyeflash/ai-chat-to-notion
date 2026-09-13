// ============================================================
// content/utils.js — 通用工具：转义/截断/sleep + Toast/状态栏
// ============================================================
// 加载顺序：第 1 个（无依赖）

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 面板底部状态栏（依赖 DOM 元素 #c2n-status） */
function showStatus(text, type = 'info') {
  const el = document.getElementById('c2n-status');
  if (el) {
    el.textContent = text;
    el.className = `c2n-status c2n-status-${type}`;
  }
}

/** 右下角浮层通知（3s 后自动消失） */
function showToast(message, type = 'success') {
  const existing = document.getElementById('c2n-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'c2n-toast';
  toast.className = `c2n-toast c2n-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('c2n-toast-fade');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
