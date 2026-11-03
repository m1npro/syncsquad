CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS licenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 key_hash text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
 expires_at timestamptz,
 max_devices integer NOT NULL DEFAULT 1 CHECK (max_devices BETWEEN 1 AND 20),
 label text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz
);
CREATE TABLE IF NOT EXISTS license_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 license_id uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
 device_hash text NOT NULL,
 device_name text NOT NULL DEFAULT '',
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(license_id,device_hash)
);
CREATE INDEX IF NOT EXISTS license_devices_license_idx ON license_devices(license_id);
CREATE TABLE IF NOT EXISTS rate_buckets(bucket text PRIMARY KEY,attempts integer NOT NULL,window_start timestamptz NOT NULL);
CREATE OR REPLACE FUNCTION activate_minpro_license(p_key_hash text,p_device_hash text,p_device_name text)
RETURNS TABLE(code text, license_id uuid, license_expiry timestamptz, device_limit int)
LANGUAGE plpgsql AS $$
DECLARE lic licenses%ROWTYPE; active_count integer;
BEGIN
 SELECT * INTO lic FROM licenses l WHERE l.key_hash=p_key_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'invalid_key'::text,NULL::uuid,NULL::timestamptz,NULL::integer;RETURN;END IF;
 IF lic.status<>'active' THEN RETURN QUERY SELECT 'revoked'::text,lic.id,lic.expires_at,lic.max_devices;RETURN;END IF;
 IF lic.expires_at IS NOT NULL AND lic.expires_at<=now() THEN RETURN QUERY SELECT 'expired'::text,lic.id,lic.expires_at,lic.max_devices;RETURN;END IF;
 IF EXISTS(SELECT 1 FROM license_devices d WHERE d.license_id=lic.id AND d.device_hash=p_device_hash) THEN
  UPDATE license_devices d SET last_seen_at=now(),device_name=left(p_device_name,80) WHERE d.license_id=lic.id AND d.device_hash=p_device_hash;
 ELSE
  SELECT count(*) INTO active_count FROM license_devices d WHERE d.license_id=lic.id;
  IF active_count>=lic.max_devices THEN RETURN QUERY SELECT 'device_limit'::text,lic.id,lic.expires_at,lic.max_devices;RETURN;END IF;
  INSERT INTO license_devices(license_id,device_hash,device_name) VALUES(lic.id,p_device_hash,left(p_device_name,80));
 END IF;
 UPDATE licenses SET last_used_at=now() WHERE id=lic.id;
 RETURN QUERY SELECT 'ok'::text,lic.id,lic.expires_at,lic.max_devices;
END; $$;