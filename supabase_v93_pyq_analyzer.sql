-- =====================================================================
--  v93: PYQ Analyzer upgrade — practice, progress, bookmarks, reports, free chapters, admin verification
--  Run ONCE in Supabase → SQL Editor → New query → paste → Run (after v92). Then run supabase_v35_admin_team.sql
--  again (it wraps the admin function and gives the new admin actions their permissions). Safe to run again.
--
--  Nothing is deleted or rewritten: only new columns (with empty defaults), new private tables and new functions.
--  Existing questions keep every value they have; they start as "not verified" until an admin verifies them.
--
--  What it adds
--   * cbt_pyq: difficulty, question type, concept, formula, NCERT reference, source, session, paper code,
--     verified, syllabus status (empty = follow the chapter's mapping in pyq-syllabus.js), updated_at.
--   * cbt_private.pyq_progress: each student's own answers, bookmarks and "to revise" marks (one row per question).
--     Students only ever reach their own rows (the student id comes from the sign-in, never from the request).
--   * cbt_private.pyq_reports: "Report an error" from students, reviewed in Admin → PYQ bank → Reports.
--   * cbt_private.pyq_free: chapters that are open to every plan (Free / Basic). Ultra (and any plan whose PYQ limit
--     is unlimited) opens every chapter. Admin → PYQ bank → Free chapters. With the plan locks off, all is open.
--   * cbt_private.pyq_audit: who changed a question, when, and what it looked like before.
--   * Students: cbt_pyq_summary (+ chapter extras, free list, access), cbt_pyq_chapter (+ new fields, free chapters
--     skip the plan check), cbt_pyq_attempt, cbt_pyq_mark, cbt_pyq_progress, cbt_pyq_questions, cbt_pyq_practice,
--     cbt_pyq_report.
--   * Admin (cbt_admin_pyq): get, add, save, verify, reports, report_set, free_get, free_set, dups, audit; list and
--     bulk know the new fields. Bulk import never marks questions verified.
-- =====================================================================

-- ---------- 1. new question fields (all optional) ----------
alter table public.cbt_pyq add column if not exists difficulty text not null default '';
alter table public.cbt_pyq add column if not exists qtype      text not null default '';
alter table public.cbt_pyq add column if not exists concept    text not null default '';
alter table public.cbt_pyq add column if not exists formula    text not null default '';
alter table public.cbt_pyq add column if not exists ncert_ref  text not null default '';
alter table public.cbt_pyq add column if not exists source_ref text not null default '';
alter table public.cbt_pyq add column if not exists session    text not null default '';
alter table public.cbt_pyq add column if not exists paper_code text not null default '';
alter table public.cbt_pyq add column if not exists verified   boolean not null default false;
alter table public.cbt_pyq add column if not exists syllabus   text not null default '';
alter table public.cbt_pyq add column if not exists updated_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cbt_pyq_v93_chk') then
    alter table public.cbt_pyq add constraint cbt_pyq_v93_chk check (
      difficulty in ('', 'easy', 'medium', 'hard')
      and qtype in ('', 'conceptual', 'numerical', 'statement', 'assertion', 'match', 'diagram')
      and syllabus in ('', 'current', 'partial', 'removed')
      and length(concept) <= 120 and length(formula) <= 600 and length(ncert_ref) <= 160 and length(source_ref) <= 200
      and length(session) <= 60 and length(paper_code) <= 30) not valid;
  end if;
end $$;
create index if not exists cbt_pyq_ex_ch on public.cbt_pyq (exam, chapter);
create index if not exists cbt_pyq_ex_yr on public.cbt_pyq (exam, year);

-- ---------- 2. private tables ----------
create table if not exists cbt_private.pyq_progress (
  student_id uuid not null references cbt_private.students(id) on delete cascade,
  qid        uuid not null references public.cbt_pyq(id) on delete cascade,
  exam       text not null default 'NEET',
  subject    text not null default '',
  chapter    text not null default '',
  choice     int,                               -- last option picked (0..3), null = not answered yet
  ok         boolean,                           -- last answer right?
  tries      int not null default 0,
  rights     int not null default 0,
  bm         boolean not null default false,    -- bookmarked
  rev        boolean not null default false,    -- marked "to revise"
  at         timestamptz not null default now(),
  primary key (student_id, qid)
);
create index if not exists pyq_progress_q on cbt_private.pyq_progress (qid);
create index if not exists pyq_progress_ch on cbt_private.pyq_progress (exam, chapter);

create table if not exists cbt_private.pyq_reports (
  id         uuid primary key default gen_random_uuid(),
  qid        uuid not null references public.cbt_pyq(id) on delete cascade,
  student_id uuid references cbt_private.students(id) on delete set null,
  reason     text not null check (reason in ('answer', 'question', 'options', 'solution', 'chapter', 'other')),
  note       text not null default '' check (length(note) <= 500),
  status     text not null default 'open' check (status in ('open', 'fixed', 'dismissed')),
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  done_by    text not null default ''
);
create index if not exists pyq_reports_open on cbt_private.pyq_reports (status, created_at desc);

create table if not exists cbt_private.pyq_free (
  exam    text not null default 'NEET',
  chapter text not null check (chapter ~ '^[A-Za-z0-9_-]{1,40}$'),
  primary key (exam, chapter)
);

create table if not exists cbt_private.pyq_audit (
  id     bigserial primary key,
  qid    uuid,
  act    text not null,
  who    text not null default '',
  at     timestamptz not null default now(),
  before jsonb
);
create index if not exists pyq_audit_q on cbt_private.pyq_audit (qid, at desc);

alter table cbt_private.pyq_progress enable row level security;
alter table cbt_private.pyq_reports enable row level security;
alter table cbt_private.pyq_free enable row level security;
alter table cbt_private.pyq_audit enable row level security;
revoke all on cbt_private.pyq_progress, cbt_private.pyq_reports, cbt_private.pyq_free, cbt_private.pyq_audit from public, anon, authenticated;
revoke all on sequence cbt_private.pyq_audit_id_seq from public, anon, authenticated;

-- ---------- 3. helpers ----------
-- may this student open this chapter's questions? null = yes. A free chapter is always yes (and not counted).
create or replace function cbt_private.pyq_can(p_sid uuid, p_exam text, p_chapter text, p_take boolean) returns jsonb
language plpgsql security definer set search_path = cbt_private, pg_temp as $$
begin
  if exists (select 1 from pyq_free where exam = p_exam and chapter = p_chapter) then return null; end if;
  return plan_use(p_sid, 'pyq', p_take);
end $$;
revoke all on function cbt_private.pyq_can(uuid, text, text, boolean) from public, anon, authenticated;

-- one question as the student app reads it
create or replace function cbt_private.pyq_item(p public.cbt_pyq) returns jsonb language sql stable
set search_path = cbt_private, pg_temp as $$
  select jsonb_build_object('id', p.id, 's', p.subject, 'c', p.chapter, 't', p.topic, 'y', p.year, 'p', p.paper, 'n', p.qno,
    'q', p.q, 'o', p.options, 'a', p.answer, 'e', p.explanation, 'img', p.has_img, 'k', p.rkey,
    'd', p.difficulty, 'ty', p.qtype, 'cn', p.concept, 'fm', p.formula, 'nr', p.ncert_ref, 'src', p.source_ref,
    'ss', p.session, 'pc', p.paper_code, 'v', p.verified, 'sy', p.syllabus,
    'rep', (select jsonb_agg(distinct r.paper) from public.cbt_pyq r where r.exam = p.exam and r.rkey = p.rkey and r.rkey <> ''))
$$;
revoke all on function cbt_private.pyq_item(public.cbt_pyq) from public, anon, authenticated;

-- ---------- 4. students: summary (counts only, open to every signed-in student) ----------
-- rows: [subject, chapter, topic, year, paper, n] as before.
-- ch:   {chapter: [easy, medium, hard, numerical, conceptual, verified, repeated, attempts by all students, right]}
--       (the last two are totals over every student, never one student's own data)
-- free: chapters open to every plan · acc: {plan, open (all chapters open for this student?)}
create or replace function public.cbt_pyq_summary(p_mobile text, p_code text, p_device text, p_exam text default 'NEET')
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; v_open boolean;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  v_open := plan_use(sid, 'pyq', false) is null;
  return jsonb_build_object('ok', true, 'v93', true,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(subject, chapter, topic, year, paper, n) order by year)
      from (select subject, chapter, topic, year, paper, count(*) n from public.cbt_pyq where exam = p_exam group by 1,2,3,4,5) x), '[]'::jsonb),
    'ch', coalesce((
      select jsonb_object_agg(chapter, jsonb_build_array(e, m, h, nu, co, ve, rp, coalesce(pa.t, 0), coalesce(pa.r, 0)))
      from (select chapter,
                   count(*) filter (where difficulty = 'easy') e, count(*) filter (where difficulty = 'medium') m,
                   count(*) filter (where difficulty = 'hard') h, count(*) filter (where qtype = 'numerical') nu,
                   count(*) filter (where qtype in ('conceptual', 'statement', 'assertion', 'match')) co,
                   count(*) filter (where verified) ve,
                   count(*) filter (where rkey <> '' and exists (select 1 from public.cbt_pyq r where r.exam = q.exam and r.rkey = q.rkey and r.paper <> q.paper)) rp
              from public.cbt_pyq q where exam = p_exam group by chapter) c
      left join (select chapter ch2, sum(tries) t, sum(rights) r from pyq_progress where exam = p_exam group by chapter) pa on pa.ch2 = c.chapter), '{}'::jsonb),
    'free', coalesce((select jsonb_agg(chapter order by chapter) from pyq_free where exam = p_exam), '[]'::jsonb),
    'acc', jsonb_build_object('plan', plan_of(sid), 'open', v_open));
end $$;
revoke all on function public.cbt_pyq_summary(text, text, text, text) from public;
grant execute on function public.cbt_pyq_summary(text, text, text, text) to anon, authenticated;

-- ---------- 5. students: one chapter's questions ----------
create or replace function public.cbt_pyq_chapter(p_mobile text, p_code text, p_device text, p_exam text, p_chapter text)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; v_sid uuid; v_p jsonb;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  v_sid := (a->>'id')::uuid;
  if not rate_ok(v_sid, 'pyq', 60) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;   -- v43
  v_p := pyq_can(v_sid, p_exam, p_chapter, true); if v_p is not null then return v_p; end if;   -- v91 plan_use, v93: free chapters skip it
  return jsonb_build_object('ok', true, 'v93', true, 'items', coalesce((
    select jsonb_agg(pyq_item(p) order by p.year desc, p.qno) from public.cbt_pyq p where p.exam = p_exam and p.chapter = p_chapter), '[]'::jsonb));
end $$;
revoke all on function public.cbt_pyq_chapter(text, text, text, text, text) from public;
grant execute on function public.cbt_pyq_chapter(text, text, text, text, text) to anon, authenticated;

-- ---------- 6. students: answer a question (the server decides right / wrong) ----------
create or replace function public.cbt_pyq_attempt(p_mobile text, p_code text, p_device text, p_q uuid, p_choice int)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; q public.cbt_pyq%rowtype; v_ok boolean;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if p_choice is null or p_choice not between 0 and 3 then return jsonb_build_object('ok', false, 'error', 'invalid_choice'); end if;
  select * into q from public.cbt_pyq where id = p_q;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not rate_ok(sid, 'pyqa', 600) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  if pyq_can(sid, q.exam, q.chapter, false) is not null then return pyq_can(sid, q.exam, q.chapter, false); end if;
  v_ok := q.answer is not null and p_choice = q.answer;
  insert into pyq_progress as g (student_id, qid, exam, subject, chapter, choice, ok, tries, rights)
  values (sid, q.id, q.exam, q.subject, q.chapter, p_choice, v_ok, 1, case when v_ok then 1 else 0 end)
  on conflict (student_id, qid) do update set choice = excluded.choice, ok = excluded.ok, tries = g.tries + 1,
    rights = g.rights + case when excluded.ok then 1 else 0 end, subject = excluded.subject, chapter = excluded.chapter, at = now();
  return jsonb_build_object('ok', true, 'right', v_ok, 'answer', q.answer);
end $$;
revoke all on function public.cbt_pyq_attempt(text, text, text, uuid, int) from public;
grant execute on function public.cbt_pyq_attempt(text, text, text, uuid, int) to anon, authenticated;

-- ---------- 7. students: bookmark / "to revise" (null = leave as it is) ----------
create or replace function public.cbt_pyq_mark(p_mobile text, p_code text, p_device text, p_q uuid, p_bm boolean default null, p_rev boolean default null)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; q public.cbt_pyq%rowtype;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  select * into q from public.cbt_pyq where id = p_q;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not rate_ok(sid, 'pyqm', 600) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  insert into pyq_progress as g (student_id, qid, exam, subject, chapter, bm, rev)
  values (sid, q.id, q.exam, q.subject, q.chapter, coalesce(p_bm, false), coalesce(p_rev, false))
  on conflict (student_id, qid) do update set bm = coalesce(p_bm, g.bm), rev = coalesce(p_rev, g.rev);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cbt_pyq_mark(text, text, text, uuid, boolean, boolean) from public;
grant execute on function public.cbt_pyq_mark(text, text, text, uuid, boolean, boolean) to anon, authenticated;

-- ---------- 8. students: my own progress (never anyone else's) ----------
-- items: [qid, subject, chapter, choice, ok, tries, bookmarked, to revise, time ms]
create or replace function public.cbt_pyq_progress(p_mobile text, p_code text, p_device text, p_exam text default 'NEET')
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_array(qid, subject, chapter, choice, ok, tries, bm, rev, (extract(epoch from at) * 1000)::bigint) order by at desc)
    from (select * from pyq_progress where student_id = sid and exam = p_exam order by at desc limit 6000) x), '[]'::jsonb));
end $$;
revoke all on function public.cbt_pyq_progress(text, text, text, text) from public;
grant execute on function public.cbt_pyq_progress(text, text, text, text) to anon, authenticated;

-- ---------- 9. students: questions by id (revision lists), only chapters the student may open ----------
create or replace function public.cbt_pyq_questions(p_mobile text, p_code text, p_device text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; v_open boolean;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if coalesce(cardinality(p_ids), 0) = 0 then return jsonb_build_object('ok', true, 'items', '[]'::jsonb); end if;
  if cardinality(p_ids) > 100 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  if not rate_ok(sid, 'pyqq', 120) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  v_open := plan_use(sid, 'pyq', false) is null;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(pyq_item(p)) from public.cbt_pyq p
     where p.id = any(p_ids) and (v_open or exists (select 1 from pyq_free f where f.exam = p.exam and f.chapter = p.chapter))), '[]'::jsonb));
end $$;
revoke all on function public.cbt_pyq_questions(text, text, text, uuid[]) from public;
grant execute on function public.cbt_pyq_questions(text, text, text, uuid[]) to anon, authenticated;

-- ---------- 10. students: smart practice (the server picks real PYQs only) ----------
-- p_f: {exam, subject, chapters:[...], topics:[...], y0, y1, diff:'easy|medium|hard', qtype, cur:true (current syllabus only;
--       the app sends the chapters that are in the syllabus), rep:true (repeated only), mode:'all|new|wrong|weak|bm', n (5..90)}
-- Students whose plan does not include every chapter get questions from the free chapters only ('limited': true).
create or replace function public.cbt_pyq_practice(p_mobile text, p_code text, p_device text, p_f jsonb)
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; f jsonb := case when jsonb_typeof(p_f) = 'object' then p_f else '{}'::jsonb end;
        v_exam text := coalesce(nullif(f->>'exam', ''), 'NEET'); v_n int; v_open boolean; v_ch text[]; v_tp text[]; v_mode text := coalesce(f->>'mode', 'all');
        v_y0 int; v_y1 int; v_items jsonb;
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if not rate_ok(sid, 'pyqp', 60) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  v_n := least(greatest(coalesce(nullif(f->>'n', '')::int, 20), 1), 90);
  v_y0 := nullif(f->>'y0', '')::int; v_y1 := nullif(f->>'y1', '')::int;
  select array_agg(x) into v_ch from jsonb_array_elements_text(case when jsonb_typeof(f->'chapters') = 'array' then f->'chapters' else '[]'::jsonb end) x;
  select array_agg(x) into v_tp from jsonb_array_elements_text(case when jsonb_typeof(f->'topics') = 'array' then f->'topics' else '[]'::jsonb end) x;
  if v_mode not in ('all', 'new', 'wrong', 'weak', 'bm') then v_mode := 'all'; end if;
  v_open := plan_use(sid, 'pyq', false) is null;
  if v_open then perform plan_use(sid, 'pyq', true); end if;   -- one practice set = one use (counted, never refused here)
  select coalesce(jsonb_agg(pyq_item(p)), '[]'::jsonb) into v_items from public.cbt_pyq p where p.id in (
    select p.id from public.cbt_pyq p
      left join pyq_progress g on g.student_id = sid and g.qid = p.id
     where p.exam = v_exam
       and (coalesce(f->>'subject', '') = '' or p.subject = f->>'subject')
       and (v_ch is null or p.chapter = any(v_ch))
       and (v_tp is null or p.topic = any(v_tp))
       and (v_y0 is null or p.year >= v_y0) and (v_y1 is null or p.year <= v_y1)
       and (coalesce(f->>'diff', '') = '' or p.difficulty = f->>'diff')
       and (coalesce(f->>'qtype', '') = '' or p.qtype = f->>'qtype')
       and (coalesce((f->>'rep')::boolean, false) is false or (p.rkey <> '' and exists (select 1 from public.cbt_pyq r where r.exam = p.exam and r.rkey = p.rkey and r.paper <> p.paper)))
       and p.answer between 0 and 3 and jsonb_array_length(p.options) >= 2
       and (v_open or exists (select 1 from pyq_free fr where fr.exam = p.exam and fr.chapter = p.chapter))
       and case v_mode when 'new' then g.choice is null
                       when 'wrong' then g.ok is false
                       when 'bm' then coalesce(g.bm, false) or coalesce(g.rev, false)
                       when 'weak' then p.chapter in (select chapter from pyq_progress w where w.student_id = sid and w.exam = v_exam and w.choice is not null
                                                       group by chapter having count(*) >= 3 and avg(case when w.ok then 1.0 else 0 end) < 0.6)
                       else true end
     order by random() limit v_n);
  return jsonb_build_object('ok', true, 'items', v_items, 'limited', not v_open);
end $$;
revoke all on function public.cbt_pyq_practice(text, text, text, jsonb) from public;
grant execute on function public.cbt_pyq_practice(text, text, text, jsonb) to anon, authenticated;

-- ---------- 11. students: report an error ----------
create or replace function public.cbt_pyq_report(p_mobile text, p_code text, p_device text, p_q uuid, p_reason text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = cbt_private, pg_temp as $$
declare a jsonb; sid uuid; v_note text := left(btrim(regexp_replace(coalesce(p_note, ''), '[\x00-\x08\x0B-\x1F\x7F]', '', 'g')), 500);
begin
  a := auth(p_mobile, p_code, p_device);
  if not (a->>'ok')::boolean then return a; end if;
  sid := (a->>'id')::uuid;
  if coalesce(p_reason, '') not in ('answer', 'question', 'options', 'solution', 'chapter', 'other') then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if not exists (select 1 from public.cbt_pyq where id = p_q) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if exists (select 1 from pyq_reports where qid = p_q and student_id = sid and status = 'open') then return jsonb_build_object('ok', true, 'already', true); end if;
  if (select count(*) from pyq_reports where student_id = sid and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  insert into pyq_reports (qid, student_id, reason, note) values (p_q, sid, p_reason, v_note);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cbt_pyq_report(text, text, text, uuid, text, text) from public;
grant execute on function public.cbt_pyq_report(text, text, text, uuid, text, text) to anon, authenticated;

-- ---------- 12. admin ----------
create or replace function public.cbt_admin_pyq(p_pw text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb; x jsonb; n int := 0; v_exam text := coalesce(p_data->>'exam', 'NEET'); v_id uuid; qr public.cbt_pyq%rowtype;
        v_who text := coalesce(nullif(current_setting('cbt.who', true), ''), 'Owner'); v_ids uuid[];
begin
  a := (public.cbt_admin(p_pw, 'ping', '{}'))::text::jsonb;
  if coalesce((a->>'ok')::boolean, false) is not true then return a; end if;

  if p_action = 'papers' then
    return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('paper', paper, 'year', year, 'n', y.n, 'subjects', s, 'verified', y.v) order by year desc, paper)
      from (select paper, year, count(*) n, count(*) filter (where verified) v, jsonb_agg(distinct subject) s from public.cbt_pyq where exam = v_exam group by paper, year) y), '[]'::jsonb),
      'total', (select count(*) from public.cbt_pyq where exam = v_exam),
      'verified', (select count(*) from public.cbt_pyq where exam = v_exam and verified),
      'open_reports', (select count(*) from cbt_private.pyq_reports where status = 'open'));

  elsif p_action = 'list' then
    return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'subject', subject, 'chapter', chapter, 'topic', topic, 'year', year, 'paper', paper, 'qno', qno,
             'q', left(q, 300), 'verified', verified, 'difficulty', difficulty, 'qtype', qtype, 'syllabus', syllabus) order by year desc, qno)
      from (select * from public.cbt_pyq where exam = v_exam
              and (coalesce(p_data->>'paper','') = '' or paper = p_data->>'paper')
              and (coalesce(p_data->>'chapter','') = '' or chapter = p_data->>'chapter')
            order by year desc, qno limit 400) l), '[]'::jsonb));

  elsif p_action = 'get' then
    select * into qr from public.cbt_pyq where id = (p_data->>'id')::uuid;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    return jsonb_build_object('ok', true, 'item', to_jsonb(qr));

  elsif p_action = 'bulk' then
    for x in select * from jsonb_array_elements(coalesce(p_data->'items', '[]'::jsonb)) loop
      exit when n >= 400;
      insert into public.cbt_pyq (exam, subject, chapter, topic, year, paper, qno, q, options, answer, explanation, has_img, rkey,
                                  difficulty, qtype, concept, formula, ncert_ref, source_ref, session, paper_code, syllabus)
      values (v_exam, left(x->>'subject', 10), left(x->>'chapter', 40), left(coalesce(x->>'topic', ''), 80), (x->>'year')::int, left(x->>'paper', 60),
              nullif(x->>'qno', '')::int, left(x->>'q', 4000), coalesce(x->'options', '[]'::jsonb), nullif(x->>'answer', '')::int,
              left(coalesce(x->>'explanation', ''), 4000), coalesce((x->>'has_img')::boolean, false), left(coalesce(x->>'rkey', ''), 120),
              case when x->>'difficulty' in ('easy', 'medium', 'hard') then x->>'difficulty' else '' end,
              case when x->>'qtype' in ('conceptual', 'numerical', 'statement', 'assertion', 'match', 'diagram') then x->>'qtype' else '' end,
              left(coalesce(x->>'concept', ''), 120), left(coalesce(x->>'formula', ''), 600), left(coalesce(x->>'ncert_ref', ''), 160),
              left(coalesce(x->>'source_ref', ''), 200), left(coalesce(x->>'session', ''), 60), left(coalesce(x->>'paper_code', ''), 30),
              case when x->>'syllabus' in ('current', 'partial', 'removed') then x->>'syllabus' else '' end);
      n := n + 1;
    end loop;
    return jsonb_build_object('ok', true, 'added', n);   -- imported questions are never marked verified

  elsif p_action = 'update' then
    select * into qr from public.cbt_pyq where id = (p_data->>'id')::uuid;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    insert into cbt_private.pyq_audit (qid, act, who, before) values (qr.id, 'tags', v_who, jsonb_build_object('subject', qr.subject, 'chapter', qr.chapter, 'topic', qr.topic));
    update public.cbt_pyq set subject = coalesce(p_data->>'subject', subject), chapter = coalesce(p_data->>'chapter', chapter), topic = coalesce(p_data->>'topic', topic), updated_at = now()
     where id = qr.id;
    return jsonb_build_object('ok', true);

  elsif p_action in ('save', 'add') then
    x := coalesce(p_data->'item', '{}'::jsonb);
    if coalesce(btrim(x->>'q'), '') = '' or coalesce(x->>'subject', '') not in ('phy', 'chem', 'bio') or coalesce(x->>'chapter', '') = ''
       or coalesce(x->>'paper', '') = '' or coalesce(nullif(x->>'year', '')::int, 0) not between 1980 and 2100
       or jsonb_typeof(x->'options') is distinct from 'array' or jsonb_array_length(x->'options') <> 4
       or (nullif(x->>'answer', '') is not null and (x->>'answer')::int not between 0 and 3) then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    if p_action = 'add' then
      insert into public.cbt_pyq (exam, subject, chapter, topic, year, paper, qno, q, options, answer, rkey) values
        (v_exam, x->>'subject', left(x->>'chapter', 40), '', (x->>'year')::int, left(x->>'paper', 60), null, left(x->>'q', 4000), x->'options', null, '')
      returning id into v_id;
      insert into cbt_private.pyq_audit (qid, act, who) values (v_id, 'add', v_who);
    else
      v_id := (p_data->>'id')::uuid;
      select * into qr from public.cbt_pyq where id = v_id;
      if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
      insert into cbt_private.pyq_audit (qid, act, who, before) values (v_id, 'edit', v_who, to_jsonb(qr) - 'rkey' - 'exam' - 'created_at');
    end if;
    update public.cbt_pyq set subject = x->>'subject', chapter = left(x->>'chapter', 40), topic = left(coalesce(x->>'topic', ''), 80),
      year = (x->>'year')::int, paper = left(x->>'paper', 60), qno = nullif(x->>'qno', '')::int, q = left(x->>'q', 4000), options = x->'options',
      answer = nullif(x->>'answer', '')::int, explanation = left(coalesce(x->>'explanation', ''), 4000), has_img = coalesce((x->>'has_img')::boolean, has_img),
      rkey = left(coalesce(nullif(x->>'rkey', ''), rkey), 120),
      difficulty = case when x->>'difficulty' in ('easy', 'medium', 'hard') then x->>'difficulty' else '' end,
      qtype = case when x->>'qtype' in ('conceptual', 'numerical', 'statement', 'assertion', 'match', 'diagram') then x->>'qtype' else '' end,
      concept = left(coalesce(x->>'concept', ''), 120), formula = left(coalesce(x->>'formula', ''), 600), ncert_ref = left(coalesce(x->>'ncert_ref', ''), 160),
      source_ref = left(coalesce(x->>'source_ref', ''), 200), session = left(coalesce(x->>'session', ''), 60), paper_code = left(coalesce(x->>'paper_code', ''), 30),
      syllabus = case when x->>'syllabus' in ('current', 'partial', 'removed') then x->>'syllabus' else '' end,
      verified = coalesce((x->>'verified')::boolean, false) and nullif(x->>'answer', '') is not null,
      updated_at = now()
     where id = v_id;
    return jsonb_build_object('ok', true, 'id', v_id);

  elsif p_action = 'verify' then
    -- {ids:[...], on:true|false} or {paper:'NEET 2024', on:true}; only questions with an answer can be verified
    select array_agg(x2::uuid) into v_ids from jsonb_array_elements_text(case when jsonb_typeof(p_data->'ids') = 'array' then p_data->'ids' else '[]'::jsonb end) x2;
    insert into cbt_private.pyq_audit (qid, act, who, before)
      select id, case when coalesce((p_data->>'on')::boolean, true) then 'verify' else 'unverify' end, v_who, jsonb_build_object('verified', verified)
        from public.cbt_pyq where exam = v_exam and (id = any(coalesce(v_ids, '{}')) or (coalesce(p_data->>'paper', '') <> '' and paper = p_data->>'paper'));
    update public.cbt_pyq set verified = coalesce((p_data->>'on')::boolean, true) and answer between 0 and 3, updated_at = now()
     where exam = v_exam and (id = any(coalesce(v_ids, '{}')) or (coalesce(p_data->>'paper', '') <> '' and paper = p_data->>'paper'));
    get diagnostics n = row_count;
    return jsonb_build_object('ok', true, 'n', n);

  elsif p_action = 'delete' then
    select * into qr from public.cbt_pyq where id = (p_data->>'id')::uuid;
    if found then insert into cbt_private.pyq_audit (qid, act, who, before) values (qr.id, 'delete', v_who, to_jsonb(qr)); end if;
    delete from public.cbt_pyq where id = (p_data->>'id')::uuid;
    return jsonb_build_object('ok', true);

  elsif p_action = 'delete_paper' then
    insert into cbt_private.pyq_audit (qid, act, who, before)
      values (null, 'delete_paper', v_who, jsonb_build_object('paper', p_data->>'paper', 'n', (select count(*) from public.cbt_pyq where exam = v_exam and paper = p_data->>'paper')));
    delete from public.cbt_pyq where exam = v_exam and paper = p_data->>'paper';
    return jsonb_build_object('ok', true);

  elsif p_action = 'reports' then
    return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'qid', r.qid, 'reason', r.reason, 'note', r.note, 'status', r.status,
             'at', (extract(epoch from r.created_at) * 1000)::bigint, 'paper', p.paper, 'qno', p.qno, 'chapter', p.chapter, 'subject', p.subject, 'q', left(p.q, 240)) order by r.created_at desc)
      from (select * from cbt_private.pyq_reports where status = case when coalesce(p_data->>'status', 'open') in ('open', 'fixed', 'dismissed') then coalesce(p_data->>'status', 'open') else 'open' end
            order by created_at desc limit 200) r join public.cbt_pyq p on p.id = r.qid), '[]'::jsonb));

  elsif p_action = 'report_set' then
    if coalesce(p_data->>'status', '') not in ('open', 'fixed', 'dismissed') then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
    update cbt_private.pyq_reports set status = p_data->>'status', done_at = case when p_data->>'status' = 'open' then null else now() end, done_by = v_who
     where id = (p_data->>'id')::uuid;
    return jsonb_build_object('ok', true);

  elsif p_action = 'free_get' then
    return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(chapter order by chapter) from cbt_private.pyq_free where exam = v_exam), '[]'::jsonb));

  elsif p_action = 'free_set' then
    if jsonb_typeof(p_data->'chapters') is distinct from 'array' or jsonb_array_length(p_data->'chapters') > 200 then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
    delete from cbt_private.pyq_free where exam = v_exam;
    insert into cbt_private.pyq_free (exam, chapter)
      select distinct v_exam, c from jsonb_array_elements_text(p_data->'chapters') c where c ~ '^[A-Za-z0-9_-]{1,40}$';
    return jsonb_build_object('ok', true, 'n', (select count(*) from cbt_private.pyq_free where exam = v_exam));

  elsif p_action = 'dups' then
    -- exact = same text twice in the same paper (an import mistake); repeated = same text in different papers (a real repeat)
    return jsonb_build_object('ok', true,
      'exact', coalesce((select jsonb_agg(jsonb_build_object('paper', paper, 'k', rkey, 'ids', ids, 'q', qq) order by paper)
        from (select paper, rkey, jsonb_agg(id) ids, left(min(q), 160) qq from public.cbt_pyq where exam = v_exam and rkey <> '' group by paper, rkey having count(*) > 1 limit 200) d), '[]'::jsonb),
      'repeated', coalesce((select jsonb_agg(jsonb_build_object('k', rkey, 'papers', ps, 'n', c, 'q', qq) order by c desc)
        from (select rkey, jsonb_agg(distinct paper) ps, count(distinct paper) c, left(min(q), 160) qq from public.cbt_pyq where exam = v_exam and rkey <> '' group by rkey having count(distinct paper) > 1 order by count(distinct paper) desc limit 200) r), '[]'::jsonb));

  elsif p_action = 'audit' then
    return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('act', act, 'who', who, 'at', (extract(epoch from at) * 1000)::bigint, 'before', before, 'qid', qid) order by at desc)
      from (select * from cbt_private.pyq_audit where (coalesce(p_data->>'id', '') = '' or qid = (p_data->>'id')::uuid) order by at desc limit 100) l), '[]'::jsonb));
  end if;
  return jsonb_build_object('ok', false, 'error', 'action');
end; $$;
revoke all on function public.cbt_admin_pyq(text, text, jsonb) from public, authenticated;
grant execute on function public.cbt_admin_pyq(text, text, jsonb) to anon;

notify pgrst, 'reload schema';
select 'v93 installed — now run supabase_v35_admin_team.sql again' as status;
