import { useEffect } from 'react';

/**
 * /tutor-lab 已改为服务端直出的顶层欧拉白板页（client/public/tutor-lab.html）：
 * 顶层文档直接加载 APK 白板内核，没有 iframe、没有「经典」皮肤切换。
 * 这里只把 SPA 内的客户端导航换成整页跳转，让顶层文档接管。
 */
export default function TutorLabPage() {
  useEffect(() => {
    // 兜底：站内若仍有 SPA 软导航落到这个路由，直接整页交给顶层欧拉文档；
    // 不再追加 ?web=1，避免 URL 二次变化观感像「自动刷新两次」。
    window.location.replace('/tutor-lab');
  }, []);
  return null;
}
