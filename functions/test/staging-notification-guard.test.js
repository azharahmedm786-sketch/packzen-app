/**
 * functions/test/staging-notification-guard.test.js
 * -------------------------------------------------------------
 * PackZen 3.0 Automated Test Suite for Staging Notification Isolation (Phase 2)
 *
 * Verifies:
 *  1. Production passthrough (only for packzen-e7539 and not in an emulator).
 *  2. Staging default simulation (packzen-staging-3 defaults to fail-closed).
 *  3. Emulator default simulation (FUNCTIONS_EMULATOR=true defaults to fail-closed).
 *  4. Unknown / ambiguous environment fail-closed handling.
 *  5. Kill switch override requirements (only explicit 'false' allows delivery).
 *  6. Exact email, phone, and webhook allowlist matching.
 *  7. Direct adapter interception (Brevo, WhatsApp, MSG91, n8n webhook).
 *  8. Multi-channel outbox dispatch coordination and status progression.
 *  9. Safe simulated response structure and distinct 'simulated_sent' status.
 * 10. Zero external network transmission during simulation.
 * -------------------------------------------------------------
 */
"use strict";

const assert = require("assert");
const path = require("path");
const { describe, it, beforeEach } = require("node:test");

const guard = require("../staging-notification-guard");
const brevoClient = require("../brevo-client");
const channelWhatsApp = require("../channel-whatsapp");
const channelWebhook = require("../channel-webhook");
const automationDispatcher = require("../automation-dispatcher");

describe("PACKZEN 3.0 — PHASE 2 NOTIFICATION ISOLATION SUITE", () => {

  // -----------------------------------------------------------
  // 1. Environment Detection & Production Passthrough
  // -----------------------------------------------------------
  describe("1. Environment Detection & Production Passthrough", () => {
    it("1.1 Identifies production project 'packzen-e7539' and passes through", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "email", recipient: "customer@gmail.com" },
        { env: { GCLOUD_PROJECT: "packzen-e7539" } }
      );
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.simulated, false);
      assert.strictEqual(res.mode, "production_live");
    });

    it("1.2 Blocks production passthrough if running inside an emulator", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "email", recipient: "customer@gmail.com" },
        { env: { GCLOUD_PROJECT: "packzen-e7539", FUNCTIONS_EMULATOR: "true" } }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "KILL_SWITCH_ACTIVE");
    });

    it("1.3 Defaults staging project 'packzen-staging-3' to simulation", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "email", recipient: "customer@gmail.com" },
        { env: { GCLOUD_PROJECT: "packzen-staging-3" } }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "KILL_SWITCH_ACTIVE");
    });

    it("1.4 Defaults unknown project ID to fail-closed simulation", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "whatsapp", recipient: "919945095453" },
        { env: { GCLOUD_PROJECT: "unknown-staging-project" } }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "KILL_SWITCH_ACTIVE");
    });

    it("1.5 Fails closed when conflicting environment variables are detected", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "email", recipient: "customer@gmail.com" },
        {
          env: {
            GCLOUD_PROJECT: "packzen-e7539",
            GOOGLE_CLOUD_PROJECT: "packzen-staging-3"
          }
        }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "AMBIGUOUS_ENVIRONMENT_CONFLICT");
    });
  });

  // -----------------------------------------------------------
  // 2. Kill Switch Override Requirements
  // -----------------------------------------------------------
  describe("2. Kill Switch Override Requirements", () => {
    it("2.1 Default when unset is fail-closed (kill switch active)", () => {
      const active = guard.isKillSwitchActive({ env: {} });
      assert.strictEqual(active, true);
    });

    it("2.2 Active when set to 'true', '1', empty, or malformed strings", () => {
      assert.strictEqual(guard.isKillSwitchActive({ env: { STAGING_NOTIFICATION_KILL_SWITCH: "true" } }), true);
      assert.strictEqual(guard.isKillSwitchActive({ env: { STAGING_NOTIFICATION_KILL_SWITCH: "1" } }), true);
      assert.strictEqual(guard.isKillSwitchActive({ env: { STAGING_NOTIFICATION_KILL_SWITCH: "" } }), true);
      assert.strictEqual(guard.isKillSwitchActive({ env: { STAGING_NOTIFICATION_KILL_SWITCH: "yes" } }), true);
      assert.strictEqual(guard.isKillSwitchActive({ env: { STAGING_NOTIFICATION_KILL_SWITCH: "0" } }), true);
    });

    it("2.3 Disengaged only when set explicitly to string 'false' or boolean false", () => {
      assert.strictEqual(guard.isKillSwitchActive({ env: { STAGING_NOTIFICATION_KILL_SWITCH: "false" } }), false);
      assert.strictEqual(guard.isKillSwitchActive({ env: { STAGING_NOTIFICATION_KILL_SWITCH: "FALSE" } }), false);
      assert.strictEqual(guard.isKillSwitchActive({ killSwitch: false }), false);
    });
  });

  // -----------------------------------------------------------
  // 3. Strict Recipient & Host Allowlists
  // -----------------------------------------------------------
  describe("3. Strict Recipient & Host Allowlists", () => {
    const stagingEnvWithKillSwitchOff = {
      GCLOUD_PROJECT: "packzen-staging-3",
      STAGING_NOTIFICATION_KILL_SWITCH: "false",
      STAGING_ALLOWED_EMAILS: "qa-lead@external.com, dev-test@gmail.com",
      STAGING_ALLOWED_DOMAINS: "packzenblr.in",
      STAGING_ALLOWED_PHONES: "919945095453, 919876543210",
      STAGING_ALLOWED_WEBHOOK_HOSTS: "n8n-staging.packzenblr.in, localhost"
    };

    // 3.1 Email matching
    it("3.1.1 Permits allowlisted domain @packzenblr.in when kill switch is false", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "email", recipient: "test.user@packzenblr.in" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.mode, "staging_allowlisted_live");
    });

    it("3.1.2 Permits exact allowlisted email address", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "email", recipient: "qa-lead@external.com" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.mode, "staging_allowlisted_live");
    });

    it("3.1.3 Rejects and simulates non-allowlisted email addresses", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "email", recipient: "victim-customer@gmail.com" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "RECIPIENT_NOT_ALLOWLISTED");
    });

    it("3.1.4 Rejects domain spoofing attempts (e.g. evil-packzenblr.in)", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "email", recipient: "attacker@fake-packzenblr.in" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "RECIPIENT_NOT_ALLOWLISTED");
    });

    // 3.2 Phone matching
    it("3.2.1 Permits allowlisted normalized E.164 phone numbers", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "whatsapp", recipient: "+91 99450 95453" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.mode, "staging_allowlisted_live");
    });

    it("3.2.2 Rejects and simulates non-allowlisted phone numbers", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "sms", recipient: "+91 99999 88888" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "RECIPIENT_NOT_ALLOWLISTED");
    });

    // 3.3 Webhook matching
    it("3.3.1 Permits allowlisted HTTPS webhook host", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "webhook", recipient: "https://n8n-staging.packzenblr.in/webhook/test" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.mode, "staging_allowlisted_live");
    });

    it("3.3.2 Rejects non-allowlisted webhook host", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "webhook", recipient: "https://production-n8n.railway.app/webhook/live" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "WEBHOOK_HOST_NOT_ALLOWLISTED");
    });

    it("3.3.3 Rejects insecure HTTP webhook for non-localhost hosts", () => {
      const res = guard.evaluateOutboundTarget(
        { channel: "webhook", recipient: "http://n8n-staging.packzenblr.in/webhook/test" },
        { env: stagingEnvWithKillSwitchOff }
      );
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.simulated, true);
      assert.strictEqual(res.reason, "WEBHOOK_HOST_NOT_ALLOWLISTED");
    });
  });

  // -----------------------------------------------------------
  // 4. Direct Channel Adapter Interception & Simulated Contracts
  // -----------------------------------------------------------
  describe("4. Direct Channel Adapter Interception", () => {
    const stagingEnv = {
      GCLOUD_PROJECT: "packzen-staging-3",
      STAGING_NOTIFICATION_KILL_SWITCH: "true"
    };

    it("4.1 Brevo client intercepts delivery and returns simulated_sent outcome", async () => {
      // In staging with kill switch active:
      const origEnv = process.env.GCLOUD_PROJECT;
      const origKs = process.env.STAGING_NOTIFICATION_KILL_SWITCH;
      try {
        process.env.GCLOUD_PROJECT = "packzen-staging-3";
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = "true";

        const res = await brevoClient.sendBrevoEmail({
          toEmail: "real-customer@yahoo.com",
          toName: "Customer Name",
          subject: "Your Booking Details",
          htmlContent: "<p>Hello</p>"
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.simulated, true);
        assert.strictEqual(res.status, "simulated_sent");
        assert.strictEqual(res.provider, "brevo_simulated");
        assert.ok(res.messageId && res.messageId.startsWith("sim_brevo_"));
        assert.ok(res.response && res.response.messageId);
      } finally {
        process.env.GCLOUD_PROJECT = origEnv;
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = origKs;
      }
    });

    it("4.2 Meta WhatsApp adapter intercepts delivery and returns simulated_sent outcome", async () => {
      const origEnv = process.env.GCLOUD_PROJECT;
      const origKs = process.env.STAGING_NOTIFICATION_KILL_SWITCH;
      const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      try {
        process.env.GCLOUD_PROJECT = "packzen-staging-3";
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = "true";
        process.env.WHATSAPP_ACCESS_TOKEN = "test_wa_token_staging";
        process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";

        const res = await channelWhatsApp.sendWhatsAppTemplateMessage({
          toPhone: "919876543210",
          templateName: "booking_confirmation_v1",
          components: []
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.simulated, true);
        assert.strictEqual(res.status, "simulated_sent");
        assert.ok(res.messageId && res.messageId.startsWith("sim_wamid_"));
        assert.ok(res.response && res.response.messages[0].id);
      } finally {
        process.env.GCLOUD_PROJECT = origEnv;
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = origKs;
        process.env.WHATSAPP_ACCESS_TOKEN = origToken;
        process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
      }
    });

    it("4.3 n8n Webhook adapter intercepts delivery and returns simulated_sent outcome", async () => {
      const origEnv = process.env.GCLOUD_PROJECT;
      const origKs = process.env.STAGING_NOTIFICATION_KILL_SWITCH;
      const origUrl = process.env.N8N_WEBHOOK_URL;
      const origSecret = process.env.N8N_WEBHOOK_SECRET;
      try {
        process.env.GCLOUD_PROJECT = "packzen-staging-3";
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = "true";
        process.env.N8N_WEBHOOK_URL = "https://n8n.railway.app/webhook/live";
        process.env.N8N_WEBHOOK_SECRET = "test_staging_secret";

        const res = await channelWebhook.dispatchWebhookEvent({
          eventId: "evt_12345",
          eventName: "booking.created",
          entityType: "booking",
          entityId: "bk_999",
          division: "logistics",
          payload: { bookingRef: "BK-999" }
        }, { webhookUrl: "https://n8n.railway.app/webhook/live", webhookSecret: "test_staging_secret" });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.simulated, true);
        assert.strictEqual(res.channel, "webhook");
        assert.strictEqual(res.result.status, "simulated_sent");
        assert.strictEqual(res.result.provider, "n8n_simulated");
      } finally {
        process.env.GCLOUD_PROJECT = origEnv;
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = origKs;
        process.env.N8N_WEBHOOK_URL = origUrl;
        process.env.N8N_WEBHOOK_SECRET = origSecret;
      }
    });
  });

  // -----------------------------------------------------------
  // 5. Transactional Outbox & Multi-Channel State Transitions
  // -----------------------------------------------------------
  describe("5. Outbox & Multi-Channel State Transitions", () => {
    it("5.1 Outbox email dispatch records simulated_sent and does not fail", async () => {
      const origEnv = process.env.GCLOUD_PROJECT;
      const origKs = process.env.STAGING_NOTIFICATION_KILL_SWITCH;
      try {
        process.env.GCLOUD_PROJECT = "packzen-staging-3";
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = "true";

        const claimedEvent = {
          eventId: "evt_email_001",
          eventName: "booking.created",
          channel: "email",
          payload: {
            customerEmail: "unallowlisted-customer@gmail.com",
            customerName: "Jane Doe",
            bookingRef: "BK-TEST-1"
          }
        };

        const res = await automationDispatcher.dispatchEmail(claimedEvent);
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.simulated, true);
        assert.strictEqual(res.result.status, "simulated_sent");
        assert.strictEqual(res.result.provider, "brevo_simulated");
        assert.ok(res.result.messageId.startsWith("sim_brevo_"));
      } finally {
        process.env.GCLOUD_PROJECT = origEnv;
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = origKs;
      }
    });

    it("5.2 Multi-channel dispatcher completes with all channels marked simulated_sent", async () => {
      const origEnv = process.env.GCLOUD_PROJECT;
      const origKs = process.env.STAGING_NOTIFICATION_KILL_SWITCH;
      const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      try {
        process.env.GCLOUD_PROJECT = "packzen-staging-3";
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = "true";
        process.env.WHATSAPP_ACCESS_TOKEN = "test_wa_token_staging";
        process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";

        const claimedEvent = {
          eventId: "evt_multi_001",
          eventName: "booking.created",
          channel: "multi_channel",
          division: "logistics",
          targetChannels: ["email", "whatsapp", "webhook"],
          payload: {
            customerEmail: "unallowlisted-customer@gmail.com",
            customerPhone: "919876543210",
            customerName: "Jane Doe",
            bookingRef: "BK-TEST-1",
            total: 3500
          }
        };

        const res = await automationDispatcher.dispatchMultiChannel(claimedEvent, {
          includeWebhook: true,
          configOverride: {
            webhookUrl: "https://n8n.railway.app/webhook/test",
            webhookSecret: "test-secret"
          }
        });

        assert.strictEqual(res.success, true);
        assert.ok(res.channelDeliveries);
        assert.strictEqual(res.channelDeliveries.email.status, "simulated_sent");
        assert.strictEqual(res.channelDeliveries.whatsapp.status, "simulated_sent");
        assert.strictEqual(res.channelDeliveries.webhook.status, "simulated_sent");
      } finally {
        process.env.GCLOUD_PROJECT = origEnv;
        process.env.STAGING_NOTIFICATION_KILL_SWITCH = origKs;
        process.env.WHATSAPP_ACCESS_TOKEN = origToken;
        process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
      }
    });
  });

  // -----------------------------------------------------------
  // 6. PII Masking
  // -----------------------------------------------------------
  describe("6. PII Masking", () => {
    it("6.1 Correctly masks email addresses in staging logs", () => {
      const masked = guard.maskRecipient("azhar@packzenblr.in", "email");
      assert.strictEqual(masked, "az***@packzenblr.in");

      const shortMasked = guard.maskRecipient("a@test.com", "email");
      assert.strictEqual(shortMasked, "a***@test.com");
    });

    it("6.2 Correctly masks phone numbers in staging logs", () => {
      const masked = guard.maskRecipient("+919945095453", "sms");
      assert.strictEqual(masked, "+91 **** 5453");
    });

    it("6.3 Correctly strips URL query params for webhook masking", () => {
      const masked = guard.maskRecipient("https://n8n.railway.app/webhook/flow?token=secret123", "webhook");
      assert.strictEqual(masked, "https://n8n.railway.app/webhook/flow");
    });
  });
});
