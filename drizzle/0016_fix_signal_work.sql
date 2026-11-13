-- 0014's CASE expression resolved NEW.run_at for outbox rows too (no such column). Branch with IF so
-- each table only touches its own column.
CREATE OR REPLACE FUNCTION app_signal_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE due timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    due := NEW.run_at;
  ELSE
    due := NEW.available_at;
  END IF;
  INSERT INTO org_work_signals (organization_id, due_at) VALUES (NEW.organization_id, due)
  ON CONFLICT (organization_id) DO UPDATE SET due_at = LEAST(org_work_signals.due_at, EXCLUDED.due_at);
  RETURN NEW;
END $$;
