alter function public.get_admin_dashboard_summary(timestamptz, integer) security invoker;
alter function public.get_admin_inventory_summary() security invoker;

revoke execute on function public.get_admin_dashboard_summary(timestamptz, integer) from public, anon;
grant execute on function public.get_admin_dashboard_summary(timestamptz, integer) to authenticated;
revoke execute on function public.get_admin_inventory_summary() from public, anon;
grant execute on function public.get_admin_inventory_summary() to authenticated;