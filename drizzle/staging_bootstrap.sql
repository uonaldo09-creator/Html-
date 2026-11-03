-- Fresh UniInfo staging schema. Apply only through scripts/bootstrapStagingSchema.ts.
-- That runner requires an explicit confirmation, a Render PostgreSQL host,
-- and the exact uniinfo_staging database name before connecting.
-- This file creates schema objects only; it copies or seeds no application data.

DO $$
BEGIN
  IF current_setting('uniinfo.staging_bootstrap', true) IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'Refusing direct schema execution: use the guarded staging bootstrap runner.';
  END IF;
  IF current_database() <> 'uniinfo_staging' THEN
    RAISE EXCEPTION 'Refusing schema bootstrap: current database must be uniinfo_staging.';
  END IF;
END
$$;

CREATE TABLE public.users (
  id serial PRIMARY KEY,
  email varchar(255) NOT NULL CONSTRAINT users_email_unique UNIQUE,
  password text NOT NULL,
  role varchar(50) NOT NULL DEFAULT 'Student',
  name varchar(100),
  login_failures integer NOT NULL DEFAULT 0,
  locked_until bigint NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  email_verified boolean NOT NULL DEFAULT false,
  verification_token text,
  verification_expires timestamp,
  auth_subject text NOT NULL CONSTRAINT users_auth_subject_unique UNIQUE,
  token_version integer NOT NULL DEFAULT 0,
  disabled boolean NOT NULL DEFAULT false
);

CREATE TABLE public.universities (
  id integer PRIMARY KEY,
  name text NOT NULL,
  location text NOT NULL,
  state text NOT NULL,
  type text NOT NULL,
  fee integer NOT NULL,
  rating double precision NOT NULL,
  students text NOT NULL,
  courses integer NOT NULL,
  image text NOT NULL,
  logo text,
  categories jsonb NOT NULL,
  stream jsonb NOT NULL,
  degrees jsonb NOT NULL,
  majors jsonb NOT NULL,
  popular_courses jsonb NOT NULL,
  phone text NOT NULL,
  competitive_exams jsonb NOT NULL,
  min_10th integer NOT NULL,
  min_12th integer NOT NULL,
  naac_grade text NOT NULL,
  nirf_rank integer NOT NULL,
  aicte_approved boolean NOT NULL,
  nba_accredited boolean NOT NULL,
  nmc_recognized boolean NOT NULL,
  avg_placement_lpa double precision NOT NULL,
  website text,
  virtual_tour_url text,
  expert_insight text,
  alumni_stories jsonb,
  campus_map jsonb,
  directory_profile jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE public.sessions (
  token varchar(255) PRIMARY KEY,
  email varchar(255) NOT NULL,
  expires_at bigint NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  last_used_at timestamp NOT NULL DEFAULT now(),
  absolute_expires_at bigint NOT NULL
);

CREATE TABLE public.reviews (
  id serial PRIMARY KEY,
  university_id integer NOT NULL CONSTRAINT reviews_university_id_universities_id_fk
    REFERENCES public.universities(id) ON DELETE CASCADE,
  user_email varchar(255) NOT NULL,
  user_name varchar(100) NOT NULL DEFAULT 'Student',
  rating integer NOT NULL,
  comment text NOT NULL,
  avatar text,
  review_date varchar(50) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX reviews_university_id_idx ON public.reviews (university_id);
CREATE INDEX reviews_user_email_idx ON public.reviews (user_email);

CREATE TABLE public.bookmarks (
  id serial PRIMARY KEY,
  user_email varchar(255) NOT NULL CONSTRAINT bookmarks_user_email_users_email_fk
    REFERENCES public.users(email) ON DELETE CASCADE,
  university_id integer NOT NULL CONSTRAINT bookmarks_university_id_universities_id_fk
    REFERENCES public.universities(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT bookmarks_user_uni_unique_idx UNIQUE (user_email, university_id)
);

CREATE TABLE public.chat_history (
  id serial PRIMARY KEY,
  user_email varchar(255),
  role varchar(50) NOT NULL,
  content text NOT NULL,
  correlation_id varchar(255),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX chat_history_email_idx ON public.chat_history (user_email);

CREATE TABLE public.audit_logs (
  id serial PRIMARY KEY,
  action varchar(100) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_email varchar(255),
  ip varchar(100),
  status varchar(50),
  correlation_id varchar(255),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE public.analytics_events (
  id integer PRIMARY KEY,
  event_type varchar NOT NULL,
  details jsonb,
  user_email varchar,
  ip_address varchar,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE public.login_attempts (
  id serial PRIMARY KEY,
  ip varchar(100) NOT NULL,
  email varchar(255),
  success boolean NOT NULL,
  attempt_time timestamp NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_ip_idx ON public.login_attempts (ip);

CREATE TABLE public.student_profiles (
  id serial PRIMARY KEY,
  user_email varchar(255) NOT NULL,
  stream varchar(100),
  budget integer,
  preferred_location varchar(255),
  preferred_course varchar(255),
  entrance_exams jsonb,
  hostel_preference boolean NOT NULL DEFAULT false,
  placement_priority varchar(100),
  academic_scores jsonb,
  career_goals text,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT student_profiles_user_email_users_email_fk
    FOREIGN KEY (user_email) REFERENCES public.users(email) ON DELETE CASCADE,
  CONSTRAINT student_profiles_user_email_unique UNIQUE (user_email)
);

CREATE TABLE public.parent_profiles (
  id serial PRIMARY KEY,
  user_email varchar(255) NOT NULL,
  budget integer,
  preferred_state_city varchar(255),
  safety_preference varchar(100),
  roi_preference varchar(100),
  scholarship_preference varchar(100),
  distance_preference varchar(100),
  accommodation_preference varchar(100),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT parent_profiles_user_email_users_email_fk
    FOREIGN KEY (user_email) REFERENCES public.users(email) ON DELETE CASCADE,
  CONSTRAINT parent_profiles_user_email_unique UNIQUE (user_email)
);

CREATE TABLE public.notifications (
  id serial PRIMARY KEY,
  user_email varchar(255) NOT NULL,
  title varchar(255) NOT NULL,
  message text NOT NULL,
  type varchar(100) NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE public.university_reviews_agg (
  university_id integer NOT NULL PRIMARY KEY,
  avg_rating double precision,
  review_count integer NOT NULL DEFAULT 0,
  CONSTRAINT university_reviews_agg_university_id_universities_id_fk
    FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE CASCADE
);
