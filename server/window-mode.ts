import type { Page } from 'patchright'

/**
 * Akamai refuses truly headless Chrome, but a normal Chrome window placed off-screen looks
 * like any desktop browser. Ratline keeps its browsers there and only brings a window on
 * screen when the user has to log in. RATLINE_BROWSER_WINDOW=visible restores the old behaviour.
 */
export const BACKGROUND_WINDOW = process.env.RATLINE_BROWSER_WINDOW !== 'visible'

const OFF_SCREEN = { left: -32000, top: -32000 }
const ON_SCREEN = { left: 80, top: 60, width: 1280, height: 860 }

/** Chrome flags: start off-screen and keep rendering/timers at full speed while hidden. */
export const windowArgs = (): string[] => (BACKGROUND_WINDOW
  ? [
    `--window-position=${OFF_SCREEN.left},${OFF_SCREEN.top}`,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ]
  : [])

const moveWindow = async (page: Page, bounds: Record<string, number>): Promise<void> => {
  const session = await page.context().newCDPSession(page)
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget') as { windowId: number }
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    await session.send('Browser.setWindowBounds', { windowId, bounds })
  } finally {
    await session.detach().catch(() => undefined)
  }
}

/** Bring the window in front of the user (login needs a human). */
export const showWindow = async (page: Page): Promise<void> => {
  if (!BACKGROUND_WINDOW) return
  await moveWindow(page, ON_SCREEN).catch(() => undefined)
  await page.bringToFront().catch(() => undefined)
}

/**
 * Put the window back out of sight once the human part is done. Chrome clamps windows that
 * are moved off-screen after launch, so minimise it (throttling is disabled via windowArgs).
 */
export const hideWindow = async (page: Page): Promise<void> => {
  if (!BACKGROUND_WINDOW) return
  const session = await page.context().newCDPSession(page)
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget') as { windowId: number }
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
  } catch {
    // Window controls unavailable (e.g. CDP-attached browser): leaving it visible is harmless.
  } finally {
    await session.detach().catch(() => undefined)
  }
}
