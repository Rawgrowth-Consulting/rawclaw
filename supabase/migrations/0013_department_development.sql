-- Add 'development' to the allowed department list so engineering-focused
-- agents (Tyler & co.) have a home on the Departments page.

alter table rgaios_agents drop constraint if exists rgaios_agents_department_check;
alter table rgaios_agents add constraint rgaios_agents_department_check
  check (department in ('marketing', 'sales', 'fulfilment', 'finance', 'development'));
