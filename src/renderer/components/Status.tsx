import { t } from '../../shared/i18n.js';
import type { StatusLabel, SessionMark } from '../../shared/contracts.js';
import { sidebarIndicator } from '../../shared/view-model.js';
import { Icon } from './Icon.js';
export function Status({ status }: { status: StatusLabel }) {
  return <span className={'status-label status-' + status.tone} role="img" aria-label={status.label} title={status.details || status.label}>
    {status.tone === 'done' && <Icon name="check" />}{status.tone === 'blocked' && <Icon name="pause" />}{status.tone === 'error' && <Icon name="alert" />}
  </span>;
}
export function SessionMarks({ mark }: { mark?: SessionMark }) {
  const pin = mark?.pinned ? t('项目内置顶') : '';
  return <>{mark?.favorite && <span className="session-mark session-favorite" role="img" aria-label={t("已收藏")} title={t("已收藏")}><Icon name="star" /></span>}
    {pin && <span className="session-mark session-pin" role="img" aria-label={pin} title={pin}><Icon name="pin" /></span>}</>
}
export function UnreadDot() {
  return <span className="sidebar-status sidebar-status-done sidebar-unread" role="img" aria-label={t("未读")} title={t("已标记为未读")} />;
}
export function SidebarStatus({ status, unread = true }: { status: StatusLabel; unread?: boolean }) {
  const kind = sidebarIndicator(status);
  if (kind === 'none' || (kind === 'done' && !unread)) return null;
  return <span className={'sidebar-status sidebar-status-' + kind} role="img" aria-label={status.label} title={status.details || status.label}>
    {kind === 'error' && <Icon name="alert" />}{kind === 'blocked' && <Icon name="pause" />}
  </span>;
}
