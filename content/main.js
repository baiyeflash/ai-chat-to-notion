// ============================================================
// content/main.js — 全局状态 + 启动入口
// ============================================================
// 加载顺序：第 9 个（最后）
//
// 这些全局 let 被其他文件的函数体引用。content_script 多文件加载到同一
// isolated world 作用域，所以这里声明的变量对其他文件可见。
// 函数体引用是延迟执行的，到用户触发动作时本文件已加载完毕。

let isModalOpen = false;
let selectedPageId = null;
let selectedPageTitle = '';
let currentExportPairs = [];
let exportModalSessionId = 0;

function init() {
  injectFloatingButton();
  initializeChatGPTConversationCache();
  console.log(`[AI Chat to Notion] 已加载：${getCurrentPlatformConfig().name}`);

  // Claude / ChatGPT 都是 SPA，路由切换时按钮可能被卸载，监听重新注入
  const observer = new MutationObserver(() => {
    if (!document.getElementById('c2n-float-btn')) {
      injectFloatingButton();
    }
  });
  observer.observe(document.body, { childList: true, subtree: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
