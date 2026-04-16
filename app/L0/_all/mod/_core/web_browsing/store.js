const STORE_NAME = "webBrowsing";

const WINDOW_MARGIN = 16;
const WINDOW_MIN_WIDTH = 360;
const WINDOW_MIN_HEIGHT = 260;
const WINDOW_EMERGENCY_MIN_WIDTH = 240;
const WINDOW_EMERGENCY_MIN_HEIGHT = 180;
const WINDOW_MINIMIZED_HEIGHT = 46;
const WINDOW_MINIMIZED_WIDTH_EM = 12;
const DEFAULT_WIDTH_RATIO = 0.62;
const DEFAULT_HEIGHT_RATIO = 0.66;

let nextWindowZIndex = 2147481200;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundPx(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function resolveMinimum(maxValue, preferredValue, emergencyFloor) {
  if (maxValue <= 0) {
    return emergencyFloor;
  }

  if (maxValue <= emergencyFloor) {
    return Math.round(maxValue);
  }

  return Math.min(preferredValue, Math.round(maxValue));
}

function readRootFontSize() {
  const root = globalThis.document?.documentElement;

  if (!(root instanceof HTMLElement)) {
    return 16;
  }

  const resolvedValue = Number.parseFloat(globalThis.getComputedStyle(root).fontSize);
  return Number.isFinite(resolvedValue) && resolvedValue > 0 ? resolvedValue : 16;
}

function getMinimizedWidthPx() {
  return Math.round(readRootFontSize() * WINDOW_MINIMIZED_WIDTH_EM);
}

function getViewportSize() {
  return {
    width: Math.max(roundPx(globalThis.window?.innerWidth, 0), WINDOW_EMERGENCY_MIN_WIDTH),
    height: Math.max(roundPx(globalThis.window?.innerHeight, 0), WINDOW_MINIMIZED_HEIGHT + (WINDOW_MARGIN * 2))
  };
}

function getAvailableWindowArea() {
  const viewport = getViewportSize();
  const top = WINDOW_MARGIN;

  return {
    height: Math.max(WINDOW_MINIMIZED_HEIGHT, viewport.height - top - WINDOW_MARGIN),
    left: WINDOW_MARGIN,
    top,
    width: Math.max(WINDOW_EMERGENCY_MIN_WIDTH, viewport.width - (WINDOW_MARGIN * 2))
  };
}

function getExpandedSizeBounds(area = getAvailableWindowArea()) {
  const minWidth = resolveMinimum(area.width, WINDOW_MIN_WIDTH, WINDOW_EMERGENCY_MIN_WIDTH);
  const minHeight = resolveMinimum(area.height, WINDOW_MIN_HEIGHT, WINDOW_EMERGENCY_MIN_HEIGHT);

  return {
    maxHeight: Math.max(minHeight, Math.round(area.height)),
    maxWidth: Math.max(minWidth, Math.round(area.width)),
    minHeight,
    minWidth
  };
}

function getDefaultExpandedSize(area = getAvailableWindowArea()) {
  const bounds = getExpandedSizeBounds(area);

  return {
    height: clamp(Math.round(area.height * DEFAULT_HEIGHT_RATIO), bounds.minHeight, bounds.maxHeight),
    width: clamp(Math.round(area.width * DEFAULT_WIDTH_RATIO), bounds.minWidth, bounds.maxWidth)
  };
}

function getDefaultPosition(size, area = getAvailableWindowArea()) {
  const maxX = area.left + Math.max(0, area.width - size.width);
  const maxY = area.top + Math.max(0, area.height - size.height);

  return {
    x: clamp(maxX - 20, area.left, maxX),
    y: clamp(area.top, area.top, maxY)
  };
}

function clampPosition(position, size, area = getAvailableWindowArea()) {
  const width = Math.max(0, roundPx(size?.width));
  const height = Math.max(0, roundPx(size?.height));
  const maxX = area.left + Math.max(0, area.width - width);
  const maxY = area.top + Math.max(0, area.height - height);

  return {
    x: clamp(roundPx(position?.x, area.left), area.left, maxX),
    y: clamp(roundPx(position?.y, area.top), area.top, maxY)
  };
}

function getNextZIndex() {
  nextWindowZIndex += 1;
  return nextWindowZIndex;
}

function releasePointerCapture(interaction) {
  try {
    interaction?.captureTarget?.releasePointerCapture?.(interaction.pointerId);
  } catch {
    // Ignore release failures from stale or detached capture targets.
  }
}

const model = {
  hasOpenedOnce: false,
  interaction: null,
  isMinimized: false,
  isOpen: false,
  lastExpandedSize: null,
  refs: {},
  size: {
    height: 520,
    width: 720
  },
  position: {
    x: WINDOW_MARGIN,
    y: 88
  },
  zIndex: getNextZIndex(),

  mount(refs = {}) {
    this.refs = refs;

    if (this.hasOpenedOnce || this.isOpen) {
      this.ensureGeometry();
    }
  },

  unmount() {
    this.stopPointer();
    this.refs = {};
  },

  focusWindow() {
    this.zIndex = getNextZIndex();
  },

  resetGeometry() {
    const area = getAvailableWindowArea();
    const defaultSize = getDefaultExpandedSize(area);

    this.size = { ...defaultSize };
    this.lastExpandedSize = { ...defaultSize };
    this.position = getDefaultPosition(defaultSize, area);
  },

  ensureGeometry() {
    if (!this.hasOpenedOnce && !this.isOpen) {
      return;
    }

    const area = getAvailableWindowArea();
    const bounds = getExpandedSizeBounds(area);
    const width = clamp(roundPx(this.size?.width, bounds.maxWidth), bounds.minWidth, bounds.maxWidth);
    const height = clamp(roundPx(this.size?.height, bounds.maxHeight), bounds.minHeight, bounds.maxHeight);

    this.size = { width, height };
    this.lastExpandedSize = { width, height };
    this.position = clampPosition(this.position, this.getPanelSize(), area);
  },

  getPanelSize() {
    const area = getAvailableWindowArea();
    const bounds = getExpandedSizeBounds(area);
    const width = clamp(roundPx(this.size?.width, bounds.maxWidth), bounds.minWidth, bounds.maxWidth);

    if (this.isMinimized) {
      const minimizedWidth = clamp(getMinimizedWidthPx(), Math.min(bounds.minWidth, bounds.maxWidth), bounds.maxWidth);
      return {
        height: Math.min(WINDOW_MINIMIZED_HEIGHT, area.height),
        width: minimizedWidth
      };
    }

    return {
      height: clamp(roundPx(this.size?.height, bounds.maxHeight), bounds.minHeight, bounds.maxHeight),
      width
    };
  },

  openFromMenu() {
    this.isOpen = true;
    this.focusWindow();

    if (!this.hasOpenedOnce) {
      this.hasOpenedOnce = true;
      this.isMinimized = false;
      this.resetGeometry();
      return;
    }

    if (this.isMinimized) {
      this.isMinimized = false;

      if (this.lastExpandedSize) {
        this.size = { ...this.lastExpandedSize };
      }
    }

    this.ensureGeometry();
  },

  closeWindow() {
    this.stopPointer();
    this.isOpen = false;
  },

  toggleMinimized() {
    if (!this.isOpen) {
      this.openFromMenu();
      return;
    }

    this.stopPointer();

    if (this.isMinimized) {
      this.isMinimized = false;

      if (this.lastExpandedSize) {
        this.size = { ...this.lastExpandedSize };
      }
    } else {
      this.lastExpandedSize = { ...this.size };
      this.isMinimized = true;
    }

    this.focusWindow();
    this.ensureGeometry();
  },

  handleViewportResize() {
    if (!this.hasOpenedOnce && !this.isOpen) {
      return;
    }

    this.ensureGeometry();
  },

  startDrag(event) {
    if (!this.isOpen || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.focusWindow();

    const interaction = {
      captureTarget: event.currentTarget,
      originPosition: { ...this.position },
      panelSize: this.getPanelSize(),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      type: "drag"
    };

    interaction.captureTarget?.setPointerCapture?.(event.pointerId);
    this.interaction = interaction;
  },

  startResize(event) {
    if (!this.isOpen || this.isMinimized || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.focusWindow();

    const bounds = getExpandedSizeBounds();
    const interaction = {
      captureTarget: event.currentTarget,
      originSize: {
        height: clamp(roundPx(this.size?.height, bounds.maxHeight), bounds.minHeight, bounds.maxHeight),
        width: clamp(roundPx(this.size?.width, bounds.maxWidth), bounds.minWidth, bounds.maxWidth)
      },
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      type: "resize"
    };

    interaction.captureTarget?.setPointerCapture?.(event.pointerId);
    this.interaction = interaction;
  },

  handlePointerMove(event) {
    const interaction = this.interaction;

    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }

    event.preventDefault();

    if (interaction.type === "drag") {
      this.position = clampPosition({
        x: interaction.originPosition.x + (event.clientX - interaction.startX),
        y: interaction.originPosition.y + (event.clientY - interaction.startY)
      }, interaction.panelSize);
      return;
    }

    const bounds = getExpandedSizeBounds();
    this.size = {
      height: Math.round(clamp(interaction.originSize.height + (event.clientY - interaction.startY), bounds.minHeight, bounds.maxHeight)),
      width: Math.round(clamp(interaction.originSize.width + (event.clientX - interaction.startX), bounds.minWidth, bounds.maxWidth))
    };
    this.lastExpandedSize = { ...this.size };
    this.position = clampPosition(this.position, this.getPanelSize());
  },

  stopPointer(event) {
    const interaction = this.interaction;

    if (!interaction) {
      return;
    }

    if (event && interaction.pointerId !== event.pointerId) {
      return;
    }

    releasePointerCapture(interaction);
    this.interaction = null;
    this.ensureGeometry();
  },

  get panelStyle() {
    const panelSize = this.getPanelSize();

    return {
      height: `${panelSize.height}px`,
      left: `${this.position.x}px`,
      top: `${this.position.y}px`,
      width: `${panelSize.width}px`,
      zIndex: String(this.zIndex)
    };
  }
};

space.fw.createStore(STORE_NAME, model);
