import { t } from '../../../shared/i18n.js';
import { useEffect, useLayoutEffect, useState } from 'react';
import type { RenameRequest } from '../../../shared/contracts.js';
import { message } from '../../../shared/errors.js';
import { useWorkspace } from '../../state/AppContext.js';
import { Dialog } from '../../components/Dialog.js';
import { Icon } from '../../components/Icon.js';
export function RenameDialog() {
  const app = useWorkspace();
  return <RenameForm request={app.renameTarget} />;
}
function RenameForm({ request }: { request: RenameRequest | null }) {
  const app = useWorkspace(), [value, setValue] = useState(request?.title || ''), [busy, setBusy] = useState(false);
  useLayoutEffect(() => { setValue(request?.title || ''); }, [request?.key]);
  const close = () => { if (!busy) { app.renameTarget = null; app.publish(); } };
  useEffect(() => { if (request) requestAnimationFrame(() => { const input = document.getElementById('rename-input') as HTMLInputElement; input?.focus(); input?.select(); }); }, [request?.key]);
  return <Dialog id="rename-dialog" open={Boolean(request)} onDismiss={close} onCancel={event => { if (busy) event.preventDefault(); }}>
    <form id="rename-form" onSubmit={event => {
      event.preventDefault(); if (!request || busy) return; setBusy(true);
      void app.bridge.renameSession(request.projectId, request.key, value).then(() => { app.renameTarget = null; app.publish(); })
        .catch(error => app.notify(t(message(error)))).finally(() => setBusy(false));
    }}>
      <div className="dialog-heading"><h2>{t("重命名会话")}</h2><button id="rename-cancel-icon" type="button" className="icon-button" aria-label={t("取消重命名")} disabled={busy} onClick={close}><Icon name="close" /></button></div>
      <label htmlFor="rename-input">{t("会话名称")}</label><input id="rename-input" className="text-input" maxLength={160} required autoComplete="off" value={value} disabled={busy} onChange={event => setValue(event.target.value)} />
      <p className="field-help">{t("只修改显示名称，不改写已有对话。")}</p><div className="dialog-actions">
        <button id="rename-cancel" className="button button-secondary" type="button" disabled={busy} onClick={close}>{t("取消")}</button>
        <button id="rename-save" className="button button-primary" type="submit" disabled={busy}>{t("保存名称")}</button></div>
    </form>
  </Dialog>;
}
