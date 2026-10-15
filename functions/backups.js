/**
 * PackZen — daily Firestore backup (Level-100 Phase 0).
 * Every night at 2:30 AM IST, exports the whole database to Cloud Storage:
 *   gs://<BACKUP_BUCKET>/firestore/<YYYY-MM-DD>/
 *
 * One-time setup (see the deploy notes):
 *   1. Create a bucket, e.g. packzen-e7539-backups, region asia-south1, with a
 *      lifecycle rule "delete objects older than 30 days".
 *   2. Give the App Engine default service account
 *      (packzen-e7539@appspot.gserviceaccount.com) the roles
 *      "Cloud Datastore Import Export Admin" and "Storage Admin" on that bucket.
 *   3. (optional) set BACKUP_BUCKET in functions/.env.packzen-e7539 if you use another name.
 * If the bucket or permission is missing, the run logs an error and records an ops
 * failure (it appears in your daily ops digest); nothing else is affected.
 */
"use strict";
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const opsAlerts = require("./ops-alerts");

function backupPath(bucket, now) {
  const ist = new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  return `gs://${bucket}/firestore/${ist}`;
}

exports.dailyFirestoreBackup = functions
  .region("asia-south1")
  .pubsub.schedule("30 2 * * *").timeZone("Asia/Kolkata")
  .onRun(async () => {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "packzen-e7539";
    const bucket = (process.env.BACKUP_BUCKET || `${projectId}-backups`).replace(/^gs:\/\//, "");
    const client = new admin.firestore.v1.FirestoreAdminClient();
    try {
      const [op] = await client.exportDocuments({
        name: client.databasePath(projectId, "(default)"),
        outputUriPrefix: backupPath(bucket, new Date()),
        collectionIds: [], // empty = everything
      });
      functions.logger.info("firestore_backup_started", { operation: op.name, bucket });
    } catch (e) {
      functions.logger.error("firestore_backup_failed", { message: String(e && e.message).slice(0, 200), bucket });
      await opsAlerts.recordFailure(admin.firestore(), "dailyFirestoreBackup", "export_failed").catch(() => {});
    }
    return null;
  });

exports._backups = { backupPath };
