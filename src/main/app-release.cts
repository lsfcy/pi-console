import type { AppRelease } from '../shared/contracts.js';

const metadata = require('../../package.json');
const repository = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(metadata.repository?.url || '')?.[1];
if (!repository) throw new Error('invalid GitHub repository');
const REPOSITORY: string = repository;
export const APP_RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const FEED = `${APP_RELEASES_URL}.atom`;
const CACHE_MS = 60 * 60 * 1000;
const MAX_BYTES = 1024 * 1024;
type Version = { major: number; minor: number; patch: number; channel: string | null; number: number };

export function parseAppVersion(value: unknown): Version | null {
  if (typeof value !== 'string') return null;
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(rc|snapshot)(?:\.(0|[1-9]\d*))?)?$/.exec(value);
  if (!m) return null;
  const [major, minor, patch, number] = [m[1], m[2], m[3], m[5] || '0'].map(Number);
  if (![major, minor, patch, number].every(Number.isSafeInteger)) return null;
  return { major, minor, patch, channel: m[4] || null, number };
}
export function compareAppVersions(a: Version, b: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  const rank = (v: Version) => v.channel === null ? 2 : v.channel === 'rc' ? 1 : 0;
  return rank(a) - rank(b) || Math.sign(a.number - b.number);
}
export function selectAppRelease(current: string, feed: unknown): AppRelease {
  const installed = parseAppVersion(current);
  if (!installed || typeof feed !== 'string' || !/<feed\b/.test(feed) || !/<\/feed>\s*$/.test(feed)) throw new Error('invalid release feed');
  let selected: { version: Version; tag: string } | null = null;
  for (const entry of feed.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    // GitHub's published-release Atom entries identify the immutable tag in this element.
    const tag = /<id>\s*tag:github\.com,2008:Repository\/\d+\/(v[0-9A-Za-z.\-]+)\s*<\/id>/.exec(entry[1])?.[1];
    const version = parseAppVersion(tag);
    if (!tag || !version || (!installed.channel && version.channel)) continue;
    if (!selected || compareAppVersions(version, selected.version) > 0) selected = { version, tag };
  }
  if (!selected) throw new Error('no compatible release');
  return { currentVersion: current, latestVersion: selected.tag.slice(1), available: compareAppVersions(selected.version, installed) > 0,
    url: `https://github.com/${REPOSITORY}/releases/tag/${selected.tag}`, channel: installed.channel ? 'prerelease' : 'stable' };
}
async function readBounded(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) throw new Error('release response too large');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) throw new Error('release response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
export class AppReleaseChecker {
  private cached: { value: AppRelease; expires: number } | null = null;
  private pending: Promise<AppRelease> | null = null;
  constructor(private current: string, private fetcher: typeof fetch = fetch, private now: () => number = Date.now) {}
  check(force = false): Promise<AppRelease> {
    if (this.pending) return this.pending;
    if (!force && this.cached && this.cached.expires > this.now()) return Promise.resolve(this.cached.value);
    const request = (async () => {
      const response = await this.fetcher(FEED, { headers: { Accept: 'application/atom+xml', 'User-Agent': 'Pi-Console' },
        redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const result = selectAppRelease(this.current, await readBounded(response));
      this.cached = { value: result, expires: this.now() + CACHE_MS };
      return result;
    })();
    this.pending = request;
    void request.finally(() => { if (this.pending === request) this.pending = null; }).catch(() => {});
    return request;
  }
}
