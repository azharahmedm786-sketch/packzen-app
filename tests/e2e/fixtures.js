const { test: base, expect } = require('@playwright/test');

exports.test = base.extend({
  context: async ({ browser }, use) => {
    const context = await browser.newContext();

    const ciDebugToken = process.env.APP_CHECK_CI_DEBUG_TOKEN;
    if (ciDebugToken) {
      await context.addInitScript((token) => {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
        window.__PACKZEN_CI_DEBUG_INITIALIZED = true;
      }, ciDebugToken);
    }

    await use(context);
    await context.close();
  },
});
exports.expect = expect;
