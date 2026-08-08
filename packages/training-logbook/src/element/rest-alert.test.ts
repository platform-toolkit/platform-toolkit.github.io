// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What each channel does when the device says yes, no, and nothing at all.
 *
 * In Node against a device made of three closures, which is the whole reason the port
 * exists: the interesting cases here are a dismissed permission prompt, a constructor
 * that throws, and a vibration API that accepts a pattern and does nothing -- none of
 * which a real browser can be talked into on demand.
 *
 * The rule under most of it: a channel that was refused must be distinguishable from a
 * channel that never answered, and neither may be reported as having worked.
 */

import { describe, expect, it, vi } from 'vitest';

import type { RestAlertSettings } from '../types.js';

import {
  createRestAlerter,
  withChannel,
  type RestAlertDevice,
  type RestNotifier,
  type RestNotifyPermission,
} from './rest-alert.js';

const NOTHING_ON: RestAlertSettings = { sound: false, vibrate: false, notify: false };
const ALL_ON: RestAlertSettings = { sound: true, vibrate: true, notify: true };

const TITLE = 'Rest is up.';

/** A notifier that starts at one permission and answers a request with another. */
function notifier(
  from: RestNotifyPermission,
  answer: RestNotifyPermission = from,
  post: (title: string) => void = () => undefined,
): RestNotifier & { readonly posts: string[] } {
  const posts: string[] = [];
  let permission = from;
  return {
    posts,
    permission: () => permission,
    request: () => {
      permission = answer;
      return Promise.resolve(answer);
    },
    post: (title) => {
      posts.push(title);
      post(title);
    },
  };
}

/** A device that can do everything, unless one of the three is overridden. */
function device(overrides: Partial<RestAlertDevice> = {}): RestAlertDevice {
  return {
    tone: () => Promise.resolve(true),
    vibrate: () => true,
    notifications: notifier('granted'),
    ...overrides,
  };
}

describe('which channels are offered', () => {
  it('offers only the ones this device has an API for', () => {
    const alerter = createRestAlerter({ vibrate: () => true });
    expect(alerter.channels).toEqual(['vibrate']);
  });

  it('offers none at all rather than failing, on a device that can do nothing', () => {
    // The desktop-Safari-in-a-frame case. Section 0.4: the band draws no control at
    // all here, which is why this has to be an empty list and not three dead options.
    expect(createRestAlerter({}).channels).toEqual([]);
  });

  it('never reports an unsupported channel as refused, because it never offers it', async () => {
    const alerter = createRestAlerter({ tone: () => Promise.resolve(true) });
    expect(await alerter.fire(ALL_ON, TITLE)).toEqual([]);
  });
});

describe('arming a channel', () => {
  it('fires the channel it just switched on, so a refusal is found at the press', async () => {
    const tone = vi.fn(() => Promise.resolve(true));
    const alerter = createRestAlerter(device({ tone }));
    expect(await alerter.arm('sound', TITLE)).toBe('delivered');
    expect(tone).toHaveBeenCalledOnce();
  });

  it('reports a tone the browser would not start as a refusal', async () => {
    const alerter = createRestAlerter(device({ tone: () => Promise.resolve(false) }));
    expect(await alerter.arm('sound', TITLE)).toBe('refused');
  });

  it('reports a tone that threw as unknown, because nothing was said either way', async () => {
    const alerter = createRestAlerter(
      device({
        tone: () => {
          throw new Error('no audio');
        },
      }),
    );
    expect(await alerter.arm('sound', TITLE)).toBe('unknown');
  });

  it('buzzes twice with a gap, so it is not read as another message', async () => {
    const vibrate = vi.fn(() => true);
    const alerter = createRestAlerter(device({ vibrate }));
    expect(await alerter.arm('vibrate', TITLE)).toBe('delivered');
    expect(vibrate).toHaveBeenCalledWith([180, 90, 180]);
  });

  it('reports a pattern the device would not take as a refusal', async () => {
    const alerter = createRestAlerter(device({ vibrate: () => false }));
    expect(await alerter.arm('vibrate', TITLE)).toBe('refused');
  });

  it('asks for notification permission, and shows one when it is given', async () => {
    const notifications = notifier('default', 'granted');
    const alerter = createRestAlerter(device({ notifications }));
    expect(await alerter.arm('notify', TITLE)).toBe('delivered');
    expect(notifications.posts).toEqual([TITLE]);
  });

  it('does not ask again once permission is already granted', async () => {
    const notifications = notifier('granted');
    const request = vi.spyOn(notifications, 'request');
    const alerter = createRestAlerter(device({ notifications }));
    expect(await alerter.arm('notify', TITLE)).toBe('delivered');
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a blocked site as refused, and shows nothing', async () => {
    const notifications = notifier('denied');
    const alerter = createRestAlerter(device({ notifications }));
    expect(await alerter.arm('notify', TITLE)).toBe('refused');
    expect(notifications.posts).toEqual([]);
  });

  it('reports a dismissed prompt as unknown, which is not a refusal', async () => {
    // The distinction the whole outcome type exists for. A prompt swiped away leaves
    // the permission at `default`, and telling the lifter they refused something they
    // never read is how a tool loses an argument it should not be having.
    const notifications = notifier('default', 'default');
    const alerter = createRestAlerter(device({ notifications }));
    expect(await alerter.arm('notify', TITLE)).toBe('unknown');
    expect(notifications.posts).toEqual([]);
  });

  it('reports a request that threw as unknown', async () => {
    const alerter = createRestAlerter(
      device({
        notifications: {
          permission: () => 'default',
          request: () => Promise.reject(new Error('not allowed here')),
          post: () => undefined,
        },
      }),
    );
    expect(await alerter.arm('notify', TITLE)).toBe('unknown');
  });

  it('reports a granted permission whose notification would not construct', async () => {
    // Android's Chrome, which takes the permission and then refuses the constructor.
    // Caught at the press, so the switch goes back off in front of the lifter.
    const notifications = notifier('granted', 'granted', () => {
      throw new TypeError('Illegal constructor');
    });
    const alerter = createRestAlerter(device({ notifications }));
    expect(await alerter.arm('notify', TITLE)).toBe('unknown');
  });

  it('reports a channel this device does not have as unknown', async () => {
    const alerter = createRestAlerter({ vibrate: () => true });
    expect(await alerter.arm('sound', TITLE)).toBe('unknown');
  });
});

describe('firing when the rest is up', () => {
  it('says nothing on a channel that is switched off', async () => {
    const tone = vi.fn(() => Promise.resolve(true));
    const vibrate = vi.fn(() => true);
    const alerter = createRestAlerter(device({ tone, vibrate }));
    await alerter.fire({ ...NOTHING_ON, sound: true }, TITLE);
    expect(tone).toHaveBeenCalledOnce();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('reports nothing when every channel that is on did its job', async () => {
    const alerter = createRestAlerter(device());
    expect(await alerter.fire(ALL_ON, TITLE)).toEqual([]);
  });

  it('never asks for permission, because there is no press behind a countdown', async () => {
    const notifications = notifier('default', 'granted');
    const request = vi.spyOn(notifications, 'request');
    const alerter = createRestAlerter(device({ notifications }));

    const trouble = await alerter.fire({ ...NOTHING_ON, notify: true }, TITLE);

    expect(request).not.toHaveBeenCalled();
    expect(notifications.posts).toEqual([]);
    expect(trouble).toEqual([{ channel: 'notify', failure: 'unknown' }]);
  });

  it('reports a permission taken back since it was armed', async () => {
    const alerter = createRestAlerter(device({ notifications: notifier('denied') }));
    expect(await alerter.fire({ ...NOTHING_ON, notify: true }, TITLE)).toEqual([
      { channel: 'notify', failure: 'refused' },
    ]);
  });

  it('reports each channel that failed and none of the ones that did not', async () => {
    const alerter = createRestAlerter(
      device({ tone: () => Promise.resolve(false), notifications: notifier('denied') }),
    );
    expect(await alerter.fire(ALL_ON, TITLE)).toEqual([
      { channel: 'sound', failure: 'refused' },
      { channel: 'notify', failure: 'refused' },
    ]);
  });

  it('says what it was given, so the sentence on screen and the notification agree', async () => {
    const notifications = notifier('granted');
    const alerter = createRestAlerter(device({ notifications }));
    await alerter.fire({ ...NOTHING_ON, notify: true }, TITLE);
    expect(notifications.posts).toEqual([TITLE]);
  });
});

describe('withChannel', () => {
  it('changes one channel and leaves the others where they were', () => {
    expect(withChannel({ ...NOTHING_ON, vibrate: true }, 'sound', true)).toEqual({
      sound: true,
      vibrate: true,
      notify: false,
    });
  });

  it('returns a new object rather than writing into the settings it was given', () => {
    const before = { ...NOTHING_ON };
    withChannel(before, 'sound', true);
    expect(before.sound).toBe(false);
  });
});
