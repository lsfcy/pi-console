import type { AppTimer } from '../../shared/contracts.js';
export class NoticeModel {
  value: { message: string; action?: () => void; id: number } | null = null;
  timer: AppTimer | null = null;
  private serial = 0;
  constructor(private changed: () => void) {}
  show(message: string, action?: () => void) { this.pause(); this.value = { message, action, id: ++this.serial }; this.changed(); }
  pause = () => { clearTimeout(this.timer ?? undefined); this.timer = null; };
  dismiss = () => { this.pause(); this.value = null; this.changed(); };
  schedule = () => {
    this.pause();
    const element = document.getElementById('notice');
    if (!this.value || element?.matches(':hover') || element?.contains(document.activeElement)) return;
    this.timer = setTimeout(this.dismiss, 6500);
  };
}
