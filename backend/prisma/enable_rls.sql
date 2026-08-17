-- Enable Row Level Security (RLS) on all public schema tables in Supabase
-- This removes Supabase's "RLS disabled in public" security warning.
-- Note: Since SocialPilot connects via Node.js/Prisma using your private DATABASE_URL,
-- Prisma connects as the database owner and bypasses RLS while keeping PostgREST safe.

ALTER TABLE IF EXISTS "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "WorkspaceMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "InstagramAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Workflow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "WorkflowExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "WorkflowExecutionAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "OAuthState" ENABLE ROW LEVEL SECURITY;
