import { redirect } from "next/navigation";

/**
 * The root has no content of its own. Middleware sends a signed-out visitor to
 * /login and a signed-in one past this redirect to the dashboard, so this only
 * runs for an authenticated request.
 */
export default function RootPage() {
  redirect("/dashboard");
}
