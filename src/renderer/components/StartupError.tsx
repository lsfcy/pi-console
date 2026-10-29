import { t } from '../../shared/i18n.js';
import { Dialog } from './Dialog.js';
export function StartupError({ title, message }: { title: string; message: string }) {
  return <Dialog id="startup-error" open onDismiss={() => window.close()} labelledBy="startup-error-title">
    <div className="dialog-heading"><h2 id="startup-error-title">{t(title)}</h2></div>
    <p className="confirmation-detail">{t(message)}</p>
    <div className="dialog-actions"><button className="button button-primary" autoFocus onClick={() => window.close()}>{t("关闭应用")}</button></div>
  </Dialog>;
}
