# Phase 2A/2B — driver profiles, presence, shadow recommendations, manual assignment

## Data model
| Doc | Written by | Notes |
|---|---|---|
| `users/{uid}` | unchanged | identity + role; `isOnline/lat/lng/locationUpdatedAt/currentBooking` still written (dual-write) |
| `driverProfiles/{uid}` | `adminUpsertDriverProfile` only | status, serviceAreas, vehicleIds (pricing-engine vehicles), skills, partnerId, maxJobsPerDay, homeBase (+geohash), phoneVerified; server-maintained rating/acceptance/lastOfferedAt |
| `driverPresence/{uid}` | the driver (own doc) | online, lat, lng, geohash, updatedAt (= server time), appVersion |
| `driverSchedule/{uid}_{date}` | `adminAssignDriver` only | `jobs: { bookingId: startMinute }` — transaction lock against double-booking |
| `assignmentRecommendations/{bookingId}` | shadow mode only | staff-readable; never touches bookings |
| `appConfig/assignment` | console / Admin SDK | `{ shadowEnabled: false }` disables the sweep; `engine: { weights, … }` overrides engine config |

Bookings are not migrated: `driverUid / driverName / driverPhone` remain the source of truth; `isAssignedDriver` is unchanged.

## Backfill (run once after deploying Functions + rules; safe to repeat)
```
cd functions && npm ci && cd ..
gcloud auth application-default login
node scripts/backfill-driver-profiles.js --project packzen-e7539           # dry run (read-only)
node scripts/backfill-driver-profiles.js --project packzen-e7539 --apply   # creates missing docs only
```
Existing drivers get `status: "active"`, `skills: ["moving"]`, **no vehicles** — set vehicles in admin (Drivers → Profile).

## Shadow mode
* `shadowAssignmentSweep` (every 30 min) stores recommendations for unassigned pending/confirmed bookings in the next 3 IST days.
* The admin assign dialog calls `adminGetAssignmentRecommendation` and shows the top driver with a "Use" button. The admin still chooses.
* Shadow mode never writes bookings or users. Automatic offers (2C) are not implemented.
* **Disable:** set Firestore `appConfig/assignment.shadowEnabled = false`, or pause the Cloud Scheduler job `firebase-schedule-shadowAssignmentSweep-asia-south1`.

## Manual assignment (`adminAssignDriver`)
Admin only; `{ bookingId, driverUid, expectedDriverUid, overrideReason? }`. One transaction re-reads the booking
(must still have `expectedDriverUid`), the driver, profile, presence and schedule lock; blocks schedule conflicts and
non-active drivers; area/vehicle/skill/capacity failures need a recorded override reason; drivers without a profile
(pre-backfill) remain assignable with a warning. Writes booking `driverUid/Name/Phone`, `status: "assigned"`,
`assignment{…}`, the schedule lock and `users.currentBooking` (releasing the previous driver's).
The advisor dashboard still assigns by direct write (planned to move to the callable before 2C).
