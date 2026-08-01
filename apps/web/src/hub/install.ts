/**
 * The "install" affordance, on the hub only.
 *
 * Browsers that support installation already offer it somewhere in a menu, so
 * this is not the only route -- it is the visible one, and on Android it is the
 * difference between a lifter having the tools on their home screen and not
 * knowing they could. On iOS the event below never fires and no button appears;
 * Safari's own Share menu is the only way, and inventing a button that cannot do
 * anything would be worse than not having one.
 */

/**
 * The event Chromium fires when it is willing to install the site.
 *
 * Not in the DOM lib, because it is not in any specification -- it is a de-facto
 * standard implemented by Chromium and by nothing else. Declaring the shape here
 * rather than casting keeps the one place that depends on a non-standard API
 * honest about it.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}

/**
 * Builds the prompt, hidden, and starts listening immediately.
 *
 * The listener is registered as this runs rather than when the element is
 * attached: the browser fires the event once, early, and a listener added after
 * it has fired never hears about it again for the life of the page.
 */
export function createInstallPrompt(): HTMLElement {
  const container = document.createElement('section');
  container.className = 'install-prompt';
  // Hidden rather than absent so that revealing it is one attribute and not a
  // second construction path that has to agree with this one.
  container.hidden = true;

  const explanation = document.createElement('p');
  explanation.textContent =
    'Add the toolkit to your home screen. It opens without browser chrome and keeps working when the gym has no signal.';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Install';

  container.append(explanation, button);

  /** The saved event. A browser hands it over once, and it can be used once. */
  let pending: BeforeInstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppresses the browser's own bar so there are not two offers on screen,
    // and is what makes the event reusable later from the button.
    event.preventDefault();
    pending = event;
    container.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    pending = null;
    container.hidden = true;
  });

  button.addEventListener('click', () => {
    const prompt = pending;
    if (prompt === null) return;

    // Cleared before the prompt resolves, not after. The event is spent the
    // moment it is used, and a second click while the dialog is open would
    // otherwise call `prompt()` on a consumed event, which rejects.
    pending = null;
    container.hidden = true;

    prompt.prompt().then(
      () => undefined,
      (error: unknown) => {
        // The visitor is not told: they either saw the browser's dialog or they
        // did not, and a page-level error about an install offer is noise. The
        // outcome of the choice is deliberately not read or reported -- whether
        // somebody installed the site is not this project's business.
        console.error(
          'The install prompt could not be shown.',
          error instanceof Error ? error.name : 'unknown',
        );
      },
    );
  });

  return container;
}
