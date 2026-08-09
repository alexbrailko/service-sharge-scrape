let cachedUserAgent: string | null = null;

const buildUserAgentMetadata = (userAgent: string) => {
  const major = (userAgent.match(/Chrome\/(\d+)/) || [])[1] || '';
  const full = (userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '';
  if (!major) return undefined;

  return {
    brands: [
      { brand: 'Not_A Brand', version: '8' },
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
    ],
    fullVersion: full,
    platform: process.platform === 'win32' ? 'Windows' : 'Linux',
    platformVersion: '',
    architecture: 'x86',
    model: '',
    mobile: false,
  };
};

export const initUserAgent = async (browser: any): Promise<void> => {
  try {
    const raw = await browser.userAgent();
    if (!raw) return;
    cachedUserAgent = raw.replace(/HeadlessChrome/g, 'Chrome');
    if (cachedUserAgent !== raw) {
      console.log(`User agent normalised to: ${cachedUserAgent}`);
    }
  } catch (e) {
    console.log('initUserAgent failed:', (e as Error)?.message || e);
  }
};

const WEBGL_VENDOR = process.env.FP_WEBGL_VENDOR || 'Intel Inc.';
const WEBGL_RENDERER =
  process.env.FP_WEBGL_RENDERER || 'Intel Iris OpenGL Engine';

const hardenScript = (vendor: string, renderer: string) => {
  const w = window as any;
  if (w.__hardened) return;
  w.__hardened = true;

  const patchGetParameter = (proto: any) => {
    if (!proto || !proto.getParameter) return;
    const original = proto.getParameter;
    proto.getParameter = function (parameter: number) {
      if (parameter === 37445) return vendor;
      if (parameter === 37446) return renderer;
      return original.call(this, parameter);
    };
  };

  patchGetParameter(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype);
  patchGetParameter(
    w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype
  );

  if (!w.chrome) {
    w.chrome = { runtime: {} };
  }

  try {
    const permissions = window.navigator.permissions;
    const originalQuery = permissions.query.bind(permissions);
    permissions.query = (params: any) =>
      params && params.name === 'notifications'
        ? Promise.resolve({
            state: Notification.permission,
            name: 'notifications',
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return false;
            },
          } as any)
        : originalQuery(params);
  } catch (e) {}

  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      const plugins = [
        {
          name: 'PDF Viewer',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
        },
        {
          name: 'Chrome PDF Viewer',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
        },
        {
          name: 'Chromium PDF Viewer',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
        },
      ];
      Object.defineProperty(navigator, 'plugins', {
        get: () => plugins,
        configurable: true,
      });
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => [
          {
            type: 'application/pdf',
            suffixes: 'pdf',
            description: 'Portable Document Format',
          },
        ],
        configurable: true,
      });
    }
  } catch (e) {}

  try {
    if (!window.outerWidth || !window.outerHeight) {
      Object.defineProperty(window, 'outerWidth', {
        get: () => window.innerWidth,
        configurable: true,
      });
      Object.defineProperty(window, 'outerHeight', {
        get: () => window.innerHeight + 85,
        configurable: true,
      });
    }
  } catch (e) {}
};

export const hardenPage = async (page: any): Promise<void> => {
  if (!page || typeof page.evaluateOnNewDocument !== 'function') return;

  if (cachedUserAgent) {
    try {
      await page.setUserAgent(
        cachedUserAgent,
        buildUserAgentMetadata(cachedUserAgent)
      );
    } catch (e) {
      console.log('setUserAgent failed:', (e as Error)?.message || e);
    }
  }

  try {
    await page.evaluateOnNewDocument(
      hardenScript,
      WEBGL_VENDOR,
      WEBGL_RENDERER
    );
  } catch (e) {
    console.log('hardenPage failed (non-fatal):', (e as Error)?.message || e);
  }
};

export const hardenBrowser = async (browser: any): Promise<void> => {
  if (!browser || typeof browser.on !== 'function') return;
  await initUserAgent(browser);
  browser.on('targetcreated', async (target: any) => {
    try {
      if (target.type() !== 'page') return;
      const page = await target.page();
      if (page) await hardenPage(page);
    } catch (e) {}
  });
};
