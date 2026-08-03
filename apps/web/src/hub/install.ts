// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The "install" affordance, on the hub only.
 *
 * WHY IT IS NOT SIMPLY A BUTTON
 *
 * Exactly one browser family lets a page offer installation in a single tap:
 * Chromium, through the non-standard `beforeinstallprompt` event. Safari fires
 * nothing at all, so a lifter on an iPhone -- which is most of the phones these
 * tools are opened from -- has to already know to reach for Share and then Add
 * to Home Screen. The first version of this was a button and nothing else, which
 * meant the offer did not exist on iOS and was a permanent card everywhere else.
 *
 * So there are two halves and they are independent. A folded line of
 * instructions is always present, because it is true on every platform and costs
 * one row when shut. The real button is rendered above it only once a browser has
 * actually handed over an event to use, never as decoration -- so it can never be
 * tapped and do nothing. No user-agent sniffing, and no timer waiting to find out
 * whether an event is coming.
 *
 * WHAT WENT WRONG BEFORE, BECAUSE THE SHAPE OF IT WILL RECUR
 *
 * The card was built hidden and revealed on the event, which was right, and the
 * stylesheet said `.install-prompt { display: grid }`, which quietly beat the
 * `hidden` attribute's `display: none`. So the card sat on screen permanently
 * with a button holding no event behind it, and tapping it did nothing -- on
 * every browser, including the one that could have installed the site. The unit
 * test asserted `container.hidden === true` and passed, because the property was
 * never what was broken. Two things stop a repeat: `tokens.css` now carries a
 * `[hidden]` reset that wins, and the tests beside this file measure computed
 * style rather than the property.
 */
import '@platform-toolkit/ui';

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
 * The parts of `window` this needs.
 *
 * Narrow on purpose, so a test can hand over a plain object. The alternative --
 * a proxy over the real window -- does not work: native window methods throw
 * when their receiver is anything but a real Window, so the proxy would have to
 * bind every one of them and would stop being a simple stand-in.
 */
export interface InstallHost {
  matchMedia: (query: string) => { readonly matches: boolean };
  addEventListener: Window['addEventListener'];
}

/**
 * Safari's own answer to "am I installed", from before `display-mode` existed.
 *
 * An intersection with `Navigator` rather than a lone optional property, because
 * an interface whose every member is optional is a "weak type": nothing without
 * one of its properties may be assigned to it, and the real `navigator` has
 * none, so `navigator` itself would be rejected.
 */
type MaybeStandaloneNavigator = Navigator & {
  readonly standalone?: boolean;
};

/**
 * True when this page is already running as the installed application.
 *
 * Three display modes rather than one, because a manifest may ask for
 * `minimal-ui` or `fullscreen`, and being offered the chance to install an app
 * from inside that app is the kind of thing that makes a tool look abandoned.
 */
function alreadyInstalled(
  host: InstallHost,
  navigatorLike: MaybeStandaloneNavigator = navigator,
): boolean {
  const displayed = host.matchMedia(
    '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)',
  ).matches;
  return displayed || navigatorLike.standalone === true;
}

/**
 * Builds the affordance and starts listening immediately.
 *
 * The listener is registered as this runs rather than when the element is
 * attached: the browser fires the event once, early, and a listener added after
 * it has fired never hears about it again for the life of the page.
 */
export function createInstallPrompt(host: InstallHost = window): HTMLElement {
  const container = document.createElement('section');
  container.className = 'install-prompt';

  // Nothing to offer somebody reading this inside the installed app. Decided
  // once, at construction, because the display mode does not change under a
  // visitor without a navigation -- and returning here also means an installed
  // page registers no listeners at all.
  if (alreadyInstalled(host)) {
    container.hidden = true;
    return container;
  }

  const button = document.createElement('ptk-button');
  button.variant = 'primary';
  button.textContent = 'Install';
  // Hidden rather than absent, so revealing it is one attribute rather than a
  // second construction path that has to agree with this one. A button with no
  // event behind it is never on screen: that is the whole of the repair.
  button.hidden = true;

  const help = document.createElement('ptk-disclosure');
  // Attributes rather than properties, unlike the button above. Neither `label`
  // nor `summary` reflects -- there is no reason for them to -- so assigning the
  // property leaves nothing in the markup, and every other fold in the toolkit
  // comes from a Lit template where the attribute is written out. The narrow-
  // layout check names folds by `[label="..."]`, and a fold that is invisible to
  // that selector is one the check silently stops opening.
  help.setAttribute('label', 'Install the toolkit');
  help.setAttribute('summary', 'Opens without browser chrome and works when the gym has no signal');

  const steps = document.createElement('p');
  // Named by browser rather than by platform, because the browser is what the
  // visitor is looking at. Both sentences are true wherever they are read, which
  // is why neither is chosen by sniffing -- a wrong guess about the platform is
  // worse than one extra line of text.
  steps.textContent =
    'On iPhone or iPad, tap Share and then Add to Home Screen. On Android or a desktop browser, open the browser menu and choose Install.';
  help.append(steps);

  container.append(button, help);

  /** The saved event. A browser hands it over once, and it can be used once. */
  let pending: BeforeInstallPromptEvent | null = null;

  host.addEventListener('beforeinstallprompt', (event) => {
    // Suppresses the browser's own bar so there are not two offers on screen,
    // and is what makes the event reusable later from the button.
    event.preventDefault();
    pending = event;
    button.hidden = false;
  });

  host.addEventListener('appinstalled', () => {
    pending = null;
    // The whole section, not just the button. The instructions are no use either
    // once the thing they describe has been done.
    container.hidden = true;
  });

  button.addEventListener('click', () => {
    const prompt = pending;
    if (prompt === null) return;

    // Cleared before the prompt resolves, not after. The event is spent the
    // moment it is used, and a second tap while the dialog is open would
    // otherwise call `prompt()` on a consumed event, which rejects.
    pending = null;
    // Only the button goes. Somebody who dismisses the browser's dialog and then
    // changes their mind still needs the manual route, and it is still below.
    button.hidden = true;

    prompt.prompt().then(
      () => undefined,
      (error: unknown) => {
        // The visitor is not told: they either saw the browser's dialog or they
        // did not, and a page-level error about an install offer is noise. The
        // outcome of the choice is deliberately never read or reported --
        // whether somebody installed the site is not this project's business.
        console.error(
          'The install prompt could not be shown.',
          error instanceof Error ? error.name : 'unknown',
        );
      },
    );
  });

  return container;
}
