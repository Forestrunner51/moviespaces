-- The crowdfunding feature (and its `spaces`/`space_pledges` tables) was
-- removed, but is_group_message_member() still referenced them in a
-- 'crowdfund' case branch. Since this is a `language sql` function, Postgres
-- resolves every table reference in the body at parse time regardless of
-- which branch actually runs — so sending a normal 'group' chat message
-- failed with "relation \"spaces\" does not exist" even though that branch
-- was never reached. Only 'group' is ever used now, so drop the dead branch.

create or replace function public.is_group_message_member(p_group_type text, p_group_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case p_group_type
    when 'group' then
      exists (
        select 1 from "Groups" g
        where g."Id" = p_group_id and g.user_id = auth.uid()::text
      )
      or exists (
        select 1 from "GroupMembers" gm
        where gm."GroupId" = p_group_id and gm.user_id = auth.uid()::text
      )
    else false
  end;
$$;
