import { useWorkspace } from '../../state/AppContext.js';
import { t } from '../../../shared/i18n.js';
export function StatsToggle() {
  const app = useWorkspace();
  return <div className="segmented history-view-toggle" role="group" aria-label={t('会话视图')}>
    <button id="history-view-list" type="button" aria-pressed={!app.statsVisible} onClick={() => app.setStatsVisible(false)}>{t('列表')}</button>
    <button id="history-view-stats" type="button" aria-pressed={app.statsVisible} onClick={() => app.setStatsVisible(true)}>{t('统计')}</button>
  </div>;
}
