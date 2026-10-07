// 检测站自绘线性图标（24×24，stroke 1.5，currentColor）；规则见 DESIGN.md §4.9
export const ICONS = {
  // 分区
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  route: '<path d="M4 7h13"/><path d="M14 4l3 3-3 3"/><path d="M20 17H7"/><path d="M10 14l-3 3 3 3"/>',
  droplet: '<path d="M12 3.5c3.4 3.8 6 7.1 6 10.3a6 6 0 0 1-12 0c0-3.2 2.6-6.5 6-10.3z"/>',
  activity: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  // IP 字段
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4 2.5 4H5"/>',
  badge: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.3 2.3 4.7-5"/>',
  server:
    '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01"/><path d="M8 16.5h.01"/>',
  hash: '<path d="M5 9h15"/><path d="M4 15h15"/><path d="M10 4L8 20"/><path d="M16 4l-2 16"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.4-3 7.9-7 9.5-4-1.6-7-5.1-7-9.5V6l7-3z"/>',
  shuffle: '<path d="M4 8h14"/><path d="M15 5l3 3-3 3"/><path d="M20 16H6"/><path d="M9 13l-3 3 3 3"/>',
  layers: '<path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/>',
  alert: '<path d="M12 4L2.8 19.5h18.4L12 4z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  gauge: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 14l3.5-3.5"/>',
  // 按钮
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
} as const;

export type IconName = keyof typeof ICONS;
