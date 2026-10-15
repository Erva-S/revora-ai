-- ====================================================================
-- REVORA — MEETING CLIENT & PROJECT ASSOCIATIONS AND DATA ISOLATION
-- Migration File: supabase/migrations/20261015030000_meeting_client_project.sql
-- ====================================================================

-- 1. Add client_id to public.meetings and public.planned_meetings
alter table public.meetings 
  add column if not exists client_id uuid references public.clients(id) on delete set null;

alter table public.planned_meetings 
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists meetings_client_id_idx on public.meetings(client_id);
create index if not exists planned_meetings_client_id_idx on public.planned_meetings(client_id);

-- 2. Update Row Level Security Policies for explicit client_id access
alter policy "Users can view own meetings" on public.meetings using (
  public.is_admin() 
  or user_id = auth.uid() 
  or (client_id is not null and client_id = public.get_auth_client_id())
  or (
    project_id is not null 
    and public.get_auth_client_id() is not null 
    and project_id in (select id from public.projects where client_id = public.get_auth_client_id())
  )
);

alter policy "planned_meetings_read" on public.planned_meetings using (
  public.is_admin() 
  or user_id = auth.uid() 
  or (client_id is not null and client_id = public.get_auth_client_id())
  or (
    project_id is not null 
    and public.get_auth_client_id() is not null 
    and project_id in (select id from public.projects where client_id = public.get_auth_client_id())
  )
);

-- 3. Validation function for admin meeting scheduling workflow
CREATE OR REPLACE FUNCTION public.validate_meeting_client_project(
  p_client_id uuid,
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client record;
  v_project record;
BEGIN
  IF p_client_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Client ID is required.');
  END IF;

  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Project ID is required.');
  END IF;

  SELECT id, name, company INTO v_client
  FROM public.clients
  WHERE id = p_client_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Selected client does not exist.');
  END IF;

  SELECT id, name, client_id INTO v_project
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Selected project does not exist.');
  END IF;

  IF v_project.client_id IS DISTINCT FROM v_client.id THEN
    RETURN jsonb_build_object('valid', false, 'error', 'The selected project does not belong to the selected client.');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'client_id', v_client.id,
    'client_name', v_client.name,
    'project_id', v_project.id,
    'project_name', v_project.name
  );
END;
$$;

-- 4. Helper functions to list clients and projects for scheduling
CREATE OR REPLACE FUNCTION public.get_schedulable_clients()
RETURNS TABLE (
  id uuid,
  name text,
  company text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.name, c.company
  FROM public.clients c
  ORDER BY c.name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_client_projects(p_client_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  client_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.client_id
  FROM public.projects p
  WHERE p.client_id = p_client_id
  ORDER BY p.name ASC;
END;
$$;

-- 5. Update check_user_meeting_access to include client_id
CREATE OR REPLACE FUNCTION public.check_user_meeting_access(p_meeting_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_user_email text;
  v_client_id uuid;
  v_role text;
BEGIN
  IF p_user_id IS NULL OR p_meeting_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT role, lower(email), client_id INTO v_role, v_user_email, v_client_id
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- 1. Meeting owner/creator
  IF EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = p_meeting_id
      AND m.user_id = p_user_id
  ) THEN
    RETURN true;
  END IF;

  -- 2. Client matching direct client_id or project client_id
  IF v_client_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.meetings m
      LEFT JOIN public.projects p ON p.id = m.project_id
      WHERE m.id = p_meeting_id
        AND (m.client_id = v_client_id OR p.client_id = v_client_id)
    ) THEN
      RETURN true;
    END IF;
  END IF;

  -- 3. Attendee in meeting_attendees
  IF EXISTS (
    SELECT 1 FROM public.meeting_attendees ma
    WHERE ma.meeting_id = p_meeting_id
      AND (
        ma.user_id = p_user_id
        OR (v_user_email IS NOT NULL AND lower(ma.email) = v_user_email)
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_meeting_client_project(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_schedulable_clients() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_client_projects(uuid) TO anon, authenticated, service_role;

