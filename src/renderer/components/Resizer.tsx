import { t } from '../../shared/i18n.js';
import { useRef } from 'react';
import { useWorkspace } from '../state/AppContext.js';
export function Resizer() {
  const app = useWorkspace(), drag = useRef<{ start: number; value: number } | null>(null);
  const min = 224, max = 440;
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(max, value)));
  const finish = () => { if (!drag.current) return; drag.current = null; void app.savePreferences({ sidebarWidth: app.preferences.sidebarWidth }); };
  return <div id="sidebar-resizer" className="sidebar-resizer"
    role="separator" tabIndex={0} aria-label={t("调整项目侧栏宽度")} aria-orientation="vertical"
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={app.preferences.sidebarWidth}
    onPointerDown={event => { if (event.button !== 0) return; drag.current = { start: event.clientX, value: app.preferences.sidebarWidth };
      event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add('resizing'); event.preventDefault(); }}
    onPointerMove={event => { if (!drag.current) return; app.applyPreferences({ sidebarWidth: clamp(drag.current.value + event.clientX - drag.current.start) }); }}
    onPointerUp={event => { event.currentTarget.classList.remove('resizing'); finish(); }}
    onPointerCancel={event => { event.currentTarget.classList.remove('resizing'); finish(); }}
    onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft'].includes(event.key)) return; event.preventDefault();
      const patch = { sidebarWidth: clamp(app.preferences.sidebarWidth + (event.key === 'ArrowRight' ? 16 : -16)) }; app.applyPreferences(patch); app.schedulePreference(patch);
    }} />;
}
