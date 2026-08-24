-- Double-booking protection at the database level.
-- A staff member cannot have two active appointments (PENDING/CONFIRMED)
-- whose time ranges overlap. Cancelled / completed / no-show visits
-- release their slot.

-- btree_gist lets GiST index equality on a uuid column.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_staff_no_overlap"
  EXCLUDE USING gist (
    "staff_profile_id" WITH =,
    tstzrange("scheduled_for", "ends_at") WITH &&
  )
  WHERE ("status" IN ('PENDING'::"AppointmentStatus", 'CONFIRMED'::"AppointmentStatus"));
