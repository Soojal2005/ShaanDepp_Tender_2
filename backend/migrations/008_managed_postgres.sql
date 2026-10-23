-- RDS and Supabase administrators are not PostgreSQL superusers. Explicit
-- membership allows the owner connection used for bootstrap to SET LOCAL ROLE.
GRANT app_api_user TO CURRENT_USER;
