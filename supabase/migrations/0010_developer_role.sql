-- Add 'developer' to the allowed role set. This is the role Rawgrowth
-- operators get on every client instance — permanent access for support,
-- distinct from the client's own owner/admin/member users.

alter table rgaios_users
  drop constraint if exists rgaios_users_role_check;

alter table rgaios_users
  add constraint rgaios_users_role_check
  check (role in ('owner', 'admin', 'member', 'developer'));

alter table rgaios_invites
  drop constraint if exists rgaios_invites_role_check;

alter table rgaios_invites
  add constraint rgaios_invites_role_check
  check (role in ('owner', 'admin', 'member', 'developer'));
