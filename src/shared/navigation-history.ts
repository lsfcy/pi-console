import type { NavigationLocation } from './contracts.js';
function key(state: NavigationLocation) {
  if (state.route === 'project') return 'project:' + state.projectId + ':' + state.terminalId;
  if (state.route === 'recent') return state.route + ':' + state.filter;
  return state.route;
}
export class NavigationHistory {
  entries: NavigationLocation[] = [];
  index = -1;
  constructor(public limit = 80) {}
  visit(state: NavigationLocation) {
    if (this.index >= 0 && key(this.entries[this.index]) === key(state)) { this.replace(state); return false; }
    this.entries.splice(this.index + 1);
    this.entries.push(structuredClone(state));
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }
  replace(state: NavigationLocation) { if (this.index >= 0) this.entries[this.index] = structuredClone(state); }
  destination(direction: number, valid: (state: NavigationLocation) => boolean = () => true) {
    if (direction !== -1 && direction !== 1) return -1;
    for (let i = this.index + direction; i >= 0 && i < this.entries.length; i += direction) {
      if (valid(this.entries[i])) return i;
    }
    return -1;
  }
  canMove(direction: number, valid?: (state: NavigationLocation) => boolean) { return this.destination(direction, valid) !== -1; }
  move(direction: number, valid?: (state: NavigationLocation) => boolean) {
    if (direction !== -1 && direction !== 1) return null;
    const next = this.destination(direction, valid);
    if (next === -1) return null;
    this.index = next;
    return structuredClone(this.entries[next]);
  }
}
