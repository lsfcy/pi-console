import { nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import path from 'node:path';
// The checked-in font-free SVG/PNG atlas is rebuilt by npm run icons.
export const menuIconNames = ["open","favorite","pinned","globalPinned","unread","read","rename","stats","close","trash","folder","terminal","up","down","hide","plus","temporary","fork","copy"] as const;
type MenuIcon = typeof menuIconNames[number];
const cache = new Map<MenuIcon, NativeImage>();
let atlas: NativeImage | undefined;
export function menuIcon(name: MenuIcon) {
  let icon = cache.get(name);
  if (!icon) {
    atlas ||= nativeImage.createFromPath(path.join(__dirname, '../../assets/menu-icons.png'));
    icon = nativeImage.createFromBuffer(atlas.crop({ x: menuIconNames.indexOf(name) * 32, y: 0, width: 32, height: 32 }).toPNG(), { scaleFactor: 2 });
    icon.setTemplateImage(true); // Native menus tint for light/dark/disabled states.
    cache.set(name, icon);
  }
  return icon;
}
