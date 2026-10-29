import { t } from '../../shared/i18n.js';
import { useEffect } from 'react';
import { useWorkspace } from '../state/AppContext.js';
export function Notice() {
  const app = useWorkspace(), notice = app.notices.value;
  useEffect(() => { app.notices.schedule(); return app.notices.pause; }, [app, notice?.id]);
  return <div id="notice" role="status" aria-live="polite" aria-atomic="true" hidden={!notice}
    onPointerEnter={app.notices.pause} onPointerLeave={app.notices.schedule}
    onFocus={app.notices.pause} onBlur={() => queueMicrotask(app.notices.schedule)}>
    {notice?.action ? <button id="notice-open-session" className="notice-action" onClick={() => { const action = notice.action; app.dismissNotice(); action?.(); }}>
      <span className="notice-message">{notice.message}</span><span className="notice-link">{t("查看会话 →")}</span>
    </button> : notice && <span className="notice-message">{notice.message}</span>}
  </div>;
}
