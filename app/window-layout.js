const { screen } = require('electron');

/** Shared window sizes — tune here for all Ocean windows. */
const LAYOUT = {
  shell: {
    /** Bottom toolbar only — expands upward when Settings/About menu opens */
    toolbar: { minWidth: 220, height: 660, minHeight: 320, menuHeight: 660 },
    modal: {
      book: { width: 960, height: 680, minWidth: 840, minHeight: 560 },
      default: { width: 880, height: 580, minWidth: 760, minHeight: 480 },
    },
  },
  ticketPanel: { width: 288, height: 310, minWidth: 260, minHeight: 300, gap: 8 },
  /** Floating QR above ticket panel — room for route + amount footer */
  qrPopup: { width: 280, height: 332 },
  license: { width: 360, height: 300, minWidth: 320, minHeight: 260 },
  news: { width: 984, height: 680, minWidth: 864, minHeight: 560 },
  trainResults: { width: 840, height: 540, minWidth: 680, minHeight: 440 },
  irctcElectron: { width: 400, height: 540, minWidth: 360, minHeight: 480 },
  directHost: { width: 360, height: 480, minWidth: 320, minHeight: 420 },
};

function getWorkArea(display) {
  return display?.workArea || screen.getPrimaryDisplay().workArea;
}

function clampSize(preferredW, preferredH, workArea, maxRatio = 0.92) {
  const maxW = Math.floor(workArea.width * maxRatio);
  const maxH = Math.floor(workArea.height * maxRatio);
  return {
    width: Math.min(preferredW, maxW),
    height: Math.min(preferredH, maxH),
  };
}

function centerBounds(workArea, width, height, offsetY = 0) {
  return {
    x: workArea.x + Math.max(0, Math.round((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.round((workArea.height - height) / 2) + offsetY),
    width,
    height,
  };
}

function bottomCenterBounds(workArea, width, height, bottomMargin = 12) {
  return {
    x: workArea.x + Math.max(0, Math.round((workArea.width - width) / 2)),
    y: workArea.y + workArea.height - height - bottomMargin,
    width,
    height,
  };
}

function sideBySidePairBounds(workArea, panelW, panelH, gap = LAYOUT.ticketPanel.gap) {
  const margin = 12;
  const startX = workArea.x + margin;
  const startY = workArea.y + margin;
  return [
    { x: startX, y: startY, width: panelW, height: panelH },
    { x: startX + panelW + gap, y: startY, width: panelW, height: panelH },
  ];
}

/**
 * One ticket = one horizontal row of pairs (left → right).
 * rowIndex 0 = top; rowIndex 1 = next ticket below, etc.
 */
function ticketRowBounds(
  workArea,
  panelW,
  panelH,
  pairCount,
  rowIndex = 0,
  gap = LAYOUT.ticketPanel.gap
) {
  const n = Math.max(1, Math.min(4, Number(pairCount) || 1));
  const margin = 12;
  const startX = workArea.x + margin;
  const startY = workArea.y + margin + Math.max(0, Number(rowIndex) || 0) * (panelH + gap);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: startX + i * (panelW + gap),
      y: startY,
      width: panelW,
      height: panelH,
    });
  }
  return out;
}

/** @deprecated use ticketRowBounds — kept for callers expecting single-ticket layout */
function multiPanelBounds(workArea, panelW, panelH, count, gap = LAYOUT.ticketPanel.gap) {
  return ticketRowBounds(workArea, panelW, panelH, count, 0, gap);
}

/** Max concurrent ticket pairs per journey (Chrome / Brave / APP). */
const MAX_PAIRS_PER_JOURNEY = 4;

function toolbarShellWidth(workArea) {
  return Math.min(220, Math.max(180, workArea.width - 24));
}

function getModalPreset(modalKind = 'default') {
  return modalKind === 'book' ? LAYOUT.shell.modal.book : LAYOUT.shell.modal.default;
}

function getModalBounds(modalKind = 'default') {
  const workArea = getWorkArea(screen.getPrimaryDisplay());
  const preset = getModalPreset(modalKind);
  const { width, height } = clampSize(preset.width, preset.height, workArea, 0.88);
  return {
    bounds: centerBounds(workArea, width, height),
    minWidth: preset.minWidth,
    minHeight: preset.minHeight,
  };
}

/** Toolbar window — always small strip at bottom, never modal-sized */
function positionToolbarShell(win, { menuOpen = false } = {}) {
  if (!win || win.isDestroyed()) return;
  const workArea = getWorkArea(screen.getPrimaryDisplay());
  const tb = LAYOUT.shell.toolbar;
  const width = Math.min(menuOpen ? 550 : toolbarShellWidth(workArea), workArea.width - 24);
  const height = Math.min(tb.height, workArea.height - 24);
  // Allow grow when menu open; keep compact min when closed
  win.setMinimumSize(Math.min(tb.minWidth,width), Math.min(tb.minHeight,height));
  win.setBounds({x:workArea.x+workArea.width-width-12,y:workArea.y+Math.round((workArea.height-height)/2),width,height}, false);
  // Windows transparent windows sometimes skip paint on newly exposed area
  if (menuOpen) win.setBackgroundColor('#00000000');
}

module.exports = {
  LAYOUT,
  MAX_PAIRS_PER_JOURNEY,
  clampSize,
  centerBounds,
  bottomCenterBounds,
  sideBySidePairBounds,
  multiPanelBounds,
  ticketRowBounds,
  positionToolbarShell,
  getModalBounds,
  getModalPreset,
  getWorkArea,
  toolbarShellWidth,
};
