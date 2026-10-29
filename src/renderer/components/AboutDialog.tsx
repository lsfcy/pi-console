import { t } from '../../shared/i18n.js';
import { useWorkspace } from '../state/AppContext.js';
import { Dialog } from './Dialog.js';
import { Icon } from './Icon.js';
export function AboutDialog() {
  const app = useWorkspace(), close = () => { app.aboutOpen = false; app.publish(); };
  return <Dialog id="about-dialog" className="about-dialog" open={app.aboutOpen} onDismiss={close}>
    <div className="dialog-heading"><h2>Pi Console</h2><button id="about-close-icon" className="icon-button" aria-label={t("关闭关于")} onClick={close}><Icon name="close" /></button></div>
    <div className="about-body"><img className="about-mark" src="../../assets/icon.svg" alt="" /><p className="about-version">{t("版本 ")}<span id="about-version">{app.appVersion}</span></p>
      <p>{t("本地多项目 Pi 会话管理工具，提供项目导航、会话标签、Shell、完成提醒和用量统计。")}</p>
      <p>{t("复用本机 Pi 的认证、工具、扩展和会话文件，不重写聊天客户端，不做云同步。")}</p>
      <div className="about-boundary"><strong>{t("边界")}</strong><p>{t("只做会话管理。供应商、模型、工具、主题与上下文配置由 Pi 管理。")}</p></div>
    </div><div className="dialog-actions"><button id="about-close" className="button button-primary" type="button" onClick={close}>{t("关闭")}</button></div>
  </Dialog>;
}
