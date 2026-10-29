export class ObservableModel {
  private revision = 0;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.revision;
  protected beforePublish() {}
  publish = () => { this.beforePublish(); this.revision++; for (const listener of this.listeners) listener(); };
}
